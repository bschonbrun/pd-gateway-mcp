// ─── Supabase Edge Function entry point ───────────────────────────────────────


interface ComparisonRow {
  label?: string;
  period: string;
  y0: number; y1: number; y2: number; y3: number;
}

interface Comparisons {
  years: [number, number, number, number];
  as_of: string;
  show_qtd: boolean;
  month_in_quarter: number;
  mtd: ComparisonRow;
  qtd: ComparisonRow;
  ytd: ComparisonRow;
}

interface DigestData {
  report_date: string;
  day_of_month: number;
  days_in_month: number;
  current_month: number;
  current_quarter: number;
  ytd: { actual: number; forecast: number; target: number; py_actual?: number };
  comparisons?: Comparisons;
  quarters: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; py_actual?: number; is_closed: boolean; is_current: boolean }>;
  months: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; py_actual?: number; is_closed: boolean; is_current: boolean }>;
  top_customers: Array<{ name: string; revenue: number; orders: number; top_product: string | null }> | null;
  forecast_gaps: Array<{ name: string; forecast: number; actual: number; gap: number }> | null;
  top_products: Array<{ product: string; product_type: string; forecast: number; actual: number; gap: number }> | null;
  largest_orders: Array<{ order_number: number; customer: string; product: string; revenue: number; totes: number; order_date: string }> | null;
}

interface RunRequest {
  template_id: string;
  dry_run?: boolean;
  overrides?: {
    channels?: string[];
    email_recipients?: string[];
    whatsapp_recipients?: string[];
    slack_channel_id?: string;
    slack_bot_name?: string;
    email_subject_prefix?: string;
    whatsapp_template_sid?: string;
  };
}

// ─── Formatters (ported from src/digest/formatters.ts) ────────────────────────

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

