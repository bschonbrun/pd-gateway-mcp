// nl-query — Natural Language → SQL → Answer pipeline
// Channel-agnostic: called by Slack workflow, WhatsApp webhook, or direct HTTP

// ─── BUSINESS DOMAIN CONTEXT ─────────────────────────────────────────────────
// Acme Corp manufactures chemical treatment products (flocculants, polymers) sold
// to oilfield services companies by the tote (264 gallons each). Revenue is
// tracked via Sales Orders (actuals) and Forecast Orders (predictions).
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_CONTEXT = `
## BUSINESS CONTEXT
Acme Corp sells chemical products (SimpleFloc, SimplePrime, etc.) to oilfield customers.
Products are sold by the TOTE (1 tote = 264 gallons). Revenue = gallons × price_per_gallon.
Customers are companies like XRI, Aureus, T-Rey, WPX, Select Energy, Renda, Aris, PTEC.
Sites are specific delivery locations within a customer (e.g. XRI has sites: Curry, Texas Ten, Big Tree).
Sales reps: Brian, Mike. Markets: Permian, Industrial, etc.

## ACTUAL SALES ("sales orders" = delivered revenue)
sales_orders table — one row per delivered order:
  row_id          text     -- unique ID
  order_number    int      -- human-readable order #
  customer_name   text     -- e.g. 'XRI', 'Aureus', 'T-Rey', 'WPX', 'Select Energy', 'Renda', 'Aris', 'PTEC'
  site_name       text     -- delivery site e.g. 'Curry', 'Wolfcamp A', 'University'
  product_row_id  text     -- FK to forecast_products
  order_date      timestamptz
  delivery_date   timestamptz  -- use this for "when revenue happened" / month bucketing
  month           text     -- e.g. 'January', 'February'
  year            int
  totes           numeric  -- volume in totes
  gallons         numeric  -- volume in gallons (totes × 264)
  amount          numeric  -- REVENUE in dollars — USE THIS for revenue queries
  cost_per_gallon numeric
  price_by        text     -- 'gallon' or 'lb'
  is_draft        bool     -- draft orders not yet confirmed
  is_cancelled    bool     -- ALWAYS filter is_cancelled = false for real revenue
  sales_rep       text
  ship_mode       text
  notes           text
  freight_charged bool
  freight_amount  numeric

## FORECAST DATA ("forecast orders" = predicted future deliveries)
forecast_orders table — one row per predicted delivery line:
  id                uuid
  price_list_row_id text     -- FK to forecast_price_lists (this is how you find customer/site)
  expected_date     date     -- predicted delivery date
  expected_totes    numeric  -- predicted volume in totes
  expected_gallons  numeric  -- predicted gallons (expected_totes × 264)
  price_per_gallon  numeric  -- price for revenue calc; FORECAST REVENUE = expected_gallons × price_per_gallon
  status            text     -- 'predicted' | 'fulfilled' | 'missed' | 'forecast_replaced'
  is_current        bool     -- CRITICAL: TRUE = latest forecast vintage. FALSE = older/superseded version. ALWAYS filter is_current = true
  version_date      date     -- date this forecast version was created (multiple vintages exist)
  source            text     -- 'excel_import' | 'manual'

FORECAST VERSIONING: There are 25+ forecast vintages in the DB. Only rows with is_current = true
represent the current working forecast. All other rows are historical snapshots — exclude them
for any current forecast query. status='forecast_replaced' rows are permanently retired.

FORECAST STATUS VALUES:
  predicted        = active forecast line, not yet delivered
  fulfilled        = matched to a real sales order (delivery happened)
  missed           = explicitly marked as lost/cancelled
  forecast_replaced = retired by a newer forecast version (always exclude)

## PRICING / CUSTOMER-SITE MAPPING
forecast_price_lists table — maps customer+site+product to a price:
  row_id          text PK
  customer_name   text     -- matches sales_orders.customer_name and forecast_customers.name
  site_name       text
  cost_per_gallon numeric  -- fallback price if forecast_orders.price_per_gallon is null
  price_by        text

## REVENUE TARGETS
forecast_targets table — monthly revenue goals:
  id            int PK
  year          int
  month         int      -- 1=January, 2=February, etc.
  target_revenue numeric  -- dollar target for that month

## REFERENCE TABLES
forecast_customers (reference, rarely needed):
  row_id text PK, name text, market text, sub_market text, sales_person text, is_active bool

forecast_sites (reference, rarely needed):
  row_id text PK, customer_name text, name text, city text, state text, market text, is_active bool

forecast_products (reference, for product type lookups):
  row_id text PK, bom_code text, nick_name text, type text  -- type e.g. 'SimpleFloc', 'SimplePrime'

## MATCH RECONCILIATION (advanced)
match_proposals table — links sales orders to forecast orders:
  id uuid, sales_order_id text, forecast_order_id uuid,
  status text ('pending' | 'accepted'), confidence numeric

Reconciliation states:
  Matched  = SO ↔ FO pair accepted by a human (forecast was correct)
  Pending  = SO ↔ FO pair proposed by engine, awaiting review
  Upside   = SO has no matching FO (unforecasted revenue — a pleasant surprise)
  Miss     = FO has no matching SO (forecast that didn't materialize)
  Downside = FO explicitly marked missed/cancelled

## KEY FORMULAS
- Actual revenue:   sales_orders.amount  (already computed, just SUM it)
- Forecast revenue: SUM(forecast_orders.expected_gallons * forecast_orders.price_per_gallon)
- Totes to gallons: × 264
- MTD actual:       WHERE delivery_date >= date_trunc('month', CURRENT_DATE) AND delivery_date < NOW()
- YTD actual:       WHERE delivery_date >= date_trunc('year', CURRENT_DATE) AND delivery_date < NOW()
- MTD forecast:     WHERE expected_date >= date_trunc('month', CURRENT_DATE) AND expected_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'

## CRITICAL RULES
1. For ACTUAL/REAL revenue → query sales_orders WHERE is_cancelled = false
2. For FORECAST revenue → query forecast_orders WHERE is_current = true (and optionally status != 'forecast_replaced')
3. To get customer/site from forecast_orders → JOIN forecast_price_lists ON forecast_orders.price_list_row_id = forecast_price_lists.row_id
4. "Sales order" / "actual order" / "revenue" / "what we sold" → sales_orders table
5. "Forecast" / "predicted" / "expected" → forecast_orders table
6. The current date for time calculations is ${new Date().toISOString().split('T')[0]}
`;

