# Project 5: Flow Builder Platform

Design, build, and manage automations through natural language — no code, no Pipedream UI, no technical skills required.

## The Problem

Today, building an automation like the Daily Revenue Digest requires:

1. A developer writing TypeScript in the MCP server
2. Someone fighting the Pipedream UI to wire up triggers, steps, and OAuth
3. A deployment cycle for every change (subject line, recipient, format)

The pd-gateway-mcp already gives AI agents access to 3,000+ app actions through 16 tools. But the *design and build* of automations still requires technical people in technical interfaces.

## The Vision

A non-technical user opens a Glide app (or sends a chat message) and says:

> "Send me a daily email at 8am with our revenue numbers"

The system builds it. No code. No Pipedream. No developer.

Then they say:

> "Add Barry to that email"
> "Change the subject to 'Daily Revenue Tracker'"
> "Also send it to Slack"

The system modifies it — instantly, conversationally.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  USER INTERFACE                                          │
│  Glide App ("BillSuite Automations")                    │
│                                                          │
│  📂 Flow Catalog    Browse shareable templates           │
│  💬 Request a Flow  Describe what you want               │
│  ⚡ My Flows        View/edit active automations         │
│  🔗 Integrations    Connect apps (Slack, Outlook, etc)   │
│  📊 Run History     Status, logs, errors                 │
└──────────────────────┬──────────────────────────────────┘
                       │ webhook / API
┌──────────────────────▼──────────────────────────────────┐
│  BUILDER AGENT (Claude + pd-gateway-mcp)                 │
│                                                          │
│  Interprets natural language requests                    │
│  Discovers available apps via pd_list_apps               │
│  Validates actions via pd_get_component                  │
│  Creates/modifies flow definitions                      │
│  Stores configured instances in Supabase                │
└──────────────────────┬──────────────────────────────────┘
                       │ reads/writes
┌──────────────────────▼──────────────────────────────────┐
│  FLOW DEFINITIONS (two layers)                           │
│                                                          │
│  Git (templates)          Supabase (instances)           │
│  ─────────────────        ─────────────────              │
│  Shareable recipes        Running configurations         │
│  Version controlled       User-specific settings         │
│  Community PRs            Active/inactive state          │
│  Like Docker images       Like running containers        │
└──────────────────────┬──────────────────────────────────┘
                       │ reads config
┌──────────────────────▼──────────────────────────────────┐
│  RUNTIME ENGINE                                          │
│                                                          │
│  Reads flow instances from Supabase                     │
│  Executes on schedule (cron) or on-demand (webhook)     │
│  Calls pd_run_action() for each action step             │
│  Logs results back to Supabase                          │
│                                                          │
│  Trigger options:                                        │
│  • Glide scheduled action                               │
│  • Supabase pg_cron                                     │
│  • Supabase Edge Function                               │
│  • Pipedream webhook (thin proxy)                       │
└──────────────────────┬──────────────────────────────────┘
                       │ pd_run_action()
┌──────────────────────▼──────────────────────────────────┐
│  PIPEDREAM CONNECT (3,000+ apps)                         │
│                                                          │
│  OAuth credential management (zero user config)         │
│  Slack, Outlook, HubSpot, Google Sheets, Twilio, etc.   │
│  Users connect once via pd_connect_account link         │
└─────────────────────────────────────────────────────────┘
```

## Flow Template Format (Git)

Templates live in version-controlled YAML. Anyone can share, fork, or contribute.

```yaml
# flows/daily-revenue-digest.yaml
name: Daily Revenue Digest
version: 1.0.0
description: |
  Sends daily revenue, forecast, and variance summary
  to configured channels (Slack, Email, WhatsApp).

data_sources:
  - id: digest
    type: supabase_rpc
    function: digest_full

formatters:
  - id: slack_msg
    type: template
    channel: slack
    template_ref: templates/digest_slack.hbs
  - id: email_msg
    type: template
    channel: email
    template_ref: templates/digest_email.hbs

actions:
  - id: send_slack
    app: slack
    action: slack-send-message
    props:
      conversation: "{{ config.slack_channel }}"
      text: "{{ formatters.slack_msg }}"
      mrkdwn: true
  - id: send_email
    app: microsoft_outlook
    action: microsoft_outlook-send-email
    props:
      recipients: "{{ config.recipients }}"
      subject: "{{ config.subject }}"
      contentType: html
      content: "{{ formatters.email_msg }}"

config_schema:
  slack_channel:
    type: string
    label: Slack Channel
    required: false
  recipients:
    type: array
    items: string
    label: Email Recipients
    required: false
  subject:
    type: string
    label: Email Subject
    default: "Daily Revenue Tracker"
  schedule:
    type: cron
    label: Schedule
    default: "0 8 * * *"
    timezone: America/Los_Angeles

required_integrations:
  - slack
  - microsoft_outlook
```

## Flow Instance Format (Supabase)

When a user activates a flow, the builder agent stores an instance:

```sql
CREATE TABLE flow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_template text NOT NULL,        -- 'daily-revenue-digest'
  flow_version text DEFAULT '1.0.0',
  owner text NOT NULL,                -- 'bill@carbonet.com'
  name text,                          -- user-given name
  config jsonb NOT NULL DEFAULT '{}', -- filled-in config values
  schedule text,                      -- cron expression
  timezone text DEFAULT 'America/Los_Angeles',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_run_at timestamptz,
  last_run_status text                -- 'success' | 'error'
);

