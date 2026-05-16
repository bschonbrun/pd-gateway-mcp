# ADR 004: The daily digest has one source of truth — the run-digest edge function

**Status:** Accepted
**Date:** 2026-04-17
**Author:** Bill (retroactive — documented 2026-05-16)

## Context

The CarboNet daily revenue digest (revenue report to the team over Slack,
Email, and WhatsApp) has been buildable several ways over its history:

- Legacy **Pipedream workflows** that assembled and sent the digest.
- The **`run-digest` edge function** on Supabase, triggered by `pg_cron`.
- This repo's **`run_daily_digest` MCP tool** and **standalone cron runner**
  (`src/digest/`).

When more than one of these is live, the team gets duplicate sends, or a
blank email from a half-configured legacy workflow firing alongside the real
one. The failure is visible and embarrassing — it lands in the team channel.

## Decision

The **`run-digest` edge function on Supabase**, scheduled by `pg_cron`, is the
single source of truth for the *scheduled* daily digest. (The edge function
itself lives in `billbot` — see ADR 003.)

All legacy Pipedream digest workflows are **disabled** and must stay disabled.

This repo's `run_daily_digest` MCP tool and `src/digest/cron.ts` runner are
kept deliberately, but only as **manual / on-demand** paths — an operator
running the digest by hand, or a dry run to preview output. They are not
wired to any schedule. The scheduled send is the edge function, full stop.

## Alternatives considered

- **A: Schedule the digest from a Pipedream workflow.** Rejected — that was
  the legacy setup; it produced duplicate and blank sends.
- **B: Schedule it from this repo's cron runner.** Rejected — would require
  this repo to be a deployed, always-on scheduled job. It is an MCP server
  (an on-demand SDK-like process), not a cron host.
- **C (chosen):** One scheduled path — the edge function on `pg_cron`. Every
  other digest path is manual-only.

## Consequences

- **Positive:** Exactly one thing sends the scheduled digest. No duplicates,
  no blank-email races.
- **Positive:** The MCP tool / cron runner stay available for manual runs and
  dry-run previews without competing with the schedule.
- **Negative:** The digest logic exists in two places — the edge function in
  `billbot` and `src/digest/` here. They can drift. Mitigation: this repo's
  copy is manual-use only; the edge function is authoritative for anything
  the team actually receives.
- **Locked in:** Never re-enable a legacy Pipedream digest workflow. If a
  digest investigation finds a Pipedream workflow sending, disabling it is
  the fix — see `docs/runbooks/daily-digest.md`.

## References
- ADR 003 — why the edge function lives in `billbot`, not here.
- `docs/runbooks/daily-digest.md` — digest troubleshooting.
- `src/digest/` — this repo's manual-use digest client.
