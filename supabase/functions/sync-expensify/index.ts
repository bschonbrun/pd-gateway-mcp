import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Accepts pre-fetched Expensify data from Pipedream and upserts to Supabase.
// Expensify API calls and credentials stay entirely in Pipedream.

interface ExpensifyReport {
  reportID: string;
  reportName?: string;
  ownerEmail: string;
  policyID?: string;
  total: number;        // cents — divided by 100 on upsert
  currency?: string;
  status: string;
  submitted?: string;
  approved?: string;
  reimbursed?: string;
  expenses: ExpensifyExpense[];
}

interface ExpensifyExpense {
  id: string;
  merchant?: string;
  category?: string;
  tag?: string;
  amount: number;       // cents — divided by 100 on upsert
  currency?: string;
  date?: string;
  comment?: string;
  reimbursable: boolean;
  billable: boolean;
}

async function upsertReports(
  supabaseUrl: string,
  serviceKey: string,
  reports: ExpensifyReport[],
): Promise<{ reports: number; transactions: number }> {
  const now = new Date().toISOString();

  const reportRows = reports.map(r => ({
    id: r.reportID,
    report_name: r.reportName || null,
    employee_email: r.ownerEmail,
    submitted_by: r.ownerEmail,
    policy_id: r.policyID || null,
    total_amount: r.total / 100,
    currency: r.currency || 'USD',
    status: r.status,
    submitted_date: r.submitted || null,
    approved_date: r.approved || null,
    reimbursed_date: r.reimbursed || null,
    synced_at: now,
  }));

  const rRes = await fetch(`${supabaseUrl}/rest/v1/expense_reports`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(reportRows),
  });
  if (!rRes.ok) throw new Error(`Report upsert failed: ${await rRes.text()}`);

  const allTxns = reports.flatMap(r =>
    r.expenses.map(e => ({
      id: e.id,
      report_id: r.reportID,
      employee_email: r.ownerEmail,
      merchant: e.merchant || null,
      category: e.category || null,
      tag: e.tag || null,
      amount: e.amount / 100,
      currency: e.currency || 'USD',
      expense_date: e.date || null,
      comment: e.comment || null,
      reimbursable: e.reimbursable,
      billable: e.billable,
      synced_at: now,
    }))
  );

  for (let i = 0; i < allTxns.length; i += 200) {
    const tRes = await fetch(`${supabaseUrl}/rest/v1/expense_transactions`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(allTxns.slice(i, i + 200)),
    });
    if (!tRes.ok) throw new Error(`Transaction upsert failed: ${await tRes.text()}`);
  }

  return { reports: reports.length, transactions: allTxns.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const body = await req.json();
    const reports: ExpensifyReport[] = body.reports;

    if (!Array.isArray(reports)) {
      return Response.json({ error: 'Body must contain a "reports" array' }, { status: 400 });
    }

    if (reports.length === 0) {
      return Response.json({ success: true, synced: { reports: 0, transactions: 0 } });
    }

    console.log(`sync-expensify: upserting ${reports.length} reports from Pipedream`);
    const result = await upsertReports(supabaseUrl, serviceKey, reports);
    console.log(`sync-expensify: done — ${result.reports} reports, ${result.transactions} transactions`);

    return Response.json({ success: true, synced: result });
  } catch (err) {
    console.error('sync-expensify FAILED:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
