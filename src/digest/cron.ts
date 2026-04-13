/**
 * Standalone cron entry point — no MCP dependency.
 * Can be triggered by: node dist/digest/cron.js
 *                      Supabase pg_cron → edge function
 *                      Pipedream 1-step workflow
 *                      GitHub Actions cron
 *                      macOS launchd
 */
import { runDigest, type DigestChannel } from './index.js';
import type { SenderConfig } from './senders.js';

const config: SenderConfig = {
  slackAuthProvisionId:     process.env['SLACK_AUTH_PROVISION_ID']    || 'apn_P8hEEEa',
  outlookAuthProvisionId:   process.env['OUTLOOK_AUTH_PROVISION_ID']  || 'apn_Xeh00n7',
  slackChannelId:           process.env['SLACK_DIGEST_CHANNEL']       || 'C0872NV9H43',
  emailRecipients:         (process.env['DIGEST_EMAIL_RECIPIENTS']    || 'user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com,user@acme.com').split(','),
  emailSubjectPrefix:       process.env['DIGEST_EMAIL_SUBJECT']       || 'Daily Revenue Tracker',
  whatsappRecipients:      (process.env['DIGEST_WHATSAPP_RECIPIENTS'] || '+16047830407').split(','),
  whatsappTemplateSid:      process.env['DIGEST_TEMPLATE_SID']        || 'HX6f733603e2f8ffb785fcf131f872565a',
  whatsappTemplateDelayMs:  Number(process.env['DIGEST_WA_DELAY_MS']) || 15_000,
  twilioSid:                process.env['TWILIO_ACCOUNT_SID']         || '',
  twilioToken:              process.env['TWILIO_AUTH_TOKEN']           || '',
  twilioWaFrom:             process.env['TWILIO_WA_FROM']              || '',
};

const channels = (process.env['DIGEST_CHANNELS'] || 'slack,email,whatsapp').split(',') as DigestChannel[];
const dry_run  = process.env['DIGEST_DRY_RUN'] === 'true';

// Minimal Pipedream Connect shim — uses same env vars as the MCP server
async function connectRunner(action: string, props: Record<string, unknown>): Promise<unknown> {
  const PD_CLIENT_ID     = process.env['PIPEDREAM_CLIENT_ID'] || '';
  const PD_CLIENT_SECRET = process.env['PIPEDREAM_CLIENT_SECRET'] || '';
  const PD_PROJECT_ID    = process.env['PIPEDREAM_PROJECT_ID'] || '';
  const DEFAULT_USER     = process.env['PIPEDREAM_EXTERNAL_USER_ID'] || 'cron-runner';

  // Token exchange
  const tokenRes = await fetch('https://api.pipedream.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: PD_CLIENT_ID, client_secret: PD_CLIENT_SECRET }),
  });
  const { access_token } = await tokenRes.json() as { access_token: string };

  const runRes = await fetch(`https://api.pipedream.com/v1/connect/${PD_PROJECT_ID}/actions/${action}/run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'X-PD-Environment': 'development',
    },
    body: JSON.stringify({ external_user_id: DEFAULT_USER, props }),
  });
  if (!runRes.ok) throw new Error(`Pipedream action ${action} failed: ${await runRes.text()}`);
  return runRes.json();
}

const supabaseUrl = process.env['SUPABASE_URL'] || '';
const supabaseKey = process.env['SUPABASE_ANON_KEY'] || '';

runDigest({ dry_run, channels }, config, supabaseUrl, supabaseKey, connectRunner as never, 'cron-runner')
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Digest failed:', err);
    process.exit(1);
  });
