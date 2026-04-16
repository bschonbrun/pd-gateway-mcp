#!/usr/bin/env node
// Deploy edge functions to Supabase using the Management API
// Usage: node scripts/deploy-edge.mjs <function-name> [function-name2 ...]

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PROJECT_ID = 'iykqsdiochxtfrtmuzdr';
let ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  try { ACCESS_TOKEN = readFileSync(join(homedir(), '.supabase_token'), 'utf8').trim(); } catch { /* noop */ }
}
const FUNCTIONS_DIR = 'supabase/functions';

if (!ACCESS_TOKEN) {
  console.error('❌ Set SUPABASE_ACCESS_TOKEN env var or create ~/.supabase_token');
  process.exit(1);
}

const functionNames = process.argv.slice(2);
if (!functionNames.length) {
  console.error('Usage: node scripts/deploy-edge.mjs <function-name> [...]');
  process.exit(1);
}

for (const name of functionNames) {
  const filePath = `${FUNCTIONS_DIR}/${name}/index.ts`;
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.error(`❌ ${filePath} not found`);
    continue;
  }

  console.log(`📦 Deploying ${name} (${content.length} bytes)...`);

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
    // Use the NEW deploy endpoint: POST /v1/projects/{ref}/functions/deploy?slug=<name>
    const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${name}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (res.ok) {
      const version = data?.version ?? '?';
      console.log(`✅ ${name} deployed → v${version}`);
    } else {
      console.error(`❌ ${name} failed (${res.status}):`, data);
    }
  } catch (e) {
    console.error(`❌ ${name} error:`, e.message);
  }
}
