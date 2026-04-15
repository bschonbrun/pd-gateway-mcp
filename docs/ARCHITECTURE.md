# Architecture

## Problem

Pipedream's official `@pipedream/mcp` server exposes every app as its own tool set — 10,000+ tools total. Most AI platforms cap at 50-128 tools. This gateway collapses the entire surface into 23 curated tools.

## Design

```
┌─────────────────────────┐
│   MCP Host (AI Agent)   │
└───────────┬─────────────┘
            │ stdio (JSON-RPC)
┌───────────▼─────────────┐
│    pd-gateway-mcp       │
│                         │
│  ┌───────┐ ┌──────────┐ │
│  │ REST  │ │ Connect  │ │
│  │ Client│ │ Client   │ │
│  └───┬───┘ └────┬─────┘ │
└──────┼──────────┼───────┘
       │          │
  Pipedream    Pipedream
  REST API     Connect API
  (v1)         (OAuth2)
```

### Two APIs, One Gateway

| Layer | API | Auth | Purpose |
|-------|-----|------|---------|
| Workflows | REST API v1 | API Key (Bearer) | CRUD workflows, event history, webhook triggers |
| App Actions | Connect API | OAuth2 client_credentials | App/trigger discovery, action execution, trigger deployment |

## Tool Inventory (23 tools)

The tools follow a **discover → configure → execute → manage** pattern.

### Tier 1: Workflow Management (REST)

| Tool | Verb | Endpoint |
|------|------|----------|
| `pd_list_workflows` | GET | `/users/me/workflows` |
| `pd_get_workflow` | GET | `/workflows/{id}` |
| `pd_trigger_workflow` | POST | `{webhook_url}` |
| `pd_get_events` | GET | `/workflows/{id}/event_summaries` |

### Tier 2: App Actions (Connect)

| Tool | Verb | Endpoint |
|------|------|----------|
| `pd_list_apps` | GET | `/connect/{project}/components` |
| `pd_list_app_actions` | GET | `/connect/{project}/actions?app={slug}` |
| `pd_run_action` | POST | `/connect/{project}/actions/run` |

### Tier 3: Account Connection (Connect)

| Tool | Verb | Endpoint |
|------|------|----------|
| `pd_connect_account` | POST | `/connect/{project}/tokens` |
| `pd_list_accounts` | GET | `/connect/{project}/accounts` |

### Tier 4: Trigger & Component (Connect)

| Tool | Verb | Endpoint |
|------|------|----------|
| `pd_list_triggers` | GET | `/connect/{project}/triggers` |
| `pd_get_component` | GET | `/connect/{project}/components/{key}` |
| `pd_configure_prop` | POST | `/connect/{project}/components/configure` |
| `pd_deploy_trigger` | POST | `/connect/{project}/triggers/deploy` |
| `pd_list_deployed_triggers` | GET | `/connect/{project}/deployed-triggers` |
| `pd_delete_deployed_trigger` | DEL | `/connect/{project}/deployed-triggers/{id}` |
| `pd_update_trigger_workflows` | PUT | `/connect/{project}/deployed-triggers/{id}/workflows` |

### Tier 5: Direct Integrations

| Tool | Purpose |
|------|---------|
| `send_whatsapp` | Send WhatsApp messages via Twilio directly |
| `ask_claude` | Call Anthropic Claude API for reasoning/formatting tasks |
| `run_daily_digest` | Run the Acme Corp daily revenue digest (Slack + Email + WhatsApp) |
| `list_templates` | List available flow templates |
| `run_template` | Execute a flow template by ID |
| `deploy_template_workflow` | Deploy a template as a scheduled Pipedream cron workflow |
| `update_workflow_webhook` | Update the webhook URL of a deployed cron workflow |

## Auth Flow

### REST API
Direct API key in `Authorization: Bearer {key}` header. No token refresh needed.

### Connect API
OAuth2 client credentials flow with auto-refresh:

1. POST `/v1/oauth/token` with `client_id` + `client_secret`
2. Receive `access_token` with `expires_in` (seconds)
3. Cache token; refresh automatically 60s before expiry
4. All Connect requests include `X-PD-Environment: {PIPEDREAM_ENVIRONMENT}` header

The `PIPEDREAM_ENVIRONMENT` env var defaults to `development`. Set it to `production` for live deployments.

## Environment Variables

### Required

| Variable | Used By |
|----------|---------|
| `PIPEDREAM_API_KEY` | REST Client |
| `PIPEDREAM_CLIENT_ID` | Connect Client (OAuth) |
| `PIPEDREAM_CLIENT_SECRET` | Connect Client (OAuth) |
| `PIPEDREAM_PROJECT_ID` | Connect Client (path param) |

### Optional / Feature-specific

