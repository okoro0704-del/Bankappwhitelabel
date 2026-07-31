/**
 * Smallest safe CORS helper for authenticated API traffic.
 * Never returns Access-Control-Allow-Origin: *.
 *
 * Configuration:
 * - CORS_ORIGIN — comma-separated allow-list of frontend origins and/or
 *   single-label subdomain patterns under a concrete base domain:
 *     https://app.example.com
 *     https://*.app.example.com
 * - Patterns only match https://{one-label}.{suffix} — never arbitrary hosts.
 * - When unset and NODE_ENV !== production, localhost Vite origins are allowed
 *   so optional direct browser→API calls work; Vite proxy does not need CORS.
 */

import { isValidSubdomain } from '../tenants/hostname';

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const parseAllowedOrigins = (): string[] => {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== '*');
};

/**
 * Match an exact origin or a https://*.{base} pattern (single DNS label only).
 */
export const originMatchesAllowListEntry = (
  requestOrigin: string,
  entry: string,
): boolean => {
  if (!entry.includes('*')) {
    return requestOrigin === entry;
  }

  // Only https://*.suffix patterns (suffix must contain a dot — e.g. app.example.com).
  const match = /^https:\/\/\*\.([a-z0-9.-]+\.[a-z0-9.-]+)$/i.exec(entry.trim());
  if (!match) {
    return false;
  }

  const suffix = match[1]!.toLowerCase();
  try {
    const url = new URL(requestOrigin);
    if (url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (host === suffix || !host.endsWith(`.${suffix}`)) {
      return false;
    }
    const label = host.slice(0, -(suffix.length + 1));
    if (!label || label.includes('.') || !isValidSubdomain(label)) {
      return false;
    }
    // Reconstruct to avoid suffix tricks.
    return host === `${label}.${suffix}`;
  } catch {
    return false;
  }
};

/**
 * When CORS_ORIGIN lists a tenant wildcard, prefer TENANT_BASE_DOMAIN alignment.
 * Entries that are not patterns still work as exact matches.
 */
export const resolveAllowedOrigin = (
  requestOrigin: string | undefined,
): string | null => {
  const configured = parseAllowedOrigins();

  if (configured.length > 0) {
    if (!requestOrigin) {
      return null;
    }

    for (const entry of configured) {
      if (originMatchesAllowListEntry(requestOrigin, entry)) {
        return requestOrigin;
      }
    }
    return null;
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  if (requestOrigin && LOCAL_DEV_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
};

export const buildCorsHeaders = (
  requestOrigin: string | undefined,
): Record<string, string> => {
  const allowed = resolveAllowedOrigin(requestOrigin);
  if (!allowed) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tenant-Slug',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};
