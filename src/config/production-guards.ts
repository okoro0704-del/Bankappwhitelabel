/**
 * Fail-fast checks for unsafe production configuration.
 * Does not print or return secret values.
 */

import { getDeploymentEnvConfig } from './deployment';

export class ProductionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionConfigError';
  }
}

const looksLikePlaceholder = (value: string): boolean =>
  /your-|example\.com|changeme|todo|replace/i.test(value);

/**
 * Validates production (and optionally Netlify) environment configuration.
 * Never logs or returns secret values.
 */
export const assertProductionEnvSafety = (
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const isProduction = env.NODE_ENV === 'production';
  const deployment = getDeploymentEnvConfig(env);

  if (isProduction) {
    if (env.ALLOW_DEV_TENANT_HEADER === 'true') {
      throw new ProductionConfigError(
        'ALLOW_DEV_TENANT_HEADER must not be enabled when NODE_ENV=production',
      );
    }

    if (env.ALLOW_VERIFICATION_CODE_PEEK === 'true') {
      throw new ProductionConfigError(
        'ALLOW_VERIFICATION_CODE_PEEK must not be enabled when NODE_ENV=production',
      );
    }

    const cors = env.CORS_ORIGIN?.trim();
    if (!cors) {
      throw new ProductionConfigError(
        'CORS_ORIGIN is required in production (exact origins and/or https://*.{TENANT_BASE_DOMAIN})',
      );
    }
    if (cors === '*') {
      throw new ProductionConfigError('CORS_ORIGIN must not be * in production');
    }

    if (!env.TENANT_BASE_DOMAIN?.trim()) {
      throw new ProductionConfigError('TENANT_BASE_DOMAIN is required in production');
    }

    if (!env.DEPLOYMENT_DNS_TARGET?.trim() && !env.TENANT_DNS_TARGET?.trim()) {
      throw new ProductionConfigError(
        'DEPLOYMENT_DNS_TARGET is required in production (e.g. your-site.netlify.app)',
      );
    }

    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) {
      throw new ProductionConfigError(
        'SUPABASE_URL and SUPABASE_ANON_KEY are required in production',
      );
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      throw new ProductionConfigError(
        'SUPABASE_SERVICE_ROLE_KEY is required in production (server-only)',
      );
    }
  }

  // Netlify provider must be fully configured whenever selected — including staging.
  if (deployment.provider === 'netlify') {
    if (!deployment.netlifyConfigured) {
      throw new ProductionConfigError(
        'DEPLOYMENT_PROVIDER=netlify requires NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID',
      );
    }
    if (looksLikePlaceholder(deployment.baseDomain)) {
      throw new ProductionConfigError(
        'TENANT_BASE_DOMAIN must be set to the real parent domain when using Netlify',
      );
    }
    if (looksLikePlaceholder(deployment.dnsTarget)) {
      throw new ProductionConfigError(
        'DEPLOYMENT_DNS_TARGET must be set to the shared Netlify site hostname',
      );
    }
  }
};

/** Safe summary for logs — never includes tokens or keys. */
export const getSafeDeploymentConfigSummary = (
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string | boolean | null> => {
  const deployment = getDeploymentEnvConfig(env);
  return {
    provider: deployment.provider,
    baseDomain: deployment.baseDomain,
    dnsTarget: deployment.dnsTarget,
    netlifyConfigured: deployment.netlifyConfigured,
    netlifySiteIdSet: Boolean(deployment.netlifySiteId),
    netlifyDnsZoneIdSet: Boolean(deployment.netlifyDnsZoneId),
    netlifyTokenSet: Boolean(env.NETLIFY_AUTH_TOKEN?.trim()),
    corsOriginSet: Boolean(env.CORS_ORIGIN?.trim()),
  };
};