function fmtGap(n: number): string {
  const prefix = n < 0 ? '-$' : '+$';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${Math.round(abs / 1_000)}K`;
  return `${prefix}${abs.toLocaleString()}`;
}

function fmtDateShort(reportDate: string): string {
  const d = new Date(reportDate);
  if (isNaN(d.getTime())) return reportDate;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function pad(s: string, w: number): string { return s.padEnd(w); }
function rpad(s: string, w: number): string { return s.padStart(w); }

function periodTag(q: { is_closed: boolean; is_current: boolean }): string {
  if (q.is_closed) return ' (Last)';
  if (q.is_current) return ' ◀';
  return ' (Next)';
}

function fmtPct(current: number, prior: number): string {
  if (!prior) return '—';
  const pct = Math.round((current / prior - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function fmtCagr(y0: number, y3: number): string {
  if (!y3 || !y0) return '—';
  const cagr = Math.round(((y0 / y3) ** (1 / 3) - 1) * 100);
  return `${cagr >= 0 ? '+' : ''}${cagr}%`;
}

function formatYoYSlack(c: Comparisons): string {
  const [yr0, yr1, yr2, yr3] = c.years;
  const L = 10, V = 7, D = 6;
  const hdr = `${pad('', L)}${rpad(String(yr3), V)}${rpad(String(yr2), V)}${pad('Δ', D)}${rpad(String(yr1), V)}${pad('Δ', D)}${rpad(String(yr0), V)}${pad('Δ', D)}${'CAGR'}`;

  function row(label: string, r: ComparisonRow): string {
    const d2 = fmtPct(r.y2, r.y3);
    const d1 = fmtPct(r.y1, r.y2);
    const d0 = fmtPct(r.y0, r.y1);
    const cagr = fmtCagr(r.y0, r.y3);
    return `${pad(label, L)}${rpad(fmtShort(r.y3), V)}${rpad(fmtShort(r.y2), V)}${pad(d2, D)}${rpad(fmtShort(r.y1), V)}${pad(d1, D)}${rpad(fmtShort(r.y0), V)}${pad(d0, D)}${cagr}`;
  }

  const rows = [
    row(`MTD ${c.mtd.label ?? ''}`.trim(), c.mtd),
    ...(c.show_qtd ? [row(`QTD ${c.qtd.label ?? ''}`.trim(), c.qtd)] : []),
    row('YTD', c.ytd),
  ];

  return [`*━━━ Year-over-Year  (${c.as_of}) ━━━*`, '```', hdr, ...rows, '```'].join('\n');
}

function formatYoYEmail(c: Comparisons): string {
  const [yr0, yr1, yr2, yr3] = c.years;
  const headers = [String(yr3), String(yr2), 'Δ', String(yr1), 'Δ', String(yr0), 'Δ', 'CAGR (3yr)'];
  const ra = [0, 1, 2, 3, 4, 5, 6, 7];

  function buildRow(label: string, r: ComparisonRow): string[] {
    return [
      label,
      fmtShort(r.y3),
      fmtShort(r.y2), fmtPct(r.y2, r.y3),
      fmtShort(r.y1), fmtPct(r.y1, r.y2),
      fmtShort(r.y0), fmtPct(r.y0, r.y1),
      fmtCagr(r.y0, r.y3),
    ];
  }

  const rows = [
    buildRow(`MTD (${c.mtd.label ?? c.mtd.period})`, c.mtd),
    ...(c.show_qtd ? [buildRow(`QTD (${c.qtd.label ?? c.qtd.period})`, c.qtd)] : []),
    buildRow(`YTD (${c.ytd.period})`, c.ytd),
  ];

  return `<h3 style="margin:16px 0 8px">📈 Year-over-Year — ${c.as_of}</h3>` +
    htmlTable(['Period', ...headers], rows, { rightAlign: ra.map(i => i + 1) });
}

function formatSlack(d: DigestData): string {
  const lines: string[] = [
    `*📊 Acme Corp Daily Digest — ${d.report_date}*`, '',
    `*━━━ YTD Summary ━━━*`,
    `Actual ${fmt(d.ytd.actual)} · Forecast ${fmt(d.ytd.forecast)} · Target ${fmt(d.ytd.target)}`,
    '', `*━━━ Quarterly ━━━*`, '```',
    `${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`,
  ];
  for (const q of d.quarters) {
    lines.push(`${pad(q.label + periodTag(q), 12)} ${rpad(fmt(q.target), 9)} ${rpad(fmt(q.forecast), 9)} ${rpad(q.actual ? fmt(q.actual) : '—', 9)} ${rpad(q.orders ? String(q.orders) : '—', 7)} ${rpad(q.totes ? String(q.totes) : '—', 6)}`);
  }
  lines.push('```', '', `*━━━ Monthly ━━━*`, '```');
  lines.push(`${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`);
  for (const m of d.months) {
    lines.push(`${pad(m.label + periodTag(m), 12)} ${rpad(fmt(m.target), 9)} ${rpad(fmt(m.forecast), 9)} ${rpad(m.actual ? fmt(m.actual) : '—', 9)} ${rpad(m.orders ? String(m.orders) : '—', 7)} ${rpad(m.totes ? String(m.totes) : '—', 6)}`);
  }
  lines.push('```', '');
  if (d.comparisons) lines.push(formatYoYSlack(d.comparisons), '');
  if (d.top_customers?.length) {
    lines.push(`*━━━ Top 5 Customers MTD ━━━*`, '```');
    lines.push(`${pad('Customer', 20)} ${rpad('Revenue', 10)} ${rpad('Ord', 4)} ${pad('Top Product', 20)}`);
    for (const c of d.top_customers) lines.push(`${pad(c.name.slice(0, 19), 20)} ${rpad(fmt(c.revenue), 10)} ${rpad(String(c.orders), 4)} ${pad((c.top_product || '—').slice(0, 19), 20)}`);
    lines.push('```', '');
  }
  if (d.largest_orders?.length) {
    lines.push(`*━━━ Top 5 Largest Orders MTD ━━━*`, '```');
    lines.push(`${pad('Order', 10)} ${pad('Customer', 18)} ${pad('Product', 20)} ${rpad('Revenue', 9)} ${pad('Date', 6)}`);
    for (const o of d.largest_orders) lines.push(`${pad(String(o.order_number), 10)} ${pad(o.customer.slice(0, 17), 18)} ${pad((o.product || '—').slice(0, 19), 20)} ${rpad(fmt(o.revenue), 9)} ${pad(o.order_date, 6)}`);
    lines.push('```');
  }
  return lines.join('\n');
}

