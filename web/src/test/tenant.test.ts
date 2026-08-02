import { describe, expect, it } from 'vitest';

import { extractTenantLabelFromHostname, isPlatformBaseHost } from '../tenant/resolve';
import {
  DEFAULT_NORTHLINE_CONFIGURATION,
  NORTHLINE_TENANT_ID,
  NORTHLINE_TENANT_SLUG,
} from '../types/tenant';

describe('tenant hostname helpers', () => {
  it('extracts subdomain labels for branded hosts', () => {
    expect(extractTenantLabelFromHostname('brand-a.example.com')).toBe('brand-a');
    expect(extractTenantLabelFromHostname('Brand-B.Example.COM')).toBe('brand-b');
  });

  it('returns null for local development hosts', () => {
    expect(extractTenantLabelFromHostname('localhost')).toBeNull();
    expect(extractTenantLabelFromHostname('localhost:5173')).toBeNull();
    expect(extractTenantLabelFromHostname('127.0.0.1')).toBeNull();
  });

  it('detects Web Finance platform apex hosts', () => {
    expect(isPlatformBaseHost('webfinance.app', 'webfinance.app')).toBe(true);
    expect(isPlatformBaseHost('www.webfinance.app', 'webfinance.app')).toBe(true);
    expect(isPlatformBaseHost('northline.webfinance.app', 'webfinance.app')).toBe(false);
    expect(isPlatformBaseHost('citbankplc.webfinance.app', 'webfinance.app')).toBe(false);
    // Still platform when Netlify env base domain is wrong/missing
    expect(isPlatformBaseHost('webfinance.app', 'app.example.com')).toBe(true);
    expect(isPlatformBaseHost('webfinance.app', '')).toBe(true);
    expect(isPlatformBaseHost('something.netlify.app', 'webfinance.app')).toBe(false);
  });
});
describe('Northline default tenant configuration', () => {
  it('exposes the seeded Northline defaults without secrets', () => {
    expect(DEFAULT_NORTHLINE_CONFIGURATION.tenantId).toBe(NORTHLINE_TENANT_ID);
    expect(DEFAULT_NORTHLINE_CONFIGURATION.slug).toBe(NORTHLINE_TENANT_SLUG);
    expect(DEFAULT_NORTHLINE_CONFIGURATION.branding.applicationName).toBe('Northline');
    const serialized = JSON.stringify(DEFAULT_NORTHLINE_CONFIGURATION);
    expect(serialized).not.toMatch(/service_role|password|secret/i);
  });
});
