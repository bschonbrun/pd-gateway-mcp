// expense-query v56 — feedback loop: corrections injected into prompts
// Normal: auto-resolve >= 0.8 confidence, ask user < 0.8
// Training: auto-resolve >= 0.2 confidence, ask user < 0.2
// Golden example matches = 100% confidence (always auto)
// Audit: self-correct when confidence < 0.7 (auditor thinks original is <70% correct)

// ─── TIMEOUTS ───

const GLOBAL_TIMEOUT_MS = 90_000;  // 90s hard ceiling for entire request
const API_CALL_TIMEOUT_MS = 30_000; // 30s per external API call

function timedFetch(url: string, opts: RequestInit, timeoutMs = API_CALL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── CONFIDENCE THRESHOLDS ───

const NORMAL_THRESHOLD = 0.8;
const TRAINING_THRESHOLD = 0.2;
const AUDIT_CONFIDENCE_FLOOR = 0.7;
function getThreshold(mode: 'normal' | 'training'): number {
  return mode === 'normal' ? NORMAL_THRESHOLD : TRAINING_THRESHOLD;
}

// ─── PATTERN MATCHERS ───

const METADATA_PATTERNS = /\b(help|capabilities|schema|data sources?|what.{0,30}(data|fields?|questions?|information|available|can (i|you|we)|have|know|track)|what('s| is) available)\b/i;
const GLOSSARY_PATTERNS = /\b(financial (terms?|definitions?|metrics?|calculations?|formulas?)|terms? (you have|available|defined|can i ask|do you (have|know|support))|definitions? (you have|available|you (know|understand|support))|glossary|kpi|kpis|what (can|can't|cannot) (you|i) (calculate|compute|measure|ask|query|answer)|what financial|what.{0,30}(metrics?|definitions?|calculations?).{0,30}(you|available|understand|know|have|like dso)|list.{0,20}(terms?|definitions?|metrics?|formulas?)|show.{0,20}(terms?|definitions?|metrics?))\b/i;
const HELP_PATTERNS = /^\s*(\/(help|\?))\s*$/i;
const FEEDBACK_PATTERNS = /^\s*(?:\/)?(wrong|learn|teach)[:\s]\s*/i;
const DEBUG_PATTERNS = /^\s*(?:\/)?debug:?\s*$/i;
const EXPLAIN_PATTERNS = /^\s*(?:\/)?explain:?\s*$/i;
const DEFINITIONS_PATTERNS = /^\s*(?:\/)?definitions?:?\s*$/i;
const INTERPRETATION_PATTERNS = /^\s*(?:\/)?interpretation:?\s*$/i;
const AUDIT_PATTERNS = /^\s*(?:\/)?audit:?\s*$/i;
const RESOLVE_PATTERNS = /^\s*(?:\/)?resolve:?\s*$/i;
const TRAIN_PATTERN = /^\s*train\s*$/i;
const TRAIN_PREFIX = /^\s*train[:\s]+\s*/i;
const NORMAL_PATTERN = /^\s*normal\s*$/i;
const NORMAL_PREFIX = /^\s*normal[:\s]+\s*/i;
const RESEARCH_PATTERNS = /\b(industry (benchmark|average|standard|norm|median|comparison)|benchmark.{0,30}(dso|dpo|ar|ap|margin|turnover|ratio|collection|aging)|best practice|how do (other|similar|comparable) (compan|manufacturer|firm)|compare.{0,20}(to|with|against) (industry|peer|sector|market)|typical.{0,20}(dso|dpo|margin|ratio|turnover|collection|aging)|what('s| is) (normal|average|typical|standard).{0,20}(for|in)|sector.{0,20}(average|benchmark|comparison)|peer.{0,20}(comparison|benchmark|group))\b/i;
const HYBRID_PATTERNS = /\b(compare|how do(es)? (our|we|my)|vs\.? (industry|benchmark|average|peer)|our.{0,30}(compare|stack up|measure up|versus|vs))\b/i;

// ─── TYPES ───

interface EngineRequest {
  question: string; user_id: string; channel?: string; command?: string;
  feedback_type?: 'rating' | 'wrong' | 'learn'; log_id?: string;
  rating?: 'positive' | 'negative'; correction?: string;
  slack_ts?: string; slack_channel?: string; thread_context?: string;
  slack_bot_token?: string; slack_thread_ts?: string;
  mode?: 'normal' | 'training';
  resolution?: { option: string; clarification_type: string; options: unknown[]; context: unknown };
}

interface GoldenExample { question: string; correct_sql: string; }
interface FinancialDefinition { term: string; category: string; definition: string; formula: string | null; sql_template: string | null; keywords: string[] | null; }
interface KnowledgeTerm { term: string; standard_ref?: string; asc_code?: string; category: string; definition: string; guidance: string | null; example: string | null; }
interface ConversationContext { question: string; sql: string; answer: string; }
interface FeedbackRule { correction: string; feedback_type: string; question: string; created_at: string; }
interface LLMResult { text: string; model: string; }

// ─── SLACK PROGRESS ───

let _progressMsgTs: string | null = null;

async function updateSlackProgress(botToken: string | undefined, channel: string | undefined, threadTs: string | undefined, text: string): Promise<void> {
  if (!botToken || !channel || !threadTs) return;
  try {
    if (!_progressMsgTs) {
      const res = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, thread_ts: threadTs, text }) });
      const data = await res.json(); if (data.ok) _progressMsgTs = data.ts;
    } else {
      await fetch('https://slack.com/api/chat.update', { method: 'POST', headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, ts: _progressMsgTs, text }) });
    }
  } catch { /* best-effort */ }
}

async function deleteSlackProgress(botToken: string | undefined, channel: string | undefined): Promise<void> {
  if (!botToken || !channel || !_progressMsgTs) return;
  try { await fetch('https://slack.com/api/chat.delete', { method: 'POST', headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, ts: _progressMsgTs }) }); } catch { /* cleanup */ }
  _progressMsgTs = null;
}

// ─── DATA FETCHERS ───

async function dbFetch<T>(url: string, key: string, path: string): Promise<T[]> {
  try { const res = await fetch(`${url}/rest/v1/${path}`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }); if (!res.ok) return []; return await res.json() as T[]; } catch { return []; }
}
async function fetchGoldenExamples(url: string, key: string): Promise<GoldenExample[]> {
  return dbFetch<GoldenExample>(url, key, 'expense_query_golden?approved=eq.true&promoted=eq.true&select=question,correct_sql&order=created_at.asc');
}
async function fetchFinancialDefinitions(url: string, key: string): Promise<FinancialDefinition[]> {
  return dbFetch<FinancialDefinition>(url, key, 'financial_definitions?active=eq.true&select=term,category,definition,formula,sql_template,keywords&order=category.asc,term.asc');
}
async function fetchKnowledgeTerms(url: string, key: string, table: 'gaap_terms' | 'ifrs_terms'): Promise<KnowledgeTerm[]> {
  const fields = table === 'gaap_terms' ? 'term,asc_code,category,definition,guidance,example' : 'term,standard_ref,category,definition,guidance,example';
  return dbFetch<KnowledgeTerm>(url, key, `${table}?active=eq.true&select=${fields}&order=category.asc,term.asc`);
}
async function fetchConversationContext(url: string, key: string, userId: string, channel: string): Promise<ConversationContext | null> {
  try { const res = await fetch(`${url}/rest/v1/expense_query_log?user_id=eq.${encodeURIComponent(userId)}&channel=eq.${encodeURIComponent(channel)}&generated_sql=not.is.null&error=is.null&order=created_at.desc&limit=1&select=question,generated_sql,answer`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }); if (!res.ok) return null; const rows = await res.json(); return rows.length ? { question: rows[0].question, sql: rows[0].generated_sql, answer: rows[0].answer } : null; } catch { return null; }
}
async function fetchRecentFeedback(url: string, key: string, limit = 20): Promise<FeedbackRule[]> {
  try {
    const res = await fetch(`${url}/rest/v1/expense_query_feedback?select=correction,feedback_type,created_at,log_id&order=created_at.desc&limit=${limit}`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } });
    if (!res.ok) return [];
    const rows = await res.json() as { correction: string; feedback_type: string; created_at: string; log_id: string }[];
    // Enrich with original question from log
    const logIds = [...new Set(rows.map(r => r.log_id).filter(Boolean))];
    const questionsMap = new Map<string, string>();
    if (logIds.length > 0) {
      const logRes = await fetch(`${url}/rest/v1/expense_query_log?id=in.(${logIds.map(id => `"${id}"`).join(',')})&select=id,question`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } });
      if (logRes.ok) {
        const logs = await logRes.json() as { id: string; question: string }[];
        for (const log of logs) questionsMap.set(log.id, log.question);
      }
    }
    return rows.map(r => ({ correction: r.correction, feedback_type: r.feedback_type, question: questionsMap.get(r.log_id) ?? '', created_at: r.created_at }));
  } catch { return []; }
}

// ─── MODE MANAGEMENT ───

async function getUserMode(url: string, key: string, userId: string): Promise<'normal' | 'training'> {
  try {
    const res = await fetch(`${url}/rest/v1/engine_mode?user_id=eq.${encodeURIComponent(userId)}&select=mode&limit=1`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } });
    if (!res.ok) return 'normal';
    const rows = await res.json();
    return (rows?.[0]?.mode as 'normal' | 'training') ?? 'normal';
  } catch { return 'normal'; }
}

async function setUserMode(url: string, key: string, userId: string, mode: 'normal' | 'training'): Promise<void> {
  try {
    await fetch(`${url}/rest/v1/engine_mode`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, mode, updated_at: new Date().toISOString() }),
    });
  } catch { /* best-effort */ }
}

// ─── GOLDEN MATCH (100% confidence bypass) ───

