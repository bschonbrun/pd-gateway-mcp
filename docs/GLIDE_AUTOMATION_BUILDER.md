# Glide × Pipedream: Visual Automation Builder

## Vision

A Glide app that lets non-technical users configure and deploy Pipedream automations through a friendly UI. Glide is the abstraction layer; Pipedream is the execution engine. Users never see Pipedream.

**Phase 1**: Internal — Acme Corp team configures workflows against enterprise tools (HubSpot, Slack, Sheets, Supabase)
**Phase 2**: Platform — Offer to other Glide users as a template/product. Each customer connects their own tools.

---

## Why This Works

Pipedream's Connect API was built exactly for this — **embedding Pipedream into other products**:

| Connect API Feature | How Glide Uses It |
|--------------------|--------------------|
| `external_user_id` | Each Glide user gets their own isolated namespace |
| Connect tokens | Per-user OAuth — user connects *their* Slack, *their* HubSpot |
| Component configure | Populate Glide dropdowns with live data (channels, spreadsheets) |
| Deploy trigger | User clicks "Deploy" in Glide → trigger goes live in Pipedream |
| Deployed trigger CRUD | Glide dashboard shows active automations with kill switches |

Users never need a Pipedream account. They interact with Pipedream through Glide.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Glide App                       │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │  Admin View   │  │   User View        │  │
│  │               │  │                    │  │
│  │ • Connect     │  │ • Browse templates │  │
│  │   enterprise  │  │ • Configure props  │  │  
│  │   apps        │  │ • Deploy triggers  │  │
│  │ • Build       │  │ • Manage active    │  │
│  │   templates   │  │   automations      │  │
│  │ • Manage      │  │ • View run history │  │
│  │   users       │  │                    │  │
│  └──────┬────────┘  └──────┬─────────────┘  │
└─────────┼──────────────────┼────────────────┘
          │                  │
          │  Glide "Call API" actions
          │                  │
┌─────────▼──────────────────▼────────────────┐
│        Pipedream Proxy Layer                 │
│  (Set of webhook-triggered workflows)        │
│                                              │
│  /api/list-apps         → Connect API        │
│  /api/list-triggers     → Connect API        │
│  /api/configure-prop    → Connect API        │
│  /api/deploy-trigger    → Connect API        │
│  /api/list-deployed     → Connect API        │
│  /api/delete-trigger    → Connect API        │
│  /api/connect-account   → Connect API        │
│  /api/run-action        → Connect API        │
│                                              │
│  Auth: OAuth2 handled server-side            │
│  Multi-tenant: external_user_id passthrough  │
└──────────────────────────────────────────────┘
```

### Why a Proxy Layer?

1. **Auth isolation**: OAuth2 token management stays server-side. Glide never sees API keys.
2. **Rate limiting**: Proxy can queue/throttle requests.
3. **Transformation**: Shape Connect API responses into Glide-friendly formats (flat JSON, clean labels).
4. **Logging**: Every request logged for audit/debugging.
5. **Security**: API keys live in Pipedream env vars, not in Glide.

---

## Data Model (Glide Tables)

### Core Tables

| Table | Columns | Source |
|-------|---------|--------|
| **Apps** | name, slug, logo_url, category, is_enabled | Cached from Connect API, admin-curated |
| **Automation Templates** | name, description, app_slug, trigger_key, default_props, created_by | Admin-created |
| **User Automations** | user_email, template_id, trigger_key, configured_props, deployed_trigger_id, status, deployed_at | User-created via deploy flow |
| **Prop Options** | component_key, prop_name, options_json, fetched_at | Cached from configure-prop calls |

### Admin Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| **Connected Accounts** | app_slug, account_id, connected_by, connected_at | Track which enterprise apps are connected |
| **Workflow Registry** | workflow_id, name, description, webhook_url, category | Available Pipedream workflows to wire triggers to |
| **Users** | email, role (admin/user), external_user_id | User management |

---

## User Flows

### Admin Flow: Connect an Enterprise App

```
Admin opens "Settings" tab
  → Sees list of available apps (Slack, HubSpot, Sheets, etc.)
  → Taps "Connect Slack"
  → Glide workflow calls /api/connect-account
  → Returns OAuth URL
  → Admin opens URL, completes OAuth in Slack
  → Account appears as "Connected ✓"
