# pd-gateway-mcp

Lightweight MCP server for Pipedream — full automation lifecycle through 16 tools instead of 10,000+.

## Why?

Pipedream's official MCP exposes every app as its own tool set — 10,000+ tools total. Most AI platforms cap at 50-128 tools. This gateway collapses the entire Pipedream surface into **16 curated tools** covering workflow management, app action execution, trigger deployment, and lifecycle management.

## Tools

### Workflow Management (REST API)

| Tool | Description |
|------|-------------|
| `pd_list_workflows` | List all workflows in workspace |
| `pd_get_workflow` | Get workflow details (steps, triggers, config) |
| `pd_trigger_workflow` | Trigger a workflow via webhook |
| `pd_get_events` | View execution history for debugging |

### App Actions (Connect API)

| Tool | Description |
|------|-------------|
| `pd_list_apps` | Search available apps (3,000+) |
| `pd_list_app_actions` | List actions for a specific app |
| `pd_run_action` | Execute any app action |

### Account Connection

| Tool | Description |
|------|-------------|
| `pd_connect_account` | Generate OAuth link to connect an app |
| `pd_list_accounts` | List connected app accounts |

### Triggers & Components

| Tool | Description |
|------|-------------|
| `pd_list_triggers` | Search trigger components by app |
| `pd_get_component` | Get full prop schema for any action or trigger |
| `pd_configure_prop` | Fetch live dropdown options (channels, spreadsheets, pipelines, etc.) |
| `pd_deploy_trigger` | Deploy a trigger, optionally wire to a workflow |
| `pd_list_deployed_triggers` | List all active triggers |
| `pd_delete_deployed_trigger` | Remove a deployed trigger |
| `pd_update_trigger_workflows` | Rewire which workflows receive trigger events |

## Key Workflows

**Build automation end-to-end:**
```
pd_list_apps → pd_list_triggers → pd_get_component → pd_configure_prop → pd_deploy_trigger
```

**Smart action execution:**
```
pd_list_app_actions → pd_get_component → pd_configure_prop → pd_run_action
```

## Setup

### 1. Clone and install

```bash
git clone https://github.com/bschonbrun/pd-gateway-mcp.git
cd pd-gateway-mcp
npm install
npm run build
```

### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env with your Pipedream credentials
```

You'll need:
- **API Key** — [pipedream.com/settings](https://pipedream.com/settings) → API Key
- **Client ID & Secret** — [pipedream.com/settings](https://pipedream.com/settings) → OAuth Credentials (for Connect API)
- **Project ID** — [pipedream.com/projects](https://pipedream.com/projects) → starts with `proj_`

### 3. Add to your MCP config

```json
{
  "mcpServers": {
    "pipedream-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/pd-gateway-mcp/dist/index.js"],
      "env": {
        "PIPEDREAM_API_KEY": "your-api-key",
        "PIPEDREAM_CLIENT_ID": "your-client-id",
        "PIPEDREAM_CLIENT_SECRET": "your-client-secret",
        "PIPEDREAM_PROJECT_ID": "proj_xxxxx",
        "PIPEDREAM_EXTERNAL_USER_ID": "optional-user-id"
      }
    }
  }
}
```

## Architecture

Two Pipedream APIs, one gateway:

| Layer | API | Auth |
|-------|-----|------|
| Workflows | REST API v1 | API Key (Bearer) |
| Everything else | Connect API | OAuth2 client credentials (auto-refresh) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design decisions and endpoint mapping.

## License

MIT