function findGoldenMatch(question: string, goldens: GoldenExample[]): GoldenExample | null {
  const q = question.toLowerCase().trim().replace(/[?!.,]+$/g, '');
  for (const g of goldens) {
    const gq = g.question.toLowerCase().trim().replace(/[?!.,]+$/g, '');
    if (q === gq) return g;
  }
  for (const g of goldens) {
    const gq = g.question.toLowerCase().trim();
    const words = q.split(/\s+/);
    const gWords = gq.split(/\s+/);
    const overlap = words.filter(w => gWords.includes(w)).length;
    if (overlap / Math.max(words.length, gWords.length) >= 0.85) return g;
  }
  return null;
}

// ─── UNKNOWN TERM DETECTION (LLM-based) ───

async function detectUnknownTermsViaLLM(
  question: string,
  knownDefs: FinancialDefinition[],
  anthropicKey: string,
  geminiKey: string | undefined,
): Promise<string[]> {
  const knownTermsLower = new Set(knownDefs.map(d => d.term.toLowerCase()));
  const knownTermsList = knownDefs.map(d => d.term).slice(0, 50).join(', ');

  const prompt = `Extract business/financial/domain-specific terms from this question that would need a precise definition to generate correct SQL. Only extract terms where the meaning could vary by company or industry — NOT generic words.

Known terms we already have definitions for: ${knownTermsList}

Return ONLY a JSON array of extracted terms (excluding any that match known terms above). If no special terms, return []. Example: ["raw materials", "finished goods", "overhead costs"]

IMPORTANT: Include multi-word business terms like "raw materials", "cost of goods sold", "accounts receivable", "work in progress", etc. Do NOT include generic SQL words or common English.`;

  try {
    const result = await callLLM(prompt, `Question: "${question}"`, anthropicKey, geminiKey, 200);
    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) return [];
    const terms = JSON.parse(jsonMatch[0]) as string[];
    return terms
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length > 1 && !knownTermsLower.has(t));
  } catch {
    return [];
  }
}

async function researchTermViaPerplexity(term: string, apiKey: string): Promise<{ definition: string; formula: string; sql_hint: string; confidence: number } | null> {
  try {
    const res = await timedFetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'system', content: 'You are a financial analyst defining accounting terms for a water treatment / chemical manufacturing company. Return JSON only.' }, { role: 'user', content: `Define "${term}" for a manufacturing company. Return ONLY valid JSON:\n{"definition": "one sentence", "formula": "formula or N/A", "sql_hint": "which columns", "confidence": 0.0-1.0}\n\nconfidence = how sure you are this is the standard industry definition (1.0 = textbook definition, 0.5 = could vary by company)` }], max_tokens: 300 }) });
    if (!res.ok) return null;
    const data = await res.json(); const text = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, confidence: parsed.confidence ?? 0.7 };
  } catch { return null; }
}

async function saveResearchedDefinition(url: string, key: string, term: string, research: { definition: string; formula: string; sql_hint: string }): Promise<void> {
  try { await fetch(`${url}/rest/v1/financial_definitions`, { method: 'POST', headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ term, category: 'auto_researched', definition: research.definition, formula: research.formula !== 'N/A' ? research.formula : null, sql_template: null, active: true, source: 'perplexity_auto' }) }); } catch { /* best-effort */ }
}

// ─── CLARIFICATION HINT ───

const REPLY_HINT = '_Reply with *A*, *B*, or *C* in this thread_';

// ─── CLARIFICATION BUILDERS ───

function buildTermClarification(term: string, research: { definition: string; formula: string; sql_hint: string; confidence: number }): { message: string; options: { label: string; description: string; value: string }[] } {
  const formulaNote = research.formula !== 'N/A' ? ` (Formula: ${research.formula})` : '';
  const confLabel = research.confidence >= 0.8 ? '🟢 high confidence' : research.confidence >= 0.5 ? '🟡 medium confidence' : '🔴 low confidence';
  const options = [
    { label: 'A', description: `${research.definition}${formulaNote}`, value: 'research_accept' },
    { label: 'B', description: `Use a different column from our data (${research.sql_hint})`, value: 'use_data_column' },
    { label: 'C', description: 'Something else — tell me your definition', value: 'custom' },
  ];
  const message = `🔬 *I don't recognize "${term}" in our definitions. I researched it (${confLabel}):*\n\n*A)* ${options[0].description}\n\n*B)* ${options[1].description}\n\n*C)* Something else — tell me your definition\n\n${REPLY_HINT}`;
  return { message, options };
}

async function checkAmbiguity(question: string, anthropicKey: string, geminiKey: string | undefined): Promise<{ isAmbiguous: boolean; confidence: number; interpretations?: { label: string; description: string; value: string }[]; message?: string; autoSelected?: string }> {
  const prompt = `You analyze financial questions for ambiguity. Given a question, determine if it has multiple valid interpretations.\n\nIf ambiguous, return JSON: {"ambiguous": true, "confidence": 0.0-1.0, "interpretations": [{"label": "A", "description": "interpretation 1"}, {"label": "B", "description": "interpretation 2"}, {"label": "C", "description": "interpretation 3"}]}\nIf clear, return: {"ambiguous": false, "confidence": 1.0}\n\nconfidence = how confident you are that interpretation A is correct (1.0 = obviously the right reading, 0.5 = genuinely could go either way)\nOnly flag as ambiguous if there are genuinely different ways to calculate the answer.`;
  try {
    const result = await callLLM(prompt, `Question: "${question}"`, anthropicKey, geminiKey, 300);
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { isAmbiguous: false, confidence: 1.0 };
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.ambiguous) return { isAmbiguous: false, confidence: parsed.confidence ?? 1.0 };
    const interps = parsed.interpretations ?? [];
    if (!interps.length) return { isAmbiguous: false, confidence: 1.0 };
    const confidence = parsed.confidence ?? 0.5;
    const message = `🤔 *"${question}" could mean a few things:*\n\n${interps.map((i: { label: string; description: string }) => `*${i.label})* ${i.description}`).join('\n\n')}\n\n${REPLY_HINT}`;
    return { isAmbiguous: true, confidence, interpretations: interps.map((i: { label: string; description: string }) => ({ ...i, value: i.description })), message, autoSelected: interps[0]?.description };
  } catch { return { isAmbiguous: false, confidence: 1.0 }; }
}

function buildAuditClarification(_question: string, issues: string, _sql: string, _correctedSql: string | undefined): { message: string; options: { label: string; description: string; value: string }[] } {
  const options = [
    { label: 'A', description: 'Use my original query', value: 'keep_original' },
    { label: 'B', description: 'Use the auditor correction', value: 'use_corrected' },
    { label: 'C', description: 'Neither — tell me the right approach', value: 'custom' },
  ];
  return { message: `🔎 *My auditor flagged a potential issue:*\n\n_${issues}_\n\n*A)* Keep my original approach\n*B)* Use the auditor correction\n*C)* Neither — tell me the right approach\n\n${REPLY_HINT}`, options };
}

// ─── SQL AUDITOR ───

async function auditSQLViaPerplexity(question: string, sql: string, relevantDefs: FinancialDefinition[], apiKey: string): Promise<{ passed: boolean; issues: string; corrected_sql?: string; confidence: number }> {
  const defsContext = relevantDefs.map(d => `${d.term}: ${d.definition}${d.formula ? ` (Formula: ${d.formula})` : ''}`).join('\n');
  try {
    const res = await timedFetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'system', content: 'You audit SQL queries for financial accuracy. Return ONLY valid JSON.' }, { role: 'user', content: `Question: "${question}"\n\nSQL:\n${sql}\n\nFinancial definitions:\n${defsContext || 'None'}\n\nDoes this SQL correctly answer the question? Return JSON:\n{"passed": true/false, "issues": "description or 'none'", "corrected_sql": "fixed SQL or null", "confidence": 0.0-1.0}\n\nconfidence = how confident you are the ORIGINAL SQL is correct (1.0 = perfect, 0.5 = uncertain, 0.0 = definitely wrong)` }], max_tokens: 800 }) });
    if (!res.ok) return { passed: true, issues: 'Audit unavailable', confidence: 0.5 };
    const data = await res.json(); const text = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { passed: true, issues: 'Could not parse audit', confidence: 0.5 };
    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, confidence: parsed.confidence ?? (parsed.passed ? 0.9 : 0.3) };
  } catch { return { passed: true, issues: 'Audit error', confidence: 0.5 }; }
}

// ─── FINANCIAL DEFINITIONS ───

