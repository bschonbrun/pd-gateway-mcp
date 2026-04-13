# Acme Corp NL Q&A Pattern Standard

## Purpose

This rule establishes the mandatory architecture for any new data domain added to Acme Corp's analytical infrastructure. Every new data source must follow this pattern to ensure consistency, maintainability, and self-improvement via automated evaluation.

## Standard Components (All Required)

| Component | Naming | Description |
|-----------|--------|-------------|
| **Sync pipeline** | `sync-{source}-to-supabase` | Pipedream scheduled workflow, daily upsert |
| **Supabase tables** | `{domain}_*` | Raw data tables with `synced_at` column |
| **Query engine** | `{domain}-query` | Supabase edge function, NL → SQL → formatted answer |
| **Query log** | `{domain}_query_log` | Every question + SQL + answer logged |
| **Golden dataset** | `{domain}_query_golden` | Curated Q&A pairs with `approved` + `promoted` flags |
| **Feedback table** | `{domain}_query_feedback` | Slack thumbs up/down linked to log |
| **Eval engine** | `{domain}-query-eval` | Runs golden set, uses Claude Haiku to judge |
| **Eval runs log** | `{domain}_eval_runs` | Pass/fail rate over time |

## Query Engine Requirements

Each `{domain}-query` edge function must include:
- **Schema context**: Full table definitions with business terminology
- **Business rules**: Domain-specific formulas and filtering logic
- **Golden injection**: Fetches `approved=true AND promoted=true` rows at runtime, injects as few-shot examples
- **SQL validation**: Whitelist SELECT only; reject forbidden DDL/DML
- **Query log**: Log every request to `{domain}_query_log`

## Slack Command Routing

All commands route through the single `slack-qa` edge function.

| Command | Engine | Domain |
|---------|--------|--------|
| `/ask` | Resolved by channel | Context-dependent |
| `/revenue` | `nl-query` | Sales revenue |
| `/forecast` | `nl-query` | Sales forecast |
| `/expense` | `expense-query` | Employee expense reports |
| `/spend` | `expense-query` | Employee expense reports |
| `/po` | `expense-query` | Purchase orders / bills |
| `/ap` | `expense-query` | Accounts payable |
| `/ar` | `expense-query` | Accounts receivable (future) |

**To add a new domain:**
1. Add its command(s) to `EXPENSE_CMDS` or create a new set in `slack-qa/index.ts`
2. Map the command to the new engine slug

## Channel-Based Routing (for `/ask`)

Set the `EXPENSE_CHANNELS` environment variable in Supabase with comma-separated channel IDs. Channels not listed default to the revenue engine.

## Golden Dataset Workflow

1. Queries appear in `{domain}_query_log`
2. Finance/ops team reviews and promotes good examples:
   - Set `approved = true` to include in eval
   - Set `promoted = true` to inject as live few-shot examples
3. Run `{domain}-query-eval` periodically to get pass rate
4. Target: ≥ 90% pass rate on approved golden set

## Eval Engine Pattern

Each eval engine:
- Fetches all `approved = true` golden rows
- Calls the query engine for each question
- Uses **Claude Haiku** as judge (cheap + fast)
- Writes results to `{domain}_eval_runs`
- Updates `last_eval_at`, `last_eval_pass` on each golden row

## Current Domains

| Domain | Engine | Source(s) | Status |
|--------|--------|-----------|--------|
| Revenue | `nl-query` | Supabase `sales_orders`, `forecast_orders` | ✅ Live |
| Expenses | `expense-query` | Expensify + Xero (via Pipedream sync) | 🔄 Sync pending |

## Pipedream Sync Requirements

Each sync workflow must:
- Run on a **daily schedule** (6am recommended)
- Use **upsert** (not insert) to avoid duplicates
- Tag records with `synced_at = now()`
- For multi-company sources: tag with `company_name`
- Pull policy/tenant IDs **dynamically** at sync time (never hardcode)

## Adding a New Domain Checklist

- [ ] Define source system and Pipedream connector
- [ ] Create Supabase tables with `synced_at` and `company_name` if multi-tenant
- [ ] Build Pipedream sync workflow (upsert pattern)
- [ ] Deploy `{domain}-query` edge function following the engine template
- [ ] Create `{domain}_query_log`, `{domain}_query_golden`, `{domain}_query_feedback`, `{domain}_eval_runs` tables
- [ ] Seed 5–10 golden examples with `approved = true, promoted = true`
- [ ] Deploy `{domain}-query-eval` using Claude Haiku judge
- [ ] Register Slack slash command(s) and add to `slack-qa` routing table
- [ ] Add `EXPENSE_CHANNELS` or equivalent env var if channel-specific routing needed
- [ ] Run eval → verify ≥ 90% pass rate
- [ ] Document in this standard under "Current Domains"
