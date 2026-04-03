# Architecture

## Problem

Pipedream's official `@pipedream/mcp` server exposes every app as its own tool set — 10,000+ tools total. Most AI platforms cap at 50-128 tools. This gateway collapses the entire surface into 16.

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

## Tool Inventory (16 tools)

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
| `pd_run_action` | POST | `/connect/{project}/actions/{key}/run` |

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

## Auth Flow

### REST API
Direct API key in `Authorization: Bearer {key}` header. No token refresh needed.

### Connect API
OAuth2 client credentials flow with auto-refresh:

1. POST `/v1/oauth/token` with `client_id` + `client_secret`
2. Receive `access_token` with `expires_in` (seconds)
3. Cache token, refresh 60s before expiry
4. All Connect requests include `X-PD-Environment: development` header

## Environment Variables

| Variable | Required | Used By |
|----------|----------|---------|
| `PIPEDREAM_API_KEY` | Yes | REST Client |
| `PIPEDREAM_CLIENT_ID` | Yes | Connect Client (OAuth) |
| `PIPEDREAM_CLIENT_SECRET` | Yes | Connect Client (OAuth) |
| `PIPEDREAM_PROJECT_ID` | Yes | Connect Client (path param) |
| `PIPEDREAM_EXTERNAL_USER_ID` | No | Connect Client (user identity) |

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

## File Structure

```
src/
├── index.ts              # MCP server + 16 tool registrations
├── types.ts              # Shared TypeScript interfaces
└── clients/
    ├── rest-api.ts       # Pipedream REST API v1 client
    └── connect-api.ts    # Pipedream Connect API client (OAuth2)
```
