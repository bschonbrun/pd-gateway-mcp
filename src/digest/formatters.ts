import type { DigestData } from './data.js';

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return n === 0 ? '—' : `$${n.toLocaleString()}`;
}

function pctDelta(curr: number, prev: number): string {
  if (!prev) return '';
  const pct = Math.round(((curr - prev) / prev) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function cagr(latest: number, earliest: number, years: number): string {
  if (!earliest || !latest || years <= 0) return '—';
  const rate = Math.pow(latest / earliest, 1 / years) - 1;
  const pct = Math.round(rate * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export function fmtShort(n: number): string {
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
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

function pad(s: string, w: number): string { return s.padEnd(w); }
function rpad(s: string, w: number): string { return s.padStart(w); }

function periodTag(q: { is_closed: boolean; is_current: boolean }): string {
  if (q.is_closed) return ' (Last)';
  if (q.is_current) return ' ◀';
  return ' (Next)';
}

export function formatSlack(d: DigestData): string {
  const lines: string[] = [
    `*📊 Acme Corp Daily Digest — ${d.report_date}*`,
    '',
    `*━━━ YTD Summary ━━━*`,
    `Actual ${fmt(d.ytd.actual)} · Forecast ${fmt(d.ytd.forecast)} · Target ${fmt(d.ytd.target)}`,
    '',
    `*━━━ Quarterly ━━━*`,
    '```',
    `${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`,
  ];
  for (const q of d.quarters) {
    lines.push(
      `${pad(q.label + periodTag(q), 12)} ${rpad(fmt(q.target), 9)} ${rpad(fmt(q.forecast), 9)} ${rpad(q.actual ? fmt(q.actual) : '—', 9)} ${rpad(q.orders ? String(q.orders) : '—', 7)} ${rpad(q.totes ? String(q.totes) : '—', 6)}`,
    );
  }
  lines.push('```', '', `*━━━ Monthly ━━━*`, '```');
  lines.push(`${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`);
  for (const m of d.months) {
    lines.push(
      `${pad(m.label + periodTag(m), 12)} ${rpad(fmt(m.target), 9)} ${rpad(fmt(m.forecast), 9)} ${rpad(m.actual ? fmt(m.actual) : '—', 9)} ${rpad(m.orders ? String(m.orders) : '—', 7)} ${rpad(m.totes ? String(m.totes) : '—', 6)}`,
    );
  }
  lines.push('```', '');

  if (d.comparisons) {
    const c = d.comparisons;
    const yrs = c.years; // [2026, 2025, 2024, 2023] — newest first
    lines.push(`*━━━ Year-over-Year (${c.as_of}) ━━━*`, '```');
    lines.push(`${pad('', 12)} ${rpad(String(yrs[3]), 8)} ${rpad(String(yrs[2]) + ' Δ', 12)} ${rpad(String(yrs[1]) + ' Δ', 12)} ${rpad(String(yrs[0]) + ' Δ', 12)} ${rpad('CAGR', 6)}`);
    // MTD row
    const m = c.mtd;
    lines.push(`${pad(`MTD ${m.label || ''}`, 12)} ${rpad(fmt(m.y3), 8)} ${rpad(fmt(m.y2) + ' ' + pctDelta(m.y2, m.y3), 12)} ${rpad(fmt(m.y1) + ' ' + pctDelta(m.y1, m.y2), 12)} ${rpad(fmt(m.y0) + ' ' + pctDelta(m.y0, m.y1), 12)} ${rpad(cagr(m.y0, m.y3, 3), 6)}`);
    // QTD row (conditional)
    if (c.show_qtd) {
      const q = c.qtd;
      lines.push(`${pad(`QTD ${q.label || ''}`, 12)} ${rpad(fmt(q.y3), 8)} ${rpad(fmt(q.y2) + ' ' + pctDelta(q.y2, q.y3), 12)} ${rpad(fmt(q.y1) + ' ' + pctDelta(q.y1, q.y2), 12)} ${rpad(fmt(q.y0) + ' ' + pctDelta(q.y0, q.y1), 12)} ${rpad(cagr(q.y0, q.y3, 3), 6)}`);
    }
    // YTD row
    const y = c.ytd;
    lines.push(`${pad('YTD', 12)} ${rpad(fmt(y.y3), 8)} ${rpad(fmt(y.y2) + ' ' + pctDelta(y.y2, y.y3), 12)} ${rpad(fmt(y.y1) + ' ' + pctDelta(y.y1, y.y2), 12)} ${rpad(fmt(y.y0) + ' ' + pctDelta(y.y0, y.y1), 12)} ${rpad(cagr(y.y0, y.y3, 3), 6)}`);
    lines.push('```', '');
  }

  if (d.top_customers?.length) {
    lines.push(`*━━━ Top 5 Customers MTD ━━━*`, '```');
    lines.push(`${pad('Customer', 20)} ${rpad('Revenue', 10)} ${rpad('Ord', 4)} ${pad('Top Product', 20)}`);
    for (const c of d.top_customers) {
      lines.push(`${pad(c.name.slice(0, 19), 20)} ${rpad(fmt(c.revenue), 10)} ${rpad(String(c.orders), 4)} ${pad((c.top_product || '—').slice(0, 19), 20)}`);
    }
    lines.push('```', '');
  }

  if (d.top_products?.length) {
    lines.push(`*━━━ Top 5 Products MTD ━━━*`, '```');
    lines.push(`${pad('Product', 22)} ${rpad('Forecast', 10)} ${rpad('Actual', 10)} ${rpad('Gap', 10)}`);
    for (const p of d.top_products) {
      lines.push(`${pad(p.product.slice(0, 21), 22)} ${rpad(fmt(p.forecast), 10)} ${rpad(p.actual ? fmt(p.actual) : '—', 10)} ${rpad(fmtGap(p.gap), 10)}`);
    }
    lines.push('```', '');
  }

  if (d.forecast_gaps?.length) {
    lines.push(`*━━━ Top 5 Forecast Gaps MTD ━━━*`, '```');
    lines.push(`${pad('Customer', 20)} ${rpad('Forecast', 10)} ${rpad('Actual', 10)} ${rpad('Gap', 10)}`);
    for (const g of d.forecast_gaps) {
      lines.push(`${pad(g.name.slice(0, 19), 20)} ${rpad(fmt(g.forecast), 10)} ${rpad(g.actual ? fmt(g.actual) : '—', 10)} ${rpad(fmtGap(g.gap), 10)}`);
    }
    lines.push('```', '');
  }

  if (d.largest_orders?.length) {
    lines.push(`*━━━ Top 5 Largest Orders MTD ━━━*`, '```');
    lines.push(`${pad('Order', 10)} ${pad('Customer', 18)} ${pad('Product', 20)} ${rpad('Revenue', 9)} ${pad('Date', 6)}`);
    for (const o of d.largest_orders) {
      lines.push(`${pad(String(o.order_number), 10)} ${pad(o.customer.slice(0, 17), 18)} ${pad((o.product || '—').slice(0, 19), 20)} ${rpad(fmt(o.revenue), 9)} ${pad(o.order_date, 6)}`);
    }
    lines.push('```');
  }

  return lines.join('\n');
}

function htmlTable(headers: string[], rows: string[][], opts?: { rightAlign?: number[]; highlightRows?: number[] }): string {
  const th = (h: string, i: number) =>
    `<th style="padding:8px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #dddddd;background:#f2f2f2">${h}</th>`;
  const td = (v: string, i: number, ri: number) => {
    const isCurrent = opts?.highlightRows?.includes(ri);
    const bg = isCurrent ? 'background:#e8f4fd;font-weight:600;' : (ri % 2 === 1 ? 'background:#f9f9f9' : '');
    return `<td style="padding:6px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #dddddd;${bg}">${v}</td>`;
  };
  return `<table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px">
<tr>${headers.map(th).join('')}</tr>
${rows.map((r, ri) => `<tr>${r.map((v, i) => td(v, i, ri)).join('')}</tr>`).join('\n')}
</table>`;
}

export function formatEmail(d: DigestData): string {
  const ra = [1, 2, 3, 4, 5, 6];

  const ytdTable = htmlTable(
    ['Metric', 'Value'],
    [['Actual', fmt(d.ytd.actual)], ['Forecast', fmt(d.ytd.forecast)], ['Target', fmt(d.ytd.target)]],
    { rightAlign: [1] },
  );

  const qHighlight = d.quarters.map((q, i) => q.is_current ? i : -1).filter(i => i >= 0);
  const qTable = htmlTable(
    ['Quarter', 'Target', 'Forecast', 'Actual', 'Orders', 'Totes'],
    d.quarters.map(q => [q.label + periodTag(q), fmt(q.target), fmt(q.forecast), q.actual ? fmt(q.actual) : '—', q.orders ? String(q.orders) : '—', q.totes ? String(q.totes) : '—']),
    { rightAlign: ra, highlightRows: qHighlight },
  );

  const mHighlight = d.months.map((m, i) => m.is_current ? i : -1).filter(i => i >= 0);
  const mTable = htmlTable(
    ['Month', 'Target', 'Forecast', 'Actual', 'Orders', 'Totes'],
    d.months.map(m => [m.label + periodTag(m), fmt(m.target), fmt(m.forecast), m.actual ? fmt(m.actual) : '—', m.orders ? String(m.orders) : '—', m.totes ? String(m.totes) : '—']),
    { rightAlign: ra, highlightRows: mHighlight },
  );

  const custTable = d.top_customers?.length ? `<h3 style="margin:16px 0 8px">Top 5 Customers MTD</h3>` + htmlTable(
    ['Customer', 'Revenue', 'Orders', 'Top Product'],
    d.top_customers.map(c => [c.name, fmt(c.revenue), String(c.orders), c.top_product || '—']),
    { rightAlign: [1, 2] },
  ) : '';

  const productTable = d.top_products?.length ? `<h3 style="margin:16px 0 8px">Top 5 Products MTD</h3>` + htmlTable(
    ['Product', 'Type', 'Forecast', 'Actual', 'Gap'],
    d.top_products.map(p => [p.product, p.product_type, fmt(p.forecast), p.actual ? fmt(p.actual) : '—', `<span style="color:${p.gap < 0 ? '#cc0000' : '#008800'}">${fmtGap(p.gap)}</span>`]),
    { rightAlign: [2, 3, 4] },
  ) : '';

  const gapTable = d.forecast_gaps?.length ? `<h3 style="margin:16px 0 8px">Top 5 Forecast Gaps MTD</h3>` + htmlTable(
    ['Customer', 'Forecast', 'Actual', 'Gap'],
    d.forecast_gaps.map(g => [g.name, fmt(g.forecast), g.actual ? fmt(g.actual) : '—', `<span style="color:${g.gap < 0 ? '#cc0000' : '#008800'}">${fmtGap(g.gap)}</span>`]),
    { rightAlign: [1, 2, 3] },
  ) : '';

  const ordersTable = d.largest_orders?.length ? `<h3 style="margin:16px 0 8px">Top 5 Largest Orders MTD</h3>` + htmlTable(
    ['Order #', 'Customer', 'Product', 'Revenue', 'Totes', 'Date'],
    d.largest_orders.map(o => [String(o.order_number), o.customer, o.product || '—', fmt(o.revenue), String(o.totes), o.order_date]),
    { rightAlign: [3, 4] },
  ) : '';

  let yoyTable = '';
  if (d.comparisons) {
    const c = d.comparisons;
    const yrs = c.years; // [2026, 2025, 2024, 2023]
    const yoyCell = (val: number, prev: number) => `${fmt(val)} <span style="color:${val >= prev ? '#008800' : '#cc0000'}">${pctDelta(val, prev)}</span>`;
    const cagrCell = (latest: number, earliest: number) => `<span style="font-weight:600">${cagr(latest, earliest, 3)}</span>`;
    const m = c.mtd;
    const rows: string[][] = [
      [`MTD (${m.label || ''})`, fmt(m.y3), yoyCell(m.y2, m.y3), yoyCell(m.y1, m.y2), yoyCell(m.y0, m.y1), cagrCell(m.y0, m.y3)],
    ];
    if (c.show_qtd) {
      const q = c.qtd;
      rows.push([`QTD (${q.label || ''})`, fmt(q.y3), yoyCell(q.y2, q.y3), yoyCell(q.y1, q.y2), yoyCell(q.y0, q.y1), cagrCell(q.y0, q.y3)]);
    }
    const y = c.ytd;
    rows.push(['YTD', fmt(y.y3), yoyCell(y.y2, y.y3), yoyCell(y.y1, y.y2), yoyCell(y.y0, y.y1), cagrCell(y.y0, y.y3)]);
    yoyTable = `<h3 style="margin:16px 0 8px">Year-over-Year (${c.as_of})</h3>` + htmlTable(
      ['Period', String(yrs[3]), `${yrs[2]} Δ`, `${yrs[1]} Δ`, `${yrs[0]} Δ`, 'CAGR'],
      rows,
      { rightAlign: [1, 2, 3, 4, 5] },
    );
  }

  return `<html>
<body>
<div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;color:#1a1a1a">
<h2 style="margin-bottom:4px">📊 Acme Corp Daily Digest</h2>
<p style="color:#666666;margin-top:0">${d.report_date}</p>
<h3 style="margin:16px 0 8px">YTD Summary</h3>${ytdTable}
<h3 style="margin:16px 0 8px">Quarterly Performance</h3>${qTable}
<h3 style="margin:16px 0 8px">Monthly Performance</h3>${mTable}
${yoyTable}${custTable}${productTable}${gapTable}${ordersTable}
</div>
</body>
</html>`;
}

export function formatWhatsApp(d: DigestData): string {
  const shortDt = fmtDateShort(d.report_date).slice(0, 5);
  const s = fmtShort;
  const lines: string[] = [
    `*Revenue Update - ${shortDt}*`,
    '',
    `*YTD*`,
    `Actual: ${s(d.ytd.actual)}`,
    `Forecast: ${s(d.ytd.forecast)}`,
    `Target: ${s(d.ytd.target)}`,
    '',
    `*Quarterly*`,
    '```',
  ];
  for (const q of d.quarters) {
    const marker = q.is_current ? ' ◀' : '';
    lines.push(`${pad(q.label, 3)}T:${s(q.target)} F:${s(q.forecast)} A:${q.actual ? s(q.actual) : '—'}${marker}`);
  }
  lines.push('```', '', `*Monthly*`, '```');
  for (const m of d.months) {
    const marker = m.is_current ? ' ◀' : '';
    lines.push(`${pad(m.label, 4)}T:${s(m.target)} F:${s(m.forecast)} A:${m.actual ? s(m.actual) : '—'}${marker}`);
  }
  lines.push('```');

  if (d.top_customers?.length) {
    lines.push('', `*Top 5 Customers MTD*`, '```');
    for (const c of d.top_customers) lines.push(`${pad(c.name.slice(0, 16), 17)} ${fmt(c.revenue)}`);
    lines.push('```');
  }

  if (d.top_products?.length) {
    lines.push('', `*Top Products MTD*`, '```');
    for (const p of d.top_products) lines.push(`${pad(p.product.slice(0, 20), 21)} ${p.actual ? fmt(p.actual) : '—'}`);
    lines.push('```');
  }

  if (d.largest_orders?.length) {
    lines.push('', `*Largest Orders*`, '```');
    for (const o of d.largest_orders) lines.push(`${o.order_date} ${pad(o.customer.slice(0, 14), 15)} ${fmt(o.revenue)}`);
    lines.push('```');
  }

  return lines.join('\n');
}
