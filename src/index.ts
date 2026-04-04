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
const TWILIO_WA_FROM = process.env['TWILIO_WHATSAPP_FROM'] || 'whatsapp:+14155238886';

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

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('pd-gateway-mcp: running (18 tools)');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
