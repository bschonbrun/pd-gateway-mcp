import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── CHANNEL CONFIG ────────────────────────────────────────────────────────────
// Add channel IDs to REVENUE_CHANNELS or EXPENSE_CHANNELS env vars (comma-separated)
const REVENUE_CHANNELS = new Set(
  (Deno.env.get('REVENUE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const EXPENSE_CHANNELS = new Set(
  (Deno.env.get('FINANCE_CHANNELS') ?? '').split(',').filter(Boolean)
);
const ALL_ALLOWED_CHANNELS = new Set([...REVENUE_CHANNELS, ...EXPENSE_CHANNELS]);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// ─── COMMAND → ENGINE ROUTING ──────────────────────────────────────────────────
// Add new commands here as new data domains are added
type Engine = 'nl-query' | 'expense-query';

const REVENUE_CMDS = new Set(['revenue', 'forecast']);
const EXPENSE_CMDS = new Set(['expense', 'spend', 'po', 'ap', 'ar', 'bills', 'costs']);

function resolveEngine(commandName: string, channelId: string): Engine | null {
  const cmd = commandName.replace('/', '').toLowerCase();
  if (REVENUE_CMDS.has(cmd)) return 'nl-query';
  if (EXPENSE_CMDS.has(cmd)) return 'expense-query';
  // /ask: resolve explicitly by channel membership
  if (EXPENSE_CHANNELS.has(channelId)) return 'expense-query';
  if (REVENUE_CHANNELS.has(channelId)) return 'nl-query';
  return null; // channel known but domain ambiguous — prompt user
}

function engineLabel(engine: Engine): string {
  return engine === 'nl-query' ? 'revenue' : 'expense';
}

function thinkingMessage(engine: Engine): string {
  const emoji = engine === 'nl-query' ? '💰' : '🧾';
  return `${emoji} Analyzing your ${engineLabel(engine)} data…`;
}

function usageHint(commandName: string): string {
  const cmd = commandName || '/ask';
  const isExpense = EXPENSE_CMDS.has(cmd.replace('/', ''));
  if (isExpense) {
    return `💡 Usage: \`${cmd} What did we spend on travel this month?\`\n\nExamples:\n• _Top vendors by spend this year_\n• _What bills are due this week?_\n• _Who has outstanding reimbursable expenses?_`;
  }
  return `💡 Usage: \`${cmd} What is our MTD revenue?\`\n\nExamples:\n• _Top 5 customers this year_\n• _Are we ahead of target?_\n• _Current forecast vs actuals_`;
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
      text: `🤔 Not sure which data to query here. Try a specific command: \`/revenue\`, \`/forecast\`, \`/expense\`, \`/ap\`, \`/ar\`, or \`/po\``,
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
              text: `Asked by <@${userId}> via \`${cmdDisplay}\` · ${data.rows ?? 0} row${data.rows === 1 ? '' : 's'} · ${((data.duration_ms ?? 0) / 1000).toFixed(1)}s`,
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
