# pd-gateway-mcp

Lightweight MCP gateway for Pipedream — workflow management + 10,000 app actions through 7 tools.

## Why?

Pipedream's official MCP exposes 10,000+ tools. Most AI platforms have tool-count limits. This gateway wraps everything behind 7 curated tools.

## Tools

| Tool | Description |
|---|---|
| `pd_list_workflows` | List all workflows in workspace |
| `pd_get_workflow` | Get workflow details |
| `pd_trigger_workflow` | Trigger a workflow via webhook |
| `pd_get_events` | View execution history |
| `pd_list_apps` | Search available apps (3,000+) |
| `pd_list_app_actions` | List actions for a specific app |
| `pd_run_action` | Execute any app action |

## Setup

1. Clone and install:
```bash
git clone https://github.com/bschonbrun/pd-gateway-mcp.git
cd pd-gateway-mcp
npm install
npm run build
```

2. Copy `.env.example` to `.env` and fill in credentials:
```bash
cp .env.example .env
```

3. Add to your MCP config:
```json
{
  "mcpServers": {
    "pipedream-gateway": {
      "command": "node",
      "args": ["path/to/pd-gateway-mcp/dist/index.js"],
      "env": {
        "PIPEDREAM_API_KEY": "your-api-key",
        "PIPEDREAM_CLIENT_ID": "your-client-id",
        "PIPEDREAM_CLIENT_SECRET": "your-client-secret",
        "PIPEDREAM_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design decisions, API surface documentation, and tiering strategy.

## License

MIT
