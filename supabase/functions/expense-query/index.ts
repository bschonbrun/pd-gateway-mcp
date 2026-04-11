// CarboNet Financial Intelligence — expense-query edge function v11
// Sources: Expensify + Float Financial + Xero (AP, AR, GL, Bank, Credit Notes, COA)
// v11: Added feedback loop — /wrong, /learn, reactions, log_id tracking

const METADATA_PATTERNS = /\b(help|capabilities|schema|data sources?|what.{0,30}(data|fields?|questions?|information|available|can (i|you|we)|have|know|track)|what('s| is) available)\b/i;

const GLOSSARY_PATTERNS = /\b(financial terms?|terms? (you have|available|defined|can i ask|do you (have|know|support))|glossary|kpi|kpis|what (can|can't|cannot) (you|i) (calculate|compute|measure|ask|query|answer)|what financial|list.{0,20}terms?|show.{0,20}terms?)\b/i;

const HELP_PATTERNS = /^\s*(\/(help|\?))\s*$/i;

const FEEDBACK_PATTERNS = /^\s*\/(wrong|learn)\s/i;

const DATA_SUMMARY = `*CarboNet Financial Intelligence — Available Data* 📊

We have *80,000+ records* across five financial data sources:

*💳 Float Financial (corporate cards)* — ~5,970 records
Fields: employee, merchant, team/category, card name, amount (CAD), date, GL code, tax, accounting stage, compliance status

*📋 Expensify (employee expenses)* — ~25,800 records
Fields: employee, merchant, category, project tag, amount, currency, approval manager, report status, receipt URL, billable/reimbursable flags

*📄 Xero AP — Accounts Payable (vendor bills)* — 26,000+ bills across 2 entities
• *Carbonet Water Treatment - USD* — the *US entity*
• *Carbonet Canada (USD)* — the *Canadian entity* (also in USD)
Fields: vendor, invoice #, status, dates, total, amount due/paid/credited, payment dates, PO reference, line items

*🧾 Xero AR — Accounts Receivable (customer invoices)* — invoices across 2 entities
Fields: customer name, invoice #, status, invoice date, due date, fully_paid_on_date, total, amount due/paid/credited, line items, payment history

*💸 Xero Invoice Payments* — granular payment records for AP and AR
Fields: payment date, amount, account, payment type, reconciliation status

*🏦 Xero Bank Transactions* — bank feed entries per entity
Fields: transaction type, contact, bank account, date, total, reconciliation status

*📓 Xero GL Journals* — double-entry general ledger
Fields: journal date, journal number, source type, debit/credit lines with account codes and amounts

*🏛️ Chart of Accounts* — all GL accounts per entity
Fields: account code, name, type, class (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE)

*💳 Credit Notes* — AP/AR credit adjustments

*Sample questions you can ask:*
• _What's our DSO? DPO?_
• _Show me our AR aging report_
• _How much did we spend on travel last month?_
• _What's our total AR balance? What's overdue?_
• _What did we invoice to [customer] this year?_
• _How long does [customer] take to pay?_
• _What's our net cash flow for Q1?_
• _Show all non-compliant Float card transactions_

*For accounting standards:*
• _/gaap how do we recognize revenue on long-term contracts?_
• _/ifrs what's the difference between IAS 2 and US GAAP for inventory?_

*For feedback:*
• React with 👍 or 👎 to rate any answer
• _/wrong [correction]_ — tell me the right answer
• _/learn [rule]_ — teach me a new rule for future queries`;

const EXPENSE_SCHEMA_CONTEXT = `
## BUSINESS CONTEXT
CarboNet tracks financial data from five sources:
1. FLOAT FINANCIAL: corporate card transactions (direct-pay, not reimbursable)
2. EXPENSIFY: employee expense reports (reimbursable + billable)
3. XERO AP: vendor invoices / Accounts Payable — two legal entities, both in USD
4. XERO AR: customer invoices / Accounts Receivable — two legal entities, both in USD
5. XERO GL: general ledger journals, bank transactions, chart of accounts, credit notes

XERO ENTITIES (both denominated in USD — the USD suffix does NOT indicate country):
- 'Carbonet Water Treatment - USD' = the US company (United States entity)
- 'Carbonet Canada (USD)'          = the Canadian company (Canada entity, billed in USD)

## expense_transactions — one row per transaction (Float + Expensify combined)
  id                       text PK    -- float_ prefix = Float, numeric = Expensify
  source                   text       -- 'float' | 'expensify'
  report_id                text       -- FK → expense_reports.id (Expensify only)
  employee_email           text
  manager_email            text       -- approver (Expensify only)
  merchant                 text       -- clean merchant name
  category                 text       -- expense category or team (Float)
  mcc_group                text       -- 'Travel'|'Food & Drink'|'Gas'|'Software' etc.
  tag                      text       -- project/cost-center or card name (Float)
  amount                   numeric    -- CAD for Float, USD for Expensify
  currency                 text       -- 'CAD' | 'USD'
  tax_amount               numeric
  expense_date             date       -- USE THIS for all time-based queries
  report_status            text       -- 'OPEN'|'SUBMITTED'|'APPROVED'|'REIMBURSED'|'ARCHIVED'
  reimbursable             bool
  billable                 bool
  accounting_stage         text       -- Float: 'IN_REVIEW'|'EXPORTED'
  spend_compliance_status  text       -- Float: 'COMPLIANT'|'NOT_COMPLIANT'
  gl_code                  text       -- Float only

## xero_bills — vendor invoices (Accounts Payable)
  id                    text PK
  xero_tenant_id        text
  company_name          text      -- 'Carbonet Water Treatment - USD' | 'Carbonet Canada (USD)'
  invoice_number        text
  contact_name          text      -- vendor name
  status                text      -- 'DRAFT'|'AUTHORISED'|'PAID'|'VOIDED'|'DELETED'
  invoice_date          date
  due_date              date
  fully_paid_on_date    date      -- actual payment date (use for DPO calculation)
  expected_payment_date date
  planned_payment_date  date
  total                 numeric
  amount_due            numeric
  amount_paid           numeric
  amount_credited       numeric
  sub_total             numeric
  total_tax             numeric
  currency_code         text
  reference             text      -- PO number
  has_attachments       boolean

## xero_bill_line_items
  id             text PK
  bill_id        text FK → xero_bills.id
  description    text
  quantity       numeric
  unit_amount    numeric
  line_amount    numeric
  account_code   text
  tax_type       text
  item_code      text
  discount_rate  numeric
  discount_amount numeric
  tracking_name  text
  tracking_option text

## xero_ar_invoices — customer invoices (Accounts Receivable)
  id                    text PK
  xero_tenant_id        text
  company_name          text
  invoice_number        text
  contact_name          text      -- customer name
  status                text      -- 'DRAFT'|'AUTHORISED'|'PAID'|'VOIDED'|'DELETED'
  invoice_date          date
  due_date              date
  fully_paid_on_date    date      -- actual payment receipt date (critical for DSO)
  expected_payment_date date
  planned_payment_date  date
  total                 numeric
  amount_due            numeric
  amount_paid           numeric
  amount_credited       numeric
  sub_total             numeric
  total_tax             numeric
  currency_code         text
  reference             text
  sent_to_contact       boolean
  has_attachments       boolean

## xero_ar_line_items
  id              text PK
  invoice_id      text FK → xero_ar_invoices.id
  description     text
  quantity        numeric
  unit_amount     numeric
  line_amount     numeric
  account_code    text
  tax_type        text
  item_code       text
  discount_rate   numeric
  discount_amount numeric
  tracking_name   text
  tracking_option text

## xero_invoice_payments — granular payment events (AP and AR)
  id            text PK
  invoice_id    text      -- FK to xero_ar_invoices.id or xero_bills.id
  invoice_type  text      -- 'AR' | 'AP'
  xero_tenant_id text
  company_name  text
  date          date      -- date payment was applied
  amount        numeric   -- payment amount
  bank_amount   numeric
  currency_rate numeric
  reference     text
  payment_type  text
  account_id    text
  account_code  text
  account_name  text
  is_reconciled boolean

## xero_journals — GL journal entries
  journal_id      text PK
  xero_tenant_id  text
  company_name    text
  journal_date    date
  journal_number  integer
  reference       text
  source_type     text      -- 'ACCPAY'|'ACCREC'|'CASHREC'|'CASHPAID'|'MANJOURNAL' etc.
  source_id       text
  created_date_utc timestamptz

## xero_journal_lines
  id            text PK
  journal_id    text FK → xero_journals.journal_id
  account_id    text
  account_code  text
  account_name  text
  account_type  text
  net_amount    numeric   -- positive = debit, negative = credit
  gross_amount  numeric
  tax_amount    numeric
  description   text
  tax_type      text

## xero_bank_transactions
  id                  text PK
  xero_tenant_id      text
  company_name        text
  transaction_type    text      -- 'SPEND'|'RECEIVE'|'SPEND-TRANSFER'|'RECEIVE-TRANSFER'
  contact_name        text
  bank_account_id     text
  bank_account_name   text
  status              text
  reference           text
  total               numeric
  sub_total           numeric
  total_tax           numeric
  date                date
  currency_code       text
  is_reconciled       boolean

## xero_credit_notes
  id                text PK
  xero_tenant_id    text
  company_name      text
  credit_note_type  text      -- 'ACCPAYCREDIT' (AP) | 'ACCRECCREDIT' (AR)
  credit_note_number text
  contact_name      text
  status            text
  date              date
  total             numeric
  applied_amount    numeric
  remaining_credit  numeric
  currency_code     text
  reference         text

## xero_accounts — chart of accounts
  account_id                   text PK
  xero_tenant_id               text
  company_name                 text
  code                         text
  name                         text
  status                       text  -- 'ACTIVE'|'ARCHIVED'
  type                         text
  tax_type                     text
  description                  text
  class                        text  -- 'ASSET'|'LIABILITY'|'EQUITY'|'INCOME'|'EXPENSE'
  enable_payments_to_account   boolean
  show_in_expense_claims       boolean
  bank_account_number          text

## KEY RULES
- expense_transactions: filter by source = 'float' or source = 'expensify'
- Float = corporate card (CAD), Expensify = employee-submitted (USD)
- Float reconciled: WHERE accounting_stage = 'EXPORTED'
- Pending reimbursement: source='expensify' AND reimbursable=true AND reimbursed_date IS NULL
- Non-compliant card spend: source='float' AND spend_compliance_status = 'NOT_COMPLIANT'
- Use expense_date for ALL time filtering on expense_transactions
- AP outstanding bill: status = 'AUTHORISED' AND amount_due > 0 (xero_bills)
- AP overdue: status = 'AUTHORISED' AND due_date < CURRENT_DATE AND amount_due > 0
- AR outstanding invoice: status = 'AUTHORISED' AND amount_due > 0 (xero_ar_invoices)
- AR overdue: status = 'AUTHORISED' AND due_date < CURRENT_DATE AND amount_due > 0
- DSO: AVG(fully_paid_on_date - invoice_date) on xero_ar_invoices WHERE status='PAID' AND fully_paid_on_date IS NOT NULL
- DPO: AVG(fully_paid_on_date - invoice_date) on xero_bills WHERE status='PAID' AND fully_paid_on_date IS NOT NULL
- Bank unreconciled: is_reconciled = false AND status = 'AUTHORISED'
- GL debit entries: net_amount > 0, credit entries: net_amount < 0
- XERO US ENTITY: company_name = 'Carbonet Water Treatment - USD'
- XERO CANADA ENTITY: company_name = 'Carbonet Canada (USD)'
- Do NOT confuse "(USD)" in the company name with the entity being American
- The current date is ${new Date().toISOString().split('T')[0]}
`;

const SQL_SYSTEM_PROMPT = `You are a SQL expert for CarboNet's financial database (PostgreSQL).
Generate a single SELECT query to answer the user's question about company finances.

${EXPENSE_SCHEMA_CONTEXT}

SQL GENERATION RULES:
- Output ONLY the SQL query — no markdown, no explanation, no backticks
- If you cannot answer with the available schema, output: CANNOT_ANSWER: <brief reason>
- Always use table aliases for clarity
- Use ILIKE for case-insensitive text matching
- Round monetary values to 2 decimal places
- Default to current month if no date range specified
- Limit results to 20 rows unless user asks for more
- For entity-specific questions, always filter by company_name
- For GL queries joining to accounts, join xero_journal_lines to xero_accounts on account_code
`;

const FORMAT_SYSTEM_PROMPT = `You format SQL query results into clear, concise Slack messages about company finances.

Rules:
- Use Slack mrkdwn: *bold*, _italic_, \`code\`
- Format currency with $ (e.g. $1,234 or $45.2K)
- Keep answers brief — 2-5 lines for simple queries, short list for multi-row
- Mention the data source (Float card / Expensify / Xero AP / Xero AR / GL) when relevant
- For employee expenses, mention the category context
- For Xero data, always distinguish entity clearly: label 'Carbonet Water Treatment - USD' as the *US entity* and 'Carbonet Canada (USD)' as the *Canadian entity*
- For bills/invoices, mention vendor/customer name and due date where relevant
- If results are empty, say so clearly
- Never expose raw SQL or technical details
- Be conversational but professional`;

const FORBIDDEN_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i;

interface ExpenseQueryRequest {
  question: string;
  user_id: string;
  channel?: string;
  command?: string;
  // Feedback fields (for /wrong, /learn, reactions)
  feedback_type?: 'rating' | 'wrong' | 'learn';
  log_id?: string;
  rating?: 'positive' | 'negative';
  correction?: string;
  slack_ts?: string;
  slack_channel?: string;
}

interface GoldenExample {
  question: string;
  correct_sql: string;
}

interface FinancialDefinition {
  term: string;
  category: string;
  definition: string;
  formula: string | null;
  sql_template: string | null;
}

interface KnowledgeTerm {
  term: string;
  standard_ref?: string;
  asc_code?: string;
  category: string;
  definition: string;
  guidance: string | null;
  example: string | null;
}

async function dbFetch<T>(supabaseUrl: string, supabaseKey: string, path: string): Promise<T[]> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return [];
    return await res.json() as T[];
  } catch {
    return [];
  }
}

async function fetchGoldenExamples(supabaseUrl: string, supabaseKey: string): Promise<GoldenExample[]> {
  return dbFetch<GoldenExample>(supabaseUrl, supabaseKey,
    'expense_query_golden?approved=eq.true&promoted=eq.true&select=question,correct_sql&order=created_at.asc&limit=12');
}

async function fetchFinancialDefinitions(supabaseUrl: string, supabaseKey: string): Promise<FinancialDefinition[]> {
  return dbFetch<FinancialDefinition>(supabaseUrl, supabaseKey,
    'financial_definitions?active=eq.true&select=term,category,definition,formula,sql_template&order=category.asc,term.asc');
}

async function fetchKnowledgeTerms(supabaseUrl: string, supabaseKey: string, table: 'gaap_terms' | 'ifrs_terms'): Promise<KnowledgeTerm[]> {
  const fields = table === 'gaap_terms'
    ? 'term,asc_code,category,definition,guidance,example'
    : 'term,standard_ref,category,definition,guidance,example';
  return dbFetch<KnowledgeTerm>(supabaseUrl, supabaseKey,
    `${table}?active=eq.true&select=${fields}&order=category.asc,term.asc`);
}

function matchRelevantDefinitions(question: string, definitions: FinancialDefinition[]): FinancialDefinition[] {
  const q = question.toLowerCase();
  return definitions.filter(d => {
    if (q.includes(d.term.toLowerCase())) return true;
    const categoryHit = (
      (d.category === 'ar_ap' && /\b(ar|ap|invoice|bill|receiv|payab|vendor|customer|aging|dso|dpo|overdue|collection|payment|credit note)\b/.test(q)) ||
      (d.category === 'cash_flow' && /\b(cash|collect|payment|burn|flow)\b/.test(q)) ||
      (d.category === 'profitability' && /\b(revenue|sales|income|profit|margin|ebitda|roe|roa|growth|ytd|mtd|qtd|run rate)\b/.test(q)) ||
      (d.category === 'fpa' && /\b(budget|forecast|yoy|mom|ttm|rolling|variance|growth|run rate|cagr)\b/.test(q)) ||
      (d.category === 'expense' && /\b(expense|spend|travel|meal|software|saas|compliance|reimburs|billable)\b/.test(q)) ||
      (d.category === 'banking' && /\b(bank|reconcil|deposit|transfer|unrecon)\b/.test(q)) ||
      (d.category === 'gl' && /\b(gl|journal|ledger|account|debit|credit|coa|chart)\b/.test(q)) ||
      (d.category === 'liquidity' && /\b(liquid|working capital|current ratio|quick ratio|ccc|cash cycle)\b/.test(q)) ||
      (d.category === 'solvency' && /\b(debt|leverage|equity|interest|coverage|solvenc)\b/.test(q)) ||
      (d.category === 'working_capital' && /\b(inventory|working capital|turnover|days)\b/.test(q))
    );
    return categoryHit;
  }).slice(0, 8);
}

function buildGlossaryResponse(definitions: FinancialDefinition[]): string {
  const byCategory: Record<string, FinancialDefinition[]> = {};
  for (const d of definitions) {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  }

  const categoryLabels: Record<string, string> = {
    ar_ap:          '📄 Accounts Payable / Receivable',
    cash_flow:      '💸 Cash Flow',
    profitability:  '📈 Revenue & Profitability',
    fpa:            '📊 FP&A & Planning',
    expense:        '💳 Expense Analysis',
    banking:        '🏦 Banking',
    gl:             '📓 General Ledger',
    liquidity:      '💧 Liquidity',
    solvency:       '⚖️ Solvency & Leverage',
    working_capital: '🔄 Working Capital',
  };

  const totalCount = definitions.length;
  let response = `*CarboNet Financial Intelligence — ${totalCount} Financial Terms & KPIs* 📚\n`;
  response += `_Ask about any of these by name, or use natural language (e.g. "what's our DSO?")_\n\n`;

  for (const [cat, items] of Object.entries(byCategory)) {
    const label = categoryLabels[cat] ?? cat;
    const terms = items.map(d => `\`${d.term}\``).join(', ');
    response += `*${label}*\n${terms}\n\n`;
  }

  response += `_For accounting standards: use /gaap or /ifrs commands_`;
  return response;
}

function buildKnowledgeAnswer(question: string, terms: KnowledgeTerm[], standard: 'GAAP' | 'IFRS'): string {
  if (!terms.length) {
    return `I couldn't find a specific ${standard} term matching your question. Try rephrasing or check the standard directly.`;
  }
  const q = question.toLowerCase();
  const sorted = terms
    .map(t => ({
      t,
      score: (q.includes(t.term.toLowerCase()) ? 10 : 0) +
             (t.definition.toLowerCase().split(' ').filter(w => w.length > 4 && q.includes(w)).length)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.t);

  const ref = standard === 'GAAP' ? 'ASC' : 'IFRS/IAS';
  let out = `*${standard} Reference* 📖\n\n`;
  for (const t of sorted) {
    const code = t.asc_code ?? t.standard_ref ?? '';
    out += `*${t.term}* ${code ? `_(${code})_` : ''}\n`;
    out += `${t.definition}\n`;
    if (t.guidance) out += `_Guidance:_ ${t.guidance}\n`;
    if (t.example) out += `_Example:_ ${t.example}\n`;
    out += `\n`;
  }
  out += `_Source: ${ref} standards database. Always verify with your auditor for specific situations._`;
  return out;
}

function buildPromptWithContext(basePrompt: string, examples: GoldenExample[], relevantDefs: FinancialDefinition[]): string {
  let prompt = basePrompt;

  if (relevantDefs.length > 0) {
    const defsBlock = relevantDefs
      .map(d => {
        let entry = `TERM: ${d.term} (${d.category})\nDEFINITION: ${d.definition}`;
        if (d.formula) entry += `\nFORMULA: ${d.formula}`;
        if (d.sql_template) entry += `\nSQL PATTERN: ${d.sql_template}`;
        return entry;
      })
      .join('\n\n');
    prompt += `\n\nRELEVANT FINANCIAL DEFINITIONS (use these SQL patterns when applicable):\n\n${defsBlock}`;
  }

  if (examples.length > 0) {
    const exampleBlock = examples.map(e => `Q: ${e.question}\nA: ${e.correct_sql}`).join('\n\n');
    prompt += `\n\nGOLDEN EXAMPLES (verified correct — follow these patterns closely):\n\n${exampleBlock}`;
  }

  return prompt;
}

async function callClaude(systemPrompt: string, userMessage: string, apiKey: string, maxTokens = 1024): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0]?.text?.trim() ?? '';
}

function cleanSQL(raw: string): string {
  return raw.replace(/;?\s*$/, '').replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();
}

function validateSQL(sql: string): { valid: boolean; reason?: string } {
  if (!sql || sql.startsWith('CANNOT_ANSWER:')) return { valid: false, reason: sql || 'No SQL generated' };
  if (FORBIDDEN_PATTERNS.test(sql)) return { valid: false, reason: 'Forbidden statement' };
  const norm = sql.trim().toUpperCase();
  if (!norm.startsWith('SELECT') && !norm.startsWith('WITH')) return { valid: false, reason: 'Must start with SELECT or WITH' };
  return { valid: true };
}

async function executeQuery(sql: string, supabaseUrl: string, supabaseKey: string): Promise<{ rows: unknown[] }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_readonly_sql`, {
    method: 'POST',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query_text: sql }),
  });
  if (!res.ok) throw new Error(`Query execution failed: ${await res.text()}`);
  const data = await res.json();
  return { rows: Array.isArray(data) ? data : [data] };
}

async function logQuery(
  supabaseUrl: string, supabaseKey: string,
  entry: { user_id: string; channel: string; question: string; generated_sql?: string; result_rows?: number; answer?: string; duration_ms: number; error?: string; slack_ts?: string; slack_channel?: string }
): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/expense_query_log`, {
      method: 'POST',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.id ?? null;
  } catch (e) {
    console.error('Failed to log query:', e);
    return null;
  }
}

async function writeFeedback(
  supabaseUrl: string, supabaseKey: string,
  entry: { log_id: string; slack_user: string; rating: string; correction?: string; correct_sql?: string; feedback_type: string }
): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/expense_query_feedback`, {
      method: 'POST',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(entry),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function findLogBySlackTs(supabaseUrl: string, supabaseKey: string, slackTs: string): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/expense_query_log?slack_ts=eq.${slackTs}&select=id&limit=1`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function findMostRecentLog(supabaseUrl: string, supabaseKey: string, userId: string): Promise<{ id: string; question: string; generated_sql: string } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/expense_query_log?user_id=eq.${userId}&select=id,question,generated_sql&order=created_at.desc&limit=1`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  const startMs = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

  let body: ExpenseQueryRequest;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { question, user_id, channel = 'unknown', command, slack_ts, slack_channel } = body;
  if (!question && !body.feedback_type) return Response.json({ error: 'question or feedback_type required' }, { status: 400 });
  if (!user_id) return Response.json({ error: 'user_id required' }, { status: 400 });

  const duration_ms = () => Date.now() - startMs;

  // ── 0. Feedback handler (reactions, /wrong, /learn) ─────────────────────
  if (body.feedback_type) {
    let logId = body.log_id;

    // If no log_id, try to find by slack_ts or fallback to most recent
    if (!logId && body.slack_ts) {
      logId = await findLogBySlackTs(supabaseUrl, supabaseKey, body.slack_ts) ?? undefined;
    }
    if (!logId) {
      const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
      logId = recent?.id;
    }
    if (!logId) {
      return Response.json({ error: 'Could not find a query to attach feedback to' }, { status: 404 });
    }

    const ok = await writeFeedback(supabaseUrl, supabaseKey, {
      log_id: logId,
      slack_user: user_id,
      rating: body.rating ?? (body.feedback_type === 'wrong' ? 'negative' : 'correction'),
      correction: body.correction ?? question,
      correct_sql: undefined,
      feedback_type: body.feedback_type,
    });

    const ack = body.feedback_type === 'wrong'
      ? `Got it — I'll learn from this. Thanks for the correction! 🙏`
      : body.feedback_type === 'learn'
      ? `Rule noted! I'll factor this into future answers. 📝`
      : `Feedback recorded. Thanks! ${body.rating === 'positive' ? '👍' : '👎'}`;

    return Response.json({ answer: ack, feedback_saved: ok, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 1. /help and /? command ──────────────────────────────────────────────────
  if (HELP_PATTERNS.test(question)) {
    const answer = DATA_SUMMARY;
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 2. /wrong and /learn commands ───────────────────────────────────────────
  if (FEEDBACK_PATTERNS.test(question)) {
    const match = question.match(/^\s*\/(wrong|learn)\s+([\s\S]+)/i);
    if (match) {
      const feedbackType = match[1].toLowerCase() as 'wrong' | 'learn';
      const correctionText = match[2].trim();

      const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
      if (!recent) {
        return Response.json({ answer: `I couldn't find a recent query to attach this to. Ask a question first, then use /${feedbackType}.`, duration_ms: duration_ms() });
      }

      await writeFeedback(supabaseUrl, supabaseKey, {
        log_id: recent.id,
        slack_user: user_id,
        rating: feedbackType === 'wrong' ? 'negative' : 'correction',
        correction: correctionText,
        correct_sql: undefined,
        feedback_type: feedbackType,
      });

      const ack = feedbackType === 'wrong'
        ? `Got it — recorded correction for: _"${recent.question}"_\nYour note: _${correctionText}_\nI'll learn from this. 🙏`
        : `Rule learned for: _"${recent.question}"_\nNew rule: _${correctionText}_ 📝`;

      await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer: ack, duration_ms: duration_ms() });
      return Response.json({ answer: ack, referenced_query: recent.question, duration_ms: duration_ms() });
    }
  }

  // ── 2. Metadata shortcut ────────────────────────────────────────────────────
  if (METADATA_PATTERNS.test(question)) {
    const answer = DATA_SUMMARY;
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 3. Financial terms glossary shortcut ─────────────────────────────────
  if (GLOSSARY_PATTERNS.test(question)) {
    const definitions = await fetchFinancialDefinitions(supabaseUrl, supabaseKey);
    const answer = buildGlossaryResponse(definitions);
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 4. GAAP knowledge mode ──────────────────────────────────────────────────
  if (command === '/gaap' || /^\s*\/gaap\s/i.test(question)) {
    const cleanQ = question.replace(/^\s*\/gaap\s*/i, '').trim();
    const terms = await fetchKnowledgeTerms(supabaseUrl, supabaseKey, 'gaap_terms');
    const answer = buildKnowledgeAnswer(cleanQ, terms, 'GAAP');
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 5. IFRS knowledge mode ──────────────────────────────────────────────────
  if (command === '/ifrs' || /^\s*\/ifrs\s/i.test(question)) {
    const cleanQ = question.replace(/^\s*\/ifrs\s*/i, '').trim();
    const terms = await fetchKnowledgeTerms(supabaseUrl, supabaseKey, 'ifrs_terms');
    const answer = buildKnowledgeAnswer(cleanQ, terms, 'IFRS');
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, duration_ms: duration_ms() });
  }

  // ── 6. SQL query mode — fetch supporting data in parallel ────────────────
  const [examples, allDefinitions] = await Promise.all([
    fetchGoldenExamples(supabaseUrl, supabaseKey),
    fetchFinancialDefinitions(supabaseUrl, supabaseKey),
  ]);

  const relevantDefs = matchRelevantDefinitions(question, allDefinitions);
  const sqlPrompt = buildPromptWithContext(SQL_SYSTEM_PROMPT, examples, relevantDefs);

  // Generate SQL
  let rawSQL: string;
  try {
    rawSQL = await callClaude(sqlPrompt, question, anthropicKey);
  } catch (e) {
    const answer = `Sorry, I couldn't generate a query right now. Please try again.`;
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, error: String(e), duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, error: String(e), duration_ms: duration_ms() });
  }

  const sql = cleanSQL(rawSQL);
  const validation = validateSQL(sql);

  if (!validation.valid) {
    const reason = validation.reason ?? '';
    const answer = reason.startsWith('CANNOT_ANSWER:')
      ? `I don't have the data to answer that. ${reason.replace('CANNOT_ANSWER:', '').trim()}`
      : `I couldn't generate a valid query for that question. Try rephrasing?`;
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, answer, error: reason, duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, sql, duration_ms: duration_ms() });
  }

  // Execute SQL
  let rows: unknown[];
  try {
    const result = await executeQuery(sql, supabaseUrl, supabaseKey);
    rows = result.rows;
  } catch (e) {
    const answer = `There was a problem running that query. The team has been notified.`;
    const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, error: String(e), duration_ms: duration_ms(), slack_ts, slack_channel });
    return Response.json({ answer, log_id: logId, sql, error: String(e), duration_ms: duration_ms() });
  }

  // Format answer
  const resultJSON = JSON.stringify(rows.slice(0, 50));
  const formatPrompt = FORMAT_SYSTEM_PROMPT;
  const formatInput = `Question: ${question}\n\nQuery results (${rows.length} rows):\n${resultJSON}`;

  let answer: string;
  try {
    answer = await callClaude(formatPrompt, formatInput, anthropicKey, 512);
  } catch {
    answer = `Found ${rows.length} result(s) but couldn't format the response.`;
  }

  const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, result_rows: rows.length, answer, duration_ms: duration_ms(), slack_ts, slack_channel });
  return Response.json({ answer, log_id: logId, sql, rows: rows.length, duration_ms: duration_ms() });
});
