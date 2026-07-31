/**
 * Server-only Netlify + deployment configuration.
 * Never expose NETLIFY_AUTH_TOKEN through VITE_* or API responses.
 */

export type DeploymentProviderId = 'manual' | 'netlify';

export type DeploymentEnvConfig = {
  /** Public base domain for tenant hostnames, e.g. app.example.com */
  baseDomain: string;
  /** CNAME target customers / Netlify DNS should point tenant hostnames at */
  dnsTarget: string;
  provider: DeploymentProviderId;
  /** Shared white-label Netlify site id (server-only) */
  netlifySiteId: string | null;
  /** Optional explicit DNS zone id; otherwise resolved from base domain */
  netlifyDnsZoneId: string | null;
  /** True when token + site id are present for Netlify provider */
  netlifyConfigured: boolean;
};

const DEFAULT_BASE_DOMAIN = 'app.example.com';
const DEFAULT_DNS_TARGET = 'edgeserver.example.com';

const resolveProvider = (env: NodeJS.ProcessEnv): DeploymentProviderId => {
  const explicit = (env.DEPLOYMENT_PROVIDER ?? '').trim().toLowerCase();
  if (explicit === 'netlify' || explicit === 'manual') {
    return explicit;
  }
  if (env.NETLIFY_AUTH_TOKEN?.trim() && env.NETLIFY_SITE_ID?.trim()) {
    return 'netlify';
  }
  return 'manual';
};

export const getDeploymentEnvConfig = (
  env: NodeJS.ProcessEnv = process.env,
): DeploymentEnvConfig => {
  const baseDomain = (env.TENANT_BASE_DOMAIN ?? DEFAULT_BASE_DOMAIN).trim().toLowerCase();
  const dnsTarget = (
    env.DEPLOYMENT_DNS_TARGET ??
    env.TENANT_DNS_TARGET ??
    DEFAULT_DNS_TARGET
  )
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');

  const netlifySiteId = env.NETLIFY_SITE_ID?.trim() || null;
  const netlifyDnsZoneId = env.NETLIFY_DNS_ZONE_ID?.trim() || null;
  const tokenPresent = Boolean(env.NETLIFY_AUTH_TOKEN?.trim());
  const provider = resolveProvider(env);

  return {
    baseDomain: baseDomain || DEFAULT_BASE_DOMAIN,
    dnsTarget: dnsTarget || DEFAULT_DNS_TARGET,
    provider,
    netlifySiteId,
    netlifyDnsZoneId,
    netlifyConfigured: tokenPresent && Boolean(netlifySiteId),
  };
};

/** Server-only — never log or return this value. */
export const getNetlifyAuthToken = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const token = env.NETLIFY_AUTH_TOKEN?.trim();
  return token || null;
};
