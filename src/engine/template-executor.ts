import { loadTemplate, resolveParams, type FlowTemplate } from './template-loader.js';
import { runDigest, type DigestChannel } from '../digest/index.js';
import { buildDigestConfig } from '../config.js';
import { executeXeroSync, type XeroSyncOptions } from './xero-sync-executor.js';

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

    case 'daily-xero-sync': {
      const xeroToken = (params as Record<string, unknown>).xero_access_token as string;
      if (!xeroToken) throw new Error('daily-xero-sync requires xero_access_token in overrides');
      return executeXeroSync({ xeroAccessToken: xeroToken, dryRun, overrides: params });
    }

    default:
      throw new Error(`No executor registered for template "${template.id}". Known templates: daily-revenue-report, daily-xero-sync`);
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

  // Start from env-sourced config then apply any template parameter overrides.
  const base = buildDigestConfig();
  const config = {
    ...base,
    slackChannelId:          (params.slack_channel_id as string)      || base.slackChannelId,
    emailRecipients:         (params.email_recipients as string[])    || base.emailRecipients,
    emailSubjectPrefix:      (params.email_subject_prefix as string)  || base.emailSubjectPrefix,
    whatsappRecipients:      (params.whatsapp_recipients as string[]) || base.whatsappRecipients,
    whatsappTemplateSid:     (params.whatsapp_template_sid as string) || base.whatsappTemplateSid,
    whatsappTemplateDelayMs: (params.whatsapp_template_delay_ms as number) || base.whatsappTemplateDelayMs,
  };

  return runDigest({ dry_run: dryRun, channels }, config, supabaseUrl, supabaseKey, connect, userId);
}