```

### Admin Flow: Create Automation Template

```
Admin opens "Templates" tab 
  → Taps "New Template"
  → Picks app (Slack) → picks trigger (New Message in Channel)
  → Sets default props (e.g., pre-select the #orders channel)
  → Names it: "New Order Alert"
  → Picks destination workflow from registry
  → Saves template
  → Users can now deploy this template in one click
```

### User Flow: Deploy an Automation

```
User opens "Automations" tab
  → Sees template cards: "New Order Alert", "Forecast Update", etc.
  → Taps "New Order Alert"
  → Sees configuration form:
      Channel: [dropdown populated from Pipedream] → #orders
      Filter: [text field] → "urgent"
  → Taps "Deploy"
  → Glide workflow calls /api/deploy-trigger
  → Card updates to "Active ✓" with a kill switch
```

### User Flow: Manage Active Automations

```
User opens "My Automations" tab
  → Sees active automations with status indicators
  → Can pause/resume (future) or delete
  → Can view execution history (last 10 events)
```

---

## Proxy Workflow Design

Each proxy endpoint is a **single Pipedream workflow** with:
1. HTTP/webhook trigger (receives POST from Glide)
2. Auth step (OAuth2 token fetch/cache)
3. API call to Pipedream Connect
4. Response transformation (flatten for Glide)
5. Return JSON to Glide

### Proxy Endpoints

| Endpoint | Method | Glide Sends | Returns |
|----------|--------|-------------|---------|
| `/api/list-apps` | POST | `{}` | Array of `{name, slug, logo_url}` |
| `/api/list-triggers` | POST | `{app: "slack"}` | Array of `{key, name, description}` |
| `/api/get-component` | POST | `{key: "slack-new-message"}` | `{props: [{name, type, label, remoteOptions}]}` |
| `/api/configure-prop` | POST | `{component: "...", prop: "channel", user_id: "..."}` | Array of `{label, value}` |
| `/api/deploy-trigger` | POST | `{trigger_key, props, user_id, workflow_id}` | `{trigger_id, status}` |
| `/api/list-deployed` | POST | `{user_id}` | Array of `{id, trigger_key, status, deployed_at}` |
| `/api/delete-trigger` | POST | `{trigger_id, user_id}` | `{success: true}` |
| `/api/connect-account` | POST | `{user_id}` | `{auth_url}` |

### Security

- Each proxy workflow validates a shared secret (Glide passes `X-API-Key` header)
- `external_user_id` derived from Glide user email — no user can access another's resources
- OAuth tokens never leave Pipedream

---

## Phased Implementation

### Phase 1: Internal MVP (Acme Corp)

> [!IMPORTANT]
> **Goal**: Team deploys automations against pre-connected enterprise tools.

**Build**:
- [ ] 4 proxy workflows (list-apps, list-triggers, configure-prop, deploy-trigger)
- [ ] Glide tables (Apps, Templates, User Automations)
- [ ] Admin view: connect apps, create templates
- [ ] User view: browse templates, configure, deploy
- [ ] Management view: see active automations, delete

**Pre-connected apps**: HubSpot, Slack, Google Sheets, Supabase
**Pre-built templates**: 3-5 common automations (deal alerts, forecast sync, order notifications)

### Phase 2: Self-Service

> [!NOTE]
> **Goal**: Users can build their own automations (not just deploy templates).

**Add**:
- [ ] Full app browser in Glide (search, filter by category)
- [ ] Free-form trigger selection (not just templates)
- [ ] Prop configuration wizard (multi-step for complex triggers)
- [ ] Workflow builder (simple: pick trigger → pick destination)

### Phase 3: Platform / Multi-Tenant

> [!NOTE]
> **Goal**: Offer to other Glide users. Each customer is isolated.

**Add**:
- [ ] Per-customer Pipedream project isolation
- [ ] Customer onboarding flow (connect their own apps)
- [ ] Usage metering / billing integration
- [ ] Glide template marketplace listing

---

## Open Questions

> [!IMPORTANT]
> **Glide app scope**: Should this be a new standalone Glide app, or a module within an existing one? New app keeps it clean and shareable.

> [!IMPORTANT]
> **Workflow templates vs. custom**: For Phase 1, do users only deploy from admin-curated templates, or can they also pick any trigger from any connected app? Templates-only is simpler and safer for launch.

> [!IMPORTANT]
> **Execution visibility**: How much should users see about what happened? Options range from "✓ ran successfully" to full event payloads. For non-technical users, probably just status + timestamp.

> [!NOTE]
> **Glide API call limits**: Glide workflows have execution limits depending on plan. Need to verify that the "Call API" action volume fits within your Glide plan for the expected usage.

---

## What Makes This Compelling

1. **For Acme Corp**: Your team gets a dead-simple way to configure automations without learning Pipedream
2. **For Glide users**: A template they can install to turn their Glide app into an automation platform
3. **As a product**: Nobody has built "Zapier inside Glide" — this is the first visual automation builder that uses Glide as the UI and Pipedream as the engine
4. **Moat**: The proxy layer + Glide template is hard to replicate. It combines two platforms in a way neither offers alone.