function htmlTable(headers: string[], rows: string[][], opts?: { rightAlign?: number[]; highlightRows?: number[] }): string {
  const th = (h: string, i: number) => `<th style="padding:8px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #ddd;background:#f2f2f2">${h}</th>`;
  const td = (v: string, i: number, ri: number) => {
    const isCurrent = opts?.highlightRows?.includes(ri);
    const bg = isCurrent ? 'background:#e8f4fd;font-weight:600;' : (ri % 2 === 1 ? 'background:#f9f9f9' : '');
    return `<td style="padding:6px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #ddd;${bg}">${v}</td>`;
  };
  return `<table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px">\n<tr>${headers.map(th).join('')}</tr>\n${rows.map((r, ri) => `<tr>${r.map((v, i) => td(v, i, ri)).join('')}</tr>`).join('\n')}\n</table>`;
}

function formatEmail(d: DigestData): string {
  const ra = [1, 2, 3, 4, 5];
  const qHighlight = d.quarters.map((q, i) => q.is_current ? i : -1).filter(i => i >= 0);
  const mHighlight = d.months.map((m, i) => m.is_current ? i : -1).filter(i => i >= 0);
  const qTable = htmlTable(['Quarter', 'Target', 'Forecast', 'Actual', 'Orders', 'Totes'], d.quarters.map(q => [q.label + periodTag(q), fmt(q.target), fmt(q.forecast), q.actual ? fmt(q.actual) : '—', q.orders ? String(q.orders) : '—', q.totes ? String(q.totes) : '—']), { rightAlign: ra, highlightRows: qHighlight });
  const mTable = htmlTable(['Month', 'Target', 'Forecast', 'Actual', 'Orders', 'Totes'], d.months.map(m => [m.label + periodTag(m), fmt(m.target), fmt(m.forecast), m.actual ? fmt(m.actual) : '—', m.orders ? String(m.orders) : '—', m.totes ? String(m.totes) : '—']), { rightAlign: ra, highlightRows: mHighlight });
  const custTable = d.top_customers?.length ? `<h3 style="margin:16px 0 8px">Top 5 Customers MTD</h3>` + htmlTable(['Customer', 'Revenue', 'Orders', 'Top Product'], d.top_customers.map(c => [c.name, fmt(c.revenue), String(c.orders), c.top_product || '—']), { rightAlign: [1, 2] }) : '';
  const ordersTable = d.largest_orders?.length ? `<h3 style="margin:16px 0 8px">Top 5 Largest Orders MTD</h3>` + htmlTable(['Order #', 'Customer', 'Product', 'Revenue', 'Totes', 'Date'], d.largest_orders.map(o => [String(o.order_number), o.customer, o.product || '—', fmt(o.revenue), String(o.totes), o.order_date]), { rightAlign: [3, 4] }) : '';
  const gapTable = d.forecast_gaps?.length ? `<h3 style="margin:16px 0 8px">Top 5 Forecast Gaps MTD</h3>` + htmlTable(['Customer', 'Forecast', 'Actual', 'Gap'], d.forecast_gaps.map(g => [g.name, fmt(g.forecast), g.actual ? fmt(g.actual) : '—', `<span style="color:${g.gap < 0 ? '#cc0000' : '#008800'}">${fmtGap(g.gap)}</span>`]), { rightAlign: [1, 2, 3] }) : '';
  const yoyTable = d.comparisons ? formatYoYEmail(d.comparisons) : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;color:#1a1a1a">\n<h2 style="margin-bottom:4px">📊 Acme Corp Daily Digest</h2>\n<p style="color:#666;margin-top:0">${d.report_date}</p>\n<h3 style="margin:16px 0 8px">YTD Summary</h3>${htmlTable(['Metric', 'Value'], [['Actual', fmt(d.ytd.actual)], ['Forecast', fmt(d.ytd.forecast)], ['Target', fmt(d.ytd.target)]], { rightAlign: [1] })}\n<h3 style="margin:16px 0 8px">Quarterly Performance</h3>${qTable}\n<h3 style="margin:16px 0 8px">Monthly Performance</h3>${mTable}\n${yoyTable}${custTable}${gapTable}${ordersTable}\n</div>`;
}

