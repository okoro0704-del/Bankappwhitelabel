/**
 * Deterministic id for the seeded Northline tenant (first application instance).
 * Must match supabase/migrations/20260731180000_tenant_architecture.sql
 */
export const NORTHLINE_TENANT_ID = 'a0000000-0000-4000-8000-000000000001';

export const NORTHLINE_TENANT_SLUG = 'northline';

export const DEFAULT_NORTHLINE_BRANDING = {
  applicationName: 'Northline',
  logoUrl: null as string | null,
  faviconUrl: null as string | null,
  primaryColor: '#0B3D2E',
  secondaryColor: '#1F6F56',
  accentColor: '#C4A35A',
  loginHeadline: 'Welcome to Northline',
  loginSubtitle: 'Sign in to manage your account.',
  supportEmail: 'support@northline.example',
  supportPhone: null as string | null,
} as const;
