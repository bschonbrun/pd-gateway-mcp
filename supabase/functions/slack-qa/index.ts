import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const REVENUE_CHANNELS = new Set(
  (Deno.env.get('REVENUE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const FINANCE_CHANNELS = new Set(
  (Deno.env.get('FINANCE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const ALL_ALLOWED_CHANNELS = new Set([...REVENUE_CHANNELS, ...FINANCE_CHANNELS]);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SLACK_BOT_TOKEN = Deno.env.get('SLACK_BOT_TOKEN')!;
const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET') ?? '';

// ─── ENGINE ROUTING ────────────────────────────────────────────────────────────
type Engine = 'nl-query' | 'expense-query';

const REVENUE_CMDS = new Set(['revenue', 'forecast']);
const FINANCE_CMDS = new Set(['finance', 'expense', 'spend', 'po', 'ap', 'ar', 'bills', 'costs']);

function resolveEngine(commandName: string, channelId: string): Engine | null {
  const cmd = commandName.replace('/', '').toLowerCase();
  if (REVENUE_CMDS.has(cmd)) return 'nl-query';
  if (FINANCE_CMDS.has(cmd)) return 'expense-query';
  if (FINANCE_CHANNELS.has(channelId)) return 'expense-query';
  if (REVENUE_CHANNELS.has(channelId)) return 'nl-query';
  return null;
}

function engineLabel(engine: Engine): string {
  return engine === 'nl-query' ? 'revenue' : 'finance';
}

function usageHint(commandName: string): string {
  const cmd = commandName || '/ask';
  const isFinance = FINANCE_CMDS.has(cmd.replace('/', ''));
  if (isFinance) {
    return `💡 Usage: \`${cmd} What did we spend on travel this month?\`\n\nExamples:\n• _Top vendors by spend this year_\n• _What bills are due this week?_\n• _Who has outstanding reimbursable expenses?_\n\nFeedback:\n• \`/teach [rule]\` — teach me a rule for better answers\n• \`/wrong [correction]\` — flag an incorrect answer\n• \`/learn [rule]\` — same as /teach`;
  }
  return `💡 Usage: \`${cmd} What is our MTD revenue?\`\n\nExamples:\n• _Top 5 customers this year_\n• _Are we ahead of target?_\n• _Current forecast vs actuals_`;
}

function formatModelName(modelId: string): string {
  if (modelId.includes('gemini-3.1-flash-lite')) return 'Gemini 3.1 Lite';
  if (modelId.includes('gemini-3-flash')) return 'Gemini 3 Flash';
  if (modelId.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (modelId.includes('gemini')) return 'Gemini';
  if (modelId.includes('sonnet')) return 'Sonnet 4.6';
  if (modelId.includes('haiku')) return 'Haiku 4.5';
  return modelId;
}

// ─── SLACK API HELPERS ─────────────────────────────────────────────────────────
async function slackPost(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const contentType = req.headers.get('content-type') ?? '';

  // ── JSON body (Event API: app_mention, message) ────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json();

    // Slack URL verification challenge
    if (body.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: body.challenge }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Event callback (app_mention in thread = follow-up)
    if (body.type === 'event_callback' && body.event) {
      const event = body.event;
      // Only handle app_mention or direct messages in threads
      if ((event.type === 'app_mention' || event.type === 'message') && event.thread_ts) {
        // Don't respond to bot's own messages
        if (event.bot_id || event.subtype === 'bot_message') {
          return new Response('OK', { status: 200 });
        }
        const followUp = (event.text as string ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
        const userId = event.user as string;
        const channelId = event.channel as string;
        const threadTs = event.thread_ts as string;

        if (followUp) {
          handleThreadFollowUp(followUp, userId, channelId, threadTs);
        }
        return new Response('OK', { status: 200 });
      }
      return new Response('OK', { status: 200 });
    }
  }

  // ── Interactive callback (button click) ──────────────────────────────────
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await req.formData();
    const payloadStr = formData.get('payload') as string | null;

    if (payloadStr) {
      return handleInteraction(JSON.parse(payloadStr));
    }

    // ── Slash command ──────────────────────────────────────────────────────
    return handleSlashCommand(formData);
  }

  return new Response('Unsupported', { status: 400 });
});

// ─── SLASH COMMAND ─────────────────────────────────────────────────────────────
async function handleSlashCommand(formData: FormData): Promise<Response> {
  const question = (formData.get('text') as string)?.trim();
  const userId = formData.get('user_id') as string;
  const channelId = formData.get('channel_id') as string;
  const commandName = (formData.get('command') as string) ?? '/ask';

  if (!ALL_ALLOWED_CHANNELS.has(channelId)) {
    return jsonResponse({ response_type: 'ephemeral', text: `🔒 \`${commandName}\` is only available in authorized channels.` });
  }

  const engine = resolveEngine(commandName, channelId);
  if (!engine) {
    return jsonResponse({
      response_type: 'ephemeral',
      text: `🤔 Not sure which data to query here. Try: \`/revenue\`, \`/forecast\`, \`/finance\`, \`/ap\`, \`/ar\`, or \`/po\``,
    });
  }

  if (!question) {
    return jsonResponse({ response_type: 'ephemeral', text: usageHint(commandName) });
  }

  // If question starts with train: or normal:, skip the picker — go direct
  const isTrainPrefix = /^train:/i.test(question);
  const isNormalPrefix = /^normal:/i.test(question);
  if (isTrainPrefix || isNormalPrefix) {
    const mode = isTrainPrefix ? 'training' : 'normal';
    const emoji = engine === 'nl-query' ? '💰' : '📊';
    processAndThread(question, userId, channelId, commandName, engine, mode);
    return jsonResponse({ response_type: 'ephemeral', text: `${emoji} Processing in ${mode} mode…` });
  }

  // Show mode picker buttons
  const emoji = engine === 'nl-query' ? '💰' : '📊';
  return jsonResponse({
    response_type: 'ephemeral',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `${emoji} *Choose a mode for your query:*\n\n> _${question}_` } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '⚡ Normal', emoji: true },
            style: 'primary',
            action_id: 'mode_normal',
            value: JSON.stringify({ question, channelId, commandName, engine }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🎓 Training', emoji: true },
            action_id: 'mode_training',
            value: JSON.stringify({ question, channelId, commandName, engine }),
          },
        ],
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_Training mode shows definitions, audit trails, and asks for your input on uncertain answers._' }],
      },
    ],
  });
}

