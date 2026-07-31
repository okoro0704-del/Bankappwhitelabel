import { NotFoundError } from '../../utils/errors';
import { NORTHLINE_TENANT_SLUG } from '../../tenants/constants';
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

const stripPort = (host: string): string => {
  // IPv6 in brackets: [::1]:3000
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  if (colon > -1 && host.indexOf(':') === colon) {
    return host.slice(0, colon);
  }
  return host;
};

/**
 * Extract a tenant label from a hostname.
 * brand-a.example.com → brand-a
 * localhost / 127.0.0.1 → null (use development default)
 */
export const extractTenantLabelFromHostname = (hostname: string): string | null => {
  const host = stripPort(hostname.trim().toLowerCase());
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return null;
  }

  // Bare IP addresses are not subdomain tenants.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return null;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) {
    // Single-label host (e.g. "northline") — treat as slug/subdomain directly.
    return parts[0] ?? null;
  }

  // brand.example.com → brand; ignore www.
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
 * Authoritative resolution is server-side (hostname / controlled dev overrides).
 * Client-supplied tenant IDs in bodies are never used here.
 */
export class TenantResolver {
  constructor(private readonly repo: TenantRepositoryPort = tenantRepository) {}

  async resolve(input: TenantResolutionInput): Promise<TenantWithBranding> {
    const hostHeader =
      input.hostname ??
      headerValue(input.headers, 'x-forwarded-host') ??
      headerValue(input.headers, 'host');

    // Development escape hatch — disabled in production.
    if (allowDevTenantHeader()) {
      const headerSlug = headerValue(input.headers, 'x-tenant-slug')?.trim().toLowerCase();
      if (headerSlug) {
        return this.requireBySlugOrSubdomain(headerSlug);
      }
    }

    if (hostHeader) {
      const label = extractTenantLabelFromHostname(hostHeader);
      if (label) {
        return this.requireBySlugOrSubdomain(label);
      }
    }

    // Local / unresolved host → development default (Northline).
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