const SQL_SYSTEM_PROMPT = `You are a SQL expert for Acme Corp's manufacturing revenue database (PostgreSQL).
Generate a single SELECT query to answer the user's question.

${SCHEMA_CONTEXT}

SQL GENERATION RULES:
- SELECT only. Never INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or CREATE.
- Always alias aggregates: SUM(amount) AS revenue, COUNT(*) AS order_count
- For "this month" / "MTD": WHERE delivery_date >= date_trunc('month', CURRENT_DATE) AND delivery_date < NOW()
- For "YTD" / "this year": WHERE delivery_date >= date_trunc('year', CURRENT_DATE) AND delivery_date < NOW()
- For "last month": WHERE delivery_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND delivery_date < date_trunc('month', CURRENT_DATE)
- Limit results to 20 rows max unless user specifies otherwise (use LIMIT 20)
- Use ILIKE for fuzzy name matching on customer_name, site_name
- ALWAYS include is_cancelled = false when querying sales_orders
- ALWAYS include is_current = true when querying forecast_orders
- For forecast revenue: JOIN forecast_price_lists to get customer_name/site_name
- If comparing actual vs target: JOIN forecast_targets ON year AND month
- If the question truly cannot be answered from these tables: CANNOT_ANSWER: <reason>

Return ONLY the raw SQL query. No markdown, no code fences, no explanation.

EXAMPLE QUERIES (static fallback — more injected at runtime from golden dataset):

Q: What is our MTD revenue?
A: SELECT SUM(amount) AS mtd_revenue FROM sales_orders WHERE is_cancelled = false AND delivery_date >= date_trunc('month', CURRENT_DATE) AND delivery_date < NOW()

Q: Top customers by revenue this year?
A: SELECT customer_name, SUM(amount) AS revenue, COUNT(*) AS orders FROM sales_orders WHERE is_cancelled = false AND delivery_date >= date_trunc('year', CURRENT_DATE) GROUP BY customer_name ORDER BY revenue DESC LIMIT 10`;

const FORMAT_SYSTEM_PROMPT = `You format SQL query results into clear, concise Slack messages.

Rules:
- Use Slack mrkdwn: *bold*, _italic_, \`code\`
- Format currency with $ and appropriate suffix (K for thousands, M for millions)
- Round to reasonable precision (2 decimal places for millions, whole numbers for thousands)
- Keep answers brief — 2-5 lines for simple queries, a short list for multi-row results
- If comparing actual vs forecast/target, include the percentage
- If results are empty, say so clearly and suggest the user check their query
- Never expose raw SQL or technical details
- Be conversational but professional`;

const FORBIDDEN_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i;

interface NLQueryRequest {
  question: string;
  user_id: string;
  channel?: string;
}

interface NLQueryResponse {
  answer: string;
  sql?: string;
  rows?: number;
  duration_ms: number;
  error?: string;
}

interface GoldenExample {
  question: string;
  correct_sql: string;
}

