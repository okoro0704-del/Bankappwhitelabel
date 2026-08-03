export type UserRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'suspended';
export type AccountType = 'escrow' | 'one_time_transfer' | 'four_stage_verification';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

export interface Paginated<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface SessionUser {
  userId: string;
  role: UserRole;
  accountStatus: AccountStatus;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Resolved by get_my_session RPC from master_admins — never set client-side. */
  isMasterAdmin?: boolean;
}

export interface Profile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  username: string;
  status: AccountStatus;
  role: UserRole;
  /** Admin deliverable — temporary password for the account holder (if still set). */
  handoffTempPassword?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  accountNumber: string;
  accountType: AccountType;
  accountStatus: AccountStatus;
  balance: number;
  currency: string;
  oneTimeTransferUsed: boolean;
}

export interface Wallet {
  id: string;
  accountId: string;
  balance: number;
  currency: string;
  updatedAt: string;
}

export interface Transaction {
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

export interface TransferRecipient {
  name: string;
  account: string;
  bank: string;
}

export interface Transfer {
  id: string;
  reference: string;
  status: string;
  amount: number;
  recipient: TransferRecipient;
  description: string | null;
  currentStage: number;
  stagesCompleted: number;
  reasonCode: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TransferActionStatus =
  | 'completed'
  | 'restricted'
  | 'failed'
  | 'verification_required';

export interface TransferActionResponse {
  status: TransferActionStatus;
  transferId?: string;
  reference?: string;
  amount?: number;
  transactionId?: string;
  stage?: 1 | 2 | 3 | 4;
  reasonCode?: string;
  reason?: string;
  idempotentReplay?: boolean;
  transfer?: Transfer;
}

export interface VerificationStageResponse {
  transferId: string;
  status: string;
  stage: number;
  stagesCompleted: number;
  expiresAt?: string;
}

export interface CreateTransferRequest {
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: number;
  description?: string;
  idempotencyKey: string;
}

export interface AdminUser {
  profile: Profile;
  account: Account;
  temporaryPassword?: string | null;
}

export interface CreateUserRequest {
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

export interface FundWalletRequest {
  amount: number;
  walletId?: string;
  accountId?: string;
  reference?: string;
  idempotencyKey?: string;
  description?: string;
}

export interface FundWalletResult {
  wallet: Wallet;
  transaction: Transaction;
  idempotentReplay: boolean;
}
