# Project 2: Sales Order Update & Approval (Glide-Triggered)

When a new sales order is entered in Glide, automatically notify the relevant approver via WhatsApp with confirmation choices. Their reply updates the record in Glide without anyone logging into a dashboard.

## Overview

A Glide automation fires a webhook when a new sales order is created or reaches a specific status. Pipedream catches the webhook, extracts the order details, sends a formatted WhatsApp message with approval choices to the responsible party, listens for their reply, and writes the decision back to Glide via the Glide API.

## Status

- [x] WhatsApp outbound (Twilio) — connected and tested
- [x] Glide connected via API (Bearer token)
- [ ] Glide webhook trigger — not configured
- [ ] Inbound WhatsApp webhook — not built
- [ ] Pipedream inbound routing workflow — not built
- [ ] Glide write-back — not built
- [ ] Conditional branching (yes/no routing) — not built

## Architecture

```
New SO entered in Glide
        │
        ▼
Glide Automation fires webhook → Pipedream HTTP Trigger
        │
        ▼
Extract order details:
  - Customer name
  - Order value
  - Delivery date
  - Responsible contact + phone number
        │
        ▼
send_whatsapp to responsible party:
  "New SO #4521 — WPX Energy, $42,000
   Delivery: April 15
   Reply 1 to APPROVE, 2 to FLAG FOR REVIEW"
        │
        ▼
User replies via WhatsApp
        │
        ▼
Twilio webhook → Pipedream inbound workflow
  Parse reply (1 = approve, 2 = flag)
        │
   ┌────┴────┐
APPROVE    FLAG
   │          │
Update Glide  Update Glide
status:       status:
"approved"    "needs_review"
   │          │
Confirm msg  Notify manager
to sender    via WhatsApp
```

## Glide Webhook Configuration

In Glide (Settings → Automations):
- Trigger: "When row is added" on Sales Orders table
- Action: "Call webhook" → Pipedream HTTP trigger URL
- Payload: Include customer, value, delivery date, approver phone

## WhatsApp Message Template

```
🆕 *New Sales Order — Approval Required*

Customer:  {customer_name}
Order #:   {order_number}
Value:     ${order_value}
Delivery:  {delivery_date}
Rep:       {sales_rep}

Reply *1* to APPROVE
Reply *2* to FLAG FOR REVIEW
Reply *3* for MORE INFO
```

## Confirmation Messages

**On approval:**
```
✅ SO #{order_number} approved.
Record updated. {customer_name} has been notified.
```

**On flag:**
```
🔴 SO #{order_number} flagged for review.
{manager_name} has been notified.
```

## Inbound WhatsApp Handling

Twilio must be configured with an inbound webhook URL pointing to a Pipedream HTTP trigger. The workflow:
1. Receives Twilio POST: `{From, Body, MessageSid}`
2. Looks up pending approval by `From` phone number (stored in state table)
3. Routes based on `Body` content ("1", "2", "3", or free text)
4. Executes appropriate Glide API write
5. Sends confirmation reply

## State Management

A Supabase table (`whatsapp_sessions`) tracks pending conversations:

```sql
CREATE TABLE whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  context_type text NOT NULL, -- 'so_approval', 'forecast_update', etc.
  context_id text NOT NULL,   -- sales order ID, forecast line ID, etc.
  options jsonb,              -- { "1": "approve", "2": "flag" }
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  resolved_at timestamptz
);
```

## Dependencies

- Glide webhook trigger configured in target project
- Glide API Bearer token (already connected)
- Twilio inbound webhook URL configured in Twilio Console
- Pipedream inbound routing workflow deployed
- Supabase `whatsapp_sessions` table (or equivalent state store)

## Implementation Steps

1. Build inbound WhatsApp routing workflow in Pipedream
2. Configure Twilio inbound webhook URL (Messaging → WhatsApp Senders)
3. Create `whatsapp_sessions` state table in Supabase
4. Configure Glide automation to fire webhook on new SO
5. Build outbound Pipedream workflow (receive Glide webhook → send WhatsApp)
6. Test full round-trip with sandbox number
7. Connect Glide write-back
8. Expand to real team numbers

## Notes

- Session state is crucial — multiple people may have pending approvals simultaneously. The `phone` + `context_type` + `expires_at` combination uniquely routes replies to the right record.
- For production WhatsApp (non-sandbox), the initial outbound message must use a Meta-approved template. The approval choice message format should be submitted for template approval early.
- Consider timeout handling: if no reply within 24 hours, auto-escalate or re-send.
