export const ACCOUNT_TYPES = [
  'escrow',
  'one_time_transfer',
  'four_stage_verification',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const APP_ROLES = ['admin', 'user'] as const;

export type UserRole = (typeof APP_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const TRANSACTION_TYPES = ['funding', 'debit', 'credit'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['pending', 'completed', 'failed'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export interface ClientEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface ServerEnvConfig extends ClientEnvConfig {
  supabaseServiceRoleKey?: string;
  initialAdminEmail?: string;
  initialAdminPassword?: string;
  initialAdminFirstName?: string;
  initialAdminLastName?: string;
  initialAdminPhone?: string;
  initialAdminUsername?: string;
  initialAdminAccountType?: AccountType;
  initialAdminAccountNumber?: string;
}

export interface AuthenticatedAppUser {
  userId: string;
  role: UserRole;
  accountStatus?: AccountStatus;
  /** Tenant membership from profiles.tenant_id (server-resolved). */
  tenantId?: string | null;
  /** Platform privilege from master_admins (never from client claims). */
  isMasterAdmin?: boolean;
}

export interface ProfileRecord {
  id: string;
  userId: string;
  tenantId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  username: string;
  status: AccountStatus;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export const TENANT_STATUSES = ['active', 'inactive'] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

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

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  ownerUserId: string | null;
  subdomain: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantBrandingRecord extends TenantBranding {
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantWithBranding {
  tenant: TenantRecord;
  branding: TenantBrandingRecord;
}

/** Public branding/config returned to frontends — never includes secrets. */
export interface TenantConfiguration {
  tenantId: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subdomain: string;
  branding: TenantBranding;
}

/** Master-dashboard summary (Master Admin only). */
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

export interface CreateTenantInput {
  name: string;
  slug: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBranding>;
}

export interface UpdateTenantInput {
  name?: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBranding>;
}

export const isTenantStatus = (value: string): value is TenantStatus => {
  return TENANT_STATUSES.includes(value as TenantStatus);
};

export interface AccountRecord {
  id: string;
  profileId: string;
  tenantId?: string | null;
  accountNumber: string;
  accountType: AccountType;
  accountStatus: AccountStatus;
  oneTimeTransferUsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  userId: string;
  tenantId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  username: string;
  status?: AccountStatus;
  role?: UserRole;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  username?: string;
  status?: AccountStatus;
}

export interface CreateAccountInput {
  profileId: string;
  tenantId?: string | null;
  accountType: AccountType;
  accountNumber?: string;
  accountStatus?: AccountStatus;
}

export interface UpdateAccountStatusInput {
  accountStatus: AccountStatus;
}

export interface ProvisionUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  phone?: string | null;
  username: string;
  accountType: AccountType;
  accountNumber?: string;
  initialBalance?: number;
}

export interface WalletRecord {
  id: string;
  accountId: string;
  tenantId?: string | null;
  balance: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionRecord {
  id: string;
  walletId: string;
  accountId: string;
  tenantId?: string | null;
  transactionType: TransactionType;
  status: TransactionStatus;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string;
  idempotencyKey: string | null;
  description: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWalletInput {
  accountId: string;
  tenantId?: string | null;
  balance?: number;
  currency?: string;
}

export interface FundWalletInput {
  walletId?: string;
  accountId?: string;
  amount: number;
  reference?: string;
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface FundWalletResult {
  wallet: WalletRecord;
  transaction: TransactionRecord;
  idempotentReplay: boolean;
}

export const TRANSFER_STATUSES = [
  'initiated',
  'processing',
  'verification_stage_1',
  'verification_stage_2',
  'verification_stage_3',
  'verification_stage_4',
  'completed',
  'failed',
  'cancelled',
  'restricted',
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_REASON_CODES = [
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'INSUFFICIENT_BALANCE',
  'EXTERNAL_TRANSFER_NOT_ALLOWED',
  'TRANSFER_LIMIT_REACHED',
  'INVALID_TRANSFER',
  'VERIFICATION_REQUIRED',
  'INVALID_VERIFICATION_CODE',
  'VERIFICATION_EXPIRED',
  'TOO_MANY_VERIFICATION_ATTEMPTS',
  'TRANSFER_ALREADY_COMPLETED',
  'DUPLICATE_REQUEST',
  'INVALID_AMOUNT',
  'UNAUTHORIZED',
] as const;

export type TransferReasonCode = (typeof TRANSFER_REASON_CODES)[number];

export interface CreateTransferInput {
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: number;
  description?: string;
  idempotencyKey: string;
}

export interface TransferRecord {
  id: string;
  accountId: string;
  userId: string;
  walletId: string;
  tenantId?: string | null;
  ledgerTransactionId: string | null;
  reference: string;
  idempotencyKey: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: number;
  description: string | null;
  status: TransferStatus;
  currentStage: number;
  stagesCompleted: number;
  reasonCode: TransferReasonCode | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferVerificationCodeRecord {
  id: string;
  transferId: string;
  stage: number;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TransferServiceResult =
  | {
      status: 'completed';
      transferId: string;
      transactionId: string;
      reference: string;
      amount: number;
      idempotentReplay?: boolean;
      transfer: TransferRecord;
      transaction?: TransactionRecord;
    }
  | {
      status: 'restricted';
      reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED';
      reason: string;
      transferId: string;
      reference: string;
      transfer: TransferRecord;
    }
  | {
      status: 'failed';
      reasonCode: TransferReasonCode;
      reason: string;
      transferId?: string;
      reference?: string;
      transfer?: TransferRecord;
    }
  | {
      status: 'verification_required';
      stage: 1 | 2 | 3 | 4;
      transferId: string;
      reference: string;
      amount: number;
      transfer: TransferRecord;
      idempotentReplay?: boolean;
    };

export const isAccountType = (value: string): value is AccountType => {
  return ACCOUNT_TYPES.includes(value as AccountType);
};

export const isUserRole = (value: string): value is UserRole => {
  return APP_ROLES.includes(value as UserRole);
};

export const isAccountStatus = (value: string): value is AccountStatus => {
  return ACCOUNT_STATUSES.includes(value as AccountStatus);
};

export const isTransactionType = (value: string): value is TransactionType => {
  return TRANSACTION_TYPES.includes(value as TransactionType);
};

export const isTransactionStatus = (value: string): value is TransactionStatus => {
  return TRANSACTION_STATUSES.includes(value as TransactionStatus);
};

export const isTransferStatus = (value: string): value is TransferStatus => {
  return TRANSFER_STATUSES.includes(value as TransferStatus);
};
