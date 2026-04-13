# Domain: Revenue & Forecasting

The first data domain for the BillSuite Core Engine. Everything Acme Corp needs to manage revenue, forecasts, customer commitments, and commercial intelligence — accessible from any channel, on any device.

---

## Domain Concept

A domain is a **grouped set of capabilities around a shared data topic**. Instead of building isolated flows, a domain bundles everything users need for one area of the business:

- Scheduled reports (push)
- Event-driven alerts (push)
- Conversational Q&A (pull, read)
- Conversational mutations (pull, write)
- Automated data ingest (capture)
- Continuous monitoring (watch)

All six capabilities share the same data sources, integrations, auth model, and schema context. Install the domain — get everything.

---

## Data Sources

| Source | What it holds | Connection | Status |
|--------|-------------|------------|--------|
| **Supabase** | Sales orders, forecast lines, forecast orders, reconciliation | Direct / MCP | ✅ Connected |
| **Glide** | Sales order entry, live forecast management | Pipedream / API | ✅ Connected |
| **HubSpot** | Pipeline deals, contacts, company info, activity history | Pipedream / MCP | ✅ Connected |
| **OneDrive/SharePoint** | Customer contracts, NDAs, Take or Pay agreements, pricing terms | Pipedream (Microsoft Graph) | 🔶 Available, not connected |
| **Outlook Inbox** | Inbound sales order emails | Pipedream | 🔶 Available, not connected |
| **Perplexity** | Market research, customer news, industry intelligence | Pipedream | ✅ Available |

---

## Integrations (Actions)

| App | Via | Actions Used |
|-----|-----|-------------|
| **Slack** | Pipedream Connect | Send messages, post to channels |
| **Outlook** | Pipedream Connect | Send emails, monitor inbox |
| **WhatsApp/Twilio** | Pipedream Connect | Send/receive messages |
| **HubSpot** | Pipedream Connect / MCP | Read/write deals, contacts, activities |
| **Glide** | Pipedream Connect / API | Create/update sales orders |
| **Perplexity** | Pipedream Connect | Search, research queries |
| **OneDrive** | Pipedream Connect | Read files, list folders |
| **GitHub** | Pipedream Connect / MCP | Create issues (feedback loop) |

---

## Six Capability Types

### 1. 📊 Report — Scheduled Push

Automated reports delivered on a schedule. Users receive data without asking.

| Report | Data Sources | Frequency | Channels | Status |
|--------|-------------|-----------|----------|--------|
| **Daily Revenue Digest** | Supabase (sales_orders, forecast_lines) | Daily 8am PT, weekdays | Email, Slack, WhatsApp | ✅ Built (hardcoded) |
| **Weekly Contract Compliance** | Supabase + Contracts (OneDrive) | Weekly Monday 8am | Email, Slack | ❌ Not built |
| **Monthly Pipeline Review** | HubSpot deals + Supabase forecasts | Monthly 1st | Email | ❌ Not built |
| **Customer Health Scorecard** | Supabase + HubSpot + Contracts | Weekly Friday | Email, Slack | ❌ Not built |
| **Market Intelligence Brief** | Perplexity (customer names as search terms) | Daily or weekly | Email | ❌ Not built |

---

### 2. 🔔 Alert — Event-Driven Push

Notifications triggered by data changes or threshold breaches. Users respond to events.

| Alert | Trigger | Who receives | Channels | Status |
|-------|---------|-------------|----------|--------|
| **New SO Approval** | Glide webhook (new sales order) | Assigned approver | WhatsApp, Slack | 🔶 Designed (Project 2) |
| **Customer Behind MVC** | Scheduled check: actual pace < committed pace | Account manager | Email, Slack | ❌ Not built |
| **Contract Renewal Approaching** | 30/60/90 day check against contract end_date | Sales lead | Email | ❌ Not built |
| **Revenue Milestone Hit** | MTD revenue crosses target threshold | Leadership | Slack, WhatsApp | ❌ Not built |
| **Large Deal Closing** | HubSpot deal moves to "closed won" | Sales team | Slack | ❌ Not built |
| **Competitor News** | Perplexity monitoring on key terms/companies | Sales lead | Email | ❌ Not built |
| **Missing PO Follow-up** | Sales order created without PO, 48hr elapsed | Sales rep | Email, Slack | ❌ Not built |

---

### 3. ❓ Query — Conversational Q&A (Read)

Users ask plain-English questions and receive accurate, formatted answers. Read-only. No data mutations.

