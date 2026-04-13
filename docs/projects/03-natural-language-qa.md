# Project 3: Natural Language Q&A — Forecast & Revenue

Allow any authorized user to ask plain-English questions about revenue and forecast data via WhatsApp, Slack, or email — and receive accurate, formatted answers — without ever opening the dashboard.

## Overview

Users send a message in natural language. A Pipedream workflow receives it, passes it to Claude with context about the data schema and current date, Claude generates a safe read-only SQL query, Supabase executes it, Claude formats the result, and the answer is returned via the same channel.

Read-only. No data mutations. Write operations are handled in Project 4.

## Status

- [x] WhatsApp channel — connected
- [x] Slack channel — connected
- [x] Email channel — connected
- [ ] Anthropic API key — pending
- [ ] NL → SQL prompt engineering — not started
- [ ] Supabase query execution layer — not built
- [ ] Response formatter — not built
- [ ] Channel router (WhatsApp / Slack / Email) — not built
- [ ] Authorization (only approved users) — not built

## Architecture

```
User message (any channel):
"What's our revenue MTD?"
"Did XRI place an order today?"
"What's our biggest open forecast for May?"
        │
        ▼
Channel Adapter (Pipedream):
  WhatsApp → Twilio inbound webhook
  Slack    → Slack Events API
  Email    → Outlook webhook or polling
        │
        ▼
Authorization check
  Is this phone/email/user in allowed list?
        │
        ▼
Claude API (claude-sonnet-4-5):
  System prompt: schema context + rules
  User message: the question
  Output: { sql: "SELECT...", explanation: "..." }
        │
        ▼
Supabase execute (read-only role)
        │
        ▼
Claude API (format result):
  Input: raw query result + original question
  Output: human-readable answer
        │
        ▼
Reply via original channel
```

## Claude System Prompt (Draft)

```
You are a revenue intelligence assistant for Acme Corp, an oilfield services company.
You answer questions about manufacturing revenue, sales orders, and forecast data.

Database schema:
- sales_orders: id, customer, market, revenue, order_date, delivery_date, status
- forecast_lines: id, customer, market, revenue, delivery_date, status, version
- forecast_orders: id, forecast_line_id, order_number, matched_revenue

Rules:
- Today is {current_date}
- Only generate SELECT statements. Never INSERT, UPDATE, DELETE, or DROP.
- If you cannot answer from the available data, say so clearly.
- Format currency as $X,XXX
- Return JSON: { "sql": "...", "explanation": "what this query does" }
```

## Example Interactions

| Question | SQL Generated | Response |
|----------|--------------|----------|
| "What's our revenue MTD?" | `SELECT SUM(revenue) FROM sales_orders WHERE date_trunc('month', order_date) = date_trunc('month', NOW())` | "MTD revenue is $1.24M as of April 4." |
| "Did XRI place an order today?" | `SELECT * FROM sales_orders WHERE customer ILIKE '%XRI%' AND order_date::date = CURRENT_DATE` | "Yes — XRI placed SO #4521 for $42,000, delivery April 15." |
| "What's our biggest open forecast for May?" | `SELECT customer, revenue FROM forecast_lines WHERE delivery_date BETWEEN... ORDER BY revenue DESC LIMIT 1` | "Largest open May forecast is WPX CBR-40 at $180,000." |

## Authorization

Only authorized phone numbers / Slack users / email addresses can query the system. Authorization list stored in Supabase:

```sql
CREATE TABLE whatsapp_authorized_users (
  phone text PRIMARY KEY,
  name text,
  role text, -- 'read', 'write', 'admin'
  active boolean DEFAULT true
);
```

Same pattern for Slack user IDs and email addresses.

## Channel-Specific Considerations

| Channel | Input | Output | Notes |
|---------|-------|--------|-------|
| WhatsApp | Text message body | Formatted text (1600 char limit) | Inbound webhook required |
| Slack | `@bot` mention or DM | Rich block message | Slack Events API app required |
| Email | Email body text | HTML reply | Outlook webhook or polling |

## Dependencies

- Anthropic API key (Claude)
- Supabase read-only service role for query execution
- Inbound webhook for each channel (WhatsApp already planned in Project 2)
- Authorization table in Supabase
- Slack app with Events API configured (for Slack channel)

## Implementation Steps

1. Get Anthropic API key, add to Pipedream
2. Define and validate schema context for Claude system prompt
3. Build NL → SQL → format Pipedream workflow (WhatsApp first)
4. Test with 10+ representative questions, refine prompt
5. Add authorization check
6. Extend to Slack channel
7. Extend to Email channel
8. Add query result caching for common questions (avoid redundant DB hits)

## Safety Guardrails

- Claude only ever generates `SELECT` statements (enforced in prompt + validated before execution)
- Supabase connection uses a **read-only** database role — even if prompt injection occurred, no mutation is possible
- Rate limiting: max 20 queries per user per hour
- Logging: all queries logged to Supabase for audit

## Notes

- This is read-only. Data mutations (forecast updates, status changes) are handled in Project 4 with an explicit confirmation flow.
- Response length on WhatsApp is capped at 1600 characters. For large result sets, respond with a summary and offer to email the full report.
- Slack allows richer formatting with Block Kit — tables, collapsible sections, etc. Consider building a richer Slack response formatter.
