import { loadTemplate, resolveParams, type FlowTemplate } from './template-loader.js';
import { runDigest, type DigestChannel } from '../digest/index.js';
import type { SenderConfig } from '../digest/senders.js';

export interface ExecuteOptions {
  template_id: string;
  dry_run?: boolean;
  overrides?: Record<string, unknown>;
}

export interface ExecuteResult {
  template_id: string;
  template_name: string;
  version: string;
  resolved_params: Record<string, unknown>;
  execution: unknown;
}

type ConnectRunner = (action: string, props: Record<string, unknown>, userId: string) => Promise<unknown>;

export async function executeTemplate(
  options: ExecuteOptions,
  connect: ConnectRunner,
  userId: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<ExecuteResult> {
  const template = await loadTemplate(options.template_id);
  const params = resolveParams(template, options.overrides);

  const execution = await routeExecution(template, params, options.dry_run ?? false, connect, userId, supabaseUrl, supabaseKey);

  return {
    template_id: template.id,
    template_name: template.name,
    version: template.version,
    resolved_params: params,
    execution,
  };
}

async function routeExecution(
  template: FlowTemplate,
  params: Record<string, unknown>,
  dryRun: boolean,
  connect: ConnectRunner,
  userId: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<unknown> {
  // Route based on template ID — each template type gets its own runner.
  // This is the extension point: adding a new flow = one new case here + template JSON.
  switch (template.id) {
    case 'daily-revenue-report':
      return executeDigest(params, dryRun, connect, userId, supabaseUrl, supabaseKey);

    default:
      throw new Error(`No executor registered for template "${template.id}". Known templates: daily-revenue-report`);
  }
}

async function executeDigest(
  params: Record<string, unknown>,
  dryRun: boolean,
  connect: ConnectRunner,
  userId: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<unknown> {
  const channels = (params.channels as DigestChannel[]) ?? ['slack', 'email'];

  const config: SenderConfig = {
    slackAuthProvisionId:     process.env['SLACK_AUTH_PROVISION_ID']    || 'apn_P8hEEEa',
    outlookAuthProvisionId:   process.env['OUTLOOK_AUTH_PROVISION_ID']  || 'apn_Xeh00n7',
    slackChannelId:           (params.slack_channel_id as string)      || 'C0872NV9H43',
    emailRecipients:          (params.email_recipients as string[])    || [],
    emailSubjectPrefix:       (params.email_subject_prefix as string)  || 'Daily Revenue Tracker',
    whatsappRecipients:       (params.whatsapp_recipients as string[]) || [],
    whatsappTemplateSid:      (params.whatsapp_template_sid as string) || 'HX6f733603e2f8ffb785fcf131f872565a',
    whatsappTemplateDelayMs:  (params.whatsapp_template_delay_ms as number) || 15_000,
    twilioSid:                process.env['TWILIO_ACCOUNT_SID']        || '',
    twilioToken:              process.env['TWILIO_AUTH_TOKEN']          || '',
    twilioWaFrom:             process.env['TWILIO_WA_FROM']             || '',
  };

  return runDigest({ dry_run: dryRun, channels }, config, supabaseUrl, supabaseKey, connect, userId);
}
