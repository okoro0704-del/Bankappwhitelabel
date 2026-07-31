/**
 * Reports which live-deployment env vars are present without printing secrets.
 * Usage: npm run check:live-env
 */

import 'dotenv/config';
import { getDeploymentEnvConfig } from '../config/deployment';
import { getSafeDeploymentConfigSummary } from '../config/production-guards';

type Presence = 'SET' | 'MISSING' | 'PLACEHOLDER';

const isPlaceholder = (value: string): boolean =>
  /your-|changeme|todo|replace|example\.com|edgeserver\.example/i.test(value);

const presence = (key: string, opts?: { allowPlaceholder?: boolean }): Presence => {
  const raw = process.env[key]?.trim() ?? '';
  if (!raw) return 'MISSING';
  if (!opts?.allowPlaceholder && isPlaceholder(raw)) return 'PLACEHOLDER';
  return 'SET';
};

const lines: string[] = [];
const push = (label: string, status: Presence | string) => {
  lines.push(`${label.padEnd(32)} ${status}`);
};

push('SUPABASE_URL', presence('SUPABASE_URL'));
push('SUPABASE_ANON_KEY', presence('SUPABASE_ANON_KEY', { allowPlaceholder: false }));
push('SUPABASE_SERVICE_ROLE_KEY', presence('SUPABASE_SERVICE_ROLE_KEY', { allowPlaceholder: false }));
push('TENANT_BASE_DOMAIN', presence('TENANT_BASE_DOMAIN'));
push('DEPLOYMENT_DNS_TARGET', presence('DEPLOYMENT_DNS_TARGET'));
push('CORS_ORIGIN', presence('CORS_ORIGIN', { allowPlaceholder: true }));
push('DEPLOYMENT_PROVIDER', process.env.DEPLOYMENT_PROVIDER?.trim() || '(unset→auto/manual)');
push('NETLIFY_AUTH_TOKEN', presence('NETLIFY_AUTH_TOKEN', { allowPlaceholder: false }));
push('NETLIFY_SITE_ID', presence('NETLIFY_SITE_ID', { allowPlaceholder: false }));
push('NETLIFY_DNS_ZONE_ID', presence('NETLIFY_DNS_ZONE_ID', { allowPlaceholder: true }));
push('INTEGRATION_ADMIN_EMAIL', presence('INTEGRATION_ADMIN_EMAIL', { allowPlaceholder: true }));
push('INTEGRATION_ADMIN_PASSWORD', presence('INTEGRATION_ADMIN_PASSWORD', { allowPlaceholder: false }));
push('VITE_SUPABASE_URL (web)', process.env.VITE_SUPABASE_URL ? 'SET_IN_PROCESS' : 'check web/.env separately');

const deployment = getDeploymentEnvConfig();
const summary = getSafeDeploymentConfigSummary();

console.log('Live environment presence (values intentionally omitted):\n');
console.log(lines.join('\n'));
console.log('\nSafe deployment summary:');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nResolved provider: ${deployment.provider}`);
console.log(`Netlify configured: ${deployment.netlifyConfigured}`);

const blocking = [
  presence('SUPABASE_URL'),
  presence('SUPABASE_ANON_KEY'),
  presence('SUPABASE_SERVICE_ROLE_KEY'),
].filter((s) => s !== 'SET');

const netlifyBlocking =
  deployment.provider === 'netlify' || process.env.DEPLOYMENT_PROVIDER === 'netlify'
    ? [
        presence('NETLIFY_AUTH_TOKEN'),
        presence('NETLIFY_SITE_ID'),
        presence('TENANT_BASE_DOMAIN'),
        presence('DEPLOYMENT_DNS_TARGET'),
      ].filter((s) => s !== 'SET')
    : [];

if (blocking.length || netlifyBlocking.length) {
  console.log('\nResult: NOT READY for live Phase 9 verification.');
  console.log('Copy .env.example → .env and web/.env.example → web/.env, then fill real values.');
  process.exitCode = 1;
} else {
  console.log('\nResult: Required live credentials appear present (presence only — not connectivity-tested).');
  console.log('Next: npm run db:push, npm run setup:initial-admin, then Master Provision on a test tenant.');
}
