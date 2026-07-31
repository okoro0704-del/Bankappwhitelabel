export type TenantStatus = 'active' | 'inactive';

export interface TenantBranding {
  applicationName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  loginHeadline: string | null;
  loginSubtitle: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  ownerUserId: string | null;
  subdomain: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantConfiguration {
  tenantId: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subdomain: string;
  branding: TenantBranding;
}

export interface MasterTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subdomain: string;
  ownerUserId: string | null;
  applicationName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MasterTenantDetail {
  tenant: Tenant;
  branding: TenantBranding;
}

export interface CreateTenantRequest {
  name: string;
  slug: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBranding>;
}

export interface UpdateTenantRequest {
  name?: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBranding>;
}

/** Deterministic Northline tenant id (matches backend migration seed). */
export const NORTHLINE_TENANT_ID = 'a0000000-0000-4000-8000-000000000001';

export const NORTHLINE_TENANT_SLUG = 'northline';

export const DEFAULT_NORTHLINE_BRANDING: TenantBranding = {
  applicationName: 'Northline',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#0B3D2E',
  secondaryColor: '#1F6F56',
  accentColor: '#C4A35A',
  loginHeadline: 'Welcome to Northline',
  loginSubtitle: 'Sign in to manage your account.',
  supportEmail: 'support@northline.example',
  supportPhone: null,
};

export const DEFAULT_NEW_TENANT_BRANDING: TenantBranding = {
  applicationName: '',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#0B3D2E',
  secondaryColor: '#1F6F56',
  accentColor: '#C4A35A',
  loginHeadline: 'Welcome',
  loginSubtitle: 'Sign in to continue.',
  supportEmail: null,
  supportPhone: null,
};

export const DEFAULT_NORTHLINE_CONFIGURATION: TenantConfiguration = {
  tenantId: NORTHLINE_TENANT_ID,
  name: 'Northline',
  slug: NORTHLINE_TENANT_SLUG,
  status: 'active',
  subdomain: 'northline',
  branding: DEFAULT_NORTHLINE_BRANDING,
};
