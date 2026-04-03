# pd-gateway-mcp: The Case for a Pipedream Gateway

## What It Is

**pd-gateway-mcp** is an open-source MCP (Model Context Protocol) server that gives AI agents programmatic access to Pipedream's entire automation platform — 3,000+ app integrations, trigger deployment, and workflow orchestration — through just 16 tools.

It's a drop-in replacement for Pipedream's official MCP server that solves a fundamental problem: **Pipedream exposes 10,000+ tools. AI platforms support 50-128. You need a gateway.**

---

## The Problem

Pipedream is one of the most powerful integration platforms available. It connects to 3,000+ apps (Slack, HubSpot, Google Sheets, Notion, Stripe, etc.) with pre-built actions and triggers you can compose into workflows. Their official MCP server, `@pipedream/mcp`, exposes all of this to AI agents.

The catch? It does so by registering **every app action as a separate tool**. Search contacts in HubSpot? That's a tool. Create a contact? Another tool. Update a deal? Another one. Across 3,000 apps, you're looking at 10,000+ tools.

Most AI platforms have hard limits:

| Platform | Tool Limit |
|----------|-----------|
| Claude (Anthropic) | ~128 tools |
| Gemini (Google) | ~100 tools |
| GPT-4 (OpenAI) | ~128 tools |
| Most MCP hosts | 50-200 tools |

Even if your platform could handle 10,000 tools, the AI model's performance degrades significantly with large tool sets. Every tool goes into the context window. More tools = more tokens burned on schema descriptions = less room for actual reasoning.

**The result**: You either give your AI agent access to a fraction of Pipedream's power, or you let the tool count explode and watch performance crater.

---

## The Solution: A Gateway Pattern

pd-gateway-mcp takes a different approach. Instead of one tool per action, it uses a **discover → configure → execute** pattern:

```
Step 1: "What apps are available?"          → pd_list_apps
Step 2: "What can I do with HubSpot?"       → pd_list_app_actions
Step 3: "What props does this action need?" → pd_get_component
Step 4: "What are the valid values?"        → pd_configure_prop
Step 5: "Execute it."                       → pd_run_action
```

Five tool calls replace 500+ tools. The AI agent discovers capabilities at runtime rather than having every possible action pre-registered.

### Tool Inventory

| # | Tool | Purpose |
|---|------|---------|
| 1 | `pd_list_workflows` | List all workflows in workspace |
| 2 | `pd_get_workflow` | Get workflow details |
| 3 | `pd_trigger_workflow` | Fire a webhook trigger |
| 4 | `pd_get_events` | View execution history |
| 5 | `pd_list_apps` | Search 3,000+ apps |
| 6 | `pd_list_app_actions` | List actions for an app |
| 7 | `pd_run_action` | Execute any action |
| 8 | `pd_connect_account` | OAuth link for app auth |
| 9 | `pd_list_accounts` | Check connected accounts |
| 10 | `pd_list_triggers` | Find trigger components |
| 11 | `pd_get_component` | Full prop schema |
| 12 | `pd_configure_prop` | Live dropdown options |
| 13 | `pd_deploy_trigger` | Deploy a trigger |
| 14 | `pd_list_deployed_triggers` | List active triggers |
| 15 | `pd_delete_deployed_trigger` | Remove a trigger |
| 16 | `pd_update_trigger_workflows` | Rewire trigger routing |

**16 tools. Full platform access. Zero capability loss.**

---

## What Makes This Different

### vs. Pipedream's Official MCP (`@pipedream/mcp`)

| Dimension | Official MCP | pd-gateway-mcp |
|-----------|-------------|----------------|
| **Tool count** | 10,000+ | 16 |
| **Context window usage** | Massive (every tool schema in context) | Minimal |
| **Trigger deployment** | ❌ Not supported | ✅ Full lifecycle |
| **Dynamic prop lookup** | ❌ Must guess values | ✅ Live enumeration |
| **Workflow management** | ❌ Actions only | ✅ List, inspect, trigger, events |
| **Composability** | Low (each tool is atomic) | High (discover → configure → execute) |
| **Setup complexity** | `npx` one-liner | Clone + env vars |

The official MCP is great for quick, targeted use ("I just need to send Slack messages from my AI"). The gateway is for power users who want their AI to orchestrate complex, multi-app automations programmatically.

### vs. Building Custom Integrations

