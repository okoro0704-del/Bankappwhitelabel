/**
 * Server-side hostname generation and base-domain-bound label extraction.
 * Authoritative tenant identity still comes from TenantResolver + DB — not the client.
 */

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Labels that must not be claimed as tenant subdomains. */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'master',
  'static',
  'assets',
  'cdn',
  'mail',
  'ftp',
  'localhost',
  'staging',
  'dev',
  'status',
  'docs',
]);

export const normalizeSubdomain = (value: string): string => value.trim().toLowerCase();

export const isValidSubdomain = (value: string): boolean =>
  SUBDOMAIN_REGEX.test(normalizeSubdomain(value));

export const isReservedSubdomain = (value: string): boolean =>
  RESERVED_SUBDOMAINS.has(normalizeSubdomain(value));

export const normalizeBaseDomain = (value: string): string =>
  value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');

/** Strip a trailing :port (supports IPv6 in brackets). */
export const stripHostnamePort = (hostname: string): string => {
  const host = hostname.trim().toLowerCase();
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

export const isLocalDevHostname = (hostname: string): boolean => {
  const host = stripHostnamePort(hostname);
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  );
};

/**
 * Extract a tenant label only when the hostname is exactly under the configured base domain.
 *
 * Allows:
 *   {label}.{baseDomain}
 *   www.{label}.{baseDomain}
 *
 * Rejects attacker-style hosts such as:
 *   {label}.attacker-example.com  (when base is example.com / app.example.com)
 *   {baseDomain}.attacker.com
 *   multi-level prefixes (a.b.{baseDomain})
 */
export const extractTenantLabelUnderBaseDomain = (
  hostname: string,
  baseDomain: string,
): string | null => {
  const host = stripHostnamePort(hostname);
  const base = normalizeBaseDomain(baseDomain);

  if (!host || !base || isLocalDevHostname(host)) {
    return null;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return null;
  }
  if (host === base) {
    return null;
  }
  if (!host.endsWith(`.${base}`)) {
    return null;
  }

  const prefix = host.slice(0, -(base.length + 1));
  if (!prefix || prefix.startsWith('.') || prefix.endsWith('.')) {
    return null;
  }

  const parts = prefix.split('.').filter(Boolean);
  let label: string | null = null;
  if (parts.length === 1) {
    label = parts[0] ?? null;
  } else if (parts.length === 2 && parts[0] === 'www') {
    label = parts[1] ?? null;
  } else {
    return null;
  }

  if (!label || !isValidSubdomain(label) || isReservedSubdomain(label)) {
    return null;
  }

  // Reconstruct — refuse suffix / casing tricks.
  const expected = `${label}.${base}`;
  if (host !== expected && host !== `www.${expected}`) {
    return null;
  }

  return label;
};

/**
 * Build the expected public hostname for a tenant subdomain.
 * Example: subdomain "capitaltrust", baseDomain "app.example.com"
 * → "capitaltrust.app.example.com"
 */
export const buildTenantHostname = (subdomain: string, baseDomain: string): string => {
  const label = normalizeSubdomain(subdomain);
  const base = normalizeBaseDomain(baseDomain);

  if (!label || !isValidSubdomain(label)) {
    throw new Error('Invalid subdomain for hostname generation');
  }
  if (isReservedSubdomain(label)) {
    throw new Error('Reserved subdomain for hostname generation');
  }
  if (!base || base.includes('://') || /\s/.test(base)) {
    throw new Error('Invalid base domain for hostname generation');
  }

  // Avoid duplicating the label if the base domain already includes it.
  if (base === label || base.startsWith(`${label}.`)) {
    return base;
  }

  return `${label}.${base}`;
};

/**
 * Authoritative customer login URL. Always HTTPS for generated tenant hosts.
 * Development localhost handoff is not generated here — Master uses TENANT_BASE_DOMAIN.
 */
export const buildTenantLoginUrl = (hostname: string): string => {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!host || host.includes('/') || host.includes(' ') || host.includes('?')) {
    throw new Error('Invalid hostname for login URL');
  }
  if (isLocalDevHostname(host)) {
    return `http://${stripHostnamePort(host)}/login`;
  }
  return `https://${host}/login`;
};
