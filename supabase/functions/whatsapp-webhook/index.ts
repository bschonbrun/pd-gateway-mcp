// whatsapp-webhook — handles incoming WhatsApp messages, sends full digest on demand
// Deployed with verify_jwt: false (Twilio calls this directly, no JWT)

interface DigestData {
  report_date: string;
  ytd: { actual: number; forecast: number; target: number };
  quarters: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  months: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  top_customers: Array<{ name: string; revenue: number; orders: number; top_product: string | null }> | null;
  largest_orders: Array<{ order_number: number; customer: string; product: string; revenue: number; totes: number; order_date: string }> | null;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return n === 0 ? '—' : `$${n.toLocaleString()}`;
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return n === 0 ? '—' : `$${n.toLocaleString()}`;
}

function fmtDateShort(reportDate: string): string {
  const d = new Date(reportDate);
  if (isNaN(d.getTime())) return reportDate;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatWhatsApp(d: DigestData): string {
  const lines: string[] = [
    `*Revenue Update — ${fmtDateShort(d.report_date)}*`, '',
    `*YTD*`,
    `Actual: ${fmtShort(d.ytd.actual)}`,
    `Forecast: ${fmtShort(d.ytd.forecast)}`,
    `Target: ${fmtShort(d.ytd.target)}`,
    '', `*Quarterly* _(T · F · A)_`,
  ];
  for (const q of d.quarters) {
    const marker = q.is_current ? ' ◀' : '';
    lines.push(`${q.label}: ${fmtShort(q.target)} · ${fmtShort(q.forecast)} · ${q.actual ? fmtShort(q.actual) : '—'}${marker}`);
  }
  lines.push('', `*Monthly* _(T · F · A)_`);
  for (const m of d.months) {
    const marker = m.is_current ? ' ◀' : '';
    lines.push(`${m.label}: ${fmtShort(m.target)} · ${fmtShort(m.forecast)} · ${m.actual ? fmtShort(m.actual) : '—'}${marker}`);
  }
  if (d.top_customers?.length) {
    lines.push('', `*Top 5 Customers MTD*`);
    for (const c of d.top_customers) lines.push(`${c.name} · ${fmt(c.revenue)}`);
  }
  if (d.largest_orders?.length) {
    lines.push('', `*Largest Orders*`);
    for (const o of d.largest_orders) lines.push(`${o.order_date} · ${o.customer} · ${fmt(o.revenue)}`);
  }
  return lines.join('\n');
}

// ─── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchDigestData(supabaseUrl: string, supabaseKey: string): Promise<DigestData> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/digest_full`, {
    method: 'POST',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Supabase RPC error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<DigestData>;
}

// ─── Trigger detection ─────────────────────────────────────────────────────────

const TRIGGER_WORDS = ['report', 'digest', 'yes', 'send', 'get'];

function isReportRequest(msgBody: string, buttonPayload: string): boolean {
  if (buttonPayload === 'get_report') return true;
  const lower = msgBody.toLowerCase().trim();
  return TRIGGER_WORDS.some(w => lower.includes(w));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Handler ───────────────────────────────────────────────────────────────────

function twimlOk(): Response {
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
}

function twimlMessage(body: string): Response {
  return new Response(`<Response><Message>${escapeXml(body)}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return twimlOk();

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(await req.text());
  } catch {
    return twimlOk();
  }

  const from = params.get('From') ?? '';
  const msgBody = params.get('Body') ?? '';
  const buttonPayload = params.get('ButtonPayload') ?? '';

  console.log(`whatsapp-webhook: from=${from} body="${msgBody}" payload="${buttonPayload}"`);

  if (!from || !isReportRequest(msgBody, buttonPayload)) {
    console.log('whatsapp-webhook: not a report request, ignoring');
    return twimlOk();
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    console.log('whatsapp-webhook: fetching digest data...');
    const d = await fetchDigestData(supabaseUrl, supabaseKey);
    const text = formatWhatsApp(d);
    console.log(`whatsapp-webhook: replying with ${text.length} chars`);
    return twimlMessage(text);
  } catch (e) {
    console.error('whatsapp-webhook FAILED:', String(e));
    return twimlMessage('Sorry, failed to load the report. Please try again.');
  }
});
