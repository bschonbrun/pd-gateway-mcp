# Data flow — pd-gateway-mcp

This repo is an integration gateway. It owns **no database tables** and runs
**no migrations**. It reads Supabase via one RPC for the digest, and otherwise
brokers calls to external APIs (Pipedream, Twilio, Anthropic).

## Diagram

```
        ┌────────────────────┐
        │  MCP Host (agent)  │
        └─────────┬──────────┘
                  │ stdio (JSON-RPC), 23 tools
        ┌─────────▼──────────┐
        │   pd-gateway-mcp   │
        │   dist/index.js    │
        └──┬──────┬──────┬───┘
           │      │      │
   ┌───────┘      │      └────────────┐
   ▼              ▼                   ▼
┌─────────┐  ┌──────────┐      ┌──────────────┐
│Pipedream│  │ Twilio   │      │ Anthropic    │
│REST +   │  │ WhatsApp │      │ Messages API │
│Connect  │  │ (send_   │      │ (ask_claude) │
│APIs     │  │ whatsapp)│      └──────────────┘
└─────────┘  └──────────┘

  Digest path (run_daily_digest tool / src/digest/cron.ts — manual use):

  pd-gateway-mcp ──read──> Supabase RPC  digest_full()  (project iykqsdiochxtfrtmuzdr)
                 ──send──> Slack + Outlook (via Pipedream Connect) + Twilio WhatsApp

  Scheduled digest (NOT this repo): run-digest edge function in billbot,
  triggered by pg_cron — see ADR 004.
```

## Tables this repo writes

None. This repo issues no SQL and runs no migrations. All schema lives in
`billbot` (ADR 003).

## Tables / data this repo reads

- **`digest_full()`** — a Supabase PostgreSQL RPC, called by the digest client
  (`src/digest/data.ts`) over the Supabase REST endpoint using
  `SUPABASE_ANON_KEY`. It aggregates sales, forecast, and target data. This
  repo reads its JSON result; it does not read the underlying tables directly.

## External services this repo calls

| Service | Via | Used by |
|---|---|---|
| Pipedream REST API v1 | `PipedreamRestClient`, API key | workflow CRUD, events |
| Pipedream Connect API | `PipedreamConnectClient`, OAuth2 | app discovery, action run, triggers, Slack + Outlook digest sends |
| Twilio | direct REST | `send_whatsapp`, WhatsApp digest channel |
| Anthropic Messages API | direct REST | `ask_claude` tool |
| Supabase | REST + RPC | `digest_full()` data fetch only |

## Repo family

| Repo | Relationship |
|---|---|
| `billbot` | Owns the Supabase schema, edge functions (incl. `run-digest`), and migrations. The scheduled digest runs here. |
| `daily-finance-sync` | Writes the ingestion tables `digest_full()` ultimately aggregates. |
| `daily-revenue-report` | Sibling reporting pipeline over the same Supabase project. |
| **`pd-gateway-mcp`** | **This repo.** Integration gateway + manual digest client. Owns no schema. |

## Cross-repo note

The daily digest deliberately spans two repos: the authoritative scheduled
send is `billbot`'s edge function; this repo's digest client is a manual /
dry-run path. The data both consume — `digest_full()` and the
`revenue_benchmarks` targets — is owned by `billbot`. See ADR 004.
