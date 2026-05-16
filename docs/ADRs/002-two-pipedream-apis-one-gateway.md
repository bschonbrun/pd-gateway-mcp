# ADR 002: Two Pipedream APIs behind one gateway

**Status:** Accepted
**Date:** 2026-04-12
**Author:** Bill (retroactive — documented 2026-05-16)

## Context

Pipedream's surface is split across two APIs with different auth models:

- **REST API v1** — workflow CRUD, event history, webhook triggers.
  Authenticates with a static API key (`Authorization: Bearer {key}`).
- **Connect API** — app/trigger discovery, action execution, account
  connection, trigger deployment. Authenticates with an OAuth2
  client-credentials flow that issues short-lived access tokens.

Every gateway tool needs one or the other. The gateway has to present a
single coherent MCP server despite the underlying split.

## Decision

Keep both APIs, behind two internal clients, exposed as one MCP server:

- `src/clients/rest-api.ts` — `PipedreamRestClient`, static-key auth.
- `src/clients/connect-api.ts` — `PipedreamConnectClient`, OAuth2 client
  credentials with **automatic token refresh** (caches the token, refreshes
  60s before expiry, so a run does one token exchange, not one per call).

Tools are documented in tiers by which API they hit (see `ARCHITECTURE.md`),
but the MCP host sees one flat tool list.

## Alternatives considered

- **A: REST API only.** Rejected — the REST API cannot do app/action
  discovery or trigger deployment. Half the gateway's value is Connect-only.
- **B: Connect API only.** Rejected — workflow CRUD and event history are
  REST-only.
- **C (chosen):** Both, each in its own client, unified at the tool layer.
  The auth difference is contained inside the two client classes; tool code
  does not know or care which API backs it.

## Consequences

- **Positive:** Full Pipedream surface reachable from one server.
- **Positive:** OAuth refresh is isolated in one client — token-expiry bugs
  have exactly one place to live.
- **Negative:** Two auth mechanisms means more env vars
  (`PIPEDREAM_API_KEY` for REST; `PIPEDREAM_CLIENT_ID` + `_CLIENT_SECRET` +
  `_PROJECT_ID` for Connect). All four are required.
- **Locked in:** Connect requests carry an `X-PD-Environment` header from
  `PIPEDREAM_ENVIRONMENT` (default `development`). Production deployments must
  set it to `production` or they silently act on dev resources.

## References
- `docs/ARCHITECTURE.md` — Auth Flow section.
- `src/clients/rest-api.ts`, `src/clients/connect-api.ts`.
