# Onboarding — pd-gateway-mcp

For a new contributor (or me, after a long break).

## In order

### 1. Read these (20 min)
- `README.md` — what the gateway is and the tool list.
- `CLAUDE.md` — how the AI assistant works here + operational facts.
- `docs/ARCHITECTURE.md` — the design: two Pipedream APIs, 23 tools, auth
  flows, env vars, timeouts.

### 2. Set up your environment (30 min)
- Node.js 20+ and npm.
- ```bash
  npm install
  npm run build      # compiles src/ → dist/ via tsc
  ```
- Credentials: `cp .env.example .env`, then fill it in. The four **required**
  vars are the Pipedream ones:
  - `PIPEDREAM_API_KEY` — pipedream.com/settings → API Key
  - `PIPEDREAM_CLIENT_ID` + `PIPEDREAM_CLIENT_SECRET` — pipedream.com/settings
    → OAuth Credentials
  - `PIPEDREAM_PROJECT_ID` — pipedream.com/projects (starts with `proj_`)
  - The rest (`SUPABASE_*`, `TWILIO_*`, `ANTHROPIC_API_KEY`, `DIGEST_*`) are
    feature-specific — needed only for the digest, WhatsApp, or `ask_claude`.
- `.env` is gitignored. Never commit it. Never paste a credential into a
  tracked file.
- Verify: `node dist/index.js` should start and wait silently on stdio. An
  env error prints immediately.

### 3. Run something (10 min)
- Run the test suite: `npm test` (builds, then runs `node --test`).
- Add the server to an MCP host (see README's MCP-config block) and call
  `pd_list_workflows` — it should return your Pipedream workspace.
- Preview the digest without sending: `DIGEST_DRY_RUN=true node dist/digest/cron.js`.

### 4. Look at recent changes (20 min)
- `git log --oneline -30`
- `gh pr list --state merged --limit 10`
- `docs/handoffs/` — session handoff docs.

### 5. Understand the decisions (30 min)
- `docs/ADRs/` — read all four:
  - 001 — why 23 curated tools, not Pipedream's 10,000+.
  - 002 — the two-API (REST + Connect) design.
  - 003 — why edge functions + schema were extracted to `billbot`.
  - 004 — the daily digest's single source of truth.

### 6. Know where to look when things break
- `docs/runbooks/mcp-server.md` — server won't start, tool errors.
- `docs/runbooks/daily-digest.md` — digest didn't send / sent wrong.

## Project-specific quirks

- **The host runs `dist/`, not `src/`.** Every `src/` change needs
  `npm run build` before it takes effect. The single most common "why didn't
  my change work" cause.
- **This repo is the gateway only.** Edge functions, the database schema, and
  their deploy tooling live in `billbot` (ADR 003). Do not recreate a
  `supabase/functions/` directory here.
- **The digest spans two repos.** The *scheduled* digest is the `run-digest`
  edge function in `billbot`. This repo's `run_daily_digest` tool and
  `src/digest/cron.ts` are manual-use only (ADR 004).
- **`PIPEDREAM_EXTERNAL_USER_ID`** is an identity key for the Connect API. It
  defaults to `pd-gateway-mcp`. Changing it changes which connected accounts
  the gateway sees — see the warning in `CLAUDE.md`.
- **Two Pipedream credentials, not one.** REST API uses an API key; Connect
  uses an OAuth client ID + secret. They are different things from the same
  settings page.

## Who to ask

Ask Bill. If Bill is unreachable, the ARCHITECTURE doc + ADRs + runbooks
cover the design and every known failure mode.

## When you're ready to make a change

1. This repo is on the Claude Code Stack at **tier 2** — see
   `.claude/stack-config.json`.
2. Use `/plan` for anything beyond a trivial fix; the foreman dispatches
   review for tier 2.
3. After editing `src/`, always `npm run build` and `npm test`.
4. A PR includes the code change, a test, and any ADR/runbook update the
   change implies.