| Variable | Default | Used By |
|----------|---------|---------|
| `PIPEDREAM_ORG_ID` | — | REST Client (org-scoped requests) |
| `PIPEDREAM_EXTERNAL_USER_ID` | `pd-gateway-mcp` | Connect Client (user identity) |
| `PIPEDREAM_ENVIRONMENT` | `development` | Connect Client (`X-PD-Environment` header) |
| `SUPABASE_URL` | — | Digest data fetch |
| `SUPABASE_ANON_KEY` | — | Digest data fetch |
| `SLACK_AUTH_PROVISION_ID` | — | Digest Slack sender |
| `SLACK_DIGEST_CHANNEL` | — | Digest Slack channel ID |
| `OUTLOOK_AUTH_PROVISION_ID` | — | Digest email sender |
| `DIGEST_EMAIL_RECIPIENTS` | — | Comma-separated recipient list |
| `DIGEST_EMAIL_SUBJECT` | `Daily Revenue Tracker` | Email subject prefix |
| `TWILIO_ACCOUNT_SID` | — | WhatsApp via Twilio |
| `TWILIO_AUTH_TOKEN` | — | WhatsApp via Twilio |
| `TWILIO_WHATSAPP_FROM` | — | Twilio sender number (`whatsapp:+1...`) |
| `DIGEST_WHATSAPP_RECIPIENTS` | — | Comma-separated recipient numbers |
| `DIGEST_TEMPLATE_SID` | — | Twilio content template SID |
| `DIGEST_WA_DELAY_MS` | `15000` | Delay between template + freeform messages |
| `DIGEST_CHANNELS` | `slack,email,whatsapp` | Active channels for standalone cron |
| `DIGEST_DRY_RUN` | `false` | Preview mode for standalone cron |
| `DIGEST_WEBHOOK_URL` | — | Default webhook for `deploy_template_workflow` |
| `ANTHROPIC_API_KEY` | — | `ask_claude` tool |

All credential env vars default to `''` when unset. Operations that require a missing credential will return a clear error rather than silently using a fallback value.

## Fetch Timeouts

All outbound HTTP calls use `AbortSignal.timeout()` to prevent indefinite hangs:

| Destination | Timeout |
|-------------|---------|
| OAuth token exchange | 10s |
| Pipedream REST API | 30s |
| Pipedream Connect API | 60s |
| Supabase RPC | 30s |
| Twilio | 15s |
| Anthropic | 60s |
| Arbitrary webhooks | 30s |

## Key Workflows

### End-to-end trigger deployment
```
pd_list_apps → pd_list_triggers → pd_get_component → pd_configure_prop → pd_deploy_trigger
```

### Smart action execution
```
pd_list_app_actions → pd_get_component → pd_configure_prop → pd_run_action
```

### Trigger rewiring
```
pd_list_deployed_triggers → pd_update_trigger_workflows
```

### Cron workflow deployment
```
deploy_template_workflow → (get new URL) → update_workflow_webhook
```

## File Structure

```
src/
├── index.ts                  # MCP server + 23 tool registrations
├── config.ts                 # Shared env helpers, digest config builder, timeouts
├── types.ts                  # Shared TypeScript interfaces
├── clients/
│   ├── rest-api.ts           # Pipedream REST API v1 client
│   └── connect-api.ts        # Pipedream Connect API client (OAuth2, auto-refresh)
├── digest/
│   ├── index.ts              # Digest orchestration (fetch → format → send)
│   ├── data.ts               # Supabase RPC data fetcher
│   ├── formatters.ts         # Slack / Email / WhatsApp formatters + htmlEscape
│   ├── senders.ts            # Pipedream action runners + Twilio sender
│   └── cron.ts               # Standalone cron entry point (no MCP dependency)
├── engine/
│   ├── template-loader.ts    # JSON template parser, validator, resolveVars/resolveParams
│   └── template-executor.ts  # Template execution router
├── deployer/
│   └── workflow-deployer.ts  # Cron workflow creation & webhook updates
└── __tests__/
    └── formatters.test.ts    # Unit tests for pure formatting functions
```

## Security Notes

- **No hardcoded credentials**: all auth values come from environment variables; missing values produce clear errors.
- **Code injection prevention**: `webhookUrl` and `templateId` are `JSON.stringify`-encoded before interpolation into generated Pipedream workflow code.
- **HTML injection prevention**: all data-sourced strings are passed through `htmlEscape()` before insertion into email HTML.
- **URL validation**: `pd_trigger_workflow`, `pd_deploy_trigger`, `deploy_template_workflow`, and `update_workflow_webhook` all validate webhook URLs with Zod's `.url()`.
- **Configurable environment**: `X-PD-Environment` reads from `PIPEDREAM_ENVIRONMENT` (default `development`) instead of being hardcoded.