| Question Type | Example | Data Source | Status |
|--------------|---------|------------|--------|
| **Revenue** | "What's our revenue MTD?" | Supabase | 🔶 Designed (Project 3) |
| **Customer performance** | "How is Devon doing this quarter?" | Supabase | 🔶 Designed |
| **Contract compliance** | "Is WPX on pace for their Take or Pay?" | Supabase + Contracts | ❌ Not built |
| **Contract terms** | "What does Devon's contract say about freight?" | OneDrive (document read) | ❌ Not built |
| **Pricing validation** | "Are we charging WPX the right price for CBR-40?" | Contracts + Supabase | ❌ Not built |
| **Pipeline** | "What's in the HubSpot pipeline for Q2?" | HubSpot | ❌ Not built |
| **Activity history** | "When did we last talk to XRI?" | HubSpot | ❌ Not built |
| **Market intel** | "Any news about Devon Energy?" | Perplexity | ❌ Not built |
| **Comparative** | "Who's our biggest customer this quarter vs last?" | Supabase | ❌ Not built |
| **Forecast** | "What's our biggest open forecast for May?" | Supabase | 🔶 Designed |
| **Order status** | "Did XRI place an order today?" | Supabase | 🔶 Designed |

---

### 4. ✏️ Mutate — Conversational Write

Users make data changes via natural language with mandatory confirmation. Every mutation is logged.

| Operation | Example | Data Target | Approval | Status |
|-----------|---------|------------|----------|--------|
| **Update forecast date** | "Move WPX delivery to April 12" | Supabase | Confirm | 🔶 Designed (Project 4) |
| **Update forecast revenue** | "Update Chord forecast to $210k" | Supabase | Confirm | 🔶 Designed |
| **Cancel forecast** | "Cancel the Select order for next week" | Supabase | Confirm | 🔶 Designed |
| **Defer forecast** | "Defer XRI to next month" | Supabase | Confirm | 🔶 Designed |
| **Confirm downside** | "Mark Chord $180k as confirmed downside" | Supabase | Confirm | 🔶 Designed |
| **Approve sales order** | Reply "1" to approval WhatsApp | Glide | Confirm | 🔶 Designed (Project 2) |
| **Create HubSpot deal** | "Create a deal for the Devon forecast" | HubSpot | Confirm | ❌ Not built |
| **Log interaction** | "Log a call with Devon re: pricing" | HubSpot | Auto | ❌ Not built |

---

### 5. 📨 Ingest — Automated Data Capture

The system watches external sources and automatically captures structured data from unstructured inputs.

| Ingest Flow | Source | Process | Target | Status |
|-------------|--------|---------|--------|--------|
| **Email-to-Sales-Order** | Outlook inbox (customer emails) | Claude extracts: customer, products, qty, delivery, PO# | Glide (new SO row) | ❌ Not built |
| **PO Attachment Parsing** | Email attachments (PDF POs) | Claude reads PDF, extracts PO number + line items | Glide (update SO with PO) | ❌ Not built |
| **Contract Indexing** | OneDrive/SharePoint folders | Claude reads contract docs, extracts key terms | Supabase (contract_terms table) | ❌ Not built |

#### Email-to-Order Flow

```
Customer emails SO → Outlook inbox
        │
Engine monitors inbox (Pipedream trigger)
        │
Claude extracts: customer, products, qty, delivery, PO#
        │
   ┌────┴────┐
Has PO       No PO
   │            │
Creates SO    Creates SO + flags "missing PO"
in Glide      in Glide
   │            │
Confirms      Alerts sales rep:
via email     "New SO from Devon, no PO attached"
```

---

### 6. 🔍 Monitor — Continuous Intelligence

The system watches external sources for changes and compiles intelligence digests.

| Monitor | Source | Frequency | Output | Status |
|---------|--------|-----------|--------|--------|
| **Customer Dossiers** | Perplexity (search per customer/prospect) | Daily | Email digest of news per customer | ❌ Not built |
| **Competitor Watch** | Perplexity (key competitor names + terms) | Daily | Slack or email alert | ❌ Not built |
| **Industry Trends** | Perplexity (basin activity, regulatory, pricing) | Weekly | Email report | ❌ Not built |
| **Contract Changes** | OneDrive folder watch | On change | Alert: "New contract uploaded for Devon" | ❌ Not built |

#### Customer Intelligence Flow

```
Customer/prospect list from Supabase + HubSpot
        │
Daily: Perplexity search per entity
   "Devon Energy news last 24 hours"
   "WaterBridge operations updates"
        │
Claude compiles dossier per customer:
   - M&A activity
   - Regulatory/compliance news
   - Earnings/financial updates
   - Operational changes
   - Competitor moves in their basin
        │
Daily email:
   "🔍 Customer Intel — April 5"
   Devon Energy: announced Permian capex increase...
   WPX: completions team restructure...
   No significant news: Chord, Select, XRI
```

