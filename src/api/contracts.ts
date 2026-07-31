import type {
  AccountStatus,
  AccountType,
  TransferReasonCode,
  TransferStatus,
  UserRole,
} from '../types';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface SessionUserResponse {
  userId: string;
  role: UserRole;
  accountStatus: AccountStatus;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Platform Master Admin — resolved server-side from master_admins. */
  isMasterAdmin: boolean;
}

export interface ProfileResponse {
  id: string;
  userId: string;
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

export interface AccountResponse {
  id: string;
  accountNumber: string;
  accountType: AccountType;
  accountStatus: AccountStatus;
  balance: number;
  currency: string;
  oneTimeTransferUsed: boolean;
}

export interface WalletResponse {
  id: string;
  accountId: string;
  balance: number;
  currency: string;
  updatedAt: string;
}

export interface TransactionResponse {
  id: string;
  accountId: string;
  walletId: string;
  type: string;
  status: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string;
  description: string | null;
  createdAt: string;
}

export interface TransferRecipientResponse {
  name: string;
  account: string;
  bank: string;
}

export interface TransferResponse {
  id: string;
  reference: string;
  status: TransferStatus;
  amount: number;
  recipient: TransferRecipientResponse;
  description: string | null;
  currentStage: number;
  stagesCompleted: number;
  reasonCode: TransferReasonCode | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TransferActionResponse {
  status:
    | 'completed'
    | 'restricted'
    | 'failed'
    | 'verification_required';
  transferId?: string;
  reference?: string;
  amount?: number;
  transactionId?: string;
  stage?: 1 | 2 | 3 | 4;
  reasonCode?: TransferReasonCode | string;
  reason?: string;
  idempotentReplay?: boolean;
  transfer?: TransferResponse;
}

export interface VerificationStageResponse {
  transferId: string;
  status: TransferStatus;
  stage: number;
  stagesCompleted: number;
  expiresAt?: string;
}

export interface CreateTransferApiRequest {
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: number;
  description?: string;
  idempotencyKey: string;
}

export interface SubmitVerificationApiRequest {
  code: string;
}

export interface CreateUserApiRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  username: string;
  accountType: AccountType;
  accountNumber?: string;
  password?: string;
  initialBalance?: number;
}

export interface FundWalletApiRequest {
  amount: number;
  walletId?: string;
  accountId?: string;
  reference?: string;
  idempotencyKey?: string;
  description?: string;
}

export interface UpdateStatusApiRequest {
  status: AccountStatus;
}

export interface UpdateProfileApiRequest {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  username?: string;
}

export interface AdminUserResponse {
  profile: ProfileResponse;
  account: AccountResponse;
}

export interface TenantBrandingResponse {
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

export interface TenantConfigurationResponse {
  tenantId: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  subdomain: string;
  branding: TenantBrandingResponse;
}

export interface MasterTenantSummaryResponse {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  subdomain: string;
  ownerUserId: string | null;
  applicationName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MasterTenantDetailResponse {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'inactive';
    subdomain: string;
    ownerUserId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  branding: TenantBrandingResponse;
}

export interface CreateTenantApiRequest {
  name: string;
  slug: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBrandingResponse>;
}

export interface UpdateTenantApiRequest {
  name?: string;
  subdomain?: string;
  ownerUserId?: string | null;
  branding?: Partial<TenantBrandingResponse>;
}