You could write direct API integrations for each service (HubSpot API, Slack API, Google Sheets API, etc.). But:

| Dimension | Custom per-API | pd-gateway-mcp |
|-----------|---------------|----------------|
| **Setup per app** | Hours (auth, endpoints, error handling) | Minutes (connect account, use) |
| **Maintenance** | You own every API change | Pipedream maintains 3,000+ integrations |
| **Auth management** | You build OAuth flows | Pipedream handles it |
| **New app coverage** | Build from scratch | Instant (if Pipedream supports it) |
| **Tool count** | 3-10 per API × N APIs | 16 total, regardless of app count |

### vs. Zapier / Make.com

Zapier and Make are GUI-first automation platforms. They're excellent for non-technical users. But they don't have MCP servers, and their API access is limited:

| Dimension | Zapier/Make | pd-gateway-mcp |
|-----------|------------|----------------|
| **AI-native** | ❌ GUI-first, API bolted on | ✅ Built for AI agents |
| **Programmatic trigger deploy** | ❌ Must use GUI | ✅ From conversation |
| **Dynamic configuration** | ❌ GUI dropdowns only | ✅ API-accessible dropdowns |
| **Cost model** | Per-task pricing | Pipedream free tier + usage |
| **MCP support** | ❌ None | ✅ Native |

---

## The Power It Unlocks

### 1. Conversational Automation Building

Your AI agent can design, configure, and deploy automations entirely through conversation:

> **You**: "Watch my forecast spreadsheet for new rows and trigger the import workflow when data lands."
>
> **Agent**: *discovers Google Sheets triggers → enumerates your spreadsheets → picks the right one → deploys trigger → wires to import workflow*
>
> **Result**: Live automation, deployed in 30 seconds, no UI touched.

### 2. Smart Action Execution with Live Prop Discovery

Before pd-gateway-mcp, running an action required knowing exact prop values. "Send a Slack message to channel C04ABCXYZ" — but how would the AI know the channel ID?

Now:

```
Agent: pd_configure_prop("slack-send-message", "channel")
→ Returns: [{"label": "#general", "value": "C04ABC..."}, 
            {"label": "#manufacturing", "value": "C04DEF..."}, ...]

Agent: pd_run_action("slack-send-message", { channel: "C04DEF...", text: "..." })
→ Message sent to #manufacturing
```

The AI sees human-readable labels, picks the right one, uses the machine ID. No guessing.

### 3. Full Trigger Lifecycle Management

Deploy, inspect, rewire, and tear down triggers programmatically:

```
Agent: pd_list_deployed_triggers()
→ Shows 3 active triggers: Sheets watcher, HubSpot deal monitor, Slack listener

Agent: pd_update_trigger_workflows("trigger_123", ["p_newWorkflow"])
→ HubSpot trigger now feeds into the new workflow instead of the old one

Agent: pd_delete_deployed_trigger("trigger_456")
→ Old Slack listener removed
```

### 4. Cross-Platform Pipeline Orchestration

Chain operations across multiple apps in a single conversation:

> **You**: "When a deal closes in HubSpot, post a celebration to #wins in Slack, create a project in Notion, and log it in our Supabase database."
>
> **Agent**: 
> 1. `pd_list_triggers("hubspot")` → finds "deal stage changed" trigger
> 2. `pd_configure_prop("hubspot-...", "pipeline")` → picks your sales pipeline  
> 3. `pd_deploy_trigger(...)` → deploys, wires to processing workflow
> 4. The workflow handles Slack + Notion + Supabase downstream

---

## Use Cases

### Sales & CRM Automation
- **Lead routing**: New HubSpot lead → enrich with Apollo → route to rep via Slack
- **Deal alerts**: Deal stage change → Slack notification + dashboard update
- **Meeting follow-up**: Calendar event ends → draft follow-up email → create task

### Data Pipeline Monitoring  
- **Spreadsheet sync**: New Google Sheets row → validate data → insert into Supabase
- **Forecast ingestion**: Excel upload to Sheets → trigger processing workflow → update dashboard
- **Anomaly alerting**: Database trigger → check thresholds → Slack alert if outside bounds

### DevOps & Engineering
- **Deploy notifications**: GitHub push → Slack message with diff summary
- **Incident response**: PagerDuty alert → create Notion incident doc → post to #incidents
- **PR review routing**: New PR → analyze files changed → assign reviewer