function matchRelevantDefinitions(question: string, definitions: FinancialDefinition[]): FinancialDefinition[] {
  const q = question.toLowerCase();
  return definitions.filter(d => {
    if (q.includes(d.term.toLowerCase())) return true;
    return (
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
  }).slice(0, 8);
}

function buildGlossaryResponse(definitions: FinancialDefinition[]): string {
  const byCategory: Record<string, FinancialDefinition[]> = {};
  for (const d of definitions) { if (!byCategory[d.category]) byCategory[d.category] = []; byCategory[d.category].push(d); }
  const labels: Record<string, string> = { ar_ap: '📄 AP / AR', cash_flow: '💸 Cash Flow', profitability: '📈 Revenue & Profitability', fpa: '📊 FP&A', expense: '💳 Expense', banking: '🏦 Banking', gl: '📓 GL', liquidity: '💧 Liquidity', solvency: '⚖️ Solvency', working_capital: '🔄 Working Capital', auto_researched: '🧪 Auto-Researched' };
  let out = `*Financial Intelligence — ${definitions.length} Terms & KPIs* 📚\n\n`;
  for (const [cat, items] of Object.entries(byCategory)) { out += `*${labels[cat] ?? cat}*\n${items.map(d => `\`${d.term}\``).join(', ')}\n\n`; }
  return out;
}

function buildKnowledgeAnswer(question: string, terms: KnowledgeTerm[], standard: 'GAAP' | 'IFRS'): string {
  if (!terms.length) return `No ${standard} term found.`;
  const q = question.toLowerCase();
  const sorted = terms.map(t => ({ t, score: (q.includes(t.term.toLowerCase()) ? 10 : 0) + (t.definition.toLowerCase().split(' ').filter(w => w.length > 4 && q.includes(w)).length) })).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.t);
  let out = `*${standard} Reference* 📖\n\n`;
  for (const t of sorted) { const code = t.asc_code ?? t.standard_ref ?? ''; out += `*${t.term}* ${code ? `_(${code})_` : ''}\n${t.definition}\n${t.guidance ? `_Guidance:_ ${t.guidance}\n` : ''}${t.example ? `_Example:_ ${t.example}\n` : ''}\n`; }
  return out;
}

function buildFeedbackContext(feedback: FeedbackRule[]): string {
  if (!feedback.length) return '';
  const sqlCorrections = feedback.filter(f => f.feedback_type === 'wrong').slice(0, 5);
  const teachRules = feedback.filter(f => f.feedback_type === 'teach' || f.feedback_type === 'learn').slice(0, 10);
  const parts: string[] = [];
  if (teachRules.length) {
    parts.push('## USER-TAUGHT RULES — YOU MUST FOLLOW THESE\n' +
      teachRules.map(r => `- ${r.correction}${r.question ? ` (context: "${r.question}")` : ''}`).join('\n'));
  }
  if (sqlCorrections.length) {
    parts.push('## PAST CORRECTIONS — LEARN FROM THESE MISTAKES\n' +
      sqlCorrections.map(r => `- User said: "${r.correction}"${r.question ? ` (about: "${r.question}")` : ''}`).join('\n'));
  }
  return parts.join('\n\n');
}

function buildFormatPromptWithFeedback(feedback: FeedbackRule[]): string {
  let prompt = FORMAT_SYSTEM_PROMPT;
  const formatRules = feedback.filter(f =>
    /\b(format|display|show|express|unit|currency|days|\$|USD|comma|decimal|label|confus)\b/i.test(f.correction)
  ).slice(0, 5);
  if (formatRules.length) {
    prompt += '\n\n## USER FORMATTING RULES — MANDATORY\n' +
      formatRules.map(r => `- ${r.correction}`).join('\n');
  }
  return prompt;
}

function buildPromptWithContext(basePrompt: string, examples: GoldenExample[], relevantDefs: FinancialDefinition[], researchedDefs?: { term: string; definition: string; formula: string }[], feedback?: FeedbackRule[]): string {
  let prompt = basePrompt;
  if (relevantDefs.length > 0) {
    const defsBlock = relevantDefs.map(d => { let e = `TERM: ${d.term} (${d.category})\nDEFINITION: ${d.definition}`; if (d.formula) e += `\nFORMULA: ${d.formula}`; if (d.sql_template) e += `\nSQL PATTERN: ${d.sql_template}`; return e; }).join('\n\n');
    prompt += `\n\n## RELEVANT FINANCIAL DEFINITIONS — MANDATORY\n${defsBlock}`;
  }
  if (researchedDefs && researchedDefs.length > 0) {
    prompt += `\n\n## NEWLY RESEARCHED TERMS\n${researchedDefs.map(d => `TERM: ${d.term}\nDEFINITION: ${d.definition}\nFORMULA: ${d.formula}`).join('\n\n')}`;
  }
  if (examples.length > 0) {
    prompt += `\n\nGOLDEN EXAMPLES:\n\n${examples.map(e => `Q: ${e.question}\nA: ${e.correct_sql}`).join('\n\n')}`;
  }
  if (feedback?.length) {
    prompt += `\n\n${buildFeedbackContext(feedback)}`;
  }
  return prompt;
}

// ─── HELP TEXT ───

const DATA_SUMMARY = `*Financial Intelligence — Available Data* 📊\n\n*💳 Float Financial* — ~5,970 corporate card records\n*📋 Expensify* — ~25,800 expense records\n*📄 Xero AP* — 26,000+ bills (2 entities)\n*🧾 Xero AR* — invoices (2 entities)\n*🏦 Banking, GL Journals, Chart of Accounts*\n\n*Commands:* \`train\` • \`normal\` • \`debug:\` • \`explain:\` • \`wrong: [correction]\` • \`teach: [rule]\``;

// ─── SCHEMA ───

const EXPENSE_SCHEMA_CONTEXT = `
## BUSINESS CONTEXT
Acme Corp financial data from six sources:
1. FLOAT FINANCIAL: corporate cards (direct-pay)
2. EXPENSIFY: employee expenses (reimbursable + billable)
3. XERO AP: vendor invoices — two entities, both USD
4. XERO AR: customer invoices — two entities, both USD
5. XERO GL: journals, bank transactions, chart of accounts, credit notes
6. SALES ORDERS: the authoritative source for revenue — use for current/MTD/QTD/YTD revenue

XERO ENTITIES:
- 'Acme Water Treatment - USD' = US
- 'Acme Canada (USD)' = Canadian

## expense_transactions
  id text PK, source text ('float'|'expensify'), report_id text, employee_email text,
  manager_email text, merchant text, category text, mcc_group text, tag text,
  amount numeric, currency text, tax_amount numeric, expense_date date,
  report_status text, reimbursable bool, billable bool, accounting_stage text,
  spend_compliance_status text, gl_code text

## xero_bills (AP)
  id text PK, company_name text, invoice_number text, contact_id text, contact_name text,
  status text ('DRAFT'|'AUTHORISED'|'PAID'|'VOIDED'|'DELETED'),
  invoice_date date, due_date date, fully_paid_on_date date,
  total numeric, amount_due numeric, amount_paid numeric, amount_credited numeric, reference text

## xero_bill_line_items
  id text PK, bill_id text FK, description text, quantity numeric, unit_amount numeric,
  line_amount numeric, account_code text

## xero_ar_invoices (AR)
  id text PK, company_name text, invoice_number text, contact_id text, contact_name text,
  status text, invoice_date date, due_date date, fully_paid_on_date date,
  total numeric, amount_due numeric, amount_paid numeric, amount_credited numeric

## xero_ar_line_items
  id text PK, invoice_id text FK, description text, quantity numeric, unit_amount numeric,
  line_amount numeric, account_code text

## xero_invoice_payments
  id text PK, invoice_id text, invoice_type text ('AR'|'AP'), company_name text,
  date date, amount numeric, account_code text, account_name text, is_reconciled boolean

## xero_journals + xero_journal_lines
  journal_id, company_name, journal_date, source_type, net_amount, account_code, account_name, account_type

## xero_bank_transactions
  id, company_name, transaction_type ('SPEND'|'RECEIVE'), contact_name, bank_account_name, total, date, is_reconciled

## xero_contacts
  id text PK, company_name text, name text (WARNING: column is "name" NOT "contact_name"),
  is_supplier boolean, is_customer boolean, country text

## xero_accounts (chart of accounts)
  account_id, company_name, code, name, type, class ('ASSET'|'LIABILITY'|'EQUITY'|'INCOME'|'EXPENSE')

## xero_credit_notes, xero_purchase_orders, xero_budgets, xero_tracking_categories

## gl_category_mappings
  category_name text UNIQUE, account_codes text[], description text

## sales_orders (REVENUE — AUTHORITATIVE SOURCE)
  row_id text PK, order_number integer, customer_name text, site_name text,
  order_date timestamptz, delivery_date timestamptz, month text, year integer,
  totes numeric, gallons numeric, amount numeric (revenue value in USD),
  cost_per_gallon numeric, cost_per_lb numeric, price_by text,
  is_draft boolean, is_cancelled boolean, sales_rep text,
  ship_mode text, reference_number text, order_invoice text
  FILTERS: WHERE NOT is_draft AND NOT is_cancelled

## FORMULA PRIORITY
1. FIRST check RELEVANT FINANCIAL DEFINITIONS
2. THEN apply company-specific rules
3. NEVER invent formulas when definitions exist

## CRITICAL RULES
- REVENUE (current period — MTD, QTD): Use sales_orders. Filter: WHERE NOT is_draft AND NOT is_cancelled. Revenue column is "amount".
- REVENUE (historical — YoY, MoM, CAGR, TTM, prior years): Use xero_ar_invoices (status IN ('AUTHORISED','PAID')). Historical invoices and sales orders should match.
- xero_ar_invoices is the primary source for AR/collections/DSO analysis
- xero_contacts uses "name" NOT "contact_name"
- AP outstanding: status = 'AUTHORISED' AND amount_due > 0
- AR outstanding: status = 'AUTHORISED' AND amount_due > 0
- Overdue: due_date < CURRENT_DATE AND amount_due > 0
- Current date: ${new Date().toISOString().split('T')[0]}
`;

const SQL_SYSTEM_PROMPT = `You are a SQL expert for Acme Corp financial database (PostgreSQL).\nGenerate a single SELECT query.\n\n${EXPENSE_SCHEMA_CONTEXT}\n\nRules: Output ONLY SQL. CANNOT_ANSWER: <reason> if impossible. Default LIMIT 20. Follow-ups: use PRIOR context.`;
const FORMAT_SYSTEM_PROMPT = `Format SQL results into a Slack message answering the user's question.

Rules:
- Use Slack mrkdwn formatting
- Format dollar amounts with $ and commas
- Format years as numbers (not dates)
- ALWAYS name the metric and include units. Examples:
  - DSO: "*54.3 days*" not just "54.3"
  - Revenue: "*$1,234,567*" not just a number
  - Count: "*142 invoices*" not just "142"
  - Ratio: "*1.8x*" or "*1.8:1*"
  - Percentage: "*23.4%*"
- ALWAYS provide brief context (e.g. "Your current DSO is *54.3 days*")
- Keep it concise — one or two sentences for simple metrics
- For tables, use bullet points with labels

METHODOLOGY TRANSPARENCY — for any calculated ratio or KPI (DSO, DPO, margins, turnover, ratios, growth rates, etc.):
- State the formula used in plain English, e.g. "_(AR Balance ÷ Revenue over 90 days) × 90_"
- State the time period measured, e.g. "_Based on trailing 90-day revenue_"
- If the user's question includes "definition", "formula", "how", "explain", or "interpret", also add:
  - What the number means practically (e.g. "On average, it takes ~54 days to collect after invoicing")
  - What range is typical for the industry if you know it
  - Whether the result looks healthy or concerning
- Keep methodology notes brief — one italic line after the answer, not a lecture`;
const FORBIDDEN_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i;
const FEEDBACK_FOOTER = `\n\n---\n_💡 \`wrong: [correction]\` • \`teach: [rule]\` • \`debug:\` • \`explain:\`_`;