CREATE TABLE flow_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid REFERENCES flow_instances(id),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text,                        -- 'success' | 'error'
  channels_sent jsonb,                -- ['slack', 'email']
  error_detail text,
  duration_ms integer
);
```

Example instance:

```json
{
  "flow_template": "daily-revenue-digest",
  "owner": "bill@carbonet.com",
  "name": "Morning Revenue Report",
  "config": {
    "slack_channel": "C0872NV9H43",
    "recipients": ["barry@carbonet.com", "lindsay@carbonet.com"],
    "subject": "Daily Revenue Tracker"
  },
  "schedule": "0 8 * * *",
  "active": true
}
```

## OAuth Setup: The Integrations Tab

Connecting apps is already handled by `pd_connect_account`. The Glide app wraps this in a simple UI:

| App | Status | Action |
|-----|--------|--------|
| Slack | ✅ Connected | Disconnect |
| Outlook | ✅ Connected | Disconnect |
| Google Sheets | ⭕ Not connected | **[Connect →]** |
| HubSpot | ⭕ Not connected | **[Connect →]** |

Flow:

1. User clicks "Connect" → Glide calls webhook
2. Webhook calls `pd_connect_account()` → returns OAuth URL
3. User opens URL, authenticates with the app
4. Done — all future `pd_run_action` calls use stored credentials
5. `pd_list_accounts` keeps the status column current

Zero technical knowledge required. User just clicks and logs in.

## User Interactions

### Creating a Flow (Natural Language)

```
User:   "I want a daily email with our revenue numbers"
Agent:  Found template 'Daily Revenue Digest'.
        Who should receive the email?
User:   "The sales team — barry, lindsay, and jack"
Agent:  Schedule? Default is 8am Pacific.
User:   "That's fine"
Agent:  ✅ Flow created: "Morning Revenue Report"
        → Email to barry@, lindsay@, jack@ at 8:00 AM PT
        → Want to add Slack or WhatsApp too?
```

### Modifying a Flow

```
User:   "Add Mike to the daily revenue email"
Agent:  ✅ Added mike@carbonet.com to "Morning Revenue Report"

User:   "Change the subject to 'Daily Revenue Tracker'"
Agent:  ✅ Updated subject line.

User:   "Also send it to Slack in #orders-glide"
Agent:  ✅ Added Slack channel #orders-glide to "Morning Revenue Report"
```

### Browsing the Catalog

```
User:   "What flows are available?"
Agent:  📂 Available templates:
        1. Daily Revenue Digest — revenue summary to Slack/Email/WhatsApp
        2. Sales Order Approval — route new orders for manager approval
        3. Forecast Gap Alert — notify when actual trails forecast by >20%
        4. New Customer Notification — alert team when new customer places first order
```

## What This Replaces

| Before | After |
|--------|-------|
| Developer writes TypeScript | User describes what they want |
| Pipedream UI to wire steps | Builder agent configures props |
| Browser OAuth dance | One-click Connect in Glide |
| Deploy cycle for every change | "Change the subject line" → done |
| Logic duplicated (MCP + Pipedream) | Single source of truth in templates |
| Team-specific, not shareable | Git-based templates anyone can use |

## Implementation Phases

### Phase 1: Extract & Template (Current → Data-Driven)

- Extract daily digest logic from `index.ts` into a standalone module
- Define the YAML template format
- Create the Supabase `flow_instances` and `flow_run_log` tables
- Build a runtime that reads instances and executes them
- Port the daily digest as the first template

### Phase 2: Builder Agent

- Build the natural language → flow config pipeline
- Claude reads templates, matches user requests to templates
- Claude fills in config values from conversational context
- Stores instances in Supabase

### Phase 3: Glide App

- Flow Catalog (read from Git via GitHub API)
- My Flows (CRUD on `flow_instances` via Supabase)
- Integrations (OAuth via `pd_connect_account`)
- Run History (read `flow_run_log`)
- Chat / Request input (webhook to builder agent)

### Phase 4: Community & Sharing

- Public Git repo for flow templates
- Contribution guidelines for new templates
- Template validation schema
- Discovery/search in the Glide catalog

## Dependencies

- pd-gateway-mcp (existing — 16 tools, 3,000 app actions)
- Supabase (existing — data store, RPC functions, pg_cron)
- Glide (existing — UI builder)
- Claude API (existing — `ask_claude` tool)
- Pipedream Connect (existing — OAuth credential management)
- GitHub repo for flow templates (new, lightweight)

## Open Questions

1. **Template language**: YAML + Handlebars-style templating (shown above), or something simpler?
2. **Runtime host**: Supabase Edge Function, Glide scheduler, or a lightweight Node.js service?
3. **Multi-tenant**: Should flow instances be org-scoped from the start, or single-user MVP first?
4. **Custom flows**: Can users create *new* templates from scratch via natural language, or only instantiate existing ones?
5. **Approval flows**: Some automations (like sales order approval) need human-in-the-loop steps. How does the runtime handle waiting for a response?

## Notes

- The pd-gateway-mcp stays as-is — it's the AI's toolkit, not the automation engine. This project builds the engine *on top of* the gateway.
- Pipedream is reduced to two roles: credential management (OAuth) and action execution. No workflow logic lives there.
- Every automation is version-controlled, auditable, and shareable. The days of clicking through UIs to build workflows are over.