async function fetchGoldenExamples(supabaseUrl: string, supabaseKey: string): Promise<GoldenExample[]> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/nl_query_golden?approved=eq.true&promoted=eq.true&select=question,correct_sql&order=created_at.asc&limit=12`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function buildPromptWithExamples(basePrompt: string, examples: GoldenExample[]): string {
  if (!examples.length) return basePrompt;
  const exampleBlock = examples
    .map(e => `Q: ${e.question}\nA: ${e.correct_sql}`)
    .join('\n\n');
  return `${basePrompt}\n\nGOLDEN EXAMPLES (verified correct — follow these patterns closely):\n\n${exampleBlock}`;
}

async function callClaude(systemPrompt: string, userMessage: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content[0]?.text?.trim() ?? '';
}

function cleanSQL(raw: string): string {
  return raw.replace(/;\s*$/, '').trim();
}

function validateSQL(sql: string): { valid: boolean; reason?: string } {
  if (!sql || sql.startsWith('CANNOT_ANSWER:')) {
    return { valid: false, reason: sql || 'No SQL generated' };
  }

  if (FORBIDDEN_PATTERNS.test(sql)) {
    return { valid: false, reason: 'Query contains forbidden statements' };
  }

  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    return { valid: false, reason: 'Query must start with SELECT or WITH' };
  }

  return { valid: true };
}

async function executeQuery(sql: string, supabaseUrl: string, supabaseKey: string): Promise<{ rows: unknown[]; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_readonly_sql`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query_text: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Query execution failed: ${body}`);
  }

  const data = await res.json();
  return { rows: Array.isArray(data) ? data : [data] };
}

async function logQuery(
  supabaseUrl: string, supabaseKey: string,
  entry: { user_id: string; channel: string; question: string; generated_sql?: string; result_rows?: number; answer?: string; duration_ms: number; error?: string }
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/rest/v1/nl_query_log`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(entry),
    });
  } catch (e) {
    console.error('Failed to log query:', e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  const startMs = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

  let body: NLQueryRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { question, user_id, channel = 'slack' } = body;
  if (!question?.trim()) {
    return Response.json({ error: 'Missing question' }, { status: 400 });
  }

  console.log(`nl-query: user=${user_id} channel=${channel} q="${question}"`);

  // Fetch promoted golden examples and build a dynamic prompt
  const goldenExamples = await fetchGoldenExamples(supabaseUrl, supabaseKey);
  const dynamicPrompt = buildPromptWithExamples(SQL_SYSTEM_PROMPT, goldenExamples);
  console.log(`nl-query: injecting ${goldenExamples.length} golden examples into prompt`);

  let sql = '';
  try {
    // Step 1: NL → SQL (with dynamic golden few-shots)
    const rawSql = await callClaude(dynamicPrompt, question, anthropicKey);
    sql = cleanSQL(rawSql);
    console.log(`nl-query: SQL="${sql.substring(0, 200)}"`);

    // Step 2: Validate
    const validation = validateSQL(sql);
    if (!validation.valid) {
      const cantAnswer = sql.startsWith('CANNOT_ANSWER:')
        ? sql.replace('CANNOT_ANSWER:', '').trim()
        : validation.reason;

      const answer = `I can't answer that from the revenue database. ${cantAnswer}`;
      await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, answer, duration_ms: Date.now() - startMs, error: validation.reason });
      return Response.json({ answer, duration_ms: Date.now() - startMs } satisfies NLQueryResponse);
    }

    // Step 3: Execute
    const { rows, error: execError } = await executeQuery(sql, supabaseUrl, supabaseKey);
    if (execError) throw new Error(execError);

    console.log(`nl-query: ${rows.length} rows returned`);

    // Step 4: Format answer
    const formatPrompt = `The user asked: "${question}"

The SQL query returned ${rows.length} rows:
${JSON.stringify(rows.slice(0, 20), null, 2)}

Format this into a clear, concise answer for Slack.`;

    const answer = await callClaude(FORMAT_SYSTEM_PROMPT, formatPrompt, anthropicKey);

    const durationMs = Date.now() - startMs;
    await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, result_rows: rows.length, answer, duration_ms: durationMs });

    return Response.json({ answer, sql, rows: rows.length, duration_ms: durationMs } satisfies NLQueryResponse);

  } catch (e) {
    const errorMsg = String(e);
    console.error('nl-query FAILED:', errorMsg);
    const durationMs = Date.now() - startMs;
    await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql || undefined, duration_ms: durationMs, error: errorMsg });
    return Response.json({ answer: 'Sorry, something went wrong processing your question. Please try rephrasing it.', error: errorMsg, duration_ms: durationMs } satisfies NLQueryResponse, { status: 500 });
  }
});