function formatWhatsApp(d: DigestData): string {
  const shortDt = fmtDateShort(d.report_date);
  const s = fmtShort;
  const lines: string[] = [
    `*Revenue Update — ${shortDt}*`, '',
    `*YTD*`,
    `Actual: ${s(d.ytd.actual)}`,
    `Forecast: ${s(d.ytd.forecast)}`,
    `Target: ${s(d.ytd.target)}`,
    '', `*Quarterly* _(T · F · A)_`,
  ];
  for (const q of d.quarters) {
    const marker = q.is_current ? ' ◀' : '';
    lines.push(`${q.label}: ${s(q.target)} · ${s(q.forecast)} · ${q.actual ? s(q.actual) : '—'}${marker}`);
  }
  lines.push('', `*Monthly* _(T · F · A)_`);
  for (const m of d.months) {
    const marker = m.is_current ? ' ◀' : '';
    lines.push(`${m.label}: ${s(m.target)} · ${s(m.forecast)} · ${m.actual ? s(m.actual) : '—'}${marker}`);
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

// ─── Data fetcher ─────────────────────────────────────────────────────────────

async function fetchDigestData(supabaseUrl: string, supabaseKey: string): Promise<DigestData> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/digest_full`, {
    method: 'POST',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Supabase RPC error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<DigestData>;
}

// ─── Pipedream Connect runner ─────────────────────────────────────────────────
// Mirrors PipedreamConnectClient.runAction() from src/clients/connect-api.ts

let _pdAccessToken: string | null = null;
let _pdTokenExpiresAt = 0;

async function getPipedreamToken(clientId: string, clientSecret: string): Promise<string> {
  if (_pdAccessToken && Date.now() < _pdTokenExpiresAt - 60_000) return _pdAccessToken;
  const res = await fetch('https://api.pipedream.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Pipedream OAuth error: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _pdAccessToken = data.access_token;
  _pdTokenExpiresAt = Date.now() + data.expires_in * 1000;
  return _pdAccessToken;
}

async function runPipedreamAction(
  actionKey: string,
  props: Record<string, unknown>,
  clientId: string,
  clientSecret: string,
  projectId: string,
  externalUserId: string,
): Promise<unknown> {
  const token = await getPipedreamToken(clientId, clientSecret);
  const res = await fetch(`https://api.pipedream.com/v1/connect/${projectId}/actions/run`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'X-PD-Environment': 'development', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: actionKey, external_user_id: externalUserId, configured_props: props }),
  });
  if (!res.ok) throw new Error(`Pipedream action error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function captureDigestImage(
  supabaseUrl: string,
  supabaseKey: string,
  screenshotoneKey: string,
  _reportDate: string,
): Promise<string | null> {
  try {
    // Fetch HTML server-to-server (bypasses Supabase's browser Content-Type override)
    const cardRes = await fetch(`${supabaseUrl}/functions/v1/digest-card`);
    if (!cardRes.ok) {
      console.error('[Digest] digest-card fetch error:', cardRes.status);
      return null;
    }
    const html = await cardRes.text();

    // POST HTML directly to ScreenshotOne (avoids headless Chrome→Supabase text/plain issue)
    const ssBody = JSON.stringify({
      access_key: screenshotoneKey,
      html: html,
      viewport_width: 600,
      viewport_height: 1200,
      format: 'png',
      full_page: true,
      device_scale_factor: 2,
    });
    const ssRes = await fetch('https://api.screenshotone.com/take', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ssBody,
    });
    if (!ssRes.ok) {
      console.error('[Digest] ScreenshotOne error:', await ssRes.text());
      return null;
    }
    const pngBytes = new Uint8Array(await ssRes.arrayBuffer());
    const dateSlug = new Date().toISOString().slice(0, 10);
    const fileName = `digest-${dateSlug}.png`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/digest-images/${fileName}`, {
      method: 'PUT',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: pngBytes,
    });
    if (!uploadRes.ok) {
      console.error('[Digest] Storage upload error:', await uploadRes.text());
      return null;
    }
    return `${supabaseUrl}/storage/v1/object/public/digest-images/${fileName}`;
  } catch (e) {
    console.error('[Digest] Image capture failed:', e);
    return null;
  }
}

