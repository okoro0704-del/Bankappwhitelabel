import type {
  Account,
  Profile,
  SessionUser,
  Transaction,
  Transfer,
  Wallet,
} from '../types/api';
import type {
  MasterTenantDetail,
  MasterTenantSummary,
  TenantBranding,
  TenantConfiguration,
  TenantDeploymentInfo,
} from '../types/tenant';

export function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    firstName: String(row.first_name ?? row.firstName),
    lastName: String(row.last_name ?? row.lastName),
    email: String(row.email),
    phone: (row.phone as string | null) ?? null,
    username: String(row.username),
    status: row.status as Profile['status'],
    role: row.role as Profile['role'],
    handoffTempPassword:
      (row.handoff_temp_password as string | null | undefined) ??
      (row.handoffTempPassword as string | null | undefined) ??
      null,
    handoffTransferPin:
      (row.handoff_transfer_pin as string | null | undefined) ??
      (row.handoffTransferPin as string | null | undefined) ??
      null,
    createdAt: String(row.created_at ?? row.createdAt),
    updatedAt: String(row.updated_at ?? row.updatedAt),
  };
}

export function mapSession(data: Record<string, unknown>): SessionUser {
  const roleRaw = String(data.role ?? 'user').toLowerCase();
  const role = roleRaw === 'admin' ? 'admin' : 'user';
  return {
    userId: String(data.userId),
    role,
    accountStatus: data.accountStatus as SessionUser['accountStatus'],
    email: String(data.email ?? ''),
    username: String(data.username ?? ''),
    firstName: String(data.firstName ?? ''),
    lastName: String(data.lastName ?? ''),
    isMasterAdmin: Boolean(data.isMasterAdmin),
  };
}

export function mapWallet(row: Record<string, unknown>): Wallet {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    balance: Number(row.balance),
    currency: String(row.currency),
    updatedAt: String(row.updated_at),
  };
}

export function mapAccount(row: Record<string, unknown>, wallet?: Wallet | null): Account {
  const productRaw = String(row.product_type ?? row.productType ?? 'checking');
  const productType = (
    ['checking', 'current', 'savings', 'business'].includes(productRaw) ? productRaw : 'checking'
  ) as Account['productType'];
  return {
    id: String(row.id),
    accountNumber: String(row.account_number ?? row.accountNumber),
    accountType: (row.account_type ?? row.accountType) as Account['accountType'],
    productType,
    accountStatus: (row.account_status ?? row.accountStatus) as Account['accountStatus'],
    balance: wallet?.balance ?? Number(row.balance ?? 0),
    currency: wallet?.currency ?? String(row.currency ?? 'USD'),
    oneTimeTransferUsed: Boolean(row.one_time_transfer_used ?? row.oneTimeTransferUsed),
  };
}

export function mapTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    walletId: String(row.wallet_id),
    type: String(row.transaction_type),
    status: String(row.status),
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    reference: String(row.reference),
    description: (row.description as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapTransfer(row: Record<string, unknown>): Transfer {
  const recipient = (row.recipient ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    reference: String(row.reference),
    status: String(row.status),
    amount: Number(row.amount),
    recipient: {
      name: String(recipient.name ?? row.recipient_name ?? ''),
      account: String(recipient.account ?? row.recipient_account ?? ''),
      bank: String(recipient.bank ?? row.recipient_bank ?? ''),
    },
    description: (row.description as string | null) ?? null,
    currentStage: Number(row.currentStage ?? row.current_stage ?? 0),
    stagesCompleted: Number(row.stagesCompleted ?? row.stages_completed ?? 0),
    reasonCode: (row.reasonCode as string | null) ?? (row.reason_code as string | null) ?? null,
    failureReason:
      (row.failureReason as string | null) ?? (row.failure_reason as string | null) ?? null,
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at),
    completedAt:
      (row.completedAt as string | null | undefined) ??
      (row.completed_at as string | null | undefined) ??
      null,
  };
}

export function mapBranding(row: Record<string, unknown> | null, fallbackName: string): TenantBranding {
  return {
    applicationName: String(row?.application_name ?? row?.applicationName ?? fallbackName),
    logoUrl: (row?.logo_url as string | null | undefined) ?? (row?.logoUrl as string | null) ?? null,
    faviconUrl:
      (row?.favicon_url as string | null | undefined) ?? (row?.faviconUrl as string | null) ?? null,
    primaryColor: String(row?.primary_color ?? row?.primaryColor ?? '#0B1F3A'),
    secondaryColor: String(row?.secondary_color ?? row?.secondaryColor ?? '#1F6FEB'),
    accentColor: String(row?.accent_color ?? row?.accentColor ?? '#C9A227'),
    loginHeadline:
      (row?.login_headline as string | null | undefined) ??
      (row?.loginHeadline as string | null) ??
      null,
    loginSubtitle:
      (row?.login_subtitle as string | null | undefined) ??
      (row?.loginSubtitle as string | null) ??
      null,
    supportEmail:
      (row?.support_email as string | null | undefined) ??
      (row?.supportEmail as string | null) ??
      null,
    supportPhone:
      (row?.support_phone as string | null | undefined) ??
      (row?.supportPhone as string | null) ??
      null,
  };
}

