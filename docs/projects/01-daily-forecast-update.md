# Project 1: Daily Forecast Update

Send a daily revenue and forecast summary to leadership via WhatsApp, Slack, and Email — fully automated, no dashboard required.

> **No LLM required.** The format is fixed, the data is structured, and aggregation is handled in SQL. This is a pure data pipeline: query → template → send.

## Overview

A scheduled Pipedream workflow queries Supabase for the latest revenue data, formats it using Claude, and pushes it to all configured channels simultaneously. Replaces manual reporting and ensures the team starts each day with a clear financial picture.

## Status

- [x] WhatsApp channel (Twilio) — connected and tested
- [x] Slack channel — connected
- [x] Email channel (Outlook) — connected
- [ ] Supabase query — confirm table/column names
- [ ] Pipedream scheduled workflow — not built
- [ ] Message template string — not built
- [ ] Multi-recipient configuration — not built

## Architecture

```
Pipedream Scheduled Trigger (daily, 7am PT)
        │
        ▼
Supabase Query (single aggregated SQL)
  → MTD actual revenue by market
  → MTD forecast by market
  → Variance (actual - forecast)
  → Top/bottom performing markets
        │
        ▼
Template string (hardcoded format, filled with query results)
        │
        ▼
Fan out in parallel:
  ├── send_whatsapp → recipient list
  ├── slack-send-message → #revenue channel
  └── microsoft_outlook-send-email → distribution list
```

## Message Format (WhatsApp / Slack)

```
📊 *CarboNet Revenue — {date}*

MTD Actual:    ${actual}
MTD Forecast:  ${forecast}
Variance:      ${variance} ({variance_pct}%)

Top markets:
🟢 {market_1}   ${revenue_1}
🟡 {market_2}   ${revenue_2}
🔴 {market_3}   ${revenue_3}

Reply INFO for full breakdown
```

## Supabase Queries Required

```sql
-- MTD actuals by market
SELECT market, SUM(revenue) as actual
FROM sales_orders
WHERE date_trunc('month', order_date) = date_trunc('month', CURRENT_DATE)
GROUP BY market ORDER BY actual DESC;

-- MTD forecast by market
SELECT market, SUM(revenue) as forecast
FROM forecast_lines
WHERE status NOT IN ('cancelled', 'forecast_replaced')
  AND date_trunc('month', delivery_date) = date_trunc('month', CURRENT_DATE)
GROUP BY market ORDER BY forecast DESC;
```

## Configuration

| Parameter | Value |
|-----------|-------|
| Schedule | Daily, 7:00am PT (weekdays) |
| Supabase Project | TBD — confirm which project |
| WhatsApp recipients | `+16047830407` (expand as needed) |
| Slack channel | `#revenue` or `#leadership` |
| Email recipients | Distribution list TBD |

## Dependencies

- Supabase project URL + service_role key for the manufacturing dashboard project
- Confirm table/column names for revenue data

## Implementation Steps

1. Confirm Supabase project and table schema
2. Get Anthropic API key, add to Pipedream environment
3. Build and test Supabase query in isolation
4. Build Pipedream workflow: schedule → query → Claude → fan-out
5. Test on sandbox recipients
6. Expand recipient lists
7. Set live schedule

## Notes

- WhatsApp has a 24-hour session window for freeform messages. For business-initiated messages sent on a schedule, **Meta-approved templates** are required for production (non-sandbox). Plan for template approval before full team rollout.
- Email version can be richer HTML with tables; WhatsApp/Slack use plain text with emoji formatting.
