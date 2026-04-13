// digest-card — renders the daily revenue digest as a styled HTML card for screenshot capture
// Deployed with verify_jwt: false (ScreenshotOne needs unauthenticated access)

interface DigestData {
  report_date: string;
  ytd: { actual: number; forecast: number; target: number };
  quarters: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  months: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  top_customers: Array<{ name: string; revenue: number; orders: number; top_product: string | null }> | null;
  largest_orders: Array<{ order_number: number; customer: string; product: string; revenue: number; totes: number; order_date: string }> | null;
}

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

function pct(actual: number, target: number): number {
  if (!target) return 0;
  return Math.min(Math.round((actual / target) * 100), 100);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function periodRows(items: DigestData['quarters'] | DigestData['months']): string {
  return items.map(p => {
    const isCurrent = p.is_current;
    const rowBg = isCurrent ? 'background: rgba(20, 184, 166, 0.08);' : '';
    const marker = isCurrent ? '<span style="color:#14b8a6;font-weight:700;margin-left:4px;">◀</span>' : '';
    const actualVal = p.actual ? fmt(p.actual) : '—';
    const actualColor = p.actual ? '#f8fafc' : '#64748b';
    const barPct = p.actual && p.target ? pct(p.actual, p.target) : 0;
    const barColor = barPct >= 80 ? '#14b8a6' : barPct >= 50 ? '#f59e0b' : '#ef4444';

    return `<tr style="${rowBg}">
      <td style="padding:8px 12px;color:${isCurrent ? '#14b8a6' : '#cbd5e1'};font-weight:${isCurrent ? '700' : '500'};">${p.label}${marker}</td>
      <td style="padding:8px 12px;text-align:right;color:#94a3b8;">${fmt(p.target)}</td>
      <td style="padding:8px 12px;text-align:right;color:#94a3b8;">${fmt(p.forecast)}</td>
      <td style="padding:8px 12px;text-align:right;color:${actualColor};font-weight:600;">${actualVal}</td>
      <td style="padding:8px 4px 8px 12px;width:60px;">
        <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:3px;"></div>
        </div>
      </td>
    </tr>`;
  }).join('\n');
}

function renderDigestCard(d: DigestData): string {
  const ytdPct = pct(d.ytd.actual, d.ytd.target);
  const forecastPct = pct(d.ytd.forecast, d.ytd.target);

  const customersHtml = d.top_customers?.length
    ? d.top_customers.map((c, i) => {
        const barW = d.top_customers ? pct(c.revenue, d.top_customers[0].revenue) : 0;
        return `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;">
          <span style="color:#64748b;font-size:12px;width:16px;text-align:right;">${i + 1}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
              <span style="color:#e2e8f0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</span>
              <span style="color:#f8fafc;font-size:13px;font-weight:600;margin-left:8px;white-space:nowrap;">${fmt(c.revenue)}</span>
            </div>
            <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${barW}%;background:linear-gradient(90deg,#0d9488,#14b8a6);border-radius:2px;"></div>
            </div>
          </div>
        </div>`;
      }).join('\n')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=600">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 600px;
      font-family: -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      padding: 32px 28px;
      background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
    }
    .section {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #475569;
      padding: 0 12px 8px;
      text-align: right;
      border-bottom: 1px solid #1e293b;
    }
    th:first-child { text-align: left; }
    th:last-child { text-align: center; }
  </style>
</head>
<body>
<div class="card">

  <!-- Header -->
  <div style="margin-bottom:24px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#14b8a6,#0d9488);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">📊</div>
      <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Acme Corp Revenue</span>
    </div>
    <div style="font-size:14px;color:#64748b;margin-left:42px;">${formatDate(d.report_date)}</div>
  </div>

  <!-- YTD Summary -->
  <div class="section">
    <div class="section-title">Year to Date</div>
    <div style="display:flex;gap:24px;margin-bottom:16px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;">Actual</div>
        <div style="font-size:28px;font-weight:700;color:#f8fafc;letter-spacing:-1px;">${fmtShort(d.ytd.actual)}</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;">Forecast</div>
        <div style="font-size:28px;font-weight:700;color:#94a3b8;letter-spacing:-1px;">${fmtShort(d.ytd.forecast)}</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;">Target</div>
        <div style="font-size:28px;font-weight:700;color:#64748b;letter-spacing:-1px;">${fmtShort(d.ytd.target)}</div>
      </div>
    </div>
    <!-- Progress bar -->
    <div style="position:relative;height:10px;background:#1e293b;border-radius:5px;overflow:hidden;">
      <div style="position:absolute;height:100%;width:${forecastPct}%;background:rgba(148,163,184,0.2);border-radius:5px;"></div>
      <div style="position:absolute;height:100%;width:${ytdPct}%;background:linear-gradient(90deg,#14b8a6,#10b981);border-radius:5px;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;">
      <span style="font-size:11px;color:#14b8a6;">${ytdPct}% of target</span>
      <span style="font-size:11px;color:#64748b;">Target: ${fmtShort(d.ytd.target)}</span>
    </div>
  </div>

  <!-- Quarterly -->
  <div class="section">
    <div class="section-title">Quarterly Performance</div>
    <table>
      <tr>
        <th style="text-align:left;">Quarter</th>
        <th>Target</th>
        <th>Forecast</th>
        <th>Actual</th>
        <th style="text-align:center;"></th>
      </tr>
      ${periodRows(d.quarters)}
    </table>
  </div>

  <!-- Monthly -->
  <div class="section">
    <div class="section-title">Monthly Performance</div>
    <table>
      <tr>
        <th style="text-align:left;">Month</th>
        <th>Target</th>
        <th>Forecast</th>
        <th>Actual</th>
        <th style="text-align:center;"></th>
      </tr>
      ${periodRows(d.months)}
    </table>
  </div>

  <!-- Top Customers -->
  ${d.top_customers?.length ? `
  <div class="section">
    <div class="section-title">Top Customers · MTD</div>
    ${customersHtml}
  </div>` : ''}

  <!-- Footer -->
  <div style="text-align:center;padding-top:8px;">
    <span style="font-size:11px;color:#475569;">Generated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Vancouver' })} PT · Acme Corp BillSuite</span>
  </div>

</div>
</body>
</html>`;
}

async function fetchDigestData(supabaseUrl: string, supabaseKey: string): Promise<DigestData> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/digest_full`, {
    method: 'POST',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Supabase RPC error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<DigestData>;
}

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const d = await fetchDigestData(supabaseUrl, supabaseKey);
    const html = renderDigestCard(d);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return new Response(`<html><body style="background:#0f172a;color:#ef4444;padding:40px;font-family:monospace;">Error: ${String(e)}</body></html>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
});
