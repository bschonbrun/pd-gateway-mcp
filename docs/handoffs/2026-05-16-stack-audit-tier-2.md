# Handoff — stack audit at tier 2

_Written: 2026-05-16. Session 9 of the retroactive audit pass._

## What this session did

Brought `pd-gateway-mcp` onto the Claude Code Stack at **tier 2** — the second
repo in the retroactive audit pass.

Added:
- `.claude/stack-config.json` — tier 2, `domain_mode: null`,
  `sensitivity: sensitive` (the repo's `.env` holds live Pipedream / Twilio /
  Anthropic credentials).
- `docs/ADRs/001..004` — retroactive ADRs (all status Accepted):
  - 001 — 23 curated tools, not Pipedream's 10,000+.
  - 002 — two Pipedream APIs (REST + Connect) behind one gateway.
  - 003 — edge functions + schema extracted to `financial-brain` / `billbot`.
  - 004 — the daily digest's single source of truth (`run-digest` edge fn).
- `docs/runbooks/mcp-server.md` — gateway server failures.
- `docs/runbooks/daily-digest.md` — digest didn't send / sent wrong.
- `docs/ONBOARDING.md` — successor walkthrough.
- `docs/architecture/data-flow.md` — gateway repo; owns no tables.
- Slimmed `CLAUDE.md` (112 → 95 lines) to the stack template.

No code changed — docs/config only.

## SECURITY — token found and scrubbed

`CLAUDE.md` had a **live Supabase management token** (`sbp_8f71...`) inline in
an "update recipients" curl example.

- It was **never committed** — `CLAUDE.md` was untracked, and `git log -S`
  finds the token nowhere in history. `.env` is correctly gitignored.
- It was scrubbed this session: the runbook and CLAUDE.md now use
  `$SUPABASE_ACCESS_TOKEN`.
- **Bill chose option (c):** scrub now, rotate on his own schedule. The token
  should still be treated as exposed (it sat in a plaintext file) and
  **rotated** at https://supabase.com/dashboard/account/tokens.

## Open threads / gotchas

- **Deferred — `ask_claude` cost_log instrumentation (audit Step 8).** The
  `ask_claude` tool (`src/index.ts`) calls the Anthropic API directly. The
  audit flow says LLM-calling code should log to the `cost_log` table. That is
  a code change to a deployed MCP server — left as a separate planned task,
  not bundled into this docs-only PR.
- **README is stale.** Its tool tables list only 16 tools (the Pipedream
  ones) and omit the 7 Tier-5 direct-integration tools (`send_whatsapp`,
  `ask_claude`, `run_daily_digest`, `list_templates`, `run_template`,
  `deploy_template_workflow`, `update_workflow_webhook`). Actual count is 23,
  per `ARCHITECTURE.md` and the code. Not fixed here — flagged for a follow-up.
- `ARCHITECTURE.md` calls the digest the "Acme Corp daily revenue digest" —
  placeholder text; should read CarboNet. Cosmetic, not fixed here.
- Foreman dispatch verification (audit Step 10) not exercised live.

## Next

Session 10: audit `daily-revenue-report` at tier 3 (next in `AUDIT-PASS.md`).
One repo per session.
