/**
 * Acme Corp Daily Revenue Digest — Pipedream Workflow Step
 *
 * Paste this as a single "Run Node.js code" step in Pipedream.
 * Trigger: Daily schedule, cron "0 15 * * *" (8:00 AM Pacific)
 *
 * Required environment variables (set in Pipedream project settings):
 *   SUPABASE_URL       = https://your-project.supabase.co
 *   SUPABASE_ANON_KEY  = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *   SLACK_BOT_TOKEN    = xoxb-... (from your Slack app or Pipedream Slack connection)
 *   SLACK_CHANNEL_ID   = C0872NV9H43
 *   OUTLOOK_AUTH_TOKEN = (from Pipedream Outlook connected account, see note below)
 *
 * For Outlook: use a Pipedream "Send Email" action step instead of this code step,
 * and pass `$.steps.digest.slackText` as the content — it handles OAuth refresh automatically.
 */

import fetch from 'node-fetch';

export default defineComponent({
  async run({ steps, $ }) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C0872NV9H43';

    // ── 1. Fetch metrics ─────────────────────────────────────────────
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/digest_metrics`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
    const [m] = await res.json();

    const mtdActual   = Number(m.mtd_actual);
    const mtdForecast = Number(m.mtd_forecast);
    const mtdTarget   = Number(m.mtd_target);
    const trendingTo  = Number(m.trending_to);
    const ytdActual   = Number(m.ytd_actual);
    const ytdForecast = Number(m.ytd_forecast);
    const ytdTarget   = Number(m.ytd_target);
    const gapToTarget = trendingTo - mtdTarget;
    const today       = m.report_date;

    // ── 2. Format helpers ────────────────────────────────────────────
    const fmt = n => {
      if (Math.abs(n) >= 1e6) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1e6).toFixed(1) + 'M';
      if (Math.abs(n) >= 1e3) return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n) / 1e3) + 'k';
      return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
    };
    const fmtExact = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

    // ── 3. Status ────────────────────────────────────────────────────
    const now = new Date();
    const dayOfMonth  = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pctElapsed  = dayOfMonth / daysInMonth;
    let status;
    if (mtdActual / mtdTarget >= pctElapsed * 1.05)  status = '✅ On track';
    else if (pctElapsed < 0.2)                        status = '⚠️ Early month — pacing expected';
    else if (trendingTo >= mtdTarget * 0.95)          status = '⚠️ Trending close to target';
    else                                               status = `🔴 At risk — ${fmt(mtdTarget - trendingTo)} gap`;

    // ── 4. Slack message (mrkdwn) ────────────────────────────────────
    const slackText = [
      `*📊 Acme Corp Daily Digest — ${today}*`,
      '',
      `*MTD Performance*`,
      `Actual: ${fmtExact(mtdActual)} (${m.mtd_orders} orders)`,
      `Target: ${fmt(mtdTarget)}`,
      `Forecast: ${fmt(mtdForecast)}`,
      `Status: ${status}`,
      '',
      `*Month Outlook*`,
      `Trending To: ${fmt(trendingTo)}`,
      `Gap to Target: ${fmtExact(gapToTarget)}`,
      '',
      `*YTD Summary*`,
      `Actual: ${fmt(ytdActual)} | Forecast: ${fmt(ytdForecast)} | Target: ${fmt(ytdTarget)}`,
    ].join('\n');

    // ── 5. Email body (HTML) ─────────────────────────────────────────
    const emailRows = [
      ['MTD Actual',     `<b>${fmtExact(mtdActual)}</b> (${m.mtd_orders} orders)`],
      ['Month Target',   fmt(mtdTarget)],
      ['Month Forecast', fmt(mtdForecast)],
      ['Status',         status],
      ['Trending To',    fmt(trendingTo)],
      ['Gap to Target',  fmtExact(gapToTarget)],
      ['YTD Actual',     fmt(ytdActual)],
      ['YTD Forecast',   fmt(ytdForecast)],
      ['YTD Target',     fmt(ytdTarget)],
    ];
    const tableRows = emailRows.map(([label, val], i) =>
      `<tr${i % 2 ? ' style="background:#f9f9f9"' : ''}>`+
      `<td style="padding:8px 16px;border:1px solid #ddd">${label}</td>`+
      `<td style="padding:8px 16px;text-align:right;border:1px solid #ddd">${val}</td></tr>`
    ).join('');
    const emailBody = `<div style="font-family:Arial,sans-serif;max-width:600px">
<h2 style="color:#1a1a1a;margin-bottom:4px">📊 Acme Corp Daily Digest</h2>
<p style="color:#666;margin-top:0">${today}</p>
<table style="border-collapse:collapse;font-size:14px;width:100%">
<tr style="background:#f2f2f2">
  <th style="padding:10px 16px;text-align:left;border:1px solid #ddd">Metric</th>
  <th style="padding:10px 16px;text-align:right;border:1px solid #ddd">Value</th>
</tr>${tableRows}
</table></div>`;

    // ── 6. WhatsApp text ─────────────────────────────────────────────
    const whatsAppText = [
      `📊 *Acme Corp Daily Digest — ${today}*`,
      '',
      `📅 *MTD Performance*`,
      `Actual: ${fmtExact(mtdActual)} (${m.mtd_orders} orders)`,
      `Target: ${fmt(mtdTarget)}`,
      `Forecast: ${fmt(mtdForecast)}`,
      `Status: ${status}`,
      '',
      `📈 *Month Outlook*`,
      `Trending To: ${fmt(trendingTo)}`,
      `Gap to Target: ${fmtExact(gapToTarget)}`,
      '',
      `📊 *YTD Summary*`,
      `Actual: ${fmt(ytdActual)} | Forecast: ${fmt(ytdForecast)} | Target: ${fmt(ytdTarget)}`,
    ].join('\n');

    // ── 7. Send to Slack ─────────────────────────────────────────────
    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL_ID,
        text: slackText,
        mrkdwn: true,
        username: 'BillSuite',
        icon_emoji: ':bar_chart:',
      }),
    });
    const slackResult = await slackRes.json();
    if (!slackResult.ok) console.error('Slack error:', slackResult.error);

    // ── 8. Export for downstream steps (Outlook email step) ──────────
    return {
      slackText,
      emailBody,
      whatsAppText,
      subject: `Daily Revenue Tracker — ${today}`,
      metrics: { mtd_actual: fmtExact(mtdActual), mtd_orders: m.mtd_orders, trending_to: fmt(trendingTo) },
      slack_ok: slackResult.ok,
    };
  }
});
