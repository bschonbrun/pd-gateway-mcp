#!/usr/bin/env node
/**
 * Reads a Supabase Edge Function from disk and prints it for MCP deployment.
 * Usage: node scripts/deploy-via-mcp.mjs <function-name>
 * 
 * This script outputs the file content so it can be piped or used.
 */
import { readFileSync } from 'fs';

const name = process.argv[2];
if (!name) { console.error('Usage: node scripts/deploy-via-mcp.mjs <function-name>'); process.exit(1); }

const content = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
console.log(`File: ${name}/index.ts`);
console.log(`Size: ${content.length} bytes`);
console.log(`Lines: ${content.split('\n').length}`);
console.log(`Version line: ${content.split('\n')[0]}`);
