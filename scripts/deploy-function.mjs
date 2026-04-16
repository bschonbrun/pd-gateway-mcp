#!/usr/bin/env node
/**
 * Deploy a Supabase Edge Function using the Management API.
 * Usage: node scripts/deploy-function.mjs <function-name> <access-token>
 * 
 * Get your access token at: https://supabase.com/dashboard/account/tokens
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_REF = 'iykqsdiochxtfrtmuzdr';
const functionName = process.argv[2] || 'expense-query';
const accessToken = process.argv[3] || process.env.SUPABASE_ACCESS_TOKEN;

if (!accessToken) {
  console.error('❌ No access token provided.');
  console.error('Usage: node scripts/deploy-function.mjs <function-name> <access-token>');
  console.error('Or set SUPABASE_ACCESS_TOKEN environment variable.');
  console.error('\nGet your token at: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const filePath = resolve(`supabase/functions/${functionName}/index.ts`);
const content = readFileSync(filePath, 'utf-8');

console.log(`🚀 Deploying ${functionName} (${content.length} bytes)...`);

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${functionName}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: content,
      verify_jwt: false,
    }),
  }
);

if (!res.ok) {
  const text = await res.text();
  console.error(`❌ Deploy failed (${res.status}): ${text}`);
  process.exit(1);
}

const data = await res.json();
console.log(`✅ ${functionName} deployed successfully!`);
console.log(`   Version: ${data.version || 'latest'}`);
console.log(`   Updated: ${data.updated_at || new Date().toISOString()}`);
