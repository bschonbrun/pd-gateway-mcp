import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BATCH_SIZE = 5;
const DELAY_MS = 2000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  try {
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!perplexityKey) {
      return Response.json({ error: 'PERPLEXITY_API_KEY not set' }, { status: 500 });
    }

    // Parse body
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const startIdx = body.start ?? 0;
    const batchLimit = body.limit ?? 10;

    // Fetch definitions
    const defsRes = await fetch(
      `${supabaseUrl}/rest/v1/financial_definitions?active=eq.true&order=category,term&select=term,category,definition,formula,sql_template`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );

    if (!defsRes.ok) {
      return Response.json({ error: `DB fetch failed: ${defsRes.status}`, body: await defsRes.text() }, { status: 500 });
    }

    const allDefs = await defsRes.json();
    const defs = allDefs.slice(startIdx, startIdx + batchLimit);

    const schemaContext = `Available database tables and key columns for a water treatment / chemical manufacturing company:
- xero_ar_invoices: company_name, contact_name, status (AUTHORISED/PAID/VOIDED/DELETED), invoice_date, due_date, total, amount_due, amount_paid, fully_paid_on_date
- xero_bills: company_name, contact_name, status, invoice_date, due_date, total, amount_due, amount_paid, fully_paid_on_date
- xero_bank_transactions: company_name, transaction_type (RECEIVE/SPEND/RECEIVE-TRANSFER/SPEND-TRANSFER), date, total, is_reconciled, status
- xero_credit_notes: company_name, credit_note_type (ACCRECCREDIT/ACCPAYCREDIT), contact_name, total, applied_amount, remaining_credit, status
- xero_invoice_payments: invoice_type (AR/AP), company_name, date, amount
- xero_journals: journal_id, company_name, journal_date, source_type
- xero_journal_lines: journal_id, account_code, account_name, account_type, net_amount, gross_amount
- xero_accounts: company_name, code, name, status, type (BANK/CURRENT/FIXED/NONCURRENT/PREPAYMENT/EQUITY/DEPRECIATN/DIRECTCOSTS/EXPENSE/CURRLIAB/LIABILITY/TERMLIAB/OTHERINCOME/REVENUE), class (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE)
- expense_transactions: employee_email, merchant, category, amount, expense_date, source (expensify/float), spend_compliance_status, reimbursable, billable, mcc_group, report_status, reimbursed_date
- sales_orders: customer_name, order_date, delivery_date, totes, gallons, amount`;

    const results: any[] = [];

    for (let i = 0; i < defs.length; i += BATCH_SIZE) {
      const batch = defs.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(batch.map(async (def: any) => {
        const prompt = `Audit this financial definition for accuracy. This is for a water treatment / chemical manufacturing company using Xero accounting.

DATABASE SCHEMA:
${schemaContext}

DEFINITION:
Term: "${def.term}"
Category: ${def.category}
Definition: "${def.definition}"
Formula: "${def.formula}"
${def.sql_template ? `SQL Template:\n${def.sql_template}` : 'SQL Template: NONE (engine must generate SQL on the fly)'}

Check:
1. Is the definition correct? (standard financial meaning)
2. Is the formula correct?
3. ${def.sql_template ? 'Does the SQL correctly implement the formula with the right columns/tables?' : 'Can this be computed from the available tables? If yes, provide SQL.'}
4. Any edge cases?

Return ONLY valid JSON (no markdown fences):
{"verdict":"PASS|FAIL|WARN","confidence":0.9,"definition_ok":true,"formula_ok":true,"sql_ok":true,"issues":"none or description","suggested_sql":null}`;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25000);

          const res = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${perplexityKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'sonar',
              messages: [
                { role: 'system', content: 'You audit financial definitions. Return ONLY valid JSON, no markdown.' },
                { role: 'user', content: prompt }
              ],
              max_tokens: 500
            }),
            signal: controller.signal
          });

          clearTimeout(timer);

          if (!res.ok) {
            const errText = await res.text();
            return { term: def.term, category: def.category, has_sql: !!def.sql_template, verdict: 'ERROR', issues: `Perplexity ${res.status}: ${errText.slice(0, 100)}`, confidence: 0 };
          }

          const data = await res.json();
          const text = data.choices?.[0]?.message?.content ?? '';
          const jsonMatch = text.match(/\{[\s\S]*?\}/);

          if (!jsonMatch) {
            return { term: def.term, category: def.category, has_sql: !!def.sql_template, verdict: 'ERROR', issues: `No JSON: ${text.slice(0, 100)}`, confidence: 0 };
          }

          const parsed = JSON.parse(jsonMatch[0]);
          return {
            term: def.term,
            category: def.category,
            has_sql: !!def.sql_template,
            verdict: parsed.verdict || 'UNKNOWN',
            issues: parsed.issues || 'none',
            confidence: parsed.confidence || 0,
            suggested_sql: parsed.suggested_sql || null
          };
        } catch (e: any) {
          return { term: def.term, category: def.category, has_sql: !!def.sql_template, verdict: 'ERROR', issues: e.message?.slice(0, 100) || String(e), confidence: 0 };
        }
      }));

      results.push(...batchResults);

      if (i + BATCH_SIZE < defs.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    const summary = {
      total_definitions: allDefs.length,
      audited: results.length,
      range: `${startIdx}-${startIdx + results.length - 1}`,
      pass: results.filter(r => r.verdict === 'PASS').length,
      warn: results.filter(r => r.verdict === 'WARN').length,
      fail: results.filter(r => r.verdict === 'FAIL').length,
      error: results.filter(r => r.verdict === 'ERROR').length,
    };

    return Response.json({ summary, results }, {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e: any) {
    return Response.json({ error: e.message, stack: e.stack?.slice(0, 300) }, { status: 500 });
  }
});
