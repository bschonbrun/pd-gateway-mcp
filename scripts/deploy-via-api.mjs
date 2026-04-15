#!/usr/bin/env node
/**
 * Deploy edge function using Supabase MCP server's deploy endpoint.
 * This reads the function from disk and calls the Supabase Management API.
 * 
 * Usage: node scripts/deploy-via-api.mjs <function-name> <access-token>
 */
import { readFileSync } from 'fs';

const PROJECT_ID = 'iykqsdiochxtfrtmuzdr';
const name = process.argv[2];
const token = process.argv[3] || process.env.SUPABASE_ACCESS_TOKEN;

if (!name || !token) {
  console.error('Usage: node scripts/deploy-via-api.mjs <function-name> <access-token>');
  console.error('  or: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-via-api.mjs <function-name>');
  process.exit(1);
}

const content = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
console.log(`📦 ${name}: ${content.length} bytes, ${content.split('\n').length} lines`);

// Deploy using the Management API
const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${name}`;
const boundary = `----FormBoundary${Date.now()}`;
const metadata = JSON.stringify({ name, verify_jwt: false, entrypoint_path: 'index.ts' });
const body = [
  `--${boundary}`,
  `Content-Disposition: form-data; name="metadata"`,
  `Content-Type: application/json`,
  ``,
  metadata,
  `--${boundary}`,
  `Content-Disposition: form-data; name="file"; filename="index.ts"`,
  `Content-Type: application/typescript`,
  ``,
  content,
  `--${boundary}--`,
].join('\r\n');

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  },
  body,
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (res.ok) {
  console.log(`✅ ${name} → v${data?.version ?? '?'}`);
} else {
  console.error(`❌ ${res.status}:`, data);
  process.exit(1);
}