export function mapTenantConfig(data: Record<string, unknown>): TenantConfiguration {
  const branding = (data.branding ?? {}) as Record<string, unknown>;
  return {
    tenantId: String(data.tenantId),
    name: String(data.name),
    slug: String(data.slug),
    status: data.status as TenantConfiguration['status'],
    subdomain: String(data.subdomain),
    branding: mapBranding(branding, String(data.name)),
  };
}

export function buildDeploymentInfo(
  tenant: Record<string, unknown>,
  baseDomain: string,
  dnsTarget: string,
  provider: 'manual' | 'netlify' = 'manual',
): TenantDeploymentInfo {
  const subdomain = String(tenant.subdomain);
  const hostname = `${subdomain}.${baseDomain}`;
  return {
    hostname,
    loginUrl: `https://${hostname}/login`,
    adminDashboardUrl: `https://${hostname}/admin`,
    baseDomain,
    dnsTarget,
    dnsStatus: tenant.dns_status as TenantDeploymentInfo['dnsStatus'],
    sslStatus: tenant.ssl_status as TenantDeploymentInfo['sslStatus'],
    deploymentStatus: tenant.deployment_status as TenantDeploymentInfo['deploymentStatus'],
    dnsRecord: { type: 'CNAME', name: subdomain, target: dnsTarget },
    dnsCheckedAt: (tenant.dns_checked_at as string | null) ?? null,
    dnsVerifiedAt: (tenant.dns_verified_at as string | null) ?? null,
    lastProvisionedAt: (tenant.last_provisioned_at as string | null) ?? null,
    sslCheckedAt: (tenant.ssl_checked_at as string | null) ?? null,
    lastProvisionError: (tenant.last_provision_error as string | null) ?? null,
    ownerAssigned: Boolean(tenant.owner_user_id),
    provider,
  };
}

export function mapMasterSummary(
  row: Record<string, unknown>,
  baseDomain: string,
): MasterTenantSummary {
  const subdomain = String(row.subdomain);
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status as MasterTenantSummary['status'],
    subdomain,
    hostname: `${subdomain}.${baseDomain}`,
    ownerUserId: (row.ownerUserId as string | null) ?? (row.owner_user_id as string | null) ?? null,
    ownerAssigned: Boolean(row.ownerAssigned ?? row.owner_user_id),
    applicationName: String(row.applicationName ?? row.application_name ?? row.name),
    dnsStatus: (row.dnsStatus ?? row.dns_status) as MasterTenantSummary['dnsStatus'],
    sslStatus: (row.sslStatus ?? row.ssl_status) as MasterTenantSummary['sslStatus'],
    deploymentStatus: (row.deploymentStatus ??
      row.deployment_status) as MasterTenantSummary['deploymentStatus'],
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at),
  };
}

export function mapMasterDetailRpc(
  data: Record<string, unknown>,
  baseDomain: string,
  dnsTarget: string,
): MasterTenantDetail {
  const tenant = data.tenant as Record<string, unknown>;
  const branding = data.branding as Record<string, unknown>;
  const raw = (data.deploymentRaw ?? {}) as Record<string, unknown>;
  return {
    tenant: {
      id: String(tenant.id),
      name: String(tenant.name),
      slug: String(tenant.slug),
      status: tenant.status as MasterTenantDetail['tenant']['status'],
      ownerUserId: (tenant.ownerUserId as string | null) ?? null,
      subdomain: String(tenant.subdomain),
      handoffTempPassword: (tenant.handoffTempPassword as string | null) ?? null,
      handoffAdminUsername: (tenant.handoffAdminUsername as string | null) ?? null,
      createdAt: String(tenant.createdAt),
      updatedAt: String(tenant.updatedAt),
    },
    branding: mapBranding(branding, String(tenant.name)),
    deployment: buildDeploymentInfo(
      {
        subdomain: tenant.subdomain,
        owner_user_id: tenant.ownerUserId,
        dns_status: raw.dnsStatus,
        ssl_status: raw.sslStatus,
        deployment_status: raw.deploymentStatus,
        dns_checked_at: raw.dnsCheckedAt,
        dns_verified_at: raw.dnsVerifiedAt,
        last_provisioned_at: raw.lastProvisionedAt,
        ssl_checked_at: raw.sslCheckedAt,
        last_provision_error: raw.lastProvisionError,
      },
      baseDomain,
      dnsTarget,
    ),
  };
}
