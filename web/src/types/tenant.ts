export type TenantStatus = 'active' | 'inactive';

export type TenantDnsStatus = 'not_configured' | 'pending' | 'verified' | 'failed';

export type TenantSslStatus = 'not_configured' | 'pending' | 'verified' | 'failed';

export type TenantDeploymentStatus =
  | 'not_configured'
  | 'waiting_for_dns'
  | 'dns_configured'
  | 'ssl_pending'
  | 'ready';

export interface TenantHomeMetric {
  label: string;
  percent: number;
}

/** Public marketing Home content (tenant-admin editable deliverable). */
export interface TenantHomeContent {
  topBarHours: string;
  tagline: string;
  heroHeadline: string;
  heroSupport: string;
  navHome: string;
  navAbout: string;
  navBanking: string;
  navLoans: string;
  navInvesting: string;
  navCards: string;
  navContact: string;
  bankingTitle: string;
  bankingLead: string;
  bankingBody: string;
  bankingSecondary: string;
  philosophyTitle: string;
  philosophyLead: string;
  philosophyBody: string;
  philosophyHighlight: string;
  whyTitle: string;
  whySubtitle: string;
  visionTitle: string;
  visionBody: string;
  missionTitle: string;
  missionBody: string;
  philosophySectionTitle: string;
  philosophySectionBody: string;
  metrics: TenantHomeMetric[];
  aboutTitle: string;
  aboutBody: string;
  hoursOnline: string;
  hoursSupport: string;
  hoursBranch: string;
  hoursSaturday: string;
  headOfficeTitle: string;
  headOfficeAddress: string;
  footerMission: string;
  footerBorrowing: string;
  footerInvestments: string;
  footerContact: string;
  footerPolicy: string;
  footerTerms: string;
  footerLogin: string;
  footerNewAccounts: string;
  copyrightNote: string;
}

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
  /** Public Home marketing deliverable; filled with defaults when missing. */
  homeContent?: TenantHomeContent | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  ownerUserId: string | null;
  subdomain: string;
  handoffTempPassword: string | null;
  handoffAdminUsername: string | null;
  /** When false, /admin/login is blocked for this tenant. Persists across other updates. */
  adminLoginEnabled?: boolean;
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

export interface TenantDnsRecordInstructions {
  type: 'CNAME';
  name: string;
  target: string;
}

export interface TenantDeploymentInfo {
  hostname: string;
  homeUrl: string;
  loginUrl: string;
  adminDashboardUrl: string;
  adminHomeUrl: string;
  baseDomain: string;
  dnsTarget: string;
  dnsStatus: TenantDnsStatus;
  sslStatus: TenantSslStatus;
  deploymentStatus: TenantDeploymentStatus;
  dnsRecord: TenantDnsRecordInstructions;
  dnsCheckedAt: string | null;
  dnsVerifiedAt: string | null;
  lastProvisionedAt: string | null;
  sslCheckedAt: string | null;
  lastProvisionError: string | null;
  ownerAssigned: boolean;
  provider: 'manual' | 'netlify';
}

export interface MasterTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subdomain: string;
  hostname: string;
  ownerUserId: string | null;
  ownerAssigned: boolean;
  applicationName: string;
  dnsStatus: TenantDnsStatus;
  sslStatus: TenantSslStatus;
  deploymentStatus: TenantDeploymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MasterTenantDetail {
  tenant: Tenant;
  branding: TenantBranding;
  deployment: TenantDeploymentInfo;
}

export interface DnsVerificationResult {
  status: TenantDnsStatus | TenantSslStatus | TenantDeploymentStatus;
  hostname: string;
  expectedTarget: string;
  deploymentStatus: TenantDeploymentStatus;
  dnsStatus?: TenantDnsStatus;
  sslStatus: TenantSslStatus;
  message: string;
  checkedAt: string;
  code?: string | null;
  detail?: string;
  tenant: MasterTenantDetail;
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
  handoffTempPassword?: string | null;
  handoffAdminUsername?: string | null;
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
