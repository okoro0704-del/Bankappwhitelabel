/**
 * Client-side hostname helpers for public tenant branding lookup.
 * Authoritative active-tenant check still happens in get_tenant_public_config RPC.
 */

export const extractTenantLabelFromHostname = (hostname: string): string | null => {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, '');
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
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

/** Extract tenant label only when host is exactly under the configured base domain. */
export const extractTenantLabelUnderBaseDomain = (
  hostname: string,
  baseDomain: string,
): string | null => {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, '');
  const base = baseDomain.trim().toLowerCase().replace(/:\d+$/, '');
  if (!host || !base) return null;
  if (host === base) return null;
  if (!host.endsWith(`.${base}`)) return null;

  const label = host.slice(0, -(base.length + 1));
  if (!label || label.includes('.')) return null;
  if (['www', 'api', 'master', 'admin'].includes(label)) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  return label;
};

/** Apex / www of the tenant base domain — Web Finance platform host, not a tenant app. */
export const isPlatformBaseHost = (hostname: string, baseDomain: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, '');
  const base = baseDomain.trim().toLowerCase().replace(/:\d+$/, '');
  if (!host || !base) return false;
  return host === base || host === `www.${base}`;
};
