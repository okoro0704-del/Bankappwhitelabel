import type { SessionUser } from '../types/api';

/** Post-login home: Master platform first, then tenant admin, then customer app. */
export function homePathForUser(appUser: SessionUser): string {
  if (appUser.isMasterAdmin) return '/master';
  if (appUser.role === 'admin') return '/admin';
  return '/app';
}
