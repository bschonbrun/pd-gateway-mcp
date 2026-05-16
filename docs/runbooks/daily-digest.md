# Runbook: Daily revenue digest didn't send / sent wrong

Last updated: 2026-05-16
Severity: high

The daily revenue digest reports revenue to the team over Slack, Email, and
WhatsApp. The **scheduled** send is the `run-digest` edge function on Supabase,
triggered by `pg_cron` (see ADR 004). The edge function source lives in
`billbot` (ADR 003). This repo holds a manual-use digest client only.

## Key facts

| Thing | Value |
|---|---|
| Supabase project | `iykqsdiochxtfrtmuzdr` |
| Scheduled sender | `run-digest` edge function (source in `billbot`) |
| Schedule | `pg_cron` jobs 5 & 6 — daily 8 AM PT (15:00 UTC) |
| Data source | `digest_full()` PostgreSQL RPC |
| Targets | `revenue_benchmarks` table, `benchmark_type = 'goal'` ($27M annual) |
| Email recipients | `OUTLOOK_RECIPIENTS` Supabase secret (comma-separated) |
| WhatsApp recipients | `DEFAULT_WA_RECIPIENTS` array, hardcoded in `run-digest` |
| Slack channel | `C0872NV9H43` (#orders) via Pipedream Connect |

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---|---|---|
| Digest not sent | `digest_full()` RPC errored | Check for a missing table/column the RPC references |
| Blank email | A legacy Pipedream digest workflow fired | Find and disable it — never re-enable (ADR 004) |
| Wrong target number | `benchmark_type` mismatch | Must be `'goal'` ($27M), not `'budget'` ($25M) |
| 500 from `run-digest` | A Supabase secret is missing/expired | Check secrets via the Management API |
| Cron not firing | The `pg_cron` job is inactive | `SELECT active FROM cron.job WHERE jobid = 5;` |
| Duplicate sends | More than one digest path is live | Confirm only the edge function schedules; ADR 004 |

## Diagnosis

```sql
-- Cron jobs and their state
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

-- Recent cron run history
SELECT jobid, status, return_message, start_time
FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- Edge function smoke test — should return ~27010153
SELECT (digest_full()->'ytd'->>'target')::numeric AS target;
```

## Fix

### Manually trigger the digest

```bash
# Full send (all channels)
curl -X POST https://iykqsdiochxtfrtmuzdr.supabase.co/functions/v1/run-digest \
  -H 'Content-Type: application/json' -d '{}'

# Dry run — compute data, send nothing
curl -X POST https://iykqsdiochxtfrtmuzdr.supabase.co/functions/v1/run-digest \
  -H 'Content-Type: application/json' \
  -d '{"skip_slack": true, "skip_email": true, "skip_whatsapp": true}'

# Email only
curl -X POST https://iykqsdiochxtfrtmuzdr.supabase.co/functions/v1/run-digest \
  -H 'Content-Type: application/json' \
  -d '{"skip_slack": true, "skip_whatsapp": true}'
```

You can also dry-run from this repo's manual client:

```bash
DIGEST_DRY_RUN=true node dist/digest/cron.js
```

### Update email recipients

Recipients are the `OUTLOOK_RECIPIENTS` Supabase secret. Supabase **redacts
secret values on read** — you cannot read-then-append. You must supply the
**full** comma-separated list every time.

```bash
# Token: a Supabase management token (sbp_...) from
# https://supabase.com/dashboard/account/tokens — keep it in your shell env,
# never inline it into a file.
curl -X POST https://api.supabase.com/v1/projects/iykqsdiochxtfrtmuzdr/secrets \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"OUTLOOK_RECIPIENTS","value":"user1@carbonet.com,user2@carbonet.com"}]'
```

### Wrong target number

The digest target must come from `revenue_benchmarks` where
`benchmark_type = 'goal'` ($27M, Permian + Industrial — the number the team
uses). `'budget'` is the $25M conservative baseline and must not appear in the
digest. There is no `forecast_targets` table — do not reach for one.

## Prevention

- Only the `run-digest` edge function schedules the digest. If you find a
  Pipedream workflow sending it, that is the bug — disable the workflow.
- When rotating any digest credential, update the Supabase secret with the
  full value; redaction-on-read means partial updates silently drop data.

## Related

- ADR 003 — why the edge function lives in `billbot`.
- ADR 004 — the digest's single source of truth; legacy workflows disabled.
- `docs/runbooks/mcp-server.md` — gateway server failures.
