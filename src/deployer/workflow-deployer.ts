import type { PipedreamRestClient } from '../clients/rest-api.js';
import type { FlowTemplate } from '../engine/template-loader.js';
import { loadTemplate, resolveParams } from '../engine/template-loader.js';

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

function buildCodeStep(template: FlowTemplate, webhookUrl: string) {
  const code = `export default defineComponent({
  async run({ $ }) {
    const res = await fetch("${webhookUrl}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: "${template.id}",
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

export async function updateWorkflowWebhook(
  workflowId: string,
  webhookUrl: string,
  rest: PipedreamRestClient,
): Promise<unknown> {
  // Update the code step with the new webhook URL.
  // We rebuild the step with the new URL and PATCH the workflow.
  return rest.updateWorkflow(workflowId, {
    steps: [{
      namespace: 'trigger_digest',
      type: 'CodeCell',
      code_raw: `export default defineComponent({
  async run({ $ }) {
    const res = await fetch("${webhookUrl}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
});`,
    }],
  });
}
