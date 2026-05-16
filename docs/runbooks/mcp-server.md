# Runbook: pd-gateway-mcp server won't start or a tool errors

Last updated: 2026-05-16
Severity: medium

The deployed component is the MCP server itself — `dist/index.js`, run by an
MCP host (Claude Desktop, Claude Code, etc.) over stdio. It is a long-running
local process, not a hosted service.

## Symptom

One of:
- The MCP host shows `pipedream-gateway` as failed / disconnected.
- A `pd_*` tool call returns `Error: Missing env var: ...`.
- A Connect-API tool returns a 401 / token error.
- A tool call hangs, then returns a timeout error.

## Diagnosis

```bash
# Build is current? (host runs dist/, not src/)
npm run build

# Run the server by hand to see startup errors:
node dist/index.js
# A healthy server waits silently on stdio. An env error prints immediately.

# Confirm the host points at an absolute path to dist/index.js
# and passes the required env vars (see the MCP config).
```

What to look for:
- `Missing env var: X` on startup → a **required** var is unset. The four
  required vars are `PIPEDREAM_API_KEY`, `PIPEDREAM_CLIENT_ID`,
  `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`.
- 401 from a Connect tool → bad/expired `PIPEDREAM_CLIENT_ID` or
  `_CLIENT_SECRET`, or the OAuth token failed to refresh.
- 401 from a REST tool → bad `PIPEDREAM_API_KEY`.
- Wrong environment (acting on dev resources in prod, or vice versa) →
  `PIPEDREAM_ENVIRONMENT` is wrong; it defaults to `development`.
- A hang → the destination is slow; every fetch has an `AbortSignal.timeout`
  (see `TIMEOUTS` in `src/config.ts`), so a true hang means the timeout
  constant is too high, not that the call is stuck forever.

## Fix

### Immediate

1. **Missing env var** — add it to the MCP host config (or `.env` for local
   runs) and restart the host. Required vars are the four above; the rest are
   feature-specific (digest, Twilio, Anthropic).
2. **Stale build** — `npm run build`, then restart the host. The host runs
   `dist/`; editing `src/` alone changes nothing until you rebuild.
3. **401** — verify the credential against
   [pipedream.com/settings](https://pipedream.com/settings). Connect uses the
   OAuth client ID + secret; REST uses the API key. They are different
   credentials.

### Full recovery

1. `cp .env.example .env` and fill every required var if `.env` was lost.
2. `npm install && npm run build`.
3. `node dist/index.js` — confirm it starts clean.
4. Restart the MCP host and confirm `pipedream-gateway` connects.

## Prevention

- The host runs `dist/`. After any `src/` change, `npm run build` before
  expecting new behaviour.
- Keep `.env` complete even for vars you are not using today — a clear value
  beats a confusing `Missing env var` later.
- `.env` is gitignored. Never commit it; never paste a credential into a
  tracked file (CLAUDE.md, a script, a doc).

## Related

- ADR 002 — the two-API auth model (why there are four required vars).
- `docs/ARCHITECTURE.md` — full env var table and timeout constants.
- `docs/runbooks/daily-digest.md` — digest-specific failures.