// ─── BUTTON INTERACTION ────────────────────────────────────────────────────────
function handleInteraction(payload: Record<string, unknown>): Response {
  const actions = payload.actions as Array<Record<string, unknown>>;
  if (!actions?.length) return jsonResponse({ text: 'No action received.' });

  const action = actions[0];
  const actionId = action.action_id as string;
  const userId = ((payload.user as Record<string, unknown>)?.id as string) ?? 'unknown';
  const responseUrl = payload.response_url as string | undefined;

  // Mode picker buttons
  if (actionId.startsWith('mode_')) {
    const mode = actionId === 'mode_training' ? 'training' : 'normal';
    const { question, channelId, commandName, engine } = JSON.parse(action.value as string) as {
      question: string; channelId: string; commandName: string; engine: Engine;
    };
    processAndThread(question, userId, channelId, commandName, engine, mode);
    // Delete the ephemeral mode picker via response_url
    if (responseUrl) {
      fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete_original: true }) }).catch(() => {});
    }
    return jsonResponse({ delete_original: true });
  }

  // Intent confirmation buttons (from training mode intent classifier)
  if (actionId.startsWith('intent_confirm') || actionId.startsWith('intent_alt_')) {
    const { defIdx, question, channelId, threadTs, engine, mode } = JSON.parse(action.value as string) as {
      defIdx: number; question: string; channelId: string; threadTs: string; engine: Engine; mode: string;
    };
    // Re-call expense-query with the confirmed definition index
    callEngine(engine, question, userId, channelId, threadTs, mode, { confirmed_def_idx: defIdx });
    return jsonResponse({ text: '' });
  }
  if (actionId === 'intent_skip') {
    const { question, channelId, threadTs, engine, mode } = JSON.parse(action.value as string) as {
      question: string; channelId: string; threadTs: string; engine: Engine; mode: string;
    };
    // Re-call with skip flag to bypass intent classifier
    callEngine(engine, question, userId, channelId, threadTs, mode, { skip_intent: true });
    return jsonResponse({ text: '' });
  }

  // Drill-down buttons (definitions, interpretation, audit)
  if (actionId.startsWith('drilldown_')) {
    const command = actionId.replace('drilldown_', '');
    const { channelId, threadTs, engine } = JSON.parse(action.value as string) as {
      channelId: string; threadTs: string; engine: Engine;
    };
    handleDrilldown(command, userId, channelId, threadTs, engine);
    return jsonResponse({ response_type: 'ephemeral', text: `Loading ${command}…` });
  }

  return jsonResponse({ text: 'Unknown action.' });
}

