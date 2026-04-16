import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Slack Events API handler — v11: Increase thread context limits for follow-up formatting

const SLACK_BOT_TOKEN = Deno.env.get('SLACK_BOT_TOKEN')!;
const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ENGINE_TIMEOUT_MS = 90_000;
const BOT_NAME = 'BillBot';
const BOT_EMOJI = ':robot_face:';

const REVENUE_CHANNELS = new Set(
  (Deno.env.get('REVENUE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const FINANCE_CHANNELS = new Set(
  (Deno.env.get('FINANCE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const ALL_ALLOWED_CHANNELS = new Set([...REVENUE_CHANNELS, ...FINANCE_CHANNELS]);

const FEEDBACK_PATTERN = /^\s*(?:\/)?(wrong|learn|teach)[:\s]\s*/i;
const CLARIFICATION_PATTERN = /^\s*([A-Ca-c])\s*$/;

const recentEvents = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

function isDuplicate(eventId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of recentEvents) {
    if (now - ts > DEDUP_WINDOW_MS) recentEvents.delete(id);
  }
  if (recentEvents.has(eventId)) return true;
  recentEvents.set(eventId, now);
  return false;
}

type Engine = 'nl-query' | 'expense-query';

function resolveEngineByChannel(channelId: string): Engine {
  if (REVENUE_CHANNELS.has(channelId)) return 'nl-query';
  return 'expense-query';
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

// --- SIGNATURE VERIFICATION ---
async function verifySlackSignature(body: string, timestamp: string, signature: string): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}` === signature;
}

// --- CLARIFICATION PERSISTENCE ---

async function getPendingClarification(userId: string, threadTs: string): Promise<{ id: string; thread_ts: string; channel_id: string; original_question: string; options: unknown[]; context: unknown; clarification_type: string; engine: string } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pending_clarifications?user_id=eq.${encodeURIComponent(userId)}&thread_ts=eq.${encodeURIComponent(threadTs)}&resolved=eq.false&order=created_at.desc&limit=1`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function resolveClarification(id: string, option: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pending_clarifications?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ resolved: true, resolved_option: option }),
    });
  } catch { /* best-effort */ }
}

async function saveClarification(userId: string, channelId: string, threadTs: string, engine: string, data: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pending_clarifications`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, channel_id: channelId, thread_ts: threadTs, engine, ...data }),
    });
  } catch (e) { console.error('saveClarification failed:', e); }
}

async function getUserMode(userId: string): Promise<'normal' | 'training'> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/engine_mode?user_id=eq.${encodeURIComponent(userId)}&select=mode&limit=1`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return 'normal';
    const rows = await res.json();
    return (rows?.[0]?.mode as 'normal' | 'training') ?? 'normal';
  } catch { return 'normal'; }
}

// --- THREAD HISTORY ---
interface ThreadMessage { role: 'user' | 'assistant'; text: string }

async function fetchThreadHistory(channel: string, threadTs: string): Promise<{ isOurs: boolean; messages: ThreadMessage[] }> {
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=20`,
      { headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` } }
    );
    const data = await res.json();
    if (!data.ok || !data.messages?.length) return { isOurs: false, messages: [] };

    const isOurs = !!data.messages[0].bot_id;
    if (!isOurs) return { isOurs: false, messages: [] };

    const messages: ThreadMessage[] = [];
    for (const msg of data.messages.slice(1)) {
      if (!msg.text?.trim()) continue;
      const role: 'user' | 'assistant' = msg.bot_id ? 'assistant' : 'user';
      // Keep full bot messages (up to 3000 chars) so follow-up formatting has complete data
      const text = role === 'assistant' ? msg.text.substring(0, 3000) : msg.text;
      messages.push({ role, text });
    }

    return { isOurs, messages };
  } catch {
    return { isOurs: false, messages: [] };
  }
}

