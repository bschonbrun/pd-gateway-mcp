import { fetchDigestData } from './data.js';
import { formatSlack, formatEmail, formatWhatsApp, fmtShort } from './formatters.js';
import { sendSlack, sendEmail, sendWhatsApp, type SenderConfig } from './senders.js';

export type DigestChannel = 'slack' | 'email' | 'whatsapp';

export interface DigestOptions {
  dry_run?: boolean;
  channels?: DigestChannel[];
}

export interface DigestResult {
  sent: boolean;
  channels: DigestChannel[];
  summary: { ytd: string; forecast: string };
  results?: Record<string, unknown>;
  // dry_run only:
  slackText?: string;
  emailBody?: string;
  whatsAppText?: string;
  recipients?: string[];
  data?: unknown;
}

type ConnectRunner = (action: string, props: Record<string, unknown>, userId: string) => Promise<unknown>;

export async function runDigest(
  options: DigestOptions,
  config: SenderConfig,
  supabaseUrl: string,
  supabaseKey: string,
  connect: ConnectRunner,
  userId: string,
): Promise<DigestResult> {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');

  const channels = options.channels ?? ['slack', 'email'];
  const d = await fetchDigestData(supabaseUrl, supabaseKey);

  const slackText = formatSlack(d);
  const emailBody = formatEmail(d);
  const whatsAppText = formatWhatsApp(d);

  if (options.dry_run) {
    return { sent: false, channels, summary: { ytd: fmtShort(d.ytd.actual), forecast: fmtShort(d.ytd.forecast) }, slackText, emailBody, whatsAppText, recipients: config.emailRecipients, data: d };
  }

  const results: Record<string, unknown> = {};

  if (channels.includes('slack')) {
    try {
      results.slack = await sendSlack(slackText, config, connect, userId);
    } catch (e) {
      results.slack_error = e instanceof Error ? e.message : String(e);
    }
  }

  if (channels.includes('email')) {
    try {
      results.email = await sendEmail(emailBody, d.report_date, config, connect, userId);
    } catch (e) {
      results.email_error = e instanceof Error ? e.message : String(e);
    }
  }

  if (channels.includes('whatsapp')) {
    try {
      results.whatsapp = await sendWhatsApp(d, whatsAppText, config);
    } catch (e) {
      results.whatsapp_error = e instanceof Error ? e.message : String(e);
    }
  }

  return { sent: true, channels, summary: { ytd: fmtShort(d.ytd.actual), forecast: fmtShort(d.ytd.forecast) }, results };
}