// ─── LLM CHAIN ───

const GEMINI_LITE = 'gemini-3.1-flash-lite-preview';
const GEMINI_FLASH = 'gemini-2.5-flash';
const GEMINI_PRO = 'gemini-3-flash-preview';
const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5';

type ModelStep = { provider: 'gemini' | 'anthropic'; model: string };
const SIMPLE_CHAIN: ModelStep[] = [{ provider: 'gemini', model: GEMINI_LITE }, { provider: 'gemini', model: GEMINI_FLASH }, { provider: 'gemini', model: GEMINI_PRO }, { provider: 'anthropic', model: SONNET }, { provider: 'anthropic', model: HAIKU }];
const COMPLEX_CHAIN: ModelStep[] = [{ provider: 'gemini', model: GEMINI_FLASH }, { provider: 'gemini', model: GEMINI_PRO }, { provider: 'anthropic', model: SONNET }, { provider: 'anthropic', model: HAIKU }];
const COMPLEX_PATTERNS = /\b(compar|vs\.?|versus|percent|trend|rank|top \d|bottom \d|breakdown|by company|by month|by vendor|year.over.year|month.over.month|growth|ratio|margin|correlat|across|between|each|per\b)/i;
function isComplexQuery(q: string): boolean { return COMPLEX_PATTERNS.test(q); }

async function callGemini(sys: string, msg: string, key: string, model: string): Promise<LLMResult | null> {
  try { const res = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: msg }] }] }) }); if (!res.ok) return null; const data = await res.json(); return { text: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '', model }; } catch { return null; }
}
async function callAnthropic(sys: string, msg: string, key: string, model: string, max = 1024): Promise<LLMResult | null> {
  try { const res = await timedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: max, system: sys, messages: [{ role: 'user', content: msg }] }) }); if (!res.ok) return null; const data = await res.json(); return { text: data.content[0]?.text?.trim() ?? '', model }; } catch { return null; }
}
async function callLLM(sys: string, msg: string, aKey: string, gKey: string | undefined, max = 1024, complex?: boolean): Promise<LLMResult> {
  for (const { provider, model } of (complex ? COMPLEX_CHAIN : SIMPLE_CHAIN)) { if (provider === 'gemini' && !gKey) continue; const r = provider === 'gemini' ? await callGemini(sys, msg, gKey!, model) : await callAnthropic(sys, msg, aKey, model, max); if (r) return r; }
  throw new Error('All LLM providers failed');
}

// ─── SQL HELPERS ───

function cleanSQL(raw: string): string { return raw.replace(/;?\s*$/, '').replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim(); }
function validateSQL(sql: string): { valid: boolean; reason?: string } { if (!sql || sql.startsWith('CANNOT_ANSWER:')) return { valid: false, reason: sql }; if (FORBIDDEN_PATTERNS.test(sql)) return { valid: false, reason: 'Forbidden' }; const n = sql.trim().toUpperCase(); if (!n.startsWith('SELECT') && !n.startsWith('WITH')) return { valid: false, reason: 'Must start with SELECT' }; return { valid: true }; }
async function executeQuery(sql: string, url: string, key: string): Promise<{ rows: unknown[] }> { const res = await fetch(`${url}/rest/v1/rpc/exec_readonly_sql`, { method: 'POST', headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query_text: sql }) }); if (!res.ok) throw new Error(`Query failed: ${await res.text()}`); const data = await res.json(); return { rows: Array.isArray(data) ? data : [data] }; }

// ─── FORMATTING ───

function formatValue(val: unknown): string { if (val === null || val === undefined) return '_N/A_'; if (typeof val === 'number') { if (Math.abs(val) >= 1000) return `*$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`; if (Number.isInteger(val)) return `*${val}*`; return `*${val.toFixed(2)}*`; } return `${val}`; }
function templateSimpleAnswer(question: string, rows: unknown[]): string | null {
  if (rows.length === 0) return `No results for: _"${question}"_`;
  if (rows.length > 3) return null;
  const first = rows[0] as Record<string, unknown>; const keys = Object.keys(first);
  // Single value results (e.g. DSO=59) → always use LLM formatter for context
  if (rows.length === 1 && keys.length === 1) return null;
  if (rows.length === 1 && keys.length <= 4) return keys.map(k => `• *${k.replace(/_/g, ' ')}*: ${formatValue(first[k])}`).join('\n');
  if (rows.length <= 3 && keys.length <= 5) return (rows as Record<string, unknown>[]).map(row => { const label = row[keys[0]]; const vals = keys.slice(1).map(k => `${k.replace(/_/g, ' ')}: ${formatValue(row[k])}`).join(' · '); return `• *${label}* — ${vals}`; }).join('\n');
  return null;
}
function formatFallback(question: string, rows: unknown[]): string {
  if (rows.length === 0) return `No results: _"${question}"_`;
  const typed = rows as Record<string, unknown>[]; const keys = Object.keys(typed[0]);
  const lines = typed.slice(0, 20).map((row, i) => `${i + 1}. ${keys.map(k => row[k] != null ? `${k.replace(/_/g, ' ')}: ${row[k]}` : '').filter(Boolean).join(' · ')}`);
  let out = lines.join('\n'); if (rows.length > 20) out += `\n_...and ${rows.length - 20} more_`; return out;
}

// ─── TRANSPARENCY ───

interface TransparencyMeta {
  definitions: { term: string; category: string; definition: string; formula: string | null }[];
  interpretation: { method: string; confidence: number; selected: string; full_text: string } | null;
  audit: { ran: boolean; autoApplied: boolean; confidence: number; issues: string; full_text: string } | null;
  researched: string[];
  golden_match: boolean;
}

function stripCitations(s: string): string { return s.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim(); }

function smartSummarize(text: string, maxLen: number): string {
  const clean = stripCitations(text);
  if (clean.length <= maxLen) return clean;
  // Find last sentence boundary before maxLen
  const truncated = clean.substring(0, maxLen);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastSemicolon = truncated.lastIndexOf(';');
  const boundary = Math.max(lastPeriod, lastSemicolon);
  return boundary > maxLen * 0.4 ? truncated.substring(0, boundary + 1) : truncated.replace(/\s+\S*$/, '') + '…';
}

function buildTransparency(mode: 'normal' | 'training', opts: { defsUsed: FinancialDefinition[]; audited: boolean; auditIssues?: string; auditAutoApplied?: boolean; auditConfidence?: number; termsResearched: string[]; ambiguityDetected?: boolean; ambiguityAutoSelected?: string; ambiguityConfidence?: number; goldenMatch?: boolean; sql?: string }): { text: string; meta: TransparencyMeta } {
  const auditPct = Math.round((opts.auditConfidence ?? 0) * 100);
  const isLowConfidenceAudit = auditPct < 50;

  const meta: TransparencyMeta = {
    definitions: opts.defsUsed.map(d => ({ term: d.term, category: d.category, definition: d.definition, formula: d.formula })),
    interpretation: opts.ambiguityDetected ? {
      method: opts.ambiguityAutoSelected ? 'auto' : 'user',
      confidence: opts.ambiguityConfidence ?? 0,
      selected: opts.ambiguityAutoSelected ?? '',
      full_text: opts.ambiguityAutoSelected ?? '',
    } : null,
    audit: opts.audited ? {
      ran: true,
      autoApplied: opts.auditAutoApplied ?? false,
      confidence: opts.auditConfidence ?? 0,
      issues: opts.auditIssues ?? 'none',
      full_text: stripCitations(opts.auditIssues ?? 'No issues detected.'),
    } : null,
    researched: opts.termsResearched,
    golden_match: opts.goldenMatch ?? false,
  };

  if (mode === 'normal') {
    const parts: string[] = [];
    if (opts.goldenMatch) parts.push('✅ Verified');
    if (opts.defsUsed.length) parts.push(`📖 ${opts.defsUsed.length} definition${opts.defsUsed.length > 1 ? 's' : ''} applied`);
    if (opts.ambiguityDetected && opts.ambiguityAutoSelected) parts.push(`🤔 ${smartSummarize(opts.ambiguityAutoSelected, 60)}`);
    if (opts.audited) parts.push(opts.auditAutoApplied ? '🔧 Audit fix applied' : isLowConfidenceAudit ? `⚠️ low-confidence audit (${auditPct}%)` : opts.auditIssues && opts.auditIssues !== 'none' ? `⚠️ ${smartSummarize(opts.auditIssues, 50)}` : '✅ Audited');
    if (opts.termsResearched.length) parts.push(`🔬 ${opts.termsResearched.join(', ')}`);
    return { text: parts.length ? `\n\n_📋 ${parts.join(' • ')}_` : '', meta };
  }

  // Training mode — compact bullets with drill-down hints
  const lines: string[] = [];
  if (opts.goldenMatch) lines.push('✅ Verified golden match');
  if (opts.defsUsed.length) {
    const defNames = opts.defsUsed.slice(0, 3).map(d => `\`${d.term}\``).join(', ');
    const extra = opts.defsUsed.length > 3 ? ` +${opts.defsUsed.length - 3}` : '';
    lines.push(`*Definitions:* ${defNames}${extra} (${opts.defsUsed.length} total)`);
  }
  if (opts.ambiguityDetected) {
    const confStr = opts.ambiguityAutoSelected ? `auto-picked (${Math.round((opts.ambiguityConfidence ?? 0) * 100)}%)` : 'user-resolved';
    const summary = opts.ambiguityAutoSelected ? smartSummarize(opts.ambiguityAutoSelected, 100) : '';
    lines.push(`*Interpretation:* ${confStr}${summary ? ': ' + summary : ''}`);
  }
  if (opts.audited) {
    const detail = opts.auditAutoApplied ? '🔧 correction applied'
      : isLowConfidenceAudit ? `⚠️ low confidence (${auditPct}%) — may need manual review`
      : opts.auditIssues && opts.auditIssues !== 'none' ? `⚠️ ${smartSummarize(opts.auditIssues, 80)}`
      : '✅ passed';
    lines.push(`*Audit:* ${detail}`);
  }
  if (opts.termsResearched.length) lines.push(`*Researched:* ${opts.termsResearched.map(t => `"${t}"`).join(', ')}`);
  if (!lines.length) return { text: '', meta };
  return { text: `\n\n📋 *How I got this:*\n${lines.map(l => `• ${l}`).join('\n')}`, meta };
}