### Customer Success
- **Onboarding automation**: New Stripe subscription → create HubSpot contact → welcome email sequence
- **Churn detection**: Support ticket volume spike → Slack alert to CS team
- **NPS follow-up**: Survey response → route to appropriate team based on score

### No-Code App Platforms (Glide, Retool, Softr)

This is where it gets interesting. Platforms like **Glide** support API calls and webhook actions in their workflows — meaning they can call Pipedream directly, and Pipedream can call back.

**Glide → Pipedream (webhook trigger)**:
1. Build a Pipedream workflow with an HTTP/webhook trigger
2. In Glide, add a "Call API" action that POSTs to the Pipedream webhook URL
3. Glide row data flows into Pipedream → gets processed → results anywhere

```
Glide workflow action → POST to Pipedream webhook URL
  → Pipedream workflow runs (enrich data, call APIs, update DBs)
    → Optionally write results back to Glide via API
```

**Pipedream → Glide (API action)**:
Pipedream has native Glide actions. Use `pd_run_action` with any `glide-*` action to read/write Glide tables programmatically.

**The gateway's role**: Your AI agent can discover Pipedream webhook URLs (`pd_get_workflow`), set up the processing workflow, and even configure the Glide → Pipedream connection — all from conversation. The runtime payload flow (Glide → Pipedream webhook) happens natively without the gateway in the path.

> **Example**: "When a new sales order is submitted in our Glide app, validate the data against our forecast in Supabase, calculate variance, and post a summary to #manufacturing in Slack."
>
> **Setup** (via gateway): Create Pipedream workflow → get webhook URL → configure Glide to POST order data → workflow handles validation + Supabase + Slack
>
> **Runtime** (direct): Glide POSTs → Pipedream runs → done

---

## Getting Started

### Prerequisites

1. A [Pipedream account](https://pipedream.com) (free tier works)
2. Node.js 18+
3. An MCP-compatible AI platform (Claude, Gemini, etc.)

### Installation

```bash
git clone https://github.com/bschonbrun/pd-gateway-mcp.git
cd pd-gateway-mcp
npm install
npm run build
```

### Configuration

```bash
cp .env.example .env
```

Fill in your credentials:

| Variable | Where to Find It |
|----------|-----------------|
| `PIPEDREAM_API_KEY` | [pipedream.com/settings](https://pipedream.com/settings) → API Key |
| `PIPEDREAM_CLIENT_ID` | [pipedream.com/settings](https://pipedream.com/settings) → OAuth Credentials |
| `PIPEDREAM_CLIENT_SECRET` | Same as above |
| `PIPEDREAM_PROJECT_ID` | [pipedream.com/projects](https://pipedream.com/projects) → starts with `proj_` |

### MCP Config

Add to your MCP host's configuration:

```json
{
  "mcpServers": {
    "pipedream-gateway": {
      "command": "node",
      "args": ["/path/to/pd-gateway-mcp/dist/index.js"],
      "env": {
        "PIPEDREAM_API_KEY": "your-api-key",
        "PIPEDREAM_CLIENT_ID": "your-client-id",
        "PIPEDREAM_CLIENT_SECRET": "your-client-secret",
        "PIPEDREAM_PROJECT_ID": "proj_xxxxx"
      }
    }
  }
}
```

### First Run

Once configured, ask your AI agent:

```
"List my Pipedream workflows"
"What apps can I connect to?"
"What triggers are available for Google Sheets?"
"Show me my connected accounts"
```

---

## Architecture

The gateway wraps two Pipedream APIs behind a single MCP interface:

| API | Auth | Handles |
|-----|------|---------|
| REST API v1 | API Key | Workflows, events, webhook triggers |
| Connect API | OAuth2 (auto-refresh) | Apps, actions, triggers, components, accounts |

The Connect API client handles OAuth2 token lifecycle automatically — acquire, cache, refresh 60s before expiry. No manual token management needed.

For full technical details, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Contributing

PRs welcome. The codebase is intentionally small (~300 lines of TypeScript) and focused. Key areas for contribution:

- **New tool ideas**: The Connect API has endpoints we intentionally excluded (see ARCHITECTURE.md). Some may be worth adding.
- **Error handling**: More granular error messages for common failure modes.
- **Testing**: Integration test suite against the Pipedream sandbox.

## License

MIT