// ─── DRILL-DOWN BUTTONS BUILDER ────────────────────────────────────────────────
function buildDrilldownButtons(
  channelId: string,
  threadTs: string,
  engine: Engine,
  meta: Record<string, unknown> | null,
): Record<string, unknown>[] {
  if (!meta) return [];
  const value = JSON.stringify({ channelId, threadTs, engine });
  const elements: Record<string, unknown>[] = [];

  if ((meta.definitions as unknown[])?.length) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: `📖 Definitions (${(meta.definitions as unknown[]).length})`, emoji: true },
      action_id: 'drilldown_definitions',
      value,
    });
  }
  if (meta.interpretation) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: '🤔 Interpretation', emoji: true },
      action_id: 'drilldown_interpretation',
      value,
    });
  }
  if ((meta.audit as Record<string, unknown>)?.ran) {
    const confPct = Math.round(((meta.audit as Record<string, unknown>).confidence as number ?? 0) * 100);
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: `🔬 Audit (${confPct}%)`, emoji: true },
      action_id: 'drilldown_audit',
      value,
    });

    // Add Resolve button when audit found issues
    const auditIssues = (meta.audit as Record<string, unknown>).issues as string;
    if (auditIssues && auditIssues !== 'none' && confPct <= 80) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🔧 Resolve', emoji: true },
        style: 'danger',
        action_id: 'drilldown_resolve',
        value,
      });
    }
  }
  return elements.length ? [{ type: 'actions', elements }] : [];
}