async function sendWhatsApp(
  d: DigestData,
  recipients: string[],
  templateSid: string,
  twilioSid: string,
  twilioToken: string,
  twilioFrom: string,
): Promise<Array<{ to: string; status: string; error?: string }>> {
  const currentMonth = d.months.find(m => m.is_current) ?? d.months[0];
  const contentVars = JSON.stringify({
    '1': fmtDateShort(d.report_date),
    '2': currentMonth?.actual ? fmtShort(currentMonth.actual) : '—',
    '3': fmtShort(currentMonth?.forecast ?? 0),
  });
  const auth = btoa(`${twilioSid}:${twilioToken}`);
  const results = [];

  for (const recipient of recipients) {
    const waTo = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient.trim()}`;

    // 1. Send template message (CTA)
    const templateParams = new URLSearchParams({ To: waTo, From: twilioFrom, ContentSid: templateSid, ContentVariables: contentVars });
    const templateRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: templateParams.toString(),
    });



    const errText = templateRes.ok ? undefined : await templateRes.text();
    results.push({ to: recipient, status: templateRes.ok ? 'sent' : 'failed', error: errText });
  }
  return results;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check
  const secret = Deno.env.get('CLOUD_API_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (secret && authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let body: RunRequest;
  try {
    body = await req.json() as RunRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.template_id !== 'daily-revenue-report') {
    return new Response(JSON.stringify({ error: `Unknown template: ${body.template_id}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Env
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const pdClientId = Deno.env.get('PIPEDREAM_CLIENT_ID')!;
  const pdClientSecret = Deno.env.get('PIPEDREAM_CLIENT_SECRET')!;
  const pdProjectId = Deno.env.get('PIPEDREAM_PROJECT_ID')!;
  const pdUserId = Deno.env.get('PIPEDREAM_EXTERNAL_USER_ID') ?? 'antigravity-agent';
  const slackProvisionId = Deno.env.get('SLACK_AUTH_PROVISION_ID') ?? 'apn_P8hEEEa';
  const outlookProvisionId = Deno.env.get('OUTLOOK_AUTH_PROVISION_ID') ?? 'apn_xOhV44q';
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const twilioFrom = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? 'whatsapp:+12362332112';
  const screenshotoneKey = Deno.env.get('SCREENSHOTONE_ACCESS_KEY') ?? '';

  // Overrides
  const ov = body.overrides ?? {};
  const channels = ov.channels ?? ['slack', 'email'];
  const emailRecipients = ov.email_recipients ?? ['user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com', 'user@acme.com'];
  const whatsappRecipients = ov.whatsapp_recipients ?? ['+16047830407', '+18322365947', '+16047542885', '+16042182889', '+16043393559', '+18067909495'];
  const slackChannelId = ov.slack_channel_id ?? 'C0872NV9H43';
  const slackBotName = ov.slack_bot_name ?? 'BillSuite';
  const emailSubjectPrefix = ov.email_subject_prefix ?? 'Daily Revenue Tracker';
  const whatsappTemplateSid = ov.whatsapp_template_sid ?? 'HX3070313cf08cae360a51e3d636619a05';

  try {
    const d = await fetchDigestData(supabaseUrl, supabaseKey);
    const slackText = formatSlack(d);
    const emailBody = formatEmail(d);
    const whatsAppText = formatWhatsApp(d);

    if (body.dry_run) {
      return new Response(JSON.stringify({ sent: false, channels, summary: { ytd: fmtShort(d.ytd.actual), forecast: fmtShort(d.ytd.forecast) }, slackText, emailBody, whatsAppText }), { headers: { 'Content-Type': 'application/json' } });
    }

    const results: Record<string, unknown> = {};

    if (channels.includes('slack')) {
      results.slack = await runPipedreamAction('slack-send-message', {
        slack: { authProvisionId: slackProvisionId },
        conversation: slackChannelId,
        text: slackText,
        mrkdwn: true,
        include_sent_via_pipedream_flag: false,
        customizeBotSettings: true,
        username: slackBotName,
        icon_emoji: ':bar_chart:',
      }, pdClientId, pdClientSecret, pdProjectId, pdUserId).catch(e => ({ error: String(e) }));
    }

    if (channels.includes('email')) {
      results.email = await runPipedreamAction('microsoft_outlook-send-email', {
        microsoftOutlook: { authProvisionId: outlookProvisionId },
        recipients: emailRecipients,
        subject: `${emailSubjectPrefix} — ${d.report_date}`,
        contentType: 'html',
        content: emailBody,
      }, pdClientId, pdClientSecret, pdProjectId, pdUserId).catch(e => ({ error: String(e) }));
    }

    if (channels.includes('whatsapp')) {
      results.whatsapp = await sendWhatsApp(d, whatsappRecipients, whatsappTemplateSid, twilioSid, twilioToken, twilioFrom).catch(e => ({ error: String(e) }));
    }

    return new Response(JSON.stringify({ sent: true, channels, summary: { ytd: fmtShort(d.ytd.actual), forecast: fmtShort(d.ytd.forecast) }, results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
