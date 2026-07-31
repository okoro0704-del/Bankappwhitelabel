/**
 * Client-side hostname helpers for eventual tenant UX.
 * Not authoritative — the backend TenantResolver decides the real tenant.
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