// ─── CALL ENGINE WITH EXTRA PARAMS (for intent confirmation) ───────────────────
async function callEngine(
  engine: Engine, question: string, userId: string, channelId: string,
  threadTs: string, mode: string, extra: Record<string, unknown>,
): Promise<void> {
  try {
    await slackPost('chat.postMessage', {
      channel: channelId, thread_ts: threadTs,
      text: `${engine === 'nl-query' ? '💰' : '📊'} Running confirmed query…`,
    });

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${engine}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question, user_id: userId, channel: channelId, mode,
        slack_bot_token: SLACK_BOT_TOKEN, slack_channel: channelId, slack_thread_ts: threadTs,
        ...extra,
      }),
    });

    const data = await res.json();
    if (!res.ok && !data.answer) throw new Error(data.error || `Engine returned ${res.status}`);

    const drilldownBlocks = mode === 'training'
      ? buildDrilldownButtons(channelId, threadTs, engine, data.transparency_meta ?? null)
      : [];

    const answerText = data.answer as string;
    const blocks: Record<string, unknown>[] = [
      { type: 'section', text: { type: 'mrkdwn', text: answerText.slice(0, 2900) } },
    ];
    if (drilldownBlocks.length) blocks.push(...drilldownBlocks);
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `via \`/${engineLabel(engine)}\` · ${(data.rows ?? '?')} rows · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s · ${data.model_used ?? 'unknown'}` }] });

    await slackPost('chat.postMessage', { channel: channelId, thread_ts: threadTs, blocks, text: answerText.slice(0, 200) });
  } catch (err) {
    await slackPost('chat.postMessage', { channel: channelId, thread_ts: threadTs, text: `❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }
}

// ─── THREAD FOLLOW-UP ──────────────────────────────────────────────────────────
async function handleThreadFollowUp(
  followUp: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  try {
    // Fetch thread history to find the original question and last bot answer
    const historyRes = await slackPost('conversations.replies', { channel: channelId, ts: threadTs, limit: 20 });
    const messages = (historyRes.messages ?? []) as Array<Record<string, unknown>>;

    // Find the original question (first message, usually "Q: ...")
    const parentMsg = messages[0];
    const originalQ = ((parentMsg?.text as string) ?? '').replace(/^Q:\s*/i, '').replace(/\s*\(.*\)\s*$/, '').trim();

    // Find the last bot answer (longest bot message, likely the data response)
    const botMessages = messages.filter(m => m.bot_id && !m.subtype && (m.text as string)?.length > 50);
    const lastBotAnswer = botMessages.length > 0
      ? (botMessages[botMessages.length - 1].text as string).slice(0, 2000)
      : '';

    // Post "thinking" message
    await slackPost('chat.postMessage', {
      channel: channelId, thread_ts: threadTs,
      text: '🔄 Processing your follow-up…',
    });

    // Call engine with thread context
    const res = await fetch(`${SUPABASE_URL}/functions/v1/expense-query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: followUp,
        user_id: userId,
        channel: channelId,
        mode: 'normal',
        slack_bot_token: SLACK_BOT_TOKEN,
        slack_channel: channelId,
        slack_thread_ts: threadTs,
        thread_context: `Q: ${originalQ}\nAnswer: ${lastBotAnswer}`,
      }),
    });

    const data = await res.json();
    const answerText = (data.answer as string) ?? 'No response from engine.';

    await slackPost('chat.postMessage', {
      channel: channelId, thread_ts: threadTs,
      text: answerText.slice(0, 3000),
    });
  } catch (err) {
    await slackPost('chat.postMessage', {
      channel: channelId, thread_ts: threadTs,
      text: `❌ Follow-up error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
}

// ─── PROCESS + THREAD ──────────────────────────────────────────────────────────
async function processAndThread(
  question: string,
  userId: string,
  channelId: string,
  commandName: string,
  engine: Engine,
  mode: 'normal' | 'training',
): Promise<void> {
  try {
    const modeIcon = mode === 'training' ? '🎓' : '⚡';
    const parentRes = await slackPost('chat.postMessage', {
      channel: channelId,
      text: `*Q:* _${question}_ (${modeIcon} ${mode})`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Q:* _${question}_` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Asked by <@${userId}> · ${modeIcon} ${mode} mode` }] },
      ],
    });

    const threadTs = (parentRes as Record<string, unknown>).ts as string;
    if (!threadTs) throw new Error('Failed to create thread — no ts returned from Slack');

    await slackPost('chat.postMessage', {
      channel: channelId,
      thread_ts: threadTs,
      text: `${engine === 'nl-query' ? '💰' : '📊'} Analyzing your ${engineLabel(engine)} data…`,
    });

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${engine}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        user_id: userId,
        channel: channelId,
        mode,
        slack_bot_token: SLACK_BOT_TOKEN,
        slack_channel: channelId,
        slack_thread_ts: threadTs,
      }),
    });

    const data = await res.json();
    if (!res.ok && !data.answer) throw new Error(data.error || `Engine returned ${res.status}`);

    const cmdDisplay = commandName !== '/ask' ? commandName : `/${engineLabel(engine)}`;

    // Build drill-down buttons for training mode
    const drilldownBlocks = mode === 'training'
      ? buildDrilldownButtons(channelId, threadTs, engine, data.transparency_meta ?? null)
      : [];

    // Slack section text limit = 3000 chars; truncate to ensure buttons render
    const MAX_BLOCK_TEXT = 2900;
    const answerText = data.answer as string;
    const answerBlocks: Record<string, unknown>[] = [];
    if (answerText.length <= MAX_BLOCK_TEXT) {
      answerBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: answerText } });
    } else {
      // Split into multiple section blocks at paragraph boundaries
      let remaining = answerText;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_BLOCK_TEXT) {
          answerBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: remaining } });
          break;
        }
        const chunk = remaining.substring(0, MAX_BLOCK_TEXT);
        const splitAt = chunk.lastIndexOf('\n\n');
        const boundary = splitAt > MAX_BLOCK_TEXT * 0.3 ? splitAt : chunk.lastIndexOf('\n');
        const cutAt = boundary > MAX_BLOCK_TEXT * 0.3 ? boundary : MAX_BLOCK_TEXT;
        answerBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: remaining.substring(0, cutAt) } });
        remaining = remaining.substring(cutAt).trimStart();
      }
    }

    const blocks: Record<string, unknown>[] = [
      ...answerBlocks,
      ...drilldownBlocks,
      { type: 'divider' },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `via \`${cmdDisplay}\` · ${data.rows ?? 0} row${data.rows === 1 ? '' : 's'} · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s${data.model_used ? ` · ${formatModelName(data.model_used)}` : ''}`,
        }],
      },
    ];

    await slackPost('chat.postMessage', {
      channel: channelId,
      thread_ts: threadTs,
      text: data.answer,
      blocks,
    });
  } catch (err) {
    await slackPost('chat.postMessage', {
      channel: channelId,
      text: `❌ Sorry, I couldn't answer that: ${(err as Error).message}`,
    });
  }
}

// ─── DRILL-DOWN HANDLER ────────────────────────────────────────────────────────
async function handleDrilldown(
  command: string,
  userId: string,
  channelId: string,
  threadTs: string,
  engine: Engine,
): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${engine}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `${command}:`,
        user_id: userId,
        channel: channelId,
        mode: 'training',
        slack_bot_token: SLACK_BOT_TOKEN,
        slack_channel: channelId,
        slack_thread_ts: threadTs,
      }),
    });

    const data = await res.json();
    await slackPost('chat.postMessage', {
      channel: channelId,
      thread_ts: threadTs,
      text: data.answer ?? 'No details available.',
    });
  } catch (err) {
    await slackPost('chat.postMessage', {
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ Error loading ${command}: ${(err as Error).message}`,
    });
  }
}

function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
