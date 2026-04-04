# Project 4: Forecast Data Updates via WhatsApp, Slack & Email

Allow authorized users to update forecasting data using plain English via any messaging channel. Claude interprets the intent, asks for confirmation, and — on approval — fires the forecast update API to make the change in Supabase.

## Overview

This extends Project 3 (read-only Q&A) with write capability. A user sends a natural language update request, Claude extracts the structured change, the system confirms the intended action with the user in plain language, and on approval executes the update via the forecast API. Every mutation is logged with the requester's identity.

## Status

- [x] WhatsApp channel — connected
- [x] Slack channel — connected
- [x] Email channel — connected
- [ ] Anthropic API key — pending
- [ ] Forecast update API — in development (separate workspace)
- [ ] NL → structured change extraction — not built
- [ ] Confirmation flow — not built
- [ ] Supabase write execution — not built
- [ ] Audit log — not built

## Architecture

```
User message:
"Change the WPX CBR-40 delivery date to April 12"
"Cancel the Select Energy order for next week"
"Move the Chord forecast from $180k to $210k"
        │
        ▼
Authorization check (write role required)
        │
        ▼
Claude API — Intent extraction:
  Output: {
    intent: "update_forecast",
    entity: "WPX CBR-40",
    field: "delivery_date",
    old_value: "April 8",    ← looked up from DB
    new_value: "April 12",
    confidence: "high"
  }
        │
        ▼
Confirmation message back to user:
"📝 Confirm change:
 WPX CBR-40 delivery: April 8 → April 12
 Reply YES to confirm, NO to cancel"
        │
        ▼
User replies YES
        │
        ▼
Forecast Update API call
  POST /api/forecast/update
  { line_id, field, value, changed_by, source: "whatsapp" }
        │
        ▼
Supabase updated
Audit log written
        │
        ▼
Confirmation reply:
"✅ Done. WPX CBR-40 delivery updated to April 12.
 Dashboard will reflect this change immediately."
```

## Supported Update Types

| Operation | Example | API Action |
|-----------|---------|------------|
| Change delivery date | "Move WPX order to April 12" | Update `delivery_date` |
| Change forecast revenue | "Update Chord forecast to $210k" | Update `revenue` |
| Cancel forecast | "Cancel the Select order for next week" | Set `status = 'cancelled'` |
| Defer forecast | "Defer the XRI order to next month" | Update `delivery_date` + `status = 'deferred'` |
| Confirm downside | "Mark the Chord $180k as confirmed downside" | Set `status = 'confirmed_downside'` |
| Split forecast | "Split the WPX order into two deliveries" | Complex — escalate to dashboard |

## Claude System Prompt (Draft)

```
You are a forecast update assistant for CarboNet.
Extract structured update intents from natural language requests.

Available operations: update_date, update_revenue, cancel, defer, confirm_downside
Entities: customers and forecast lines in the manufacturing dashboard

Always look up the current value before proposing a change.
Return JSON: {
  "intent": "update_date",
  "entity_type": "forecast_line",
  "entity_id": "...",
  "entity_label": "WPX CBR-40 — April 8",
  "field": "delivery_date",
  "old_value": "2026-04-08",
  "new_value": "2026-04-12",
  "confidence": "high|medium|low",
  "notes": "..."
}

If confidence is low or the request is ambiguous, ask a clarifying question instead.
```

## Confirmation Flow

The confirmation step is non-negotiable for all write operations:

1. System always shows the current value alongside the proposed new value
2. User must explicitly reply YES (or CONFIRM, Y, etc.)
3. Any other reply cancels the operation
4. Confirmation expires after 5 minutes — a new request must be made

```
User: "Change WPX delivery to the 12th"

Bot:  "📝 Confirm change:
       WPX CBR-40
       Delivery: April 8 → April 12
       
       Reply YES to confirm or NO to cancel
       ⏱ Expires in 5 minutes"

User: "YES"

Bot:  "✅ Done. WPX CBR-40 updated to April 12."
```

## Session State

Uses the same `whatsapp_sessions` table as Project 2:

```sql
INSERT INTO whatsapp_sessions (phone, context_type, context_id, options)
VALUES (
  '+16047830407',
  'forecast_update',
  'forecast_line_uuid',
  '{"YES": {"action": "update_date", "line_id": "...", "new_value": "2026-04-12"}}'
);
```

## Audit Log

Every write operation is logged:

```sql
CREATE TABLE forecast_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_line_id uuid REFERENCES forecast_lines(id),
  field_changed text,
  old_value text,
  new_value text,
  changed_by text,        -- phone / slack user / email
  channel text,           -- 'whatsapp', 'slack', 'email'
  raw_message text,       -- original natural language request
  confirmed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

## Authorization

Write operations require `role = 'write'` or `role = 'admin'` in the authorization table. Read-only users (Project 3) receive an error message if they attempt a write.

## Integration with Forecast Update API

This project depends on the forecast update API being developed in the manufacturing dashboard workspace. The API should accept:

```
POST /api/forecast/update
Authorization: Bearer {service_token}
{
  "line_id": "uuid",
  "field": "delivery_date",
  "value": "2026-04-12",
  "changed_by": "+16047830407",
  "source": "whatsapp",
  "session_id": "uuid"
}
```

The API handles validation, status taxonomy enforcement (`forecast_replaced`, version management), and Supabase writes. This Pipedream workflow is the caller, not the implementer of that logic.

## Dependencies

- Anthropic API key (Claude)
- Forecast Update API (in development — separate workspace)
- Inbound webhook routing from Project 2
- Authorization table with write-role users
- `whatsapp_sessions` state table
- `forecast_change_log` audit table

## Implementation Steps

1. Finalize forecast update API (coordinate with dashboard workspace)
2. Build Claude intent extraction prompt, test with 20+ scenarios
3. Build confirmation flow (reuse session state from Project 2)
4. Wire YES/NO reply routing to API call vs. cancel
5. Create audit log table
6. Test end-to-end: WhatsApp message → confirmation → API update → Supabase change → dashboard refresh
7. Add error handling (ambiguous requests, entity not found, API failure)
8. Extend to Slack and Email channels

## Notes

- This project has a hard dependency on the forecast update API. Build and test that API independently first.
- "Split forecast" operations are complex (multiple new rows) — consider routing those to the dashboard with a link rather than handling via messaging.
- The confirmation step must show old AND new values. Users sometimes misidentify entities — seeing "WPX Apr 8 → Apr 12" catches that before it's committed.
- Consider a daily digest of all changes made via messaging, sent to an admin, as an additional audit mechanism.
