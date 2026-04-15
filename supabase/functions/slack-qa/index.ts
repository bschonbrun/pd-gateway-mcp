import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── CHANNEL CONFIG ────────────────────────────────────────────────────────────
const REVENUE_CHANNELS = new Set(
  (Deno.env.get('REVENUE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const FINANCE_CHANNELS = new Set(
  (Deno.env.get('FINANCE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const ALL_ALLOWED_CHANNELS = new Set([...REVENUE_CHANNELS, ...FINANCE_CHANNELS]);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// ─── COMMAND → ENGINE ROUTING ──────────────────────────────────────────────────
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

function thinkingMessage(engine: Engine): string {
  const emoji = engine === 'nl-query' ? '💰' : '📊';
  return `${emoji} Analyzing your ${engineLabel(engine)} data…`;
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

Deno.serve(async (req: Request) => {
  const formData    = await req.formData();
  const question    = (formData.get('text') as string)?.trim();
  const responseUrl = formData.get('response_url') as string;
  const userId      = formData.get('user_id') as string;
  const channelId   = formData.get('channel_id') as string;
  const commandName = (formData.get('command') as string) ?? '/ask';

  if (!ALL_ALLOWED_CHANNELS.has(channelId)) {
    return jsonResponse({
      response_type: 'ephemeral',
      text: `🔒 \`${commandName}\` is only available in authorized channels.`,
    });
  }

  const engine = resolveEngine(commandName, channelId);
  if (!engine) {
    return jsonResponse({
      response_type: 'ephemeral',
      text: `🤔 Not sure which data to query here. Try a specific command: \`/revenue\`, \`/forecast\`, \`/finance\`, \`/ap\`, \`/ar\`, or \`/po\``,
    });
  }

  if (!question) {
    return jsonResponse({ response_type: 'ephemeral', text: usageHint(commandName) });
  }

  // Fire async — Slack requires a response within 3 seconds
  processQuestion(question, responseUrl, userId, channelId, commandName, engine);

  return jsonResponse({ response_type: 'ephemeral', text: thinkingMessage(engine) });
});

async function processQuestion(
  question: string,
  responseUrl: string,
  userId: string,
  channelId: string,
  commandName: string,
  engine: Engine
): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${engine}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, user_id: userId, channel: channelId }),
    });

    const data = await res.json();
    if (!res.ok && !data.answer) throw new Error(data.error || `Engine returned ${res.status}`);

    const cmdDisplay = commandName !== '/ask' ? commandName : `/${engineLabel(engine)}`;

    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*Q:* _${question}_` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: data.answer } },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `Asked by <@${userId}> via \`${cmdDisplay}\` · ${data.rows ?? 0} row${data.rows === 1 ? '' : 's'} · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s${data.model_used ? ` · ${formatModelName(data.model_used)}` : ''}`,
            }],
          },
        ],
        text: data.answer,
      }),
    });
  } catch (err) {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `❌ Sorry, I couldn't answer that: ${(err as Error).message}`,
      }),
    });
  }
}

function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
