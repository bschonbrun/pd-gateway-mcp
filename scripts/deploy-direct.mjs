#!/usr/bin/env node
/**
 * Deploy an edge function using the Supabase MCP server's Management API token.
 * Reads the token from environment or .supabase config.
 * 
 * Usage: SUPABASE_ACCESS_TOKEN=xxx node scripts/deploy-direct.mjs <function-name>
 */
import { readFileSync } from 'fs';

const PROJECT_ID = 'iykqsdiochxtfrtmuzdr';
const name = process.argv[2];

if (!name) {
  console.error('Usage: node scripts/deploy-direct.mjs <function-name>');
  process.exit(1);
}

const filePath = `supabase/functions/${name}/index.ts`;
let content;
try {
  content = readFileSync(filePath, 'utf8');
} catch {
  console.error(`❌ ${filePath} not found`);
  process.exit(1);
}

console.log(`📦 Deploying ${name} (${content.length} bytes, ${content.split('\n').length} lines)...`);

// Try to get token from multiple sources
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('❌ SUPABASE_ACCESS_TOKEN not set');
  console.error('Run: npx supabase login');
  console.error('Or set: export SUPABASE_ACCESS_TOKEN=sbp_...');
  process.exit(1);
}

const metadata = JSON.stringify({
  name,
  verify_jwt: false,
  entrypoint_path: 'index.ts',
});

const boundary = `----FormBoundary${Date.now()}`;
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

try {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${name}`;
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
    console.log(`✅ ${name} deployed → v${data?.version ?? '?'}`);
  } else {
    console.error(`❌ ${name} failed (${res.status}):`, data);
  }
} catch (e) {
  console.error(`❌ ${name} error:`, e.message);
}
