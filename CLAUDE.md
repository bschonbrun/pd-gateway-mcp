# PD Gateway MCP — Agent Guide

## Overview

The **Pipedream Gateway MCP server** for CarboNet. It collapses Pipedream's
10,000+-tool surface into 23 curated MCP tools (Slack, Outlook, WhatsApp,
workflow orchestration) and also carries a manual-use client for the daily
revenue digest.

## Stack tier

Tier: 2
See `.claude/stack-config.json` for active subagents and overrides.

## Tech stack

TypeScript, compiled with `tsc` to `dist/`. One runtime dependency
(`@modelcontextprotocol/sdk`). Node.js 20+.

## ⚠️ Operational facts (the AI can't infer these from code)

### Infrastructure access

- All credentials come from environment variables — `.env` locally, the MCP
  host config when run by a host. `.env` is gitignored.
- Four **required** Pipedream vars: `PIPEDREAM_API_KEY` (REST),
  `PIPEDREAM_CLIENT_ID` + `PIPEDREAM_CLIENT_SECRET` + `PIPEDREAM_PROJECT_ID`
  (Connect OAuth). REST and Connect are two different credentials — see
  ADR 002.
- Feature vars (`SUPABASE_*`, `TWILIO_*`, `ANTHROPIC_API_KEY`, `DIGEST_*`)
  are needed only for the digest, WhatsApp, and `ask_claude`.

### Build / run

- The MCP host runs **`dist/index.js`**, not `src/`. After any `src/` change
  you must `npm run build` or nothing changes. This is the most common
  "my change didn't take" cause.
- `node dist/index.js` starts the server (waits silently on stdio).
  `npm test` builds + runs the unit tests.

### Past-failure warnings

- **Never inline a credential into a tracked or untracked file.** During the
  2026-05-16 stack audit a live Supabase management token (`sbp_...`) was
  found hardcoded in this file's "update recipients" example. It was never
  committed, but it sat exposed on disk. Credentials belong in `.env` or the
  host config only; docs use `$ENV_VAR` placeholders.
- **Never re-enable a legacy Pipedream digest workflow.** They cause duplicate
  or blank digest sends. The scheduled digest is the `run-digest` edge
  function only (ADR 004).

### Domain mode

None. Integration/infra repo — no financial calculations, no schema, no
edge-function deploys (those live in `billbot`).

## Key IDs

| Resource | ID |
|---|---|
| Supabase project | `iykqsdiochxtfrtmuzdr` |
| Pipedream project | `proj_jBsgrRD` |
| Slack channel (#orders) | `C0872NV9H43` |
| Slack account (Pipedream) | `apn_P8hEEEa` |
| Outlook auth provision | `apn_Xeh00n7` |
| WhatsApp template SID | `HX3070313cf08cae360a51e3d636619a05` |

## Repo family

| Repo | Purpose |
|---|---|
| `billbot` | Edge functions (incl. `run-digest`) + Supabase schema + migrations |
| `daily-finance-sync` | Nightly Xero + Expensify ingestion |
| `daily-revenue-report` | Daily revenue digest pipeline |
| **this repo** | Pipedream gateway MCP server + manual digest client |

## Related ADRs

- `docs/ADRs/001-curated-gateway-not-full-pipedream-mcp.md` — 23 tools, not
  10,000+.
- `docs/ADRs/002-two-pipedream-apis-one-gateway.md` — REST + Connect design.
- `docs/ADRs/003-edge-functions-extracted-to-financial-brain.md` — why the
  backend lives in `billbot`.
- `docs/ADRs/004-run-digest-single-source-of-truth.md` — the digest's one
  scheduled sender.

## Related runbooks

- `docs/runbooks/mcp-server.md` — server won't start, tool errors.
- `docs/runbooks/daily-digest.md` — digest didn't send / sent wrong
  (cron checks, manual trigger, updating recipients).

## Onboarding

New here? See `docs/ONBOARDING.md` first.