---

## Cloud API

All six capabilities are accessible through one API. Any channel connects to the same endpoint.

```
User (any device, any channel)
   │
   ├── Slack DM    → Pipedream trigger ─┐
   ├── WhatsApp    → Pipedream trigger ─┤
   ├── Email       → Pipedream trigger ─┤
   ├── Glide chat  → Pipedream trigger ─┤
   └── Web widget  → HTTP POST         ─┤
                                         │
                                    Cloud API
                                    (Pipedream workflow)
                                         │
                                    Core Engine
                                    (Reason → Query → Execute)
                                         │
                                    Responds via same channel
```

The Cloud API:
- Receives the user message + channel metadata (who, where, reply-to)
- Calls Claude API with domain schema context
- Claude determines intent (query, mutate, command)
- Engine executes (Supabase query, Pipedream action, etc.)
- Formats response for the originating channel
- Replies

---

## Authorization Model

| Role | Can do | Example users |
|------|--------|---------------|
| **Admin** | Everything + manage users + modify templates | Bill |
| **Write** | Query + Mutate + receive Reports/Alerts | Sales managers |
| **Read** | Query + receive Reports/Alerts | Sales reps, leadership |

Stored in Supabase, keyed by phone number / Slack user ID / email:

```sql
CREATE TABLE domain_authorized_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,       -- phone, slack_id, or email
  identifier_type text NOT NULL,  -- 'phone', 'slack', 'email'
  name text,
  role text CHECK (role IN ('admin', 'write', 'read')),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

---

## Shared Infrastructure

All six capabilities share:

| Component | Purpose |
|-----------|---------|
| **Schema context** | Claude system prompt describing all tables, columns, relationships |
| **Session state** | `whatsapp_sessions` table for multi-step conversations (confirmations, approvals) |
| **Audit log** | Every query, mutation, and action logged with user identity and channel |
| **Format templates** | Per-channel message formatters (Slack blocks, HTML email, WhatsApp text) |
| **Pipedream Connect** | OAuth tokens for all connected apps |

---

## Build Priority

### Phase 1 — Foundation (MCP / Product 1)
Refactor existing work into the domain model. Build for the IDE user first.

| # | Item | What |
|---|------|------|
| 1 | Refactor daily digest | Hardcoded TypeScript → data-driven JSON template |
| 2 | Template engine | Parse template JSON + execute (query → format → send) |
| 3 | Deploy to Pipedream | Programmatic workflow creation from template |
| 4 | Schema context | Document all tables/columns for Claude system prompt |
| 5 | Query capability | NL → SQL → response for revenue data (Project 3) |

### Phase 2 — Cloud API (Product 2)
Make it accessible from any channel, any device.

| # | Item | What |
|---|------|------|
| 6 | Cloud API | Pipedream workflow: receive message → Claude → respond |
| 7 | Channel adapters | Slack, WhatsApp, Email inbound triggers |
| 8 | Auth system | Verify user identity per channel |
| 9 | Session state | Multi-step conversations (confirmations, approvals) |

### Phase 3 — Expand Capabilities
Add the remaining capability types.

| # | Item | What |
|---|------|------|
| 10 | Mutate capability | NL → intent → confirm → execute (Project 4) |
| 11 | Alert: SO Approval | Glide webhook → WhatsApp approval flow (Project 2) |
| 12 | Ingest: Email-to-Order | Outlook monitoring → Claude extraction → Glide entry |
| 13 | Monitor: Customer Intel | Perplexity daily search → dossier compilation |
| 14 | Contract integration | OneDrive/SharePoint → contract indexing → compliance queries |
| 15 | HubSpot pipeline | Pipeline data in queries + reports |

### Phase 4 — Template Marketplace
Make it reusable for other domains and users.

| # | Item | What |
|---|------|------|
| 16 | Template abstraction | Extract domain into shareable template group |
| 17 | Template catalog | Git + DB sync, browsable by power users |
| 18 | Feedback loop | Claude creates GitHub issues when hitting template boundaries |
| 19 | Second domain | Prospecting & Lead Management (same pattern, different data) |

---

## Future Domains (Same Pattern)

| Domain | Data | Same 6 capabilities |
|--------|------|---------------------|
| **Prospecting & Leads** | HubSpot, Apollo, LinkedIn, Perplexity | Report, Alert, Query, Mutate, Ingest, Monitor |
| **Inventory & Logistics** | Glide, shipping APIs, warehouse data | Report, Alert, Query, Mutate, Ingest, Monitor |
| **Finance & Billing** | QuickBooks, contracts, AR/AP | Report, Alert, Query, Mutate, Ingest, Monitor |
