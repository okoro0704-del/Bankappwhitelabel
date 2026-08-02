import type { SessionUser } from '../types/api';
import { isPlatformBaseHost } from '../tenant/resolve';

function currentHostname(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

function platformBaseDomain(): string {
  return (import.meta.env.VITE_TENANT_BASE_DOMAIN ?? '').trim().toLowerCase();
}

/** True on webfinance.app / www — the Web Finance console host only. */
export function isOnPlatformHost(hostname = currentHostname()): boolean {
  return isPlatformBaseHost(hostname, platformBaseDomain());
}

/**
 * Post-login home.
 * Master console only on the platform apex. Tenant hosts always stay in the tenant app.
 */
export function homePathForUser(appUser: SessionUser, hostname = currentHostname()): string {
  if (appUser.isMasterAdmin && isOnPlatformHost(hostname)) return '/master';
  if (appUser.role === 'admin') return '/admin';
  return '/app';
}

/** Absolute URL for the Web Finance console (apex only). */
export function platformMasterLoginUrl(): string {
  const base = platformBaseDomain();
  if (!base) return '/master/login';
  return `https://${base}/master/login`;
}
