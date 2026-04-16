// review-agent — self-healing review loop
// Called fire-and-forget by expense-query / nl-query after wrong: feedback.
// Classifies root cause, saves a schema_hint (plain-English rule injected
// into future SQL prompts), writes a review_log entry, and posts a diagnosis
// message back to the originating Slack thread.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const GEMINI_KEY    = Deno.env.get('GEMINI_API_KEY');
const SLACK_TOKEN   = Deno.env.get('SLACK_BOT_TOKEN')!;

const SCHEMA_HINT_CAP = 20; // max unverified hints kept per domain

// ─── TYPES ───────────────────────────────────────────────────────────────────

const ROOT_CAUSE_TYPES = [
  'SCOPE_DRIFT', 'WRONG_TABLE', 'MISSING_JOIN',
  'MISSING_DEFINITION', 'WRONG_FORMULA', 'FORMAT_ISSUE',
] as const;
type RootCauseType = typeof ROOT_CAUSE_TYPES[number];

const ROOT_CAUSE_EMOJI: Record<string, string> = {
  SCOPE_DRIFT: '🎯', WRONG_TABLE: '📋', MISSING_JOIN: '🔗',
  MISSING_DEFINITION: '📚', WRONG_FORMULA: '🧮', FORMAT_ISSUE: '🎨',
};

const ROOT_CAUSE_TO_CATEGORY: Record<string, string> = {
  SCOPE_DRIFT: 'scope', WRONG_TABLE: 'table_selection',
  MISSING_JOIN: 'join', MISSING_DEFINITION: 'other',
  WRONG_FORMULA: 'formula', FORMAT_ISSUE: 'other',
};

interface ReviewRequest {
  question: string;
  sql: string;
  correction: string;
  thread_context?: string;
  domain: 'revenue' | 'finance';
  log_id?: string;
  slack_channel?: string;
  slack_thread_ts?: string;
}

// ─── LLM HELPERS ─────────────────────────────────────────────────────────────

async function callGemini(sys: string, msg: string, key: string, max = 600): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: sys }] },
          contents: [{ role: 'user', parts: [{ text: msg }] }],
          generationConfig: { maxOutputTokens: max },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}

async function callAnthropic(sys: string, msg: string, max = 600): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: max,
        system: sys, messages: [{ role: 'user', content: msg }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}

async function callLLM(sys: string, msg: string, max = 600): Promise<string> {
  if (GEMINI_KEY) {
    const r = await callGemini(sys, msg, GEMINI_KEY, max);
    if (r) return r;
  }
  const r = await callAnthropic(sys, msg, max);
  if (r) return r;
  throw new Error('All LLM providers failed');
}

// ─── DB HELPERS ───────────────────────────────────────────────────────────────

