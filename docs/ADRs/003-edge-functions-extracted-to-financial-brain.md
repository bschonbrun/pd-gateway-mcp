# ADR 003: Edge functions and schema extracted to financial-brain

**Status:** Accepted
**Date:** 2026-05-01
**Author:** Bill (retroactive — documented 2026-05-16)

## Context

This repo originally carried a `supabase/` directory: twelve edge functions
(`run`, `digest-card`, `nl-query`, `expense-query`, `slack-events`,
`sync-xero`, `sync-expensify`, and others), a schema migration, and a set of
deploy scripts. So the same repo held both the MCP gateway *and* the
Supabase backend.

That conflated two unrelated lifecycles. The MCP gateway is a long-running
local process behaving like an SDK. The edge functions are deployed
serverless backend code with their own schema, secrets, and cron jobs. A
contributor reading the repo could not tell where the gateway ended and the
backend began.

## Decision

Extract everything Supabase-backend into the `financial-brain` private repo
(later renamed `billbot`). This repo keeps **only** the MCP gateway and the
digest client code. The extraction is commit
`354b90f chore: supabase/ and supporting files extracted to financial-brain
private repo` — it removed all `supabase/functions/*`, the migration, and
the `deploy-*` scripts.

`billbot` now owns: all edge functions, the database schema and migrations,
and the deploy tooling for them.

## Alternatives considered

- **A: Keep everything in one repo.** Rejected — two lifecycles, two deploy
  targets, no clear boundary. A reader cannot reason about either half.
- **B: Three repos (gateway / functions / schema).** Rejected — the edge
  functions and the schema they depend on change together; splitting them
  adds cross-repo coordination with no benefit.
- **C (chosen):** Two repos along the real seam — `pd-gateway-mcp` for the
  gateway, `billbot` for the Supabase backend (functions + schema + deploy).

## Consequences

- **Positive:** Each repo has one deploy story. This one is "build + run as
  an MCP server"; `billbot` is "deploy edge functions."
- **Positive:** Schema lives in exactly one place (`billbot`) — consistent
  with the other CarboNet repos.
- **Negative:** The daily digest now spans two repos: the `run-digest` /
  `run` edge function lives in `billbot`, while this repo has its own
  digest client (`src/digest/`, the `run_daily_digest` MCP tool and the
  standalone cron runner). See ADR 004 for which one is authoritative.
- **Locked in:** This repo must not regrow a `supabase/functions/` directory.
  Backend code belongs in `billbot`.

## References
- Extraction commit `354b90f`.
- ADR 004 — the digest's single source of truth.
- `billbot` — edge functions + schema home.
