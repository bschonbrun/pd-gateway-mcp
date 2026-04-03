# Pipedream Gateway MCP — Architecture & Design Decisions

## Why This Exists

Pipedream's official MCP server exposes all 10,000+ app tools directly, making it unusable for AI platforms with tool-count limits (e.g., Antigravity's 100-tool cap). This gateway wraps Pipedream's REST and Connect APIs behind ~7 curated MCP tools.

## Gateway vs. Direct MCP — When to Use What

| Factor | Direct MCP | Via pd-gateway |
|---|---|---|
| **Tool slots** | 10-20 per app | 0 (shared `pd_run_action`) |
| **Parameter validation** | Full schema, typed | Generic props object |
| **Complex queries** | Filters, batch, associations | Limited to pre-built actions |
| **Latency** | Direct API call | gateway → Pipedream → API |
| **Auth** | Per-server credentials | Single Pipedream credential |

### Recommended Tiering

| Tier | When | Examples |
|---|---|---|
| **Direct MCP** | Heavy daily use, complex queries | HubSpot, Supabase |
| **Gateway** | Light/occasional, simple CRUD | Glide, Slack, Notion, Perplexity |

### Specific App Decisions

| App | Approach | Rationale |
|---|---|---|
| **HubSpot** | Keep direct MCP | Complex filters, batch reads, associations — Pipedream actions can't match |
| **Supabase** | Keep direct MCP | DDL, migrations, raw SQL — critical for development |
| **Glide** | Gateway | Simple CRUD (5 actions verified) |
| **Perplexity** | Gateway | 6 actions via Pipedream > 3 via direct MCP, zero slots |
| **Notion** | Gateway | Saves 18 tool slots, Pipedream has full CRUD actions |
| **Slack** | Gateway | One-off messages, not worth dedicated MCP |

## Pipedream Has TWO Separate APIs

### 1. REST API v1 (Workflow Management)
- **Auth:** API Key as Bearer token
- **Base URL:** `https://api.pipedream.com/v1/`
- **Purpose:** List/inspect/trigger workflows, view execution history
- **Key endpoints:**
  - `GET /users/me/workflows` — list workflows
  - `GET /workflows/{id}` — workflow details
  - `GET /workflows/{id}/event_summaries` — execution history
  - `POST {webhook_url}` — trigger via HTTP

### 2. Connect API (App Action Execution)
- **Auth:** OAuth2 client credentials (auto-refresh, expires 1hr)
- **Base URL:** `https://api.pipedream.com/v1/connect/{project_id}/`
- **Purpose:** Discover and execute any app action (Glide, Slack, etc.)
- **Key endpoints:**
  - `GET /actions?app={slug}` — list actions for an app
  - `POST /actions/{key}/run` — execute an action
  - `GET /components?q={query}` — search available apps
- **Requires header:** `X-PD-Environment: development`

### OAuth Token Flow
```
POST https://api.pipedream.com/v1/oauth/token
{
  "grant_type": "client_credentials",
  "client_id": "...",
  "client_secret": "..."
}
→ { "access_token": "...", "expires_in": 3600 }
```
Token expires after 1 hour — gateway must auto-refresh.

## Verified App Actions via Connect API

### Glide (5 actions)
```
glide-add-rows      | Add Rows to Table
glide-get-rows      | Get Rows
glide-list-tables   | List Big Tables
glide-update-row    | Update Row
glide-delete-row    | Delete Row
```

### Perplexity (6 actions)
```
chat-completions           | Basic chat completion
chat-completions-advanced  | Advanced chat with full params
create-response            | Create response (newer API)
search                     | Web search
create-embeddings          | Text embeddings
create-contextualized-embeddings | Context-aware embeddings
```

## Account Details

- **Org ID:** `o_g0I1q4k`
- **Project:** `proj_jBsgrRD` ("Manufacturing Dashboard")
- **Credentials:** See `.env` file (gitignored)

## Tool Surface (7 tools)

### Workflow Management (REST API)
1. `pd_list_workflows` — List all workflows
2. `pd_get_workflow` — Get workflow details
3. `pd_trigger_workflow` — Trigger via webhook
4. `pd_get_events` — Execution history

### App Actions (Connect API)
5. `pd_list_apps` — Search available apps
6. `pd_list_app_actions` — List actions for an app
7. `pd_run_action` — Execute any action (the "1 tool = 10k actions" gateway)