async function dbPost(path: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Enforce 20-hint cap: delete oldest unverified hints when over limit
async function pruneSchemaHints(domain: string): Promise<void> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/schema_hints?domain=eq.${domain}&verified=eq.false&select=id&order=created_at.asc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return;
    const rows = await res.json() as { id: string }[];
    if (rows.length <= SCHEMA_HINT_CAP) return;
    for (const { id } of rows.slice(0, rows.length - SCHEMA_HINT_CAP)) {
      await fetch(`${SUPABASE_URL}/rest/v1/schema_hints?id=eq.${id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      }).catch(() => {});
    }
  } catch { /* best-effort */ }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

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
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  let body: ReviewRequest;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { question, sql, correction, thread_context, domain, log_id, slack_channel, slack_thread_ts } = body;
  if (!question || !sql || !correction || !domain) {
    return Response.json({ error: 'question, sql, correction, domain required' }, { status: 400 });
  }

  // ── Build LLM prompt ──────────────────────────────────────────────────────
  const domainLabel = domain === 'revenue'
    ? 'Revenue engine (sales orders, MTD/YTD, totes, customers)'
    : 'Finance engine (AP, AR, collections, DSO, expenses, bills, journals)';

  const sys = 'You are a database debugging expert for a financial analytics system. Return ONLY valid JSON with no markdown fences.';
  const msg = `A user flagged an incorrect answer in the ${domainLabel}.

ORIGINAL QUESTION: "${question}"

GENERATED SQL:
${sql}

USER CORRECTION: "${correction}"
${thread_context ? `\nTHREAD CONTEXT:\n${thread_context}` : ''}

Classify the root cause as EXACTLY ONE of:
• SCOPE_DRIFT       — Follow-up lost the date range or scope from the prior query
• WRONG_TABLE       — Used wrong table (e.g. AR invoices instead of payment table)
• MISSING_JOIN      — Query needed a JOIN that was omitted
• MISSING_DEFINITION — No financial definition exists for this calculation
• WRONG_FORMULA     — Wrong aggregation, filter, or calculation logic
• FORMAT_ISSUE      — SQL data was correct; only formatting/display was wrong

Then write a SCHEMA HINT: a specific, plain-English rule with actual table/column names to prevent this error class in future SQL generation.
Good: "When reporting payments received on AR invoices use xero_invoice_payments WHERE invoice_type='AR', not xero_ar_invoices.amount_paid"
Bad: "Use the right table next time"
For FORMAT_ISSUE, set schemaHint to null.

Return ONLY valid JSON (no markdown):
{
  "rootCauseType": "SCOPE_DRIFT|WRONG_TABLE|MISSING_JOIN|MISSING_DEFINITION|WRONG_FORMULA|FORMAT_ISSUE",
  "diagnosis": "One concise sentence explaining what went wrong",
  "schemaHint": "Specific rule with table/column names, or null",
  "fixDescription": "Short user-facing description of what was learned (max 80 chars)"
}`;

  // ── Call LLM ──────────────────────────────────────────────────────────────
  let rootCauseType: RootCauseType | 'UNKNOWN' = 'UNKNOWN';
  let diagnosis = '';
  let schemaHint: string | null = null;
  let fixDescription = 'Feedback recorded';

  try {
    const text = await callLLM(sys, msg);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const rct = parsed.rootCauseType as string;
      rootCauseType = ROOT_CAUSE_TYPES.includes(rct as RootCauseType) ? (rct as RootCauseType) : 'UNKNOWN';
      diagnosis     = typeof parsed.diagnosis === 'string' ? parsed.diagnosis : '';
      schemaHint    = typeof parsed.schemaHint === 'string' && parsed.schemaHint.length > 20
        ? parsed.schemaHint : null;
      fixDescription = typeof parsed.fixDescription === 'string' ? parsed.fixDescription : 'Feedback recorded';
    }
  } catch { /* LLM failed — persist with UNKNOWN type, no hint */ }

  const fixesApplied: Record<string, string> = {};

  // ── Save schema hint (skip FORMAT_ISSUE — doesn't improve SQL) ───────────
  if (schemaHint && rootCauseType !== 'FORMAT_ISSUE' && rootCauseType !== 'UNKNOWN') {
    const category = ROOT_CAUSE_TO_CATEGORY[rootCauseType] ?? 'other';
    await dbPost('schema_hints', {
      domain, category, hint: schemaHint,
      source_log_id: log_id ?? null,
      auto_generated: true, verified: false,
    });
    fixesApplied.schema_hint = schemaHint;
    await pruneSchemaHints(domain); // keep under 20-hint cap
  }

  // ── Save review log ───────────────────────────────────────────────────────
  await dbPost('review_log', {
    log_id: log_id ?? null, domain,
    original_question: question, generated_sql: sql, user_correction: correction,
    root_cause_type: rootCauseType, diagnosis, fixes_applied: fixesApplied, reviewed: false,
  });

  // ── Post Slack diagnosis to thread ────────────────────────────────────────
  if (slack_channel && slack_thread_ts && SLACK_TOKEN && rootCauseType !== 'UNKNOWN') {
    const emoji = ROOT_CAUSE_EMOJI[rootCauseType] ?? '🔬';
    const typeLabel = rootCauseType.replace(/_/g, ' ');
    const hintLine = schemaHint
      ? `\n_Rule added: "${schemaHint.length > 200 ? schemaHint.slice(0, 197) + '…' : schemaHint}"_`
      : '';
    const slackMsg = `${emoji} *Root cause: ${typeLabel}*\n${diagnosis}${hintLine}\n✅ ${fixDescription}`;
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: slack_channel, thread_ts: slack_thread_ts, text: slackMsg }),
    }).catch(() => {});
  }

  return Response.json({ rootCauseType, diagnosis, schemaHint, fixDescription });
});
