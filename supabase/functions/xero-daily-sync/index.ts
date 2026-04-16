import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const SYNC_XERO_URL = `${SUPABASE_URL}/functions/v1/sync-xero`;
const PAGE_SIZE = 100;

interface Tenant {
  tenant_id: string;
  tenant_name: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface Endpoint {
  path: string;
  key: string;
  responseKey: string;
  paginated: boolean;
}

const ENDPOINTS: Endpoint[] = [
  { path: "Invoices?where=Type%3D%22ACCPAY%22", key: "bills", responseKey: "Invoices", paginated: true },
  { path: "Invoices?where=Type%3D%22ACCREC%22", key: "ar_invoices", responseKey: "Invoices", paginated: true },
  { path: "Contacts", key: "contacts", responseKey: "Contacts", paginated: true },
  { path: "Accounts", key: "accounts", responseKey: "Accounts", paginated: false },
  { path: "BankTransactions", key: "bank_transactions", responseKey: "BankTransactions", paginated: true },
  { path: "CreditNotes", key: "credit_notes", responseKey: "CreditNotes", paginated: true },
  { path: "Journals", key: "journals", responseKey: "Journals", paginated: true },
  { path: "PurchaseOrders", key: "purchase_orders", responseKey: "PurchaseOrders", paginated: true },
  { path: "TrackingCategories", key: "tracking_categories", responseKey: "TrackingCategories", paginated: false },
];

// ── Supabase helpers ────────────────────────────────────────────────────

function dbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function loadTenants(): Promise<Tenant[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/xero_oauth_tokens?select=tenant_id,tenant_name,client_id,client_secret,refresh_token`,
    { headers: dbHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to load tenants: ${await res.text()}`);
  return res.json();
}

async function saveTokens(tenantId: string, accessToken: string, refreshToken: string, expiresIn: number) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/xero_oauth_tokens?tenant_id=eq.${tenantId}`,
    {
      method: "PATCH",
      headers: { ...dbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save tokens: ${await res.text()}`);
}

// ── Xero OAuth ──────────────────────────────────────────────────────────

async function refreshAccessToken(tenant: Tenant): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tenant.refresh_token,
    client_id: tenant.client_id,
    client_secret: tenant.client_secret,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Xero token refresh failed for ${tenant.tenant_name}: ${res.status} ${err}`);
  }

  const data = await res.json();
  await saveTokens(tenant.tenant_id, data.access_token, data.refresh_token, data.expires_in);
  return data.access_token;
}

// ── Xero API fetching ───────────────────────────────────────────────────

async function xeroGet(url: string, tenantId: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Xero API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchEndpoint(endpoint: Endpoint, tenantId: string, accessToken: string): Promise<unknown[]> {
  if (!endpoint.paginated) {
    const data = await xeroGet(`${XERO_API_BASE}/${endpoint.path}`, tenantId, accessToken);
    return (data as Record<string, unknown>)[endpoint.responseKey] as unknown[] ?? [];
  }

  const all: unknown[] = [];
  let page = 1;
  const sep = endpoint.path.includes("?") ? "&" : "?";

  while (true) {
    const data = await xeroGet(`${XERO_API_BASE}/${endpoint.path}${sep}page=${page}`, tenantId, accessToken);
    const records = (data as Record<string, unknown>)[endpoint.responseKey] as unknown[] ?? [];
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ── Sync to Supabase ────────────────────────────────────────────────────

async function syncToSupabase(tenantId: string, tenantName: string, key: string, records: unknown[]) {
  if (!records.length) return { skipped: true, count: 0 };

  const res = await fetch(SYNC_XERO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId, tenantName, [key]: records }),
  });

  if (!res.ok) throw new Error(`sync-xero failed for ${key}: ${await res.text()}`);
  return res.json();
}

// ── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });

  const startTime = Date.now();
  const results: Record<string, unknown> = {};

  try {
    const tenants = await loadTenants();
    if (!tenants.length) return Response.json({ error: "No tenants configured" }, { status: 400 });

    for (const tenant of tenants) {
      const tenantResults: Record<string, unknown> = {};

      // Refresh access token
      let accessToken: string;
      try {
        accessToken = await refreshAccessToken(tenant);
        tenantResults._tokenRefresh = "success";
      } catch (e) {
        tenantResults._tokenRefresh = { error: String(e) };
        results[tenant.tenant_name] = tenantResults;
        continue;
      }

      // Fetch + sync each endpoint
      for (const endpoint of ENDPOINTS) {
        try {
          const records = await fetchEndpoint(endpoint, tenant.tenant_id, accessToken);
          const syncResult = await syncToSupabase(tenant.tenant_id, tenant.tenant_name, endpoint.key, records);
          tenantResults[endpoint.key] = { fetched: records.length, synced: syncResult };
        } catch (e) {
          tenantResults[endpoint.key] = { error: String(e) };
        }
      }

      results[tenant.tenant_name] = tenantResults;
    }

    return Response.json({
      success: true,
      duration_ms: Date.now() - startTime,
      results,
    });
  } catch (e) {
    console.error("xero-daily-sync error:", e);
    return Response.json({ error: String(e), duration_ms: Date.now() - startTime }, { status: 500 });
  }
});
