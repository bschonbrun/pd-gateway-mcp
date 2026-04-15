import type { PipedreamRestClient } from '../clients/rest-api.js';
import type { FlowTemplate } from '../engine/template-loader.js';
import { loadTemplate, resolveParams } from '../engine/template-loader.js';
import { TIMEOUTS } from '../config.js';

export interface DeployResult {
  workflow_id: string;
  workflow_url: string;
  name: string;
  cron: string;
  webhook_url: string;
  status: string;
}

export async function deployTemplateWorkflow(
  templateId: string,
  rest: PipedreamRestClient,
  projectId: string,
  overrides: Record<string, unknown> = {},
  webhookUrl?: string,
): Promise<DeployResult> {
  const template = await loadTemplate(templateId);
  const params = resolveParams(template, overrides);

  const cron = (params.schedule as string) || '0 15 * * 1-5';
  const name = `${template.name} (auto-deployed)`;

  // The target URL for the cron to POST to. Until the Cloud API is live,
  // this can be a Pipedream request bin, a local tunnel, or a placeholder.
  const targetUrl = webhookUrl || process.env['DIGEST_WEBHOOK_URL'] || 'https://placeholder.example.com/digest';

  const codeStep = buildCodeStep(template, targetUrl);

  const result = await rest.createWorkflow({
    project_id: projectId,
    settings: { name, auto_deploy: true },
    triggers: [{
      type: '$.interface.timer',
      props: { cron, timezone: 'America/Los_Angeles' },
    }],
    steps: [codeStep],
  });

  const wfData = result.data ?? result;
  const workflowId = wfData.id || 'unknown';

  return {
    workflow_id: workflowId,
    workflow_url: `https://pipedream.com/@${workflowId}`,
    name,
    cron,
    webhook_url: targetUrl,
    status: 'deployed',
  };
}

/**
 * Build the Pipedream code step that POSTs to a webhook on each cron tick.
 *
 * The webhook URL is JSON-encoded before interpolation to prevent code
 * injection if the URL contains quotes, backslashes, or other special chars.
 */
function buildCodeStep(template: FlowTemplate, webhookUrl: string) {
  // JSON.stringify produces a properly-escaped JS string literal including the
  // surrounding quotes, e.g. "https://example.com/path" → `"https://example.com/path"`.
  const safeUrl = JSON.stringify(webhookUrl);
  const safeId  = JSON.stringify(template.id);

  const code = `export default defineComponent({
  async run({ $ }) {
    const res = await fetch(${safeUrl}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: ${safeId},
        source: "pipedream-cron",
        timestamp: new Date().toISOString(),
      }),
    });
    const body = await res.text();
    $.export("status", res.status);
    $.export("response", body);
    if (!res.ok) throw new Error(\`Webhook failed: \${res.status} \${body}\`);
    return { status: res.status, body };
  },
});`;

  return {
    namespace: 'trigger_digest',
    type: 'CodeCell',
    code_raw: code,
  };
}

/**
 * Update the webhook URL (and optionally the template ID) of a previously
 * deployed template workflow.
 *
 * @param templateId  - Optional: the template ID to embed in the POST body.
 *                      Provide this so the receiving endpoint knows which
 *                      template to run after the URL change.
 */
export async function updateWorkflowWebhook(
  workflowId: string,
  webhookUrl: string,
  rest: PipedreamRestClient,
  templateId?: string,
): Promise<unknown> {
  const safeUrl = JSON.stringify(webhookUrl);
  const templateLine = templateId
    ? `        template_id: ${JSON.stringify(templateId)},\n`
    : '';

  return rest.updateWorkflow(workflowId, {
    steps: [{
      namespace: 'trigger_digest',
      type: 'CodeCell',
      code_raw: `export default defineComponent({
  async run({ $ }) {
    const res = await fetch(${safeUrl}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
${templateLine}        source: "pipedream-cron",
        timestamp: new Date().toISOString(),
      }),
    });
    const body = await res.text();
    $.export("status", res.status);
    $.export("response", body);
    if (!res.ok) throw new Error(\`Webhook failed: \${res.status} \${body}\`);
    return { status: res.status, body };
  },
});`,
    }],
  });
}

// Re-export TIMEOUTS so callers that only import from this module don't need
// a separate import when they want to pass a timeout to rest.updateWorkflow.
export { TIMEOUTS };
