# Using the pd-gateway-mcp with Glide

This repository contains the **Pipedream Gateway MCP** (`pd-gateway-mcp`). It allows AI agents (like Cursor or Claude) to build, deploy, and manage Pipedream workflows autonomously.

## Why use this with Glide?
Glide has a solid internal workflow engine with about 100 native integrations. However, some projects require external integrations or more complex automation. Pipedream has over 3,000 apps and 10,000+ native actions.

By connecting this MCP to your AI assistant, you can have the AI automatically build the Pipedream backend for your Glide app.

## Key Patterns

1. **Webhook Ingestion**
   Create a "Trigger Webhook" action in Glide. Have your AI use this MCP to spin up a listening Pipedream workflow that catches the webhook, formats the data, and sends it to external APIs that aren't natively supported by Glide.

2. **Supabase Sync**
   If your Glide app runs on Supabase, the AI can deploy Pipedream cron jobs or database listeners that manipulate your Supabase records in the background. Your Glide frontend will instantly reflect these changes.

## How it Works
Typically, Pipedream's massive action library (10,000+ tools) overwhelms AI agents context limits. This MCP compresses the entire Pipedream API into 16 tools using a `discover → configure → execute` pattern. This allows your AI to dynamically search for apps and trigger logic on the fly without breaking.

See `README.md` for local setup steps.
