import type {
  AccountRecord,
  MasterTenantSummary,
  ProfileRecord,
  TenantConfiguration,
  TenantWithBranding,
  TransactionRecord,
  TransferRecord,
  TransferServiceResult,
  WalletRecord,
} from '../types';
import type {
  AccountResponse,
  MasterTenantDetailResponse,
  MasterTenantSummaryResponse,
  ProfileResponse,
  SessionUserResponse,
  TenantConfigurationResponse,
  TransactionResponse,
  TransferActionResponse,
  TransferResponse,
  VerificationStageResponse,
  WalletResponse,
} from './contracts';
import { buildTenantDeploymentInfo } from '../services/tenants/tenant-service';

export const toProfileResponse = (profile: ProfileRecord): ProfileResponse => ({
  id: profile.id,
  userId: profile.userId,
  firstName: profile.firstName,
  lastName: profile.lastName,
  email: profile.email,
  phone: profile.phone,
  username: profile.username,
  status: profile.status,
  role: profile.role,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
});

export const toSessionUserResponse = (
  profile: ProfileRecord,
  accountStatus: ProfileRecord['status'],
  isMasterAdmin = false,
): SessionUserResponse => ({
  userId: profile.userId,
  role: profile.role,
  accountStatus,
  email: profile.email,
  username: profile.username,
  firstName: profile.firstName,
  lastName: profile.lastName,
  isMasterAdmin,
});

export const toAccountResponse = (
  account: AccountRecord,
  wallet: WalletRecord,
): AccountResponse => ({
  id: account.id,
  accountNumber: account.accountNumber,
  accountType: account.accountType,
  accountStatus: account.accountStatus,
  balance: wallet.balance,
  currency: wallet.currency,
  oneTimeTransferUsed: account.oneTimeTransferUsed,
});

export const toWalletResponse = (wallet: WalletRecord): WalletResponse => ({
  id: wallet.id,
  accountId: wallet.accountId,
  balance: wallet.balance,
  currency: wallet.currency,
  updatedAt: wallet.updatedAt,
});

export const toTransactionResponse = (
  transaction: TransactionRecord,
): TransactionResponse => ({
  id: transaction.id,
  accountId: transaction.accountId,
  walletId: transaction.walletId,
  type: transaction.transactionType,
  status: transaction.status,
  amount: transaction.amount,
  balanceBefore: transaction.balanceBefore,
  balanceAfter: transaction.balanceAfter,
  reference: transaction.reference,
  description: transaction.description,
  createdAt: transaction.createdAt,
});

export const toTransferResponse = (transfer: TransferRecord): TransferResponse => ({
  id: transfer.id,
  reference: transfer.reference,
  status: transfer.status,
  amount: transfer.amount,
  recipient: {
    name: transfer.recipientName,
    account: transfer.recipientAccount,
    bank: transfer.recipientBank,
  },
  description: transfer.description,
  currentStage: transfer.currentStage,
  stagesCompleted: transfer.stagesCompleted,
  reasonCode: transfer.reasonCode,
  failureReason: transfer.failureReason,
  createdAt: transfer.createdAt,
  updatedAt: transfer.updatedAt,
  completedAt: transfer.completedAt,
});

export const toTransferActionResponse = (
  result: TransferServiceResult,
): TransferActionResponse => {
  if (result.status === 'completed') {
    return {
      status: 'completed',
      transferId: result.transferId,
      reference: result.reference,
      amount: result.amount,
      transactionId: result.transactionId,
      idempotentReplay: result.idempotentReplay,
      transfer: toTransferResponse(result.transfer),
    };
  }

  if (result.status === 'restricted') {
    return {
      status: 'restricted',
      transferId: result.transferId,
      reference: result.reference,
      reasonCode: result.reasonCode,
      reason: result.reason,
      transfer: toTransferResponse(result.transfer),
    };
  }

  if (result.status === 'failed') {
    return {
      status: 'failed',
      transferId: result.transferId,
      reference: result.reference,
      reasonCode: result.reasonCode,
      reason: result.reason,
      transfer: result.transfer ? toTransferResponse(result.transfer) : undefined,
    };
  }

  return {
    status: 'verification_required',
    transferId: result.transferId,
    reference: result.reference,
    amount: result.amount,
    stage: result.stage,
    idempotentReplay: result.idempotentReplay,
    transfer: toTransferResponse(result.transfer),
  };
};

export const toVerificationStageResponse = (input: {
  transferId: string;
  status: TransferRecord['status'];
  currentStage: number;
  stagesCompleted: number;
  expiresAt?: string;
}): VerificationStageResponse => ({
  transferId: input.transferId,
  status: input.status,
  stage: input.currentStage,
  stagesCompleted: input.stagesCompleted,
  expiresAt: input.expiresAt,
});

export const toTenantConfigurationResponse = (
  config: TenantConfiguration,
): TenantConfigurationResponse => ({
  tenantId: config.tenantId,
  name: config.name,
  slug: config.slug,
  status: config.status,
  subdomain: config.subdomain,
  branding: { ...config.branding },
});

export const toMasterTenantSummaryResponse = (
  summary: MasterTenantSummary,
): MasterTenantSummaryResponse => ({ ...summary });

export const toMasterTenantDetailResponse = (
  bundle: TenantWithBranding,
): MasterTenantDetailResponse => {
  const deployment = buildTenantDeploymentInfo(bundle);
  return {
    tenant: {
      id: bundle.tenant.id,
      name: bundle.tenant.name,
      slug: bundle.tenant.slug,
      status: bundle.tenant.status,
      subdomain: bundle.tenant.subdomain,
      ownerUserId: bundle.tenant.ownerUserId,
      createdAt: bundle.tenant.createdAt,
      updatedAt: bundle.tenant.updatedAt,
    },
    branding: {
      applicationName: bundle.branding.applicationName,
      logoUrl: bundle.branding.logoUrl,
      faviconUrl: bundle.branding.faviconUrl,
      primaryColor: bundle.branding.primaryColor,
      secondaryColor: bundle.branding.secondaryColor,
      accentColor: bundle.branding.accentColor,
      loginHeadline: bundle.branding.loginHeadline,
      loginSubtitle: bundle.branding.loginSubtitle,
      supportEmail: bundle.branding.supportEmail,
      supportPhone: bundle.branding.supportPhone,
    },
    deployment,
  };
};
