import type { DigestData } from './data.js';
import { fmtShort } from './formatters.js';

export interface SenderConfig {
  slackAuthProvisionId: string;
  outlookAuthProvisionId: string;
  slackChannelId: string;
  emailRecipients: string[];
  emailSubjectPrefix: string;
  whatsappRecipients: string[];
  whatsappTemplateSid: string;
  whatsappTemplateDelayMs: number;
  twilioSid: string;
  twilioToken: string;
  twilioWaFrom: string;
}

type ConnectRunner = (action: string, props: Record<string, unknown>, userId: string) => Promise<unknown>;

export async function sendSlack(
  text: string,
  config: Pick<SenderConfig, 'slackAuthProvisionId' | 'slackChannelId'>,
  connect: ConnectRunner,
  userId: string,
): Promise<unknown> {
  return connect('slack-send-message', {
    slack: { authProvisionId: config.slackAuthProvisionId },
    conversation: config.slackChannelId,
    text,
    mrkdwn: true,
    include_sent_via_pipedream_flag: false,
    customizeBotSettings: true,
    username: 'BillSuite',
    icon_emoji: ':bar_chart:',
  }, userId);
}

export async function sendEmail(
  body: string,
  reportDate: string,
  config: Pick<SenderConfig, 'outlookAuthProvisionId' | 'emailRecipients' | 'emailSubjectPrefix'>,
  connect: ConnectRunner,
  userId: string,
): Promise<unknown> {
  return connect('microsoft_outlook-send-email', {
    microsoftOutlook: { authProvisionId: config.outlookAuthProvisionId },
    recipients: config.emailRecipients,
    subject: `${config.emailSubjectPrefix} — ${reportDate}`,
    contentType: 'html',
    content: body,
  }, userId);
}

export async function sendWhatsApp(
  d: DigestData,
  freeformBody: string,
  config: Pick<SenderConfig, 'whatsappRecipients' | 'whatsappTemplateSid' | 'whatsappTemplateDelayMs' | 'twilioSid' | 'twilioToken' | 'twilioWaFrom'>,
): Promise<Array<{ to: string; template: string; detail: string }>> {
  const currentMonth = d.months.find(m => m.is_current) || d.months[0];
  const s = fmtShort;
  const contentVars = JSON.stringify({
    '1': currentMonth?.actual ? s(currentMonth.actual) : '—',
    '2': s(currentMonth?.forecast || 0),
  });
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
  const results: Array<{ to: string; template: string; detail: string }> = [];

  for (const recipient of config.whatsappRecipients) {
    const waTo = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient.trim()}`;

    const tplParams = new URLSearchParams({
      To: waTo, From: config.twilioWaFrom,
      ContentSid: config.whatsappTemplateSid, ContentVariables: contentVars,
    });
    const tplRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tplParams.toString(),
    });
    const tplData = await tplRes.json() as Record<string, unknown>;
    if (!tplRes.ok) {
      results.push({ to: recipient, template: 'failed', detail: String(tplData['message'] || tplRes.status) });
      continue;
    }

    await new Promise(r => setTimeout(r, config.whatsappTemplateDelayMs));

    const freeParams = new URLSearchParams({ To: waTo, From: config.twilioWaFrom, Body: freeformBody });
    const freeRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: freeParams.toString(),
    });
    const freeData = await freeRes.json() as Record<string, unknown>;
    results.push({
      to: recipient,
      template: String(tplData['sid']),
      detail: freeRes.ok ? String(freeData['sid']) : `follow-up failed: ${freeData['message']}`,
    });
  }

  return results;
}
