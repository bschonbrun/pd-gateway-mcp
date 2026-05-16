# ADR 001: A curated 23-tool gateway, not Pipedream's full MCP

**Status:** Accepted
**Date:** 2026-04-12
**Author:** Bill (retroactive — documented 2026-05-16)

## Context

Pipedream ships an official MCP server, `@pipedream/mcp`. It exposes every
app in the Pipedream catalogue as its own set of tools — 10,000+ tools total.
Most AI hosts cap their tool list far below that: typically 50–128 tools. A
host pointed at the official server either fails outright or silently
truncates the tool list, making the integration unusable and
unpredictable.

CarboNet needs Pipedream automation (Slack, Outlook, Twilio, workflow
orchestration) driven by an AI agent. It needs a tool surface an AI host can
actually load.

## Decision

Build a thin gateway MCP server (`pd-gateway-mcp`) that exposes **23 curated
tools** instead of proxying the whole catalogue. The 23 follow a
`discover → configure → execute → manage` pattern: generic tools like
`pd_list_apps`, `pd_get_component`, `pd_configure_prop`, and `pd_run_action`
reach the entire 3,000+ app surface dynamically, without one tool per app.

## Alternatives considered

- **A: Use `@pipedream/mcp` directly.** Rejected — 10,000+ tools exceeds every
  practical host cap. Unusable.
- **B: Hand-pick one tool per app CarboNet uses.** Rejected — every new app or
  action needs a code change and redeploy; the tool list still grows
  unbounded over time.
- **C (chosen):** A small fixed set of generic tools that operate over
  Pipedream's own component/action discovery endpoints. The catalogue stays
  reachable; the tool count stays constant at 23.

## Consequences

- **Positive:** Constant, host-loadable tool count regardless of catalogue
  size.
- **Positive:** New Pipedream apps are reachable the day Pipedream adds them —
  no gateway change needed.
- **Negative:** Using an app is a multi-step dance (`list → get_component →
  configure_prop → run_action`) rather than one direct call. Accepted — it is
  the cost of not having 10,000 tools.
- **Locked in:** The tool count is a feature. Adding app-specific tools
  reintroduces the unbounded-growth problem this ADR exists to prevent.

## References
- `docs/ARCHITECTURE.md` — full 23-tool inventory.
- `README.md` — tool tables (note: the README table currently lists only the
  16 Pipedream tools and omits the 7 Tier-5 direct-integration tools).