// ─── LOGGING & FEEDBACK ───

async function logQuery(url: string, key: string, entry: Record<string, unknown>): Promise<string | null> { try { const res = await fetch(`${url}/rest/v1/expense_query_log`, { method: 'POST', headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify(entry) }); if (!res.ok) return null; const rows = await res.json(); return rows?.[0]?.id ?? null; } catch { return null; } }
async function writeFeedback(url: string, key: string, entry: Record<string, unknown>): Promise<boolean> { try { const res = await fetch(`${url}/rest/v1/expense_query_feedback`, { method: 'POST', headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify(entry) }); return res.ok; } catch { return false; } }
async function findMostRecentLog(url: string, key: string, userId: string): Promise<{ id: string; question: string; generated_sql: string; transparency_meta?: TransparencyMeta } | null> { try { const res = await fetch(`${url}/rest/v1/expense_query_log?user_id=eq.${userId}&select=id,question,generated_sql,transparency_meta&order=created_at.desc&limit=1`, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }); if (!res.ok) return null; const rows = await res.json(); return rows?.[0] ?? null; } catch { return null; } }
async function saveVerifiedGolden(url: string, key: string, question: string, verifiedSql: string, notes: string): Promise<void> { try { await fetch(`${url}/rest/v1/expense_query_golden`, { method: 'POST', headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ question, correct_sql: verifiedSql, notes, approved: true, promoted: true }) }); } catch { /* best-effort */ } }

// ─── PERPLEXITY RESEARCH ───

const RESEARCH_SYS = 'Financial research for water treatment/chemical manufacturing. Concise Slack, 3-5 bullets, cite sources.';
async function callPerplexity(question: string, apiKey: string): Promise<{ text: string; citations: string[] }> { const res = await timedFetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'system', content: RESEARCH_SYS }, { role: 'user', content: question }], max_tokens: 1024 }) }); if (!res.ok) throw new Error(`Perplexity ${res.status}`); const data = await res.json(); return { text: data.choices?.[0]?.message?.content ?? '', citations: data.citations ?? [] }; }
function extractMetricKeywords(q: string): string[] { const metrics = ['dso', 'dpo', 'ar aging', 'ap aging', 'gross margin', 'operating margin', 'ebitda', 'current ratio', 'quick ratio', 'collection rate', 'burn rate', 'cash conversion cycle', 'working capital', 'debt to equity', 'revenue growth', 'inventory turnover']; const lower = q.toLowerCase(); return metrics.filter(m => lower.includes(m)); }

