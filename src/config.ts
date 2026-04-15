/**
 * Shared configuration helpers.
 *
 * Env vars are read at call time so this module can be imported by both
 * the long-running MCP server and the standalone cron runner without
 * capturing stale values at import time.
 */

/** Read a required env var; throw clearly if absent. */
export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

/** Read an optional env var with a safe empty-string default. */
export function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

/**
 * Build the digest SenderConfig from environment variables.
 * All fields default to '' when unset; callers that need a specific field
 * (e.g. Twilio creds for WhatsApp) will receive a clear API error if the
 * value is missing rather than silently using a hardcoded fallback.
 */
export function buildDigestConfig() {
  return {
    slackAuthProvisionId:    optionalEnv('SLACK_AUTH_PROVISION_ID'),
    outlookAuthProvisionId:  optionalEnv('OUTLOOK_AUTH_PROVISION_ID'),
    slackChannelId:          optionalEnv('SLACK_DIGEST_CHANNEL'),
    emailRecipients:         optionalEnv('DIGEST_EMAIL_RECIPIENTS').split(',').filter(Boolean),
    emailSubjectPrefix:      optionalEnv('DIGEST_EMAIL_SUBJECT', 'Daily Revenue Tracker'),
    whatsappRecipients:      optionalEnv('DIGEST_WHATSAPP_RECIPIENTS').split(',').filter(Boolean),
    whatsappTemplateSid:     optionalEnv('DIGEST_TEMPLATE_SID'),
    whatsappTemplateDelayMs: Number(optionalEnv('DIGEST_WA_DELAY_MS', '15000')),
    twilioSid:               optionalEnv('TWILIO_ACCOUNT_SID'),
    twilioToken:             optionalEnv('TWILIO_AUTH_TOKEN'),
    twilioWaFrom:            optionalEnv('TWILIO_WHATSAPP_FROM'),
  };
}

/**
 * The Pipedream Connect environment header value.
 * Set PIPEDREAM_ENVIRONMENT=production in production deployments.
 * Defaults to 'development' to preserve existing behaviour.
 */
export const PD_ENVIRONMENT = process.env['PIPEDREAM_ENVIRONMENT'] ?? 'development';

/**
 * Fetch timeout constants (milliseconds).
 * All outbound fetch() calls should pass one of these as AbortSignal.timeout(ms).
 */
export const TIMEOUTS = {
  /** OAuth token exchange */
  authToken:  10_000,
  /** Pipedream REST API (workflow CRUD, event history) */
  restApi:    30_000,
  /** Pipedream Connect API (app/action discovery, trigger deployment) */
  connectApi: 60_000,
  /** Supabase RPC data queries */
  supabase:   30_000,
  /** Twilio messaging API */
  twilio:     15_000,
  /** Anthropic messages API */
  anthropic:  60_000,
  /** Arbitrary webhook POSTs (pd_trigger_workflow, cron step) */
  webhook:    30_000,
} as const;
