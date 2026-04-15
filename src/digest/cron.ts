/**
 * Standalone cron entry point — no MCP dependency.
 * Can be triggered by: node dist/digest/cron.js
 *                      Supabase pg_cron → edge function
 *                      Pipedream 1-step workflow
 *                      GitHub Actions cron
 *                      macOS launchd
 */
import { runDigest, type DigestChannel } from './index.js';
import { buildDigestConfig } from '../config.js';
import { PipedreamConnectClient } from '../clients/connect-api.js';

const config = buildDigestConfig();

const channels = (process.env['DIGEST_CHANNELS'] || 'slack,email,whatsapp').split(',') as DigestChannel[];
const dry_run  = process.env['DIGEST_DRY_RUN'] === 'true';

// Instantiate the shared Connect client so tokens are cached across calls
// (one token fetch per run, not one per action).
const connect = new PipedreamConnectClient(
  process.env['PIPEDREAM_CLIENT_ID']     || '',
  process.env['PIPEDREAM_CLIENT_SECRET'] || '',
  process.env['PIPEDREAM_PROJECT_ID']    || '',
);

const defaultUser = process.env['PIPEDREAM_EXTERNAL_USER_ID'] || 'cron-runner';

const supabaseUrl = process.env['SUPABASE_URL']      || '';
const supabaseKey = process.env['SUPABASE_ANON_KEY'] || '';

runDigest(
  { dry_run, channels },
  config,
  supabaseUrl,
  supabaseKey,
  (action, props, userId) => connect.runAction(action, props, userId),
  defaultUser,
)
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Digest failed:', err);
    process.exit(1);
  });