// ─── MAIN HANDLER ───

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  _progressMsgTs = null;
  const startMs = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');

  let body: EngineRequest;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let { question } = body;
  const { user_id, channel = 'unknown', command, slack_ts, slack_channel, thread_context, slack_bot_token, slack_thread_ts, resolution } = body;
  if (!question && !body.feedback_type) return Response.json({ error: 'question or feedback_type required' }, { status: 400 });
  if (!user_id) return Response.json({ error: 'user_id required' }, { status: 400 });

  const ms = () => Date.now() - startMs;
  const isOverDeadline = () => ms() > GLOBAL_TIMEOUT_MS;
  const progress = (text: string) => updateSlackProgress(slack_bot_token, slack_channel, slack_thread_ts, text);

  let mode: 'normal' | 'training' = body.mode ?? 'normal';
  if (!body.mode) mode = await getUserMode(supabaseUrl, supabaseKey, user_id);

  // ── 0. train / normal toggle (standalone or prefix)
  if (TRAIN_PATTERN.test(question)) {
    await setUserMode(supabaseUrl, supabaseKey, user_id, 'training');
    return Response.json({ answer: `🎓 *Training mode ON.* Confidence threshold: ${TRAINING_THRESHOLD * 100}% — I'll ask for your input on most decisions to learn your preferences.\n\n_Say \`normal\` to switch back (${NORMAL_THRESHOLD * 100}% auto-resolve)._` });
  }
  if (NORMAL_PATTERN.test(question)) {
    await setUserMode(supabaseUrl, supabaseKey, user_id, 'normal');
    return Response.json({ answer: `⚡ *Normal mode.* Confidence threshold: ${NORMAL_THRESHOLD * 100}% — I auto-resolve when confident, but I'll still ask when I'm not sure.\n\n_Say \`train\` to switch to training mode (${TRAINING_THRESHOLD * 100}% threshold)._` });
  }

  // train: <question> → switch mode AND process the question
  if (TRAIN_PREFIX.test(question)) {
    await setUserMode(supabaseUrl, supabaseKey, user_id, 'training');
    mode = 'training';
    question = question.replace(TRAIN_PREFIX, '').trim();
    if (!question) {
      return Response.json({ answer: `🎓 *Training mode ON.* Confidence threshold: ${TRAINING_THRESHOLD * 100}%\n\n_Say \`normal\` to switch back._` });
    }
    // fall through to process the question in training mode
  }
  if (NORMAL_PREFIX.test(question)) {
    await setUserMode(supabaseUrl, supabaseKey, user_id, 'normal');
    mode = 'normal';
    question = question.replace(NORMAL_PREFIX, '').trim();
    if (!question) {
      return Response.json({ answer: `⚡ *Normal mode.* Confidence threshold: ${NORMAL_THRESHOLD * 100}%\n\n_Say \`train\` to switch to training mode._` });
    }
  }

  const threshold = getThreshold(mode);

  // ── 0b. Feedback handler
  if (body.feedback_type) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ error: 'No recent query' }, { status: 404 });
    await writeFeedback(supabaseUrl, supabaseKey, { log_id: recent.id, slack_user: user_id, rating: body.rating ?? 'correction', correction: body.correction ?? question, feedback_type: body.feedback_type });
    return Response.json({ answer: 'Feedback recorded! 👍', feedback_saved: true, duration_ms: ms() });
  }

  if (HELP_PATTERNS.test(question)) return Response.json({ answer: DATA_SUMMARY, duration_ms: ms() });

  if (DEBUG_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query to debug.' });
    const allDefs = await fetchFinancialDefinitions(supabaseUrl, supabaseKey);
    const matched = matchRelevantDefinitions(recent.question, allDefs);
    return Response.json({ answer: `🔍 *Debug*\n\n*Q:* _"${recent.question}"_\n\n*SQL:*\n\`\`\`${recent.generated_sql || 'N/A'}\`\`\`\n\n*Definitions (${matched.length}):*\n${matched.length ? matched.map(d => `• *${d.term}*: ${d.definition.substring(0, 80)}`).join('\n') : '_None_'}\n\n*Mode:* ${mode} (threshold: ${threshold * 100}%)` });
  }
  if (EXPLAIN_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query to explain.' });
    const allDefs = await fetchFinancialDefinitions(supabaseUrl, supabaseKey);
    const matched = matchRelevantDefinitions(recent.question, allDefs);
    const result = await callLLM('Explain SQL reasoning for non-technical user. 3-5 steps, Slack mrkdwn.', `Question: "${recent.question}"\nSQL: ${recent.generated_sql}\nDefinitions: ${matched.map(d => `${d.term}: ${d.definition}`).join('; ') || 'none'}`, anthropicKey, geminiKey, 512);
    return Response.json({ answer: `🧠 *Reasoning: "${recent.question}"*\n\n${result.text}` });
  }

  // ── Drill-down commands ──
  if (DEFINITIONS_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query.' });
    const meta = recent.transparency_meta;
    if (!meta?.definitions?.length) {
      const allDefs = await fetchFinancialDefinitions(supabaseUrl, supabaseKey);
      const matched = matchRelevantDefinitions(recent.question, allDefs);
      if (!matched.length) return Response.json({ answer: '📖 No definitions were matched for your last query.' });
      const defLines = matched.map(d => `• *${d.term}* (${d.category})\n  ${d.definition}${d.formula ? `\n  _Formula: ${d.formula}_` : ''}`);
      return Response.json({ answer: `📖 *Definitions for:* _"${recent.question}"_\n\n${defLines.join('\n\n')}` });
    }
    const defLines = meta.definitions.map(d => `• *${d.term}* (${d.category})\n  ${d.definition}${d.formula ? `\n  _Formula: ${d.formula}_` : ''}`);
    return Response.json({ answer: `📖 *Definitions for:* _"${recent.question}"_ (${meta.definitions.length} matched)\n\n${defLines.join('\n\n')}` });
  }

  if (INTERPRETATION_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query.' });
    const meta = recent.transparency_meta;
    if (!meta?.interpretation) return Response.json({ answer: '🤔 No interpretation ambiguity was detected for your last query — it was interpreted directly.' });
    const interp = meta.interpretation;
    const confPct = Math.round(interp.confidence * 100);
    return Response.json({ answer: `🤔 *Interpretation for:* _"${recent.question}"_\n\n• *Method:* ${interp.method === 'auto' ? 'Auto-selected' : 'User-resolved'}\n• *Confidence:* ${confPct}%\n• *Selected approach:* ${interp.selected}\n\n${interp.full_text ? `*Full reasoning:*\n${interp.full_text}` : '_No additional detail available._'}` });
  }

  if (AUDIT_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query.' });
    const meta = recent.transparency_meta;
    if (!meta?.audit?.ran) return Response.json({ answer: '🔬 No audit was performed on your last query.' });
    const a = meta.audit;
    const confPct = Math.round(a.confidence * 100);
    const confLabel = confPct >= 80 ? 'High' : confPct >= 50 ? 'Medium' : 'Low';
    const confExplain = confPct >= 80 ? 'The SQL closely matches the expected query pattern.'
      : confPct >= 50 ? 'The SQL partially matches expected patterns — some aspects may need verification.'
      : 'The SQL diverges significantly from expected patterns — manual review recommended.';
    const hasIssues = a.issues !== 'none' && confPct < 70;
    const resolveHint = hasIssues ? '\n\n_Click *🔧 Resolve* or type `resolve:` to have me fix this automatically._' : '';
    return Response.json({ answer: `🔬 *Audit for:* _"${recent.question}"_\n\n• *Confidence:* ${confPct}% (${confLabel})\n  _${confExplain}_\n• *Auto-correction:* ${a.autoApplied ? 'Yes — SQL was modified based on audit findings' : 'No'}\n• *Issues found:* ${a.issues === 'none' ? 'None' : a.full_text}${resolveHint}\n\n_Type \`debug:\` to see the actual SQL, or \`wrong: [correction]\` to provide feedback._` });
  }

  if (RESOLVE_PATTERNS.test(question)) {
    const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
    if (!recent) return Response.json({ answer: 'No recent query to resolve.' });
    const meta = recent.transparency_meta;
    if (!meta?.audit?.ran || meta.audit.issues === 'none') return Response.json({ answer: '✅ No audit issues to resolve — the last query looks good.' });

    await progress('🔧 Resolving audit issues...');
    const [examples, allDefs] = await Promise.all([fetchGoldenExamples(supabaseUrl, supabaseKey), fetchFinancialDefinitions(supabaseUrl, supabaseKey)]);
    const relevantDefs = matchRelevantDefinitions(recent.question, allDefs);
    const defsContext = relevantDefs.map(d => `${d.term}: ${d.definition}${d.formula ? ` (Formula: ${d.formula})` : ''}`).join('\n');

    const constrainedPrompt = buildPromptWithContext(SQL_SYSTEM_PROMPT, examples, relevantDefs);
    const constrainedQuestion = `${recent.question}\n\nIMPORTANT CORRECTION: A previous attempt generated incorrect SQL. The auditor found these issues:\n${meta.audit.full_text}\n\nRelevant financial definitions:\n${defsContext}\n\nYou MUST follow the definitions exactly. Generate corrected SQL.`;

    try {
      // Check if a definition template can resolve this directly
      const templateDef = relevantDefs.find(d => d.sql_template);
      let newSql: string;
      let usedTemplate = false;

      if (templateDef?.sql_template) {
        newSql = templateDef.sql_template;
        usedTemplate = true;
      } else {
        const sqlResult = await callLLM(constrainedPrompt, constrainedQuestion, anthropicKey, geminiKey, 1024, true);
        newSql = cleanSQL(sqlResult.text);
        if (!validateSQL(newSql).valid) return Response.json({ answer: '❌ Could not generate valid corrected SQL. Please use `wrong: [your correction]` to teach me the right approach.' });
      }

      // Re-audit the corrected SQL (skip if using verified template)
      let reauditPassed = true;
      if (!usedTemplate && perplexityKey && relevantDefs.length > 0) {
        await progress('🔎 Re-auditing corrected SQL...');
        const reaudit = await auditSQLViaPerplexity(recent.question, newSql, relevantDefs, perplexityKey);
        reauditPassed = reaudit.passed || reaudit.confidence >= AUDIT_CONFIDENCE_FLOOR;
      }

      await progress('📊 Running corrected query...');
      let rows: unknown[];
      try {
        const result = await executeQuery(newSql, supabaseUrl, supabaseKey);
        rows = result.rows;
      } catch (execErr) {
        // If template failed or syntax error, retry with LLM
        if (usedTemplate) throw execErr;
        await progress('🔄 Retrying with error feedback...');
        const retryResult = await callLLM(constrainedPrompt, `${constrainedQuestion}\n\nPREVIOUS ATTEMPT FAILED:\nSQL: ${newSql}\nERROR: ${execErr}\nFix the syntax error. Output ONLY valid SQL.`, anthropicKey, geminiKey, 1024, true);
        newSql = cleanSQL(retryResult.text);
        if (!validateSQL(newSql).valid) throw execErr;
        const retryExec = await executeQuery(newSql, supabaseUrl, supabaseKey);
        rows = retryExec.rows;
      }

      const fmt = await callLLM(FORMAT_SYSTEM_PROMPT, `Q: ${recent.question}\nResults (${rows.length}):\n${JSON.stringify((rows as unknown[]).slice(0, 50))}`, anthropicKey, geminiKey, 1024);

      // Save as golden if using template or re-audit passed
      if (usedTemplate || reauditPassed) {
        await saveVerifiedGolden(supabaseUrl, supabaseKey, recent.question, newSql, usedTemplate ? `Resolved via definition template: ${templateDef!.term}` : `Auto-resolved from audit issues: ${meta.audit.issues}`);
      }

      await deleteSlackProgress(slack_bot_token, slack_channel);
      const statusLine = (usedTemplate || reauditPassed) ? '✅ *Resolved and saved as verified answer.*' : '⚠️ *Resolved but re-audit had concerns — not saved as golden.*';
      return Response.json({ answer: `🔧 *Resolved:* _"${recent.question}"_\n\n${fmt.text}\n\n${statusLine}\n_The corrected SQL now uses the proper formula from your definitions._` });
    } catch (e) {
      await deleteSlackProgress(slack_bot_token, slack_channel);
      return Response.json({ answer: `❌ Resolve failed: ${(e as Error).message}\n\nPlease use \`wrong: [your correction]\` to teach me manually.` });
    }
  }

  if (FEEDBACK_PATTERNS.test(question)) {
    const match = question.match(/^\s*(?:\/)?(wrong|learn|teach)[:\s]\s*([\s\S]+)/i);
    if (match) {
      const feedbackType = match[1].toLowerCase();
      const correctionText = match[2].trim();
      const recent = await findMostRecentLog(supabaseUrl, supabaseKey, user_id);
      if (!recent) return Response.json({ answer: 'Ask a question first.' });
      await progress('📝 Recording correction...');
      await writeFeedback(supabaseUrl, supabaseKey, { log_id: recent.id, slack_user: user_id, rating: 'negative', correction: correctionText, feedback_type: feedbackType });

      // Determine if this is a SQL correction or a formatting/behavior rule
      const isSQLCorrection = /\b(sql|query|table|column|join|where|from|select|group|order|sum|count|avg|having|distinct|subquery|GL|journals?|invoices?|bills?)\b/i.test(correctionText);

      if (isSQLCorrection && recent.generated_sql) {
        await progress('🔧 Generating corrected SQL...');
        const [examples, allDefs, priorFeedback] = await Promise.all([
          fetchGoldenExamples(supabaseUrl, supabaseKey),
          fetchFinancialDefinitions(supabaseUrl, supabaseKey),
          fetchRecentFeedback(supabaseUrl, supabaseKey),
        ]);
        const relevantDefs = matchRelevantDefinitions(recent.question, allDefs);
        const diagnosisPrompt = buildPromptWithContext(SQL_SYSTEM_PROMPT, examples, relevantDefs, undefined, priorFeedback);
        let correctedAnswer = '', verifiedSql = '';
        try {
          const sqlResult = await callLLM(diagnosisPrompt, `Previous SQL wrong.\nQ: "${recent.question}"\nSQL: ${recent.generated_sql}\nCorrection: "${correctionText}"\nGenerate CORRECTED SQL only.`, anthropicKey, geminiKey, 1024, true);
          const sql = cleanSQL(sqlResult.text);
          if (validateSQL(sql).valid) {
            await progress('⚡ Running corrected query...');
            const result = await executeQuery(sql, supabaseUrl, supabaseKey);
            verifiedSql = sql;
            const fmtPrompt = buildFormatPromptWithFeedback(priorFeedback);
            const fmt = await callLLM(fmtPrompt, `Q: ${recent.question}\nResults (${result.rows.length}):\n${JSON.stringify(result.rows.slice(0, 50))}`, anthropicKey, geminiKey, 512);
            correctedAnswer = fmt.text;
          }
        } catch { /* best-effort */ }
        if (verifiedSql) await saveVerifiedGolden(supabaseUrl, supabaseKey, recent.question, verifiedSql, `Correction: ${correctionText}`);
        await deleteSlackProgress(slack_bot_token, slack_channel);
        const fullAnswer = correctedAnswer
          ? `📝 *Correction for:* _"${recent.question}"_\nNote: _${correctionText}_\n\n---\n*Updated:*\n${correctedAnswer}\n\n_✅ Verified SQL saved._`
          : `📝 *Recorded SQL correction:* _${correctionText}_\n⚠️ Could not auto-generate corrected SQL. I'll remember this rule for next time.`;
        await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer: fullAnswer, duration_ms: ms() });
        return Response.json({ answer: fullAnswer, duration_ms: ms() });
      }

      // Non-SQL correction: formatting, behavior, or response quality feedback
      // Re-run the same query with the correction applied to see if it improves
      await progress('🔧 Applying correction...');
      let correctedAnswer = '';
      if (recent.generated_sql) {
        try {
          const result = await executeQuery(recent.generated_sql, supabaseUrl, supabaseKey);
          const priorFeedback = await fetchRecentFeedback(supabaseUrl, supabaseKey);
          const fmtPrompt = buildFormatPromptWithFeedback(priorFeedback);
          const fmt = await callLLM(fmtPrompt, `Q: ${recent.question}\nResults (${result.rows.length}):\n${JSON.stringify(result.rows.slice(0, 50))}\n\nIMPORTANT USER CORRECTION: "${correctionText}"\nYou MUST apply this correction to how you format and present the answer.`, anthropicKey, geminiKey, 512);
          correctedAnswer = fmt.text;
        } catch { /* best-effort */ }
      }
      await deleteSlackProgress(slack_bot_token, slack_channel);
      const fullAnswer = correctedAnswer
        ? `📝 *Correction for:* _"${recent.question}"_\nRule: _${correctionText}_\n\n---\n*Updated:*\n${correctedAnswer}\n\n_✅ Rule saved — I'll apply this to future answers._`
        : `📝 *Rule saved:* _${correctionText}_\n✅ I'll apply this to all future answers.`;
      await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, answer: fullAnswer, duration_ms: ms() });
      return Response.json({ answer: fullAnswer, duration_ms: ms() });
    }
  }

  if (METADATA_PATTERNS.test(question)) return Response.json({ answer: DATA_SUMMARY, duration_ms: ms() });
  if (GLOSSARY_PATTERNS.test(question)) { const defs = await fetchFinancialDefinitions(supabaseUrl, supabaseKey); return Response.json({ answer: buildGlossaryResponse(defs), duration_ms: ms() }); }
  if (command === '/gaap' || /^\s*\/gaap\s/i.test(question)) { const terms = await fetchKnowledgeTerms(supabaseUrl, supabaseKey, 'gaap_terms'); return Response.json({ answer: buildKnowledgeAnswer(question.replace(/^\/gaap\s*/i, ''), terms, 'GAAP'), duration_ms: ms() }); }
  if (command === '/ifrs' || /^\s*\/ifrs\s/i.test(question)) { const terms = await fetchKnowledgeTerms(supabaseUrl, supabaseKey, 'ifrs_terms'); return Response.json({ answer: buildKnowledgeAnswer(question.replace(/^\/ifrs\s*/i, ''), terms, 'IFRS'), duration_ms: ms() }); }

  if (perplexityKey && RESEARCH_PATTERNS.test(question)) {
    await progress('🔬 Researching...');
    if (HYBRID_PATTERNS.test(question)) {
      const metricKW = extractMetricKeywords(question);
      const [sqlData, researchData] = await Promise.all([
        (async () => { try { const [ex, defs] = await Promise.all([fetchGoldenExamples(supabaseUrl, supabaseKey), fetchFinancialDefinitions(supabaseUrl, supabaseKey)]); const rd = matchRelevantDefinitions(question, defs); const p = buildPromptWithContext(SQL_SYSTEM_PROMPT, ex, rd); const r = await callLLM(p, question, anthropicKey, geminiKey, 1024, true); const s = cleanSQL(r.text); if (!validateSQL(s).valid) return null; const res = await executeQuery(s, supabaseUrl, supabaseKey); const fmt = await callLLM(FORMAT_SYSTEM_PROMPT, `Q: ${question}\nResults (${res.rows.length}):\n${JSON.stringify(res.rows.slice(0, 20))}`, anthropicKey, geminiKey, 512); return fmt.text; } catch { return null; } })(),
        callPerplexity(metricKW.length > 0 ? `Industry benchmark ${metricKW.join(', ')} for manufacturing` : question, perplexityKey).catch(() => null),
      ]);
      let answer = ''; if (sqlData) answer += `*📊 Your Data*\n${sqlData}\n\n`; if (researchData) answer += `*🔬 Industry*\n${researchData.text}`;
      await deleteSlackProgress(slack_bot_token, slack_channel);
      return Response.json({ answer: answer || 'Could not retrieve data or benchmarks.', mode: 'hybrid', duration_ms: ms() });
    }
    try { const r = await callPerplexity(question, perplexityKey); await deleteSlackProgress(slack_bot_token, slack_channel); return Response.json({ answer: `*🔬 Research*\n\n${r.text}`, mode: 'research', duration_ms: ms() }); }
    catch { /* fall through */ }
  }

  // ── SQL QUERY MODE — CONFIDENCE-BASED PIPELINE
  await progress('⏳ Understanding your question...');

  const [examples, allDefinitions, priorContext, userFeedback] = await Promise.all([
    fetchGoldenExamples(supabaseUrl, supabaseKey),
    fetchFinancialDefinitions(supabaseUrl, supabaseKey),
    fetchConversationContext(supabaseUrl, supabaseKey, user_id, channel),
    fetchRecentFeedback(supabaseUrl, supabaseKey),
  ]);

  // ── GOLDEN MATCH CHECK (100% confidence — skip everything)
  const goldenMatch = findGoldenMatch(question, examples);
  if (goldenMatch) {
    await progress('✅ Found verified answer...');
    const sql = goldenMatch.correct_sql;
    try {
      const result = await executeQuery(sql, supabaseUrl, supabaseKey);
      // Always use LLM formatter for golden matches too — ensures contextual answers
      const fmt = await callLLM(FORMAT_SYSTEM_PROMPT, `Q: ${question}\nResults (${result.rows.length}):\n${JSON.stringify(result.rows.slice(0, 50))}`, anthropicKey, geminiKey, 1024);
      let answer = fmt.text;
      const goldenDefs = matchRelevantDefinitions(question, allDefinitions);
      const transparency = buildTransparency(mode, { defsUsed: goldenDefs, audited: true, auditIssues: 'none', auditConfidence: 1.0, termsResearched: [], goldenMatch: true, sql });
      answer += transparency.text;
      answer += FEEDBACK_FOOTER;
      await deleteSlackProgress(slack_bot_token, slack_channel);
      const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: sql, result_rows: result.rows.length, answer, duration_ms: ms(), slack_ts, slack_channel, transparency_meta: transparency.meta });
      return Response.json({ answer, log_id: logId, sql, rows: result.rows.length, model_used: 'golden_match', golden_match: true, duration_ms: ms(), transparency_meta: transparency.meta });
    } catch { /* golden SQL failed — fall through to normal pipeline */ }
  }

  // ── DEFINITION TEMPLATE SHORTCUT (use verified sql_template when available)
  // Score each template by word matches — prefer most specific match
  const qWords = new Set(question.toLowerCase().split(/\s+/));
  const directDef = allDefinitions
    .filter(d => d.sql_template)
    .map(d => {
      const termWords = d.term.toLowerCase().split(/\s+/);
      const termHits = termWords.filter(w => qWords.has(w)).length;
      const keywordHits = (d.keywords ?? []).filter((k: string) => qWords.has(k.toLowerCase())).length;
      const isFullMatch = termWords.every(w => qWords.has(w));
      return { def: d, score: isFullMatch ? termHits + keywordHits : 0 };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.def ?? null;
  if (directDef?.sql_template && !resolution) {
    await progress('✅ Using verified definition template...');
    const templateSql = directDef.sql_template;
    try {
      const result = await executeQuery(templateSql, supabaseUrl, supabaseKey);
      const fmtPrompt = buildFormatPromptWithFeedback(userFeedback);
      const fmt = await callLLM(fmtPrompt, `Q: ${question}\nDefinition: ${directDef.term} — ${directDef.definition}${directDef.formula ? `\nFormula: ${directDef.formula}` : ''}\nResults (${result.rows.length}):\n${JSON.stringify(result.rows.slice(0, 50))}`, anthropicKey, geminiKey, 1024);
      let answer = (mode === 'training' ? '🎓 ' : '') + fmt.text;
      const transparency = buildTransparency(mode, { defsUsed: [directDef], audited: true, auditIssues: 'none', auditConfidence: 1.0, termsResearched: [], goldenMatch: false, sql: templateSql });
      answer += transparency.text;
      answer += FEEDBACK_FOOTER;
      await deleteSlackProgress(slack_bot_token, slack_channel);
      const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: templateSql, result_rows: result.rows.length, answer, duration_ms: ms(), slack_ts, slack_channel, transparency_meta: transparency.meta });
      return Response.json({ answer, log_id: logId, sql: templateSql, rows: result.rows.length, model_used: 'definition_template', mode, duration_ms: ms(), transparency_meta: transparency.meta });
    } catch { /* template SQL failed — fall through to normal pipeline */ }
  }

  // ── 6a. Unknown term detection (LLM-based)
  let researchedDefs: { term: string; definition: string; formula: string }[] = [];
  const termsResearched: string[] = [];
  let unknownTerms: string[] = [];
  if (!isOverDeadline()) {
    await progress('🔍 Checking for unfamiliar terms...');
    unknownTerms = await detectUnknownTermsViaLLM(question, allDefinitions, anthropicKey, geminiKey);
  }

  if (unknownTerms.length > 0 && perplexityKey) {
    const term = unknownTerms[0];
    await progress(`🔬 Researching "${term}"...`);
    const research = await researchTermViaPerplexity(term, perplexityKey);

    if (research) {
      if (research.confidence < threshold && !resolution) {
        const clarification = buildTermClarification(term, research);
        await deleteSlackProgress(slack_bot_token, slack_channel);
        return Response.json({
          type: 'clarification', clarification_type: 'unknown_term',
          message: clarification.message, options: clarification.options,
          context: { term, research, original_question: question, confidence: research.confidence },
          duration_ms: ms(),
        });
      }
      await saveResearchedDefinition(supabaseUrl, supabaseKey, term, research);
      termsResearched.push(term);
      researchedDefs.push({ term, definition: research.definition, formula: research.formula });
    }

    if (unknownTerms.length > 1) {
      const results = await Promise.all(unknownTerms.slice(1, 3).map(async (t) => {
        const r = await researchTermViaPerplexity(t, perplexityKey);
        if (r && r.confidence >= threshold) { await saveResearchedDefinition(supabaseUrl, supabaseKey, t, r); termsResearched.push(t); return { term: t, definition: r.definition, formula: r.formula }; }
        return null;
      }));
      researchedDefs = [...researchedDefs, ...results.filter(Boolean) as typeof researchedDefs];
    }
  }

  if (resolution) {
    const ctx = resolution.context as Record<string, unknown>;
    if (resolution.clarification_type === 'unknown_term' && resolution.option === 'A') {
      const research = ctx.research as { definition: string; formula: string; sql_hint: string };
      const term = ctx.term as string;
      await saveResearchedDefinition(supabaseUrl, supabaseKey, term, research);
      termsResearched.push(term);
      researchedDefs.push({ term, definition: research.definition, formula: research.formula });
    }
  }

  // ── 6b. Ambiguity detection (confidence-gated)
  let ambiguityDetected = false;
  let ambiguityAutoSelected: string | undefined;
  let ambiguityConfidence = 1.0;

  if (!resolution && !isOverDeadline()) {
    await progress('🧠 Checking for ambiguity...');
    const ambiguityCheck = await checkAmbiguity(question, anthropicKey, geminiKey);
    if (ambiguityCheck.isAmbiguous && ambiguityCheck.interpretations?.length) {
      ambiguityDetected = true;
      ambiguityConfidence = ambiguityCheck.confidence;

      if (ambiguityCheck.confidence < threshold) {
        await deleteSlackProgress(slack_bot_token, slack_channel);
        return Response.json({
          type: 'clarification', clarification_type: 'ambiguous_query',
          message: ambiguityCheck.message, options: ambiguityCheck.interpretations,
          context: { original_question: question, confidence: ambiguityCheck.confidence },
          duration_ms: ms(),
        });
      }
      ambiguityAutoSelected = ambiguityCheck.autoSelected ?? ambiguityCheck.interpretations[0]?.description;
    }
  }

  let enrichedQuestion: string;
  if (resolution && resolution.clarification_type === 'ambiguous_query') {
    const chosenOption = (resolution.options as { label: string; description: string; value: string }[])?.find(o => o.label === resolution.option);
    enrichedQuestion = chosenOption ? `${question}\n\nCLARIFICATION: The user means: ${chosenOption.description}` : question;
  } else if (ambiguityAutoSelected) {
    enrichedQuestion = `${question}\n\nAUTO-INTERPRETATION (${Math.round(ambiguityConfidence * 100)}% confident): ${ambiguityAutoSelected}`;
  } else if (priorContext) {
    enrichedQuestion = `PRIOR:\nQ: ${priorContext.question}\nSQL: ${priorContext.sql}\nResult: ${priorContext.answer?.substring(0, 300)}\n\nFOLLOW-UP: ${question}`;
  } else if (thread_context) {
    enrichedQuestion = `THREAD:\n${thread_context}\n\nCURRENT: ${question}`;
  } else {
    enrichedQuestion = question;
  }

  const relevantDefs = matchRelevantDefinitions(thread_context ? `${thread_context} ${question}` : question, allDefinitions);
  const sqlPrompt = buildPromptWithContext(SQL_SYSTEM_PROMPT, examples, relevantDefs, researchedDefs, userFeedback);

  await progress('⚡ Generating SQL...');
  const complex = isComplexQuery(question);
  let sqlResult: LLMResult;
  try { sqlResult = await callLLM(sqlPrompt, enrichedQuestion, anthropicKey, geminiKey, 1024, complex); }
  catch (e) { await deleteSlackProgress(slack_bot_token, slack_channel); return Response.json({ answer: 'Sorry, could not generate a query.', error: String(e), duration_ms: ms() }); }

  let sql = cleanSQL(sqlResult.text);
  let modelUsed = sqlResult.model;
  const validation = validateSQL(sql);
  if (!validation.valid) {
    await deleteSlackProgress(slack_bot_token, slack_channel);
    const reason = validation.reason ?? '';
    return Response.json({ answer: reason.startsWith('CANNOT_ANSWER:') ? `I don't have that data. ${reason.replace('CANNOT_ANSWER:', '').trim()}` : 'Could not generate a valid query.', duration_ms: ms() });
  }

  // ── 6c. Audit SQL (confidence-gated, self-correcting)
  let audited = false;
  let auditIssues = 'none';
  let auditAutoApplied = false;
  let auditConfidence = 1.0;
  if (perplexityKey && relevantDefs.length > 0 && !isOverDeadline()) {
    await progress('🔎 Auditing query...');
    const audit = await auditSQLViaPerplexity(question, sql, relevantDefs, perplexityKey);
    audited = true;
    auditIssues = audit.issues;
    auditConfidence = audit.confidence;

    // Self-correction: only attempt if we have time budget remaining
    if ((!audit.passed || audit.confidence < AUDIT_CONFIDENCE_FLOOR) && !isOverDeadline()) {
      if (audit.corrected_sql) {
        const corrected = cleanSQL(audit.corrected_sql);
        if (validateSQL(corrected).valid && !isOverDeadline()) {
          const reaudit = await auditSQLViaPerplexity(question, corrected, relevantDefs, perplexityKey);
          if (reaudit.passed || reaudit.confidence >= AUDIT_CONFIDENCE_FLOOR) {
            sql = corrected;
            modelUsed = `${modelUsed} (audit-corrected)`;
            auditAutoApplied = true;
            auditConfidence = reaudit.confidence;
            auditIssues = reaudit.issues;
          }
        }
      }

      // Retry with feedback — only if we still have time
      if (!auditAutoApplied && audit.issues !== 'none' && !isOverDeadline()) {
        await progress('🔄 Retrying with audit feedback...');
        const defsCtx = relevantDefs.map(d => `${d.term}: ${d.definition}${d.formula ? ` (Formula: ${d.formula})` : ''}`).join('\n');
        const retryQuestion = `${enrichedQuestion}\n\nCRITICAL: A code auditor found issues with the previous SQL attempt:\n${audit.issues}\n\nFinancial definitions to follow:\n${defsCtx}\n\nYou MUST generate SQL that follows the definitions exactly.`;
        try {
          const retryResult = await callLLM(sqlPrompt, retryQuestion, anthropicKey, geminiKey, 1024, true);
          const retrySql = cleanSQL(retryResult.text);
          if (validateSQL(retrySql).valid && !isOverDeadline()) {
            const reaudit = await auditSQLViaPerplexity(question, retrySql, relevantDefs, perplexityKey);
            if (reaudit.passed || reaudit.confidence > audit.confidence) {
              sql = retrySql;
              modelUsed = `${retryResult.model} (audit-retried)`;
              auditAutoApplied = true;
              auditConfidence = reaudit.confidence;
              auditIssues = reaudit.issues;
            }
          }
        } catch { /* retry failed — use original */ }
      }
    }
  }

  if (resolution?.clarification_type === 'audit_conflict') {
    const ctx = resolution.context as Record<string, unknown>;
    if (resolution.option === 'A') sql = ctx.original_sql as string;
    else if (resolution.option === 'B') { sql = cleanSQL(ctx.corrected_sql as string); modelUsed = `${modelUsed} (audited)`; }
  }

  // Global deadline check — bail before executing if we're already over
  if (isOverDeadline()) {
    await deleteSlackProgress(slack_bot_token, slack_channel);
    return Response.json({ answer: '⏱️ That question took too long. Try breaking it into a simpler query.', duration_ms: ms() });
  }

  await progress('📊 Running query...');
  let rows: unknown[], finalSql = sql, finalModel = modelUsed;
  try { const result = await executeQuery(sql, supabaseUrl, supabaseKey); rows = result.rows; }
  catch (firstError) {
    if (isOverDeadline()) { await deleteSlackProgress(slack_bot_token, slack_channel); return Response.json({ answer: '⏱️ That question took too long. Try breaking it into a simpler query.', duration_ms: ms() }); }
    await progress('🔄 Retrying...');
    try { const retry = await callLLM(sqlPrompt, `SQL failed:\n${sql}\nERROR: ${firstError}\nFix it. Output ONLY SQL.`, anthropicKey, geminiKey, 1024, true); const retrySql = cleanSQL(retry.text); if (validateSQL(retrySql).valid) { const r = await executeQuery(retrySql, supabaseUrl, supabaseKey); rows = r.rows; finalSql = retrySql; finalModel = retry.model; } else throw firstError; }
    catch { await deleteSlackProgress(slack_bot_token, slack_channel); return Response.json({ answer: 'Problem running that query.', sql, error: String(firstError), duration_ms: ms() }); }
  }

  await progress('✅ Formatting...');
  let answer: string;
  const simple = templateSimpleAnswer(question, rows);
  if (simple) answer = simple;
  else { try { const fmtPrompt = buildFormatPromptWithFeedback(userFeedback); const fmt = await callLLM(fmtPrompt, `Q: ${question}\nResults (${rows.length}):\n${JSON.stringify(rows.slice(0, 50))}`, anthropicKey, geminiKey, 1024); answer = fmt.text; } catch { answer = formatFallback(question, rows); } }

  // Prepend mode badge
  const modeBadge = mode === 'training' ? '🎓 ' : '';
  answer = modeBadge + answer;

  const transparency = buildTransparency(mode, { defsUsed: relevantDefs, audited, auditIssues, auditAutoApplied, auditConfidence, termsResearched, ambiguityDetected, ambiguityAutoSelected, ambiguityConfidence, sql: finalSql });
  answer += transparency.text;
  answer += FEEDBACK_FOOTER;

  await deleteSlackProgress(slack_bot_token, slack_channel);
  const logId = await logQuery(supabaseUrl, supabaseKey, { user_id, channel, question, generated_sql: finalSql, result_rows: rows.length, answer, duration_ms: ms(), slack_ts, slack_channel, transparency_meta: transparency.meta });
  return Response.json({ answer, log_id: logId, sql: finalSql, rows: rows.length, model_used: finalModel, audited, terms_researched: termsResearched.length > 0 ? termsResearched : undefined, mode, duration_ms: ms(), transparency_meta: transparency.meta });
});
