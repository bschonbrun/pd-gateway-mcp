#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PipedreamRestClient } from './clients/rest-api.js';
import { PipedreamConnectClient } from './clients/connect-api.js';

const env = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
};

const rest = new PipedreamRestClient(env('PIPEDREAM_API_KEY'), process.env.PIPEDREAM_ORG_ID);
const connect = new PipedreamConnectClient(
  env('PIPEDREAM_CLIENT_ID'),
  env('PIPEDREAM_CLIENT_SECRET'),
  env('PIPEDREAM_PROJECT_ID'),
);
const defaultUserId = process.env['PIPEDREAM_EXTERNAL_USER_ID'] || 'pd-gateway-mcp';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

const server = new McpServer({ name: 'pd-gateway-mcp', version: '0.1.0' });

// ── Workflow Tools (REST API) ───────────────────────────────────────

server.tool(
  'pd_list_workflows',
  'List all workflows in your Pipedream workspace.',
  { limit: z.number().min(1).max(100).default(10).describe('Max results (1-100)') },
  async ({ limit }) => {
    try { return ok(await rest.listWorkflows(limit)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_get_workflow',
  'Get details for a specific workflow including steps, triggers, and configuration.',
  { workflow_id: z.string().describe('Workflow ID (e.g. p_abc123)') },
  async ({ workflow_id }) => {
    try { return ok(await rest.getWorkflow(workflow_id)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_trigger_workflow',
  'Trigger a workflow by POSTing JSON data to its webhook URL.',
  {
    webhook_url: z.string().url().describe('Webhook trigger URL'),
    data: z.record(z.string(), z.unknown()).default({}).describe('JSON payload'),
  },
  async ({ webhook_url, data }) => {
    try { return ok(await rest.triggerWebhook(webhook_url, data)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_get_events',
  'View recent execution events for a workflow. Useful for debugging.',
  {
    workflow_id: z.string().describe('Workflow ID'),
    limit: z.number().min(1).max(100).default(10).describe('Max events'),
  },
  async ({ workflow_id, limit }) => {
    try { return ok(await rest.getWorkflowEvents(workflow_id, limit)); }
    catch (e) { return fail(e); }
  },
);

// ── App Action Tools (Connect API) ──────────────────────────────────

server.tool(
  'pd_list_apps',
  'Search available apps on Pipedream (3,000+). Returns app names and slugs.',
  { query: z.string().optional().describe('Search query (e.g. "hubspot", "slack")') },
  async ({ query }) => {
    try { return ok(await connect.listApps(query)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_list_app_actions',
  'List available actions for a specific app. Returns action keys, names, and configurable props.',
  { app: z.string().describe('App slug (e.g. "hubspot", "google_sheets", "slack")') },
  async ({ app }) => {
    try { return ok(await connect.listActions(app)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_run_action',
  'Execute an app action. Use pd_list_app_actions first to discover the action key and required props.',
  {
    action_key: z.string().describe('Action key (e.g. "hubspot-create-contact")'),
    props: z.record(z.string(), z.unknown()).default({}).describe('Configured props for the action'),
    external_user_id: z.string().optional().describe('External user ID for auth context'),
  },
  async ({ action_key, props, external_user_id }) => {
    try {
      return ok(await connect.runAction(action_key, props, external_user_id || defaultUserId));
    } catch (e) { return fail(e); }
  },
);

// ── Account Connection Tools ────────────────────────────────────────

server.tool(
  'pd_connect_account',
  'Generate an auth link to connect an app (Slack, HubSpot, Google, etc.) to Pipedream. Returns a URL the user must open to complete the OAuth flow. After auth, pd_run_action will automatically use the stored credentials.',
  {
    external_user_id: z.string().optional().describe('External user ID for the connection (uses default if omitted)'),
  },
  async ({ external_user_id }) => {
    try {
      const userId = external_user_id || defaultUserId;
      const result = await connect.createConnectToken(userId);
      return ok({
        ...result,
        instructions: 'Open the connect_link_url in a browser to authenticate. Once complete, pd_run_action will use the stored credentials automatically.',
      });
    } catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_list_accounts',
  'List all connected app accounts for the current user. Shows which apps are already authenticated and ready to use with pd_run_action.',
  {
    external_user_id: z.string().optional().describe('External user ID to check (uses default if omitted)'),
  },
  async ({ external_user_id }) => {
    try {
      return ok(await connect.listAccounts(external_user_id || defaultUserId));
    } catch (e) { return fail(e); }
  },
);

// ── Trigger & Component Tools (Connect API) ─────────────────────────

server.tool(
  'pd_list_triggers',
  'List available trigger components for an app. Returns trigger keys, names, and configurable props. Use this to discover what events an app can listen for (e.g. new row in Google Sheets, new message in Slack).',
  { app: z.string().optional().describe('App slug to filter triggers (e.g. "google_sheets", "slack")') },
  async ({ app }) => {
    try { return ok(await connect.listTriggers(app)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_get_component',
  'Get detailed configuration schema for any action or trigger by its key. Returns all configurable_props with types, labels, descriptions, and whether they have remote options (dynamic dropdowns).',
  { component_key: z.string().describe('Component key (e.g. "google_sheets-new-row-added", "slack-send-message")') },
  async ({ component_key }) => {
    try { return ok(await connect.getComponent(component_key)); }
    catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_configure_prop',
  'Fetch live dropdown options for a component prop. Works for both actions and triggers. Use this to enumerate valid values (e.g. list of Slack channels, Google Sheets spreadsheets, HubSpot pipelines) before running an action or deploying a trigger.',
  {
    component_id: z.string().describe('Component key (e.g. "slack-send-message")'),
    prop_name: z.string().describe('Name of the prop to configure (e.g. "channel", "spreadsheet")'),
    configured_props: z.record(z.string(), z.unknown()).optional().describe('Already-configured props (some dropdowns depend on other selections)'),
    query: z.string().optional().describe('Optional search/filter query for the prop options'),
    external_user_id: z.string().optional().describe('External user ID (uses default if omitted)'),
  },
  async ({ component_id, prop_name, configured_props, query, external_user_id }) => {
    try {
      return ok(await connect.configureProp({
        component_id,
        prop_name,
        external_user_id: external_user_id || defaultUserId,
        configured_props: configured_props || {},
        query,
      }));
    } catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_deploy_trigger',
  'Deploy a trigger to start listening for events. Optionally wire it directly to a workflow and/or webhook URL. Use pd_list_triggers to find trigger keys and pd_configure_prop to enumerate valid prop values first.',
  {
    trigger_id: z.string().describe('Trigger component key (e.g. "google_sheets-new-row-added")'),
    configured_props: z.record(z.string(), z.unknown()).default({}).describe('Configured props for the trigger'),
    workflow_id: z.string().optional().describe('Workflow ID to receive trigger events (e.g. "p_abc123")'),
    webhook_url: z.string().url().optional().describe('Webhook URL to receive trigger events'),
    external_user_id: z.string().optional().describe('External user ID (uses default if omitted)'),
  },
  async ({ trigger_id, configured_props, workflow_id, webhook_url, external_user_id }) => {
    try {
      return ok(await connect.deployTrigger({
        trigger_id,
        external_user_id: external_user_id || defaultUserId,
        configured_props,
        workflow_id,
        webhook_url,
      }));
    } catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_list_deployed_triggers',
  'List all currently deployed (active) triggers. Shows trigger status, configuration, and linked workflows.',
  {
    external_user_id: z.string().optional().describe('External user ID (uses default if omitted)'),
  },
  async ({ external_user_id }) => {
    try {
      return ok(await connect.listDeployedTriggers(external_user_id || defaultUserId));
    } catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_delete_deployed_trigger',
  'Delete a deployed trigger to stop it from listening for events. This permanently removes the trigger.',
  {
    trigger_id: z.string().describe('Deployed trigger ID to delete'),
    external_user_id: z.string().optional().describe('External user ID (uses default if omitted)'),
  },
  async ({ trigger_id, external_user_id }) => {
    try {
      return ok(await connect.deleteDeployedTrigger(trigger_id, external_user_id || defaultUserId));
    } catch (e) { return fail(e); }
  },
);

server.tool(
  'pd_update_trigger_workflows',
  'Update which workflows receive events from a deployed trigger. Use this to rewire a trigger to different workflows without redeploying.',
  {
    trigger_id: z.string().describe('Deployed trigger ID'),
    workflow_ids: z.array(z.string()).describe('Array of workflow IDs to receive events'),
    external_user_id: z.string().optional().describe('External user ID (uses default if omitted)'),
  },
  async ({ trigger_id, workflow_ids, external_user_id }) => {
    try {
      return ok(await connect.updateTriggerWorkflows(trigger_id, workflow_ids, external_user_id || defaultUserId));
    } catch (e) { return fail(e); }
  },
);

// ── WhatsApp Tool (Twilio Direct) ───────────────────────────────────

const TWILIO_SID = process.env['TWILIO_ACCOUNT_SID'] || '';
const TWILIO_TOKEN = process.env['TWILIO_AUTH_TOKEN'] || '';
const TWILIO_WA_FROM = process.env['TWILIO_WHATSAPP_FROM'] || 'whatsapp:+12362332112';

server.tool(
  'send_whatsapp',
  'Send a WhatsApp message via Twilio. Bypasses Pipedream component limitations. Supports text messages to any WhatsApp number.',
  {
    to: z.string().describe('Recipient phone number with country code (e.g. "+16045551234"). The whatsapp: prefix is added automatically.'),
    body: z.string().max(1600).describe('Message text (max 1600 chars). Supports WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```monospace```'),
    from: z.string().optional().describe('Override sender WhatsApp number (defaults to sandbox number)'),
    media_url: z.string().url().optional().describe('Optional media URL to attach (image, PDF, etc.)'),
  },
  async ({ to, body, from, media_url }) => {
    if (!TWILIO_SID || !TWILIO_TOKEN) return fail('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');

    const waTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const waFrom = from ? (from.startsWith('whatsapp:') ? from : `whatsapp:${from}`) : TWILIO_WA_FROM;

    const params = new URLSearchParams({ To: waTo, From: waFrom, Body: body });
    if (media_url) params.append('MediaUrl', media_url);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await res.json();
      if (!res.ok) return fail(`Twilio ${res.status}: ${data.message || JSON.stringify(data)}`);
      return ok({ sid: data.sid, status: data.status, to: data.to, from: data.from, date_created: data.date_created });
    } catch (e) { return fail(e); }
  },
);

// ── Claude Tool (Anthropic Direct) ──────────────────────────────────

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] || '';

server.tool(
  'ask_claude',
  'Send a message to Claude (claude-sonnet-4-5). Use for: formatting data into readable summaries, answering natural language questions about structured data, generating SQL from plain English, or any task requiring reasoning. Returns Claude\'s response as text.',
  {
    prompt: z.string().describe('The user message / question to send to Claude'),
    system: z.string().optional().describe('Optional system prompt to set Claude\'s role and context (e.g. database schema, formatting rules)'),
    model: z.enum(['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']).default('claude-sonnet-4-5').describe('Claude model to use'),
    max_tokens: z.number().min(100).max(8192).default(1024).describe('Maximum tokens in response'),
  },
  async ({ prompt, system, model, max_tokens }) => {
    if (!ANTHROPIC_API_KEY) return fail('ANTHROPIC_API_KEY must be set');

    const body: Record<string, unknown> = {
      model,
      max_tokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) body.system = system;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        content?: Array<{ type: string; text: string }>;
        error?: { message: string };
      };
      if (!res.ok) return fail(`Anthropic ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
      const text = data.content?.find(b => b.type === 'text')?.text ?? '';
      return { content: [{ type: 'text' as const, text }] };
    } catch (e) { return fail(e); }
  },
);

// ── Daily Digest Tool ──────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'] || '';
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'] || '';
const SLACK_AUTH_PROVISION = process.env['SLACK_AUTH_PROVISION_ID'] || 'apn_P8hEEEa';
const OUTLOOK_AUTH_PROVISION = process.env['OUTLOOK_AUTH_PROVISION_ID'] || 'apn_Xeh00n7';
const SLACK_CHANNEL_ID = process.env['SLACK_DIGEST_CHANNEL'] || 'C0872NV9H43';
const EMAIL_RECIPIENTS = (process.env['DIGEST_EMAIL_RECIPIENTS'] || 'barry@carbonet.com,lindsay@carbonet.com,jack@carbonet.com,amielle@carbonet.com,buster@carbonet.com,mike@carbonet.com,paul@carbonet.com,nolan@carbonet.com,bill@carbonet.com,graeme@carbonet.com').split(',');
const WHATSAPP_RECIPIENTS = (process.env['DIGEST_WHATSAPP_RECIPIENTS'] || '+16047830407').split(',');
const DIGEST_TEMPLATE_SID = process.env['DIGEST_TEMPLATE_SID'] || 'HX6f733603e2f8ffb785fcf131f872565a';

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return n === 0 ? '—' : `$${n.toLocaleString()}`;
}

function fmtExact(n: number): string {
  const prefix = n < 0 ? '-$' : '$';
  return prefix + Math.abs(Math.round(n)).toLocaleString();
}

function fmtGap(n: number): string {
  const prefix = n < 0 ? '-$' : '+$';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${Math.round(abs / 1_000)}K`;
  return `${prefix}${abs.toLocaleString()}`;
}

function pad(s: string, w: number): string { return s.padEnd(w); }
function rpad(s: string, w: number): string { return s.padStart(w); }

interface DigestData {
  report_date: string; day_of_month: number; days_in_month: number; current_quarter: number;
  ytd: { actual: number; forecast: number; target: number };
  quarters: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  months: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; is_closed: boolean; is_current: boolean }>;
  top_customers: Array<{ name: string; revenue: number; orders: number; top_product: string | null }> | null;
  forecast_gaps: Array<{ name: string; forecast: number; actual: number; gap: number }> | null;
  top_products: Array<{ product: string; product_type: string; forecast: number; actual: number; gap: number }> | null;
  largest_orders: Array<{ order_number: number; customer: string; product: string; revenue: number; totes: number; order_date: string }> | null;
}

function periodTag(q: { is_closed: boolean; is_current: boolean }): string {
  if (q.is_closed) return ' (Last)';
  if (q.is_current) return ' ◀';
  return ' (Next)';
}

function formatSlack(d: DigestData): string {
  const lines: string[] = [
    `*📊 CarboNet Daily Digest — ${d.report_date}*`,
    '',
    `*━━━ YTD Summary ━━━*`,
    `Actual ${fmt(d.ytd.actual)} · Forecast ${fmt(d.ytd.forecast)} · Target ${fmt(d.ytd.target)}`,
    '',
    `*━━━ Quarterly ━━━*`,
    '```',
    `${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`,
  ];
  for (const q of d.quarters) {
    const tag = periodTag(q);
    lines.push(
      `${pad(q.label + tag, 12)} ${rpad(fmt(q.target), 9)} ${rpad(fmt(q.forecast), 9)} ${rpad(q.actual ? fmt(q.actual) : '—', 9)} ${rpad(q.orders ? String(q.orders) : '—', 7)} ${rpad(q.totes ? String(q.totes) : '—', 6)}`,
    );
  }
  lines.push('```', '');

  lines.push(`*━━━ Monthly ━━━*`, '```');
  lines.push(`${pad('', 12)} ${rpad('Target', 9)} ${rpad('Forecast', 9)} ${rpad('Actual', 9)} ${rpad('Orders', 7)} ${rpad('Totes', 6)}`);
  for (const m of d.months) {
    const tag = periodTag(m);
    lines.push(
      `${pad(m.label + tag, 12)} ${rpad(fmt(m.target), 9)} ${rpad(fmt(m.forecast), 9)} ${rpad(m.actual ? fmt(m.actual) : '—', 9)} ${rpad(m.orders ? String(m.orders) : '—', 7)} ${rpad(m.totes ? String(m.totes) : '—', 6)}`,
    );
  }
  lines.push('```', '');

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
    `<th style="padding:8px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #ddd;background:#f2f2f2">${h}</th>`;
  const td = (v: string, i: number, ri: number) => {
    const isCurrent = opts?.highlightRows?.includes(ri);
    const bg = isCurrent ? 'background:#e8f4fd;font-weight:600;' : (ri % 2 === 1 ? 'background:#f9f9f9' : '');
    return `<td style="padding:6px 12px;text-align:${opts?.rightAlign?.includes(i) ? 'right' : 'left'};border:1px solid #ddd;${bg}">${v}</td>`;
  };
  return `<table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px">
<tr>${headers.map(th).join('')}</tr>
${rows.map((r, ri) => `<tr>${r.map((v, i) => td(v, i, ri)).join('')}</tr>`).join('\n')}
</table>`;
}

function formatEmail(d: DigestData): string {
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
    d.top_products.map(p => [p.product, p.product_type, fmt(p.forecast), p.actual ? fmt(p.actual) : '—', `<span style="color:${p.gap < 0 ? '#c00' : '#080'}">${fmtGap(p.gap)}</span>`]),
    { rightAlign: [2, 3, 4] },
  ) : '';

  const gapTable = d.forecast_gaps?.length ? `<h3 style="margin:16px 0 8px">Top 5 Forecast Gaps MTD</h3>` + htmlTable(
    ['Customer', 'Forecast', 'Actual', 'Gap'],
    d.forecast_gaps.map(g => [g.name, fmt(g.forecast), g.actual ? fmt(g.actual) : '—', `<span style="color:${g.gap < 0 ? '#c00' : '#080'}">${fmtGap(g.gap)}</span>`]),
    { rightAlign: [1, 2, 3] },
  ) : '';

  const ordersTable = d.largest_orders?.length ? `<h3 style="margin:16px 0 8px">Top 5 Largest Orders MTD</h3>` + htmlTable(
    ['Order #', 'Customer', 'Product', 'Revenue', 'Totes', 'Date'],
    d.largest_orders.map(o => [String(o.order_number), o.customer, o.product || '—', fmt(o.revenue), String(o.totes), o.order_date]),
    { rightAlign: [3, 4] },
  ) : '';

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;color:#1a1a1a">
<h2 style="margin-bottom:4px">📊 CarboNet Daily Digest</h2>
<p style="color:#666;margin-top:0">${d.report_date}</p>
<h3 style="margin:16px 0 8px">YTD Summary</h3>${ytdTable}
<h3 style="margin:16px 0 8px">Quarterly Performance</h3>${qTable}
<h3 style="margin:16px 0 8px">Monthly Performance</h3>${mTable}
${custTable}${productTable}${gapTable}${ordersTable}
</div>`;
}

function fmtDateShort(reportDate: string): string {
  const d = new Date(reportDate);
  if (isNaN(d.getTime())) return reportDate;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return n === 0 ? '—' : `$${n.toLocaleString()}`;
}

function formatWhatsApp(d: DigestData): string {
  const shortDt = fmtDateShort(d.report_date).slice(0, 5); // MM/DD only
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

server.tool(
  'run_daily_digest',
  'Run the CarboNet daily revenue digest. Queries live Supabase data and sends formatted reports to Slack (#orders-glide) and Outlook email recipients.',
  {
    dry_run: z.boolean().default(false).describe('If true, returns the formatted messages without sending them'),
    channels: z.array(z.enum(['slack', 'email', 'whatsapp'])).default(['slack', 'email']).describe('Which channels to send to'),
  },
  async ({ dry_run, channels }) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return fail('SUPABASE_URL and SUPABASE_ANON_KEY must be set');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/digest_full`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return fail(`Supabase error ${res.status}: ${await res.text()}`);
    const d = await res.json() as DigestData;

    const slackText = formatSlack(d);
    const emailBody = formatEmail(d);
    const whatsAppText = formatWhatsApp(d);

    if (dry_run) return ok({ slackText, emailBody, whatsAppText, recipients: EMAIL_RECIPIENTS, data: d });

    const results: Record<string, unknown> = {};

    if (channels.includes('slack')) {
      try {
        results.slack = await connect.runAction('slack-send-message', {
          slack: { authProvisionId: SLACK_AUTH_PROVISION },
          conversation: SLACK_CHANNEL_ID,
          text: slackText,
          mrkdwn: true,
          include_sent_via_pipedream_flag: false,
          customizeBotSettings: true,
          username: 'BillSuite',
          icon_emoji: ':bar_chart:',
        }, defaultUserId);
      } catch (e) {
        results.slack_error = e instanceof Error ? e.message : String(e);
      }
    }

    if (channels.includes('email')) {
      try {
        results.email = await connect.runAction('microsoft_outlook-send-email', {
          microsoftOutlook: { authProvisionId: OUTLOOK_AUTH_PROVISION },
          recipients: EMAIL_RECIPIENTS,
          subject: `Daily Revenue Tracker — ${d.report_date}`,
          contentType: 'html',
          content: emailBody,
        }, defaultUserId);
      } catch (e) {
        results.email_error = e instanceof Error ? e.message : String(e);
      }
    }

    if (channels.includes('whatsapp')) {
      try {
        const currentMonth = d.months.find(m => m.is_current) || d.months[0];
        const s = fmtShort;
        const contentVars = JSON.stringify({
          '1': currentMonth?.actual ? s(currentMonth.actual) : '—',
          '2': s(currentMonth?.forecast || 0),
        });
        const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
        const waResults: Array<{ to: string; template: string; detail: string }> = [];
        for (const recipient of WHATSAPP_RECIPIENTS) {
          const waTo = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient.trim()}`;
          // Step 1: Send template (opens conversation window)
          const tplParams = new URLSearchParams({
            To: waTo, From: TWILIO_WA_FROM,
            ContentSid: DIGEST_TEMPLATE_SID, ContentVariables: contentVars,
          });
          const tplRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tplParams.toString(),
          });
          const tplData = await tplRes.json() as Record<string, unknown>;
          if (!tplRes.ok) {
            waResults.push({ to: recipient, template: 'failed', detail: String(tplData['message'] || tplRes.status) });
            continue;
          }
          // Step 2: Wait 15s so template arrives first, then send full report
          await new Promise(r => setTimeout(r, 15_000));
          const freeParams = new URLSearchParams({ To: waTo, From: TWILIO_WA_FROM, Body: whatsAppText });
          const freeRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: freeParams.toString(),
          });
          const freeData = await freeRes.json() as Record<string, unknown>;
          waResults.push({
            to: recipient,
            template: String(tplData['sid']),
            detail: freeRes.ok ? String(freeData['sid']) : `follow-up failed: ${freeData['message']}`,
          });
        }
        results.whatsapp = waResults;
      } catch (e) {
        results.whatsapp_error = e instanceof Error ? e.message : String(e);
      }
    }

    return ok({ sent: true, channels, summary: { ytd: fmt(d.ytd.actual), forecast: fmt(d.ytd.forecast) }, results });
  },
);

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('pd-gateway-mcp: running (19 tools)');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
