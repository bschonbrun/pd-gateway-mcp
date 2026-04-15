import { loadTemplate, resolveParams } from './template-loader.js';

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const PAGE_SIZE = 100;

interface XeroTenant {
  id: string;
  name: string;
}

interface XeroEndpoint {
  path: string;
  key: string;
  responseKey: string;
  paginated: boolean;
}

interface SyncResult {
  tenant: string;
  endpoint: string;
  fetched: number;
  synced: unknown;
  error?: string;
}

export interface XeroSyncOptions {
  xeroAccessToken: string;
  dryRun?: boolean;
  overrides?: Record<string, unknown>;
}

export async function executeXeroSync(options: XeroSyncOptions): Promise<{
  results: SyncResult[];
  summary: { total_fetched: number; total_endpoints: number; errors: number };
}> {
  const template = await loadTemplate('daily-xero-sync');
  const params = resolveParams(template, options.overrides);

  const tenants = params.tenants as XeroTenant[];
  const endpoints = params.endpoints as XeroEndpoint[];
  const syncUrl = params.sync_edge_function as string;

  const results: SyncResult[] = [];

  for (const tenant of tenants) {
    for (const endpoint of endpoints) {
      const result = await syncEndpoint(
        tenant,
        endpoint,
        options.xeroAccessToken,
        syncUrl,
        options.dryRun ?? false,
      );
      results.push(result);
    }
  }

  return {
    results,
    summary: {
      total_fetched: results.reduce((sum, r) => sum + r.fetched, 0),
      total_endpoints: results.length,
      errors: results.filter(r => r.error).length,
    },
  };
}

async function syncEndpoint(
  tenant: XeroTenant,
  endpoint: XeroEndpoint,
  accessToken: string,
  syncUrl: string,
  dryRun: boolean,
): Promise<SyncResult> {
  try {
    const records = endpoint.paginated
      ? await fetchPaginated(endpoint, tenant.id, accessToken)
      : await fetchSingle(endpoint, tenant.id, accessToken);

    if (dryRun) {
      return { tenant: tenant.name, endpoint: endpoint.key, fetched: records.length, synced: 'dry_run' };
    }

    if (!records.length) {
      return { tenant: tenant.name, endpoint: endpoint.key, fetched: 0, synced: 'skipped_empty' };
    }

    const syncRes = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: tenant.id,
        tenantName: tenant.name,
        [endpoint.key]: records,
      }),
    });

    const syncData = await syncRes.json();
    if (!syncRes.ok) throw new Error(`sync-xero returned ${syncRes.status}: ${JSON.stringify(syncData)}`);

    return { tenant: tenant.name, endpoint: endpoint.key, fetched: records.length, synced: syncData };
  } catch (e) {
    return { tenant: tenant.name, endpoint: endpoint.key, fetched: 0, synced: null, error: String(e) };
  }
}

async function fetchPaginated(endpoint: XeroEndpoint, tenantId: string, accessToken: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;
  const separator = endpoint.path.includes('?') ? '&' : '?';

  while (true) {
    const url = `${XERO_API_BASE}/${endpoint.path}${separator}page=${page}`;
    const data = await xeroGet(url, tenantId, accessToken);
    const records = (data as Record<string, unknown>)[endpoint.responseKey] as unknown[] ?? [];
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
    page++;
  }

  return all;
}

async function fetchSingle(endpoint: XeroEndpoint, tenantId: string, accessToken: string): Promise<unknown[]> {
  const url = `${XERO_API_BASE}/${endpoint.path}`;
  const data = await xeroGet(url, tenantId, accessToken);
  return (data as Record<string, unknown>)[endpoint.responseKey] as unknown[] ?? [];
}

async function xeroGet(url: string, tenantId: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xero API ${res.status}: ${body}`);
  }
  return res.json();
}
