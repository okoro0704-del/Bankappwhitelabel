import { apiRequest } from './client';
import type { TenantConfiguration } from '../types/tenant';

/**
 * Public tenant branding/configuration for the hostname-resolved tenant.
 * Does not require authentication.
 */
export const getTenantConfig = () =>
  apiRequest<TenantConfiguration>('/api/tenant/config', { auth: false });
