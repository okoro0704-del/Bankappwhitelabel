import type { TenantBranding } from '../types/tenant';
import { DEFAULT_NORTHLINE_BRANDING } from '../types/tenant';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Accept only #RRGGBB; otherwise return the fallback. */
export function sanitizeHexColor(value: string | null | undefined, fallback: string): string {
  if (typeof value === 'string' && HEX_COLOR.test(value.trim())) {
    return value.trim().toUpperCase();
  }
  return fallback;
}

/**
 * Allow only absolute http(s) URLs for logos/favicons.
 * Blocks javascript:, data:, and relative paths that could be surprising.
 */
export function sanitizePublicUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeBranding(branding: TenantBranding): TenantBranding {
  const defaults = DEFAULT_NORTHLINE_BRANDING;
  return {
    applicationName: branding.applicationName?.trim() || defaults.applicationName,
    logoUrl: sanitizePublicUrl(branding.logoUrl),
    faviconUrl: sanitizePublicUrl(branding.faviconUrl),
    primaryColor: sanitizeHexColor(branding.primaryColor, defaults.primaryColor),
    secondaryColor: sanitizeHexColor(branding.secondaryColor, defaults.secondaryColor),
    accentColor: sanitizeHexColor(branding.accentColor, defaults.accentColor),
    loginHeadline: branding.loginHeadline?.trim() || null,
    loginSubtitle: branding.loginSubtitle?.trim() || null,
    supportEmail: branding.supportEmail?.trim() || null,
    supportPhone: branding.supportPhone?.trim() || null,
  };
}

function softAccent(hex: string): string {
  // Approximate a soft tint without a color library (8-digit hex with alpha).
  return `${hex}26`;
}

function darkenHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 24);
  const g = Math.max(0, ((n >> 8) & 0xff) - 24);
  const b = Math.max(0, (n & 0xff) - 24);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Apply tenant colors onto CSS custom properties used by the design system. */
export function applyTenantCssVariables(branding: TenantBranding, root: HTMLElement = document.documentElement): void {
  const safe = sanitizeBranding(branding);
  root.style.setProperty('--tenant-primary', safe.primaryColor);
  root.style.setProperty('--tenant-secondary', safe.secondaryColor);
  root.style.setProperty('--tenant-accent', safe.accentColor);
  // Map into existing tokens so buttons/nav pick up tenant colors without scattered inline styles.
  root.style.setProperty('--nl-brand', safe.primaryColor);
  root.style.setProperty('--nl-accent', safe.secondaryColor);
  root.style.setProperty('--nl-accent-hover', darkenHex(safe.secondaryColor));
  root.style.setProperty('--nl-accent-soft', softAccent(safe.secondaryColor));
}

export function clearTenantCssVariables(root: HTMLElement = document.documentElement): void {
  for (const key of [
    '--tenant-primary',
    '--tenant-secondary',
    '--tenant-accent',
    '--nl-brand',
    '--nl-accent',
    '--nl-accent-hover',
    '--nl-accent-soft',
  ]) {
    root.style.removeProperty(key);
  }
}

export function applyDocumentTitle(applicationName: string): void {
  const name = applicationName.trim() || 'Application';
  if (document.title !== name) {
    document.title = name;
  }
}

const FAVICON_ATTR = 'data-tenant-favicon';

export function applyFavicon(faviconUrl: string | null): void {
  const safe = sanitizePublicUrl(faviconUrl);
  let link = document.querySelector<HTMLLinkElement>(`link[rel="icon"][${FAVICON_ATTR}]`);

  if (!safe) {
    if (link) {
      link.remove();
    }
    // Restore default favicon if present in the document head.
    const fallback = document.querySelector<HTMLLinkElement>('link[rel="icon"]:not([data-tenant-favicon])');
    if (!fallback) {
      const restored = document.createElement('link');
      restored.rel = 'icon';
      restored.type = 'image/svg+xml';
      restored.href = '/favicon.svg';
      document.head.appendChild(restored);
    }
    return;
  }

  if (!link) {
    // Prefer updating the existing favicon link once, then mark it.
    link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
    link.rel = 'icon';
    link.setAttribute(FAVICON_ATTR, 'true');
    if (!link.parentElement) {
      document.head.appendChild(link);
    }
  }

  link.href = safe;
}

export function brandInitial(applicationName: string): string {
  const trimmed = applicationName.trim();
  return (trimmed[0] ?? 'A').toUpperCase();
}