// --- SLACK API ---
async function postSlackMessage(
  channel: string,
  text: string,
  opts?: { thread_ts?: string; blocks?: unknown[]; username?: string; icon_emoji?: string }
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel,
      text,
      blocks: opts?.blocks,
      thread_ts: opts?.thread_ts,
      username: opts?.username ?? BOT_NAME,
      icon_emoji: opts?.icon_emoji ?? BOT_EMOJI,
    }),
  });
  return res.json();
}

async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string,
  opts?: { blocks?: unknown[] }
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, ts, text, blocks: opts?.blocks }),
  });
  return res.json();
}

// --- MAIN HANDLER ---
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const retryNum = req.headers.get('x-slack-retry-num');
  if (retryNum) {
    console.log(`Ignoring Slack retry #${retryNum}`);
    return new Response('ok', { status: 200 });
  }

  const body = await req.text();
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  const signature = req.headers.get('x-slack-signature') ?? '';

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(body); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  if (payload.type === 'url_verification') {
    return new Response(
      JSON.stringify({ challenge: payload.challenge }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  const valid = await verifySlackSignature(body, timestamp, signature);
  if (!valid) {
    console.error('Invalid Slack signature');
    return new Response('Invalid signature', { status: 401 });
  }

  if (payload.type === 'event_callback') {
    const event = payload.event as Record<string, unknown>;
    const eventId = (event?.client_msg_id as string) ?? `${event?.ts}`;

    if (
      event?.type === 'message' &&
      !event.bot_id &&
      !event.subtype &&
      event.thread_ts &&
      event.thread_ts !== event.ts &&
      ALL_ALLOWED_CHANNELS.has(event.channel as string) &&
      !isDuplicate(eventId)
    ) {
      (globalThis as any).EdgeRuntime?.waitUntil?.(handleThreadReply(event));
    }
  }

  return new Response('ok', { status: 200 });
});

async function handleThreadReply(event: Record<string, unknown>): Promise<void> {
  const channel = event.channel as string;
  const user = event.user as string;
  const text = event.text as string;
  const threadTs = event.thread_ts as string;

  if (!text?.trim()) return;

  // Fetch thread history — also verifies this is our thread
  const { isOurs, messages: threadHistory } = await fetchThreadHistory(channel, threadTs);
  if (!isOurs) return;

  const engine = resolveEngineByChannel(channel);
  const isFeedback = FEEDBACK_PATTERN.test(text);
  const clarificationMatch = text.match(CLARIFICATION_PATTERN);

  // -- CLARIFICATION RESOLUTION --
  if (clarificationMatch) {
    const option = clarificationMatch[1].toUpperCase();
    const pending = await getPendingClarification(user, threadTs);
    if (pending) {
      const thinkingMsg = await postSlackMessage(channel, `Processing option ${option}...`, { thread_ts: threadTs });
      const thinkingTs = thinkingMsg.ts;

      await resolveClarification(pending.id, option);

      const resolveEngine = (pending.engine as Engine) ?? engine;
      const mode = await getUserMode(user);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

        const res = await fetch(`${SUPABASE_URL}/functions/v1/${resolveEngine}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: pending.original_question,
            user_id: user,
            channel: `${channel}:thread_${threadTs}`,
            mode,
            resolution: { option, clarification_type: pending.clarification_type, options: pending.options, context: pending.context },
            slack_bot_token: SLACK_BOT_TOKEN,
            slack_thread_ts: threadTs,
            slack_channel: channel,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await res.json();

        // Handle chained clarification
        if (data.type === 'clarification') {
          await saveClarification(user, channel, threadTs, resolveEngine, {
            original_question: pending.original_question,
            clarification_type: data.clarification_type as string,
            options: data.options as unknown[],
            context: data.context as unknown,
          });
          const clarMsg = data.message as string;
          const blocks = [
            { type: 'section', text: { type: 'mrkdwn', text: clarMsg } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `${mode === 'training' ? '🎓 Training' : '🤖 Normal'} — reply with *A*, *B*, or *C*` }] },
          ];
          if (thinkingTs) await updateSlackMessage(channel, thinkingTs, clarMsg, { blocks });
          else await postSlackMessage(channel, clarMsg, { thread_ts: threadTs, blocks });
          return;
        }

        const answer = data.answer ?? 'Could not generate an answer after resolution.';
        const modelInfo = data.model_used ? ` · ${formatModelName(data.model_used)}` : '';
        const auditInfo = data.audited ? ' · ✅ Audited' : '';
        const meta = `${data.rows ?? 0} rows · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s${modelInfo}${auditInfo} · Resolved (${option})`;

        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: answer } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: meta }] },
        ];

        if (thinkingTs) await updateSlackMessage(channel, thinkingTs, answer, { blocks });
        else await postSlackMessage(channel, answer, { thread_ts: threadTs, blocks });
      } catch (err) {
        const error = err as Error;
        const userMessage = error.name === 'AbortError'
          ? '⏱️ That took too long. Try simplifying your question.'
          : `❌ ${error.message}`;
        if (thinkingTs) await updateSlackMessage(channel, thinkingTs, userMessage);
        else await postSlackMessage(channel, userMessage, { thread_ts: threadTs });
      }
      return;
    }
  }

  // -- REGULAR FOLLOW-UP or FEEDBACK --
  const thinkingText = isFeedback ? '📝 Processing your feedback…' : '🧠 Thinking…';
  const thinkingMsg = await postSlackMessage(channel, thinkingText, { thread_ts: threadTs });
  const thinkingTs = thinkingMsg.ts;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

    // Build thread context — pass full bot messages so reformat has all data
    const threadContext = threadHistory.length > 1
      ? threadHistory.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.text}`).join('\n')
      : undefined;

    const mode = await getUserMode(user);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${engine}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        user_id: user,
        channel: `${channel}:thread_${threadTs}`,
        slack_ts: threadTs,
        slack_channel: channel,
        slack_bot_token: SLACK_BOT_TOKEN,
        slack_thread_ts: threadTs,
        mode,
        ...(threadContext ? { thread_context: threadContext } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const bodyText = await res.text();
      let errorMsg = `Engine returned ${res.status}`;
      if (res.status === 504) {
        errorMsg = 'That question took too long to process. Try simplifying it.';
      } else if (bodyText) {
        try {
          const errData = JSON.parse(bodyText);
          errorMsg = errData.error || errorMsg;
        } catch { /* use default */ }
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();

    // Handle clarification response from engine
    if (data.type === 'clarification') {
      await saveClarification(user, channel, threadTs, engine, {
        original_question: text,
        clarification_type: data.clarification_type as string,
        options: data.options as unknown[],
        context: data.context as unknown,
      });
      const clarMsg = data.message as string;
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: clarMsg } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `${mode === 'training' ? '🎓 Training' : '🤖 Normal'} — reply with *A*, *B*, or *C*` }] },
      ];
      if (thinkingTs) await updateSlackMessage(channel, thinkingTs, clarMsg, { blocks });
      else await postSlackMessage(channel, clarMsg, { thread_ts: threadTs, blocks });
      return;
    }

    const meta = isFeedback
      ? `${((data.duration_ms ?? 0) / 1000).toFixed(1)}s`
      : `${data.rows ?? 0} row${data.rows === 1 ? '' : 's'} · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s${data.model_used ? ` · ${formatModelName(data.model_used)}` : ''}${data.audited ? ' · ✅ Audited' : ''}`;

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: data.answer } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: meta }] },
    ];

    if (thinkingTs) {
      await updateSlackMessage(channel, thinkingTs, data.answer, { blocks });
    } else {
      await postSlackMessage(channel, data.answer, { thread_ts: threadTs, blocks });
    }
  } catch (err) {
    const error = err as Error;
    console.error('Thread reply failed:', error.message);

    const userMessage = error.name === 'AbortError'
      ? '⏱️ That question took too long. Try breaking it into a simpler query.'
      : `❌ ${error.message}`;

    if (thinkingTs) {
      await updateSlackMessage(channel, thinkingTs, userMessage);
    } else {
      await postSlackMessage(channel, userMessage, { thread_ts: threadTs });
    }
  }
}
