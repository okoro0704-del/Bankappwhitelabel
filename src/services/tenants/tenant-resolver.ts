import { NotFoundError } from '../../utils/errors';
import { NORTHLINE_TENANT_SLUG } from '../../tenants/constants';
import {
  extractTenantLabelUnderBaseDomain,
  isLocalDevHostname,
  stripHostnamePort,
} from '../../tenants/hostname';
import { getDeploymentEnvConfig } from '../../config/deployment';
import type { TenantWithBranding } from '../../types';
import {
  tenantRepository,
  type TenantRepositoryPort,
} from '../../repositories/tenants/tenant-repository';

export type TenantResolutionInput = {
  /** HTTP Host header (may include port). */
  hostname?: string | null;
  /** Optional forwarded host. */
  headers?: Record<string, string | string[] | undefined>;
  /** Query params — never used for production authorization. */
  query?: Record<string, string | undefined>;
};

const headerValue = (
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined => {
  if (!headers) return undefined;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
};

/** Hostname from a browser Origin / Referer URL (cross-origin SPA → API). */
export const extractHostnameFromOriginHeader = (origin: string | undefined): string | null => {
  if (!origin?.trim()) return null;
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return stripHostnamePort(url.hostname) || null;
  } catch {
    return null;
  }
};

/**
 * Prefer proxy / browser page host over the API server Host header.
 * Order: explicit → X-Forwarded-Host → Origin → Host.
 */
export const resolveRequestHostname = (input: TenantResolutionInput): string | null => {
  if (input.hostname?.trim()) {
    return stripHostnamePort(input.hostname);
  }
  const forwarded = headerValue(input.headers, 'x-forwarded-host');
  if (forwarded?.trim()) {
    // X-Forwarded-Host may be a comma-separated list; use the first hop.
    return stripHostnamePort(forwarded.split(',')[0] ?? forwarded);
  }
  const fromOrigin = extractHostnameFromOriginHeader(headerValue(input.headers, 'origin'));
  if (fromOrigin) {
    return fromOrigin;
  }
  const host = headerValue(input.headers, 'host');
  return host?.trim() ? stripHostnamePort(host) : null;
};

/**
 * @deprecated Prefer extractTenantLabelUnderBaseDomain with TENANT_BASE_DOMAIN.
 * Kept for backward-compatible unit tests of unconstrained label parsing.
 * Not used for authoritative TenantResolver identity.
 */
export const extractTenantLabelFromHostname = (hostname: string): string | null => {
  const host = stripHostnamePort(hostname);
  if (!host || isLocalDevHostname(host)) {
    return null;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return null;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) {
    return parts[0] ?? null;
  }

  const label = parts[0];
  if (label === 'www' && parts.length >= 3) {
    return parts[1] ?? null;
  }
  if (label === 'www') {
    return null;
  }
  return label ?? null;
};

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

const allowDevTenantHeader = (): boolean =>
  !isProduction() && process.env.ALLOW_DEV_TENANT_HEADER === 'true';

const defaultDevSlug = (): string =>
  (process.env.TENANT_DEV_DEFAULT_SLUG ?? NORTHLINE_TENANT_SLUG).trim().toLowerCase();

/**
 * Resolves which tenant is being accessed.
 * Authoritative resolution is server-side (hostname under TENANT_BASE_DOMAIN).
 * Client-supplied tenant IDs in bodies / query / localStorage are never used here.
 */
export class TenantResolver {
  constructor(private readonly repo: TenantRepositoryPort = tenantRepository) {}

  async resolve(input: TenantResolutionInput): Promise<TenantWithBranding> {
    // Development escape hatch — disabled in production.
    if (allowDevTenantHeader()) {
      const headerSlug = headerValue(input.headers, 'x-tenant-slug')?.trim().toLowerCase();
      if (headerSlug) {
        return this.requireBySlugOrSubdomain(headerSlug);
      }
    }

    const host = resolveRequestHostname(input);
    const baseDomain = getDeploymentEnvConfig().baseDomain;

    if (host) {
      if (isLocalDevHostname(host)) {
        if (isProduction()) {
          throw new NotFoundError('Tenant not found');
        }
        return this.requireBySlugOrSubdomain(defaultDevSlug());
      }

      const label = extractTenantLabelUnderBaseDomain(host, baseDomain);
      if (label) {
        return this.requireBySlugOrSubdomain(label);
      }

      // Present but not a valid tenant host under the configured base domain.
      throw new NotFoundError('Tenant not found');
    }

    if (isProduction()) {
      throw new NotFoundError('Tenant not found');
    }

    // Local / missing host → development default only.
    return this.requireBySlugOrSubdomain(defaultDevSlug());
  }

  private async requireBySlugOrSubdomain(label: string): Promise<TenantWithBranding> {
    const bySubdomain = await this.repo.findBySubdomain(label);
    if (bySubdomain) {
      return bySubdomain;
    }
    const bySlug = await this.repo.findBySlug(label);
    if (bySlug) {
      return bySlug;
    }
    throw new NotFoundError('Tenant not found');
  }
}

const defaultTenantResolver = new TenantResolver();
let activeTenantResolver: TenantResolver = defaultTenantResolver;

export const tenantResolver: TenantResolver = new Proxy({} as TenantResolver, {
  get(_target, prop, _receiver) {
    const value = Reflect.get(activeTenantResolver, prop, activeTenantResolver);
    return typeof value === 'function' ? value.bind(activeTenantResolver) : value;
  },
});

export const setTenantResolverForTests = (resolver: TenantResolver): void => {
  activeTenantResolver = resolver;
};

export const resetTenantResolverForTests = (): void => {
  activeTenantResolver = defaultTenantResolver;
};

// Re-export for tests and callers that need the hardened extractor.
export { extractTenantLabelUnderBaseDomain } from '../../tenants/hostname';
