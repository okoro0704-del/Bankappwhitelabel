import { getSupabase } from '../auth/supabase';
import { ApiError } from './errors';
import {
  mapAccount,
  mapMasterDetailRpc,
  mapMasterSummary,
  mapProfile,
  mapSession,
  mapTenantConfig,
  mapTransaction,
  mapTransfer,
  mapWallet,
} from './mappers';
import { invokeFunction, rpcJson, throwFromPostgrest } from './supabase-rpc';
import { parseActivationCodes } from '../utils/activationCodes';
import type {
  Account,
  AdminUser,
  CreateTransferRequest,
  CreateUserRequest,
  FundWalletRequest,
  FundWalletResult,
  Paginated,
  Profile,
  SessionUser,
  Transaction,
  Transfer,
  TransferActionResponse,
  VerificationStageResponse,
  Wallet,
} from '../types/api';
import type {
  CreateTenantRequest,
  DnsVerificationResult,
  MasterTenantDetail,
  MasterTenantSummary,
  TenantConfiguration,
  TenantDeploymentInfo,
  TenantHomeContent,
  UpdateTenantRequest,
} from '../types/tenant';
import { sanitizeHomeContent } from '../tenant/homeContent';
import { extractTenantLabelUnderBaseDomain, isPlatformBaseHost } from '../tenant/resolve';
import {
  checkTls,
  deriveDeploymentStatus,
  verifyPublicDns,
} from '../master/dnsVerify';
import type { TenantDnsStatus, TenantSslStatus } from '../types/tenant';

export interface ListParams {
  limit?: number;
  offset?: number;
  search?: string;
}

function baseDomain(): string {
  return (import.meta.env.VITE_TENANT_BASE_DOMAIN ?? 'app.example.com').trim().toLowerCase();
}

function dnsTarget(): string {
  return (import.meta.env.VITE_DEPLOYMENT_DNS_TARGET ?? 'edgeserver.example.com')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

/** Shared Netlify site apex (no tenant subdomain) — use default slug for branding only. */
function isSharedDeployHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (h.endsWith('.netlify.app')) return true;
  const target = dnsTarget();
  return Boolean(target) && h === target;
}

function pageParams(params: ListParams = {}) {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  return { limit, offset, from: offset, to: offset + limit - 1 };
}

function mapTransferAction(data: Record<string, unknown>): TransferActionResponse {
  const transferRow = data.transfer as Record<string, unknown> | undefined;
  return {
    status: data.status as TransferActionResponse['status'],
    transferId: data.transferId ? String(data.transferId) : undefined,
    reference: data.reference ? String(data.reference) : undefined,
    amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : undefined,
    transactionId: data.transactionId ? String(data.transactionId) : undefined,
    stage: data.stage !== undefined && data.stage !== null ? (Number(data.stage) as 1 | 2 | 3 | 4) : undefined,
    reasonCode: (data.reasonCode as string | undefined) ?? undefined,
    reason: (data.reason as string | undefined) ?? undefined,
    idempotentReplay: Boolean(data.idempotentReplay),
    transfer: transferRow ? mapTransfer(transferRow) : undefined,
  };
}

async function requireOwnAccountRow() {
  const { data: sessionData } = await getSupabase().auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);

  const { data: profile, error: profileError } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) throwFromPostgrest(profileError);
  if (!profile) throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);

  const { data: account, error: accountError } = await getSupabase()
    .from('accounts')
    .select('*')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (accountError) throwFromPostgrest(accountError);
  if (!account) throw new ApiError('ACCOUNT_NOT_FOUND', 'Account could not be found.', 404);

  const { data: wallet, error: walletError } = await getSupabase()
    .from('wallets')
    .select('*')
    .eq('account_id', account.id)
    .maybeSingle();
  if (walletError) throwFromPostgrest(walletError);

  return { profile, account, wallet };
}

export const api = {
  getSession: async (): Promise<SessionUser> => {
    const data = await rpcJson<Record<string, unknown>>('get_my_session');
    return mapSession(data);
  },

  getProfile: async (): Promise<Profile> => {
    const { profile } = await requireOwnAccountRow();
    return mapProfile(profile);
  },

  uploadProfilePhoto: async (file: File): Promise<string> => {
    const { data: sessionData } = await getSupabase().auth.getUser();
    const userId = sessionData.user?.id;
    if (!userId) throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${userId}/avatar.${ext || 'jpg'}`;
    const { error: uploadError } = await getSupabase().storage.from('avatars').upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg',
      cacheControl: '3600',
    });
    if (uploadError) {
      throw new ApiError('VALIDATION_ERROR', uploadError.message || 'Unable to upload photo', 400);
    }

    const { data } = getSupabase().storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
    await rpcJson('user_set_avatar_url', { p_avatar_url: publicUrl });
    return publicUrl;
  },

  clearProfilePhoto: async (): Promise<void> => {
    await rpcJson('user_set_avatar_url', { p_avatar_url: null });
  },

  getAccount: async (): Promise<Account> => {
    const { account, wallet } = await requireOwnAccountRow();
    return mapAccount(account, wallet ? mapWallet(wallet) : null);
  },

  getWallet: async (): Promise<Wallet> => {
    const { wallet } = await requireOwnAccountRow();
    if (!wallet) throw new ApiError('NOT_FOUND', 'Wallet not found', 404);
    return mapWallet(wallet);
  },

  getTransactions: async (params?: ListParams): Promise<Paginated<Transaction>> => {
    const { account } = await requireOwnAccountRow();
    const { limit, offset, from, to } = pageParams(params);
    const query = getSupabase()
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    const { data, error, count } = await query;
    if (error) throwFromPostgrest(error);
    return {
      items: (data ?? []).map(mapTransaction),
      limit,
      offset,
      total: count ?? 0,
    };
  },

  getTransaction: async (id: string): Promise<Transaction> => {
    const { data, error } = await getSupabase().from('transactions').select('*').eq('id', id).maybeSingle();
    if (error) throwFromPostgrest(error);
    if (!data) throw new ApiError('NOT_FOUND', 'Transaction not found', 404);
    return mapTransaction(data);
  },

  getTransfers: async (params?: ListParams): Promise<Paginated<Transfer>> => {
    const { data: sessionData } = await getSupabase().auth.getUser();
    const userId = sessionData.user?.id;
    if (!userId) throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);
    const { limit, offset, from, to } = pageParams(params);
    const { data, error, count } = await getSupabase()
      .from('transfers')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throwFromPostgrest(error);
    return { items: (data ?? []).map(mapTransfer), limit, offset, total: count ?? 0 };
  },

  getTransfer: async (id: string): Promise<Transfer> => {
    const { data, error } = await getSupabase().from('transfers').select('*').eq('id', id).maybeSingle();
    if (error) throwFromPostgrest(error);
    if (!data) throw new ApiError('NOT_FOUND', 'Transfer not found', 404);
    return mapTransfer(data);
  },

  createTransfer: async (body: CreateTransferRequest): Promise<TransferActionResponse> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('user_create_transfer', {
        p_recipient_name: body.recipientName,
        p_recipient_account: body.recipientAccount,
        p_recipient_bank: body.recipientBank,
        p_amount: body.amount,
        p_idempotency_key: body.idempotencyKey,
        p_description: body.description ?? null,
        p_pin: body.pin,
        p_recipient_swift: body.recipientSwift ?? null,
        p_recipient_iban: body.recipientIban ?? null,
      });
      return mapTransferAction(data);
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Transfers are not enabled on the database yet. Ask your administrator to run supabase/migrations/20260803130000_transfer_rpcs_and_pin.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  getVerification: async (id: string): Promise<VerificationStageResponse> => {
    const data = await rpcJson<Record<string, unknown>>('user_get_transfer_verification', {
      p_transfer_id: id,
    });
    return {
      transferId: String(data.transferId ?? id),
      status: String(data.status ?? ''),
      stage: Number(data.stage ?? 0),
      stagesCompleted: Number(data.stagesCompleted ?? 0),
      expiresAt: (data.expiresAt as string | undefined) ?? undefined,
    };
  },

  submitVerification: async (id: string, code: string): Promise<TransferActionResponse> => {
    const data = await rpcJson<Record<string, unknown>>('user_submit_transfer_verification', {
      p_transfer_id: id,
      p_code: code,
    });
    return mapTransferAction(data);
  },

  completeTransfer: async (id: string): Promise<TransferActionResponse> => {
    const data = await rpcJson<Record<string, unknown>>('user_complete_transfer', {
      p_transfer_id: id,
    });
    return mapTransferAction(data);
  },

  getTransferPinStatus: async (): Promise<{ configured: boolean }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('user_transfer_pin_status');
      return { configured: Boolean(data.configured) };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'PIN setup is unavailable. Run supabase/migrations/20260803150000_user_security_pin.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  setTransferPin: async (body: {
    pin: string;
    currentPin?: string;
  }): Promise<{ configured: boolean; message: string }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('user_set_transfer_pin', {
        p_pin: body.pin,
        p_current_pin: body.currentPin?.trim() ? body.currentPin.trim() : null,
      });
      return {
        configured: Boolean(data.configured),
        message: String(data.message ?? 'Transfer PIN saved'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'PIN setup is unavailable. Run supabase/migrations/20260803150000_user_security_pin.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminListUsers: async (params?: ListParams): Promise<Paginated<AdminUser>> => {
    const { limit, offset, from, to } = pageParams(params);
    let query = getSupabase()
      .from('profiles')
      .select('*, accounts(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (params?.search) {
      query = query.or(
        `email.ilike.%${params.search}%,username.ilike.%${params.search}%,first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%`,
      );
    }
    const { data, error, count } = await query;
    if (error) throwFromPostgrest(error);

    const accountIds = (data ?? [])
      .map((row) => {
        const accountRow = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
        return accountRow?.id as string | undefined;
      })
      .filter((id): id is string => Boolean(id));

    const activationByAccount = new Map<string, NonNullable<Account['activationCodes']>>();
    if (accountIds.length > 0) {
      const { data: activationRows } = await getSupabase()
        .from('account_activation_codes')
        .select('account_id, codes')
        .in('account_id', accountIds);
      for (const row of activationRows ?? []) {
        const codes = parseActivationCodes(row.codes);
        if (codes) activationByAccount.set(String(row.account_id), codes);
      }
    }

    const items: AdminUser[] = [];
    for (const row of data ?? []) {
      const accountRow = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      if (!accountRow) continue;
      const { data: wallet } = await getSupabase()
        .from('wallets')
        .select('*')
        .eq('account_id', accountRow.id)
        .maybeSingle();
      const activationCodes = activationByAccount.get(String(accountRow.id)) ?? null;
      items.push({
        profile: mapProfile(row),
        account: {
          ...mapAccount(accountRow, wallet ? mapWallet(wallet) : null),
          activationCodes,
        },
        activationCodes,
      });
    }
    return { items, limit, offset, total: count ?? 0 };
  },

  adminGetUser: async (userId: string): Promise<AdminUser> => {
    const { data: profile, error } = await getSupabase()
      .from('profiles')
      .select('*, accounts(*)')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throwFromPostgrest(error);
    if (!profile) throw new ApiError('NOT_FOUND', 'User not found', 404);
    const accountRow = Array.isArray(profile.accounts) ? profile.accounts[0] : profile.accounts;
    if (!accountRow) throw new ApiError('NOT_FOUND', 'Account not found', 404);
    const { data: wallet } = await getSupabase()
      .from('wallets')
      .select('*')
      .eq('account_id', accountRow.id)
      .maybeSingle();
    const { data: activationRow } = await getSupabase()
      .from('account_activation_codes')
      .select('codes')
      .eq('account_id', accountRow.id)
      .maybeSingle();
    const activationCodes = parseActivationCodes(activationRow?.codes);
    const account = mapAccount(accountRow, wallet ? mapWallet(wallet) : null);
    return {
      profile: mapProfile(profile),
      account: { ...account, activationCodes },
      activationCodes,
    };
  },

  adminCreateUser: async (body: CreateUserRequest): Promise<AdminUser> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_create_tenant_user', {
        p_first_name: body.firstName,
        p_last_name: body.lastName,
        p_email: body.email,
        p_username: body.username,
        p_password: body.password?.trim() ? body.password : null,
        p_phone: body.phone ?? null,
        p_account_type: body.accountType,
        p_product_type: body.productType,
        p_account_number: body.accountNumber?.trim() ? body.accountNumber.trim() : null,
        p_initial_balance: body.initialBalance ?? 0,
        p_currency: body.currency?.trim() ? body.currency.trim().toUpperCase() : 'USD',
        p_account_country: body.accountCountry?.trim() ? body.accountCountry.trim() : null,
        p_routing_number: body.routingNumber?.trim() ? body.routingNumber.trim() : null,
      });
      const profileData = (data.profile ?? {}) as Record<string, unknown>;
      const accountData = (data.account ?? {}) as Record<string, unknown>;
      const temporaryPassword =
        (data.temporaryPassword as string | null | undefined) ??
        (profileData.handoffTempPassword as string | null | undefined) ??
        String(profileData.username ?? body.username);
      const activationCodes =
        parseActivationCodes(data.activationCodes) ??
        parseActivationCodes(accountData.activationCodes);
      return {
        profile: {
          id: String(profileData.id),
          userId: String(profileData.userId),
          firstName: String(profileData.firstName),
          lastName: String(profileData.lastName),
          email: String(profileData.email),
          phone: (profileData.phone as string | null) ?? null,
          username: String(profileData.username),
          status: profileData.status as Profile['status'],
          role: profileData.role as Profile['role'],
          handoffTempPassword: temporaryPassword,
          createdAt: String(profileData.createdAt),
          updatedAt: String(profileData.updatedAt),
          handoffTransferPin:
            (profileData.handoffTransferPin as string | null | undefined) ??
            (data.transferPin as string | null | undefined) ??
            '1111',
        },
        account: {
          id: String(accountData.id),
          accountNumber: String(accountData.accountNumber),
          accountType: accountData.accountType as Account['accountType'],
          productType: (accountData.productType as Account['productType']) ?? 'checking',
          accountStatus: accountData.accountStatus as Account['accountStatus'],
          balance: Number(accountData.balance ?? 0),
          currency: String(accountData.currency ?? body.currency ?? 'USD'),
          accountCountry:
            (accountData.accountCountry as string | null | undefined) ??
            body.accountCountry ??
            null,
          routingNumber:
            (accountData.routingNumber as string | null | undefined) ??
            body.routingNumber ??
            null,
          oneTimeTransferUsed: Boolean(accountData.oneTimeTransferUsed),
          activationCodes,
        },
        temporaryPassword,
        transferPin:
          (data.transferPin as string | null | undefined) ??
          (profileData.handoffTransferPin as string | null | undefined) ??
          '1111',
        activationCodes,
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache|overloaded|20260803200000/i.test(
          error.message,
        );
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Create-user RPC needs a fix. Run supabase/migrations/20260803250000_account_fields_and_avatar.sql in the Supabase SQL Editor, then try again.',
          400,
        );
      }
      throw error;
    }
  },

  adminClearUserTempPassword: async (profileId: string): Promise<void> => {
    await rpcJson('admin_clear_user_temp_password', { p_profile_id: profileId });
  },

  adminIssueActivationCodes: async (
    accountId: string,
  ): Promise<{
    accountId: string;
    activationCodes: NonNullable<Account['activationCodes']>;
    message: string;
  }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_issue_activation_codes', {
        p_account_id: accountId,
      });
      const activationCodes = parseActivationCodes(data.activationCodes);
      if (!activationCodes) {
        throw new ApiError('VALIDATION_ERROR', 'Activation codes were not returned', 400);
      }
      return {
        accountId: String(data.accountId ?? accountId),
        activationCodes,
        message: String(data.message ?? 'Four-stage verification codes created'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Activation-codes RPC is missing. Run supabase/migrations/20260803180000_admin_issue_activation_codes.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminGetHomeContent: async (): Promise<{
    applicationName: string;
    supportEmail: string | null;
    supportPhone: string | null;
    homeContent: TenantHomeContent;
  }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_get_home_content', {});
      const applicationName = String(data.applicationName ?? 'Application');
      return {
        applicationName,
        supportEmail: (data.supportEmail as string | null) ?? null,
        supportPhone: (data.supportPhone as string | null) ?? null,
        homeContent: sanitizeHomeContent(data.homeContent, applicationName),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Home deliverables RPC is missing. Run supabase/migrations/20260803270000_tenant_home_content_deliverables.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateHomeContent: async (
    homeContent: TenantHomeContent,
  ): Promise<{
    applicationName: string;
    supportEmail?: string | null;
    supportPhone?: string | null;
    homeContent: TenantHomeContent;
    message: string;
  }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_update_home_content', {
        p_home: homeContent,
      });
      const applicationName = String(data.applicationName ?? 'Application');
      return {
        applicationName,
        supportEmail: (data.supportEmail as string | null | undefined) ?? undefined,
        supportPhone: (data.supportPhone as string | null | undefined) ?? undefined,
        homeContent: sanitizeHomeContent(data.homeContent, applicationName),
        message: String(data.message ?? 'Home deliverables saved'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Home deliverables RPC is missing. Run supabase/migrations/20260803270000_tenant_home_content_deliverables.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateHomeSupport: async (
    supportEmail: string,
    supportPhone: string,
  ): Promise<{ supportEmail: string | null; supportPhone: string | null; message: string }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_update_home_support', {
        p_support_email: supportEmail,
        p_support_phone: supportPhone,
      });
      return {
        supportEmail: (data.supportEmail as string | null) ?? null,
        supportPhone: (data.supportPhone as string | null) ?? null,
        message: String(data.message ?? 'Home contact details saved'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Home deliverables RPC is missing. Run supabase/migrations/20260803270000_tenant_home_content_deliverables.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminBackfillActivationCodes: async (): Promise<{ created: number; message: string }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_backfill_activation_codes', {});
      return {
        created: Number(data.created ?? 0),
        message: String(data.message ?? 'Verification codes updated'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Backfill RPC is missing. Run supabase/migrations/20260803190000_backfill_existing_activation_codes.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminResetPasswordToUsername: async (
    profileId: string,
  ): Promise<{ username: string; temporaryPassword: string; message: string }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_reset_password_to_username', {
        p_profile_id: profileId,
      });
      return {
        username: String(data.username ?? ''),
        temporaryPassword: String(data.temporaryPassword ?? data.username ?? ''),
        message: String(data.message ?? 'Login password set to the username'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Password reset RPC is missing. Run supabase/migrations/20260803120000_fix_admin_suspend_delete_password.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminDeleteUser: async (profileId: string): Promise<void> => {
    try {
      await rpcJson('admin_delete_tenant_user', { p_profile_id: profileId });
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Delete-user RPC is missing. Run supabase/migrations/20260803120000_fix_admin_suspend_delete_password.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateTransactionCreatedAt: async (
    transactionId: string,
    createdAt: string,
  ): Promise<Transaction> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_update_transaction_created_at', {
        p_transaction_id: transactionId,
        p_created_at: createdAt,
      });
      return {
        id: String(data.id),
        accountId: String(data.accountId),
        walletId: String(data.walletId),
        type: String(data.type),
        status: String(data.status),
        amount: Number(data.amount ?? 0),
        balanceBefore: Number(data.balanceBefore ?? 0),
        balanceAfter: Number(data.balanceAfter ?? 0),
        reference: String(data.reference ?? ''),
        description: (data.description as string | null) ?? null,
        createdAt: String(data.createdAt),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Deposit-date RPC is missing. Run supabase/migrations/20260803100000_admin_delete_user_edit_deposit_date.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateTransferCreatedAt: async (
    transferId: string,
    createdAt: string,
  ): Promise<Transfer> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_update_transfer_created_at', {
        p_transfer_id: transferId,
        p_created_at: createdAt,
      });
      return mapTransfer(data);
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Transfer-date RPC is missing. Run supabase/migrations/20260803300000_admin_update_transfer_created_at.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateStatus: async (profileId: string, status: 'active' | 'suspended'): Promise<Profile> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_set_profile_status', {
        p_profile_id: profileId,
        p_status: status,
      });
      return {
        id: String(data.id),
        userId: String(data.userId),
        firstName: String(data.firstName),
        lastName: String(data.lastName),
        email: String(data.email),
        phone: (data.phone as string | null) ?? null,
        username: String(data.username),
        status: data.status as Profile['status'],
        role: data.role as Profile['role'],
        handoffTempPassword: (data.handoffTempPassword as string | null) ?? null,
        createdAt: String(data.createdAt),
        updatedAt: String(data.updatedAt),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Status RPC is missing. Run supabase/migrations/20260803120000_fix_admin_suspend_delete_password.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  adminUpdateProfile: async (
    profileId: string,
    body: { firstName?: string; lastName?: string; phone?: string | null; username?: string },
  ): Promise<Profile> => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.firstName !== undefined) patch.first_name = body.firstName;
    if (body.lastName !== undefined) patch.last_name = body.lastName;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.username !== undefined) patch.username = body.username;
    const { data, error } = await getSupabase()
      .from('profiles')
      .update(patch)
      .eq('id', profileId)
      .select('*')
      .single();
    if (error) throwFromPostgrest(error);
    return mapProfile(data);
  },

  adminFundWallet: async (body: FundWalletRequest): Promise<FundWalletResult> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('admin_fund_wallet', {
        p_amount: body.amount,
        p_wallet_id: body.walletId ?? null,
        p_account_id: body.accountId ?? null,
        p_reference: body.reference ?? null,
        p_idempotency_key: body.idempotencyKey ?? crypto.randomUUID(),
        p_description: body.description ?? null,
      });
      const walletData = (data.wallet ?? {}) as Record<string, unknown>;
      const txData = (data.transaction ?? {}) as Record<string, unknown>;
      return {
        wallet: {
          id: String(walletData.id),
          accountId: String(walletData.accountId),
          balance: Number(walletData.balance ?? 0),
          currency: String(walletData.currency ?? 'USD'),
          updatedAt: String(walletData.updatedAt ?? new Date().toISOString()),
        },
        transaction: {
          id: String(txData.id),
          accountId: String(txData.accountId),
          walletId: String(txData.walletId),
          type: String(txData.type),
          status: String(txData.status),
          amount: Number(txData.amount ?? 0),
          balanceBefore: Number(txData.balanceBefore ?? 0),
          balanceAfter: Number(txData.balanceAfter ?? 0),
          reference: String(txData.reference ?? ''),
          description: (txData.description as string | null) ?? null,
          createdAt: String(txData.createdAt ?? new Date().toISOString()),
        },
        idempotentReplay: Boolean(data.idempotentReplay),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Funding RPC is missing. Run supabase/migrations/20260803080000_admin_fund_wallet_rpc.sql in the Supabase SQL Editor, then try again.',
          400,
        );
      }
      throw error;
    }
  },

  adminGetWallet: async (walletId: string): Promise<Wallet> => {
    const { data, error } = await getSupabase().from('wallets').select('*').eq('id', walletId).maybeSingle();
    if (error) throwFromPostgrest(error);
    if (!data) throw new ApiError('NOT_FOUND', 'Wallet not found', 404);
    return mapWallet(data);
  },

  adminListTransactions: async (params?: ListParams): Promise<Paginated<Transaction>> => {
    const { limit, offset, from, to } = pageParams(params);
    const { data, error, count } = await getSupabase()
      .from('transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throwFromPostgrest(error);
    return { items: (data ?? []).map(mapTransaction), limit, offset, total: count ?? 0 };
  },

  adminListTransfers: async (params?: ListParams): Promise<Paginated<Transfer>> => {
    const { limit, offset, from, to } = pageParams(params);
    const { data, error, count } = await getSupabase()
      .from('transfers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throwFromPostgrest(error);
    return { items: (data ?? []).map(mapTransfer), limit, offset, total: count ?? 0 };
  },

  adminGetTransfer: async (id: string): Promise<Transfer> => {
    const { data, error } = await getSupabase().from('transfers').select('*').eq('id', id).maybeSingle();
    if (error) throwFromPostgrest(error);
    if (!data) throw new ApiError('NOT_FOUND', 'Transfer not found', 404);
    return mapTransfer(data);
  },

  getTenantConfig: async (): Promise<TenantConfiguration> => {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const base = baseDomain();
    const label = extractTenantLabelUnderBaseDomain(host, base);
    const devDefault = (import.meta.env.VITE_TENANT_DEV_DEFAULT_SLUG ?? 'northline').trim().toLowerCase();
    const sharedHost = isSharedDeployHost(host);
    // Never resolve the platform apex as a tenant — that host is Web Finance only.
    if (isPlatformBaseHost(host, base)) {
      throw new ApiError('NOT_FOUND', 'Tenant not found', 404);
    }
    const subdomain =
      label ??
      (import.meta.env.DEV || host === 'localhost' || host === '127.0.0.1' || sharedHost
        ? devDefault
        : null);
    if (!subdomain) {
      throw new ApiError(
        'NOT_FOUND',
        `No tenant subdomain for host ${host} (base ${base || '(unset)'}). Set VITE_TENANT_BASE_DOMAIN.`,
        404,
      );
    }
    try {
      const data = await rpcJson<Record<string, unknown>>('get_tenant_public_config', {
        p_subdomain: subdomain,
      });
      return mapTenantConfig(data);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') throw error;
      throw error;
    }
  },

  masterListTenants: async (params?: ListParams): Promise<Paginated<MasterTenantSummary>> => {
    const data = await rpcJson<{
      items: Record<string, unknown>[];
      limit: number;
      offset: number;
      total: number;
    }>('master_list_tenants', {
      p_limit: params?.limit ?? 50,
      p_offset: params?.offset ?? 0,
    });
    return {
      items: (data.items ?? []).map((row) => mapMasterSummary(row, baseDomain())),
      limit: data.limit,
      offset: data.offset,
      total: data.total,
    };
  },

  masterGetTenant: async (tenantId: string): Promise<MasterTenantDetail> => {
    const data = await rpcJson<Record<string, unknown>>('master_get_tenant', {
      p_tenant_id: tenantId,
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  },

  masterCreateTenant: async (body: CreateTenantRequest): Promise<MasterTenantDetail> => {
    const data = await rpcJson<Record<string, unknown>>('master_create_tenant', {
      p_name: body.name,
      p_slug: body.slug,
      p_subdomain: body.subdomain ?? null,
      p_owner_user_id: body.ownerUserId ?? null,
      p_branding: body.branding ?? {},
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  },

  masterUpdateTenant: async (
    tenantId: string,
    body: UpdateTenantRequest,
  ): Promise<MasterTenantDetail> => {
    const data = await rpcJson<Record<string, unknown>>('master_update_tenant', {
      p_tenant_id: tenantId,
      p_name: body.name ?? null,
      p_subdomain: body.subdomain ?? null,
      p_owner_user_id: body.ownerUserId ?? null,
      p_clear_owner: Object.prototype.hasOwnProperty.call(body, 'ownerUserId') && body.ownerUserId === null,
      p_branding: body.branding ?? null,
      p_handoff_temp_password: body.handoffTempPassword ?? null,
      p_clear_handoff_temp_password:
        Object.prototype.hasOwnProperty.call(body, 'handoffTempPassword') &&
        body.handoffTempPassword === null,
      p_handoff_admin_username: body.handoffAdminUsername ?? null,
      p_clear_handoff_admin_username:
        Object.prototype.hasOwnProperty.call(body, 'handoffAdminUsername') &&
        body.handoffAdminUsername === null,
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  },

  masterProvisionTenantAdmin: async (
    tenantId: string,
    body: { username: string; password?: string | null; email?: string | null },
  ): Promise<{
    ownerUserId: string;
    username: string;
    email: string;
    temporaryPassword: string;
    adminLoginEnabled?: boolean;
    message: string;
  }> => {
    try {
      const username = body.username.trim().toLowerCase();
      const password = body.password?.trim() ? body.password.trim() : null;
      const data = await rpcJson<Record<string, unknown>>('master_provision_tenant_admin', {
        p_tenant_id: tenantId,
        p_username: username,
        p_password: password,
        p_email: body.email?.trim() ? body.email.trim() : null,
      });
      return {
        ownerUserId: String(data.ownerUserId ?? ''),
        username: String(data.username ?? username),
        email: String(data.email ?? body.email ?? ''),
        temporaryPassword: String(data.temporaryPassword ?? ''),
        adminLoginEnabled: data.adminLoginEnabled !== false,
        message: String(data.message ?? 'Admin login enabled.'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (!missingFn) throw error;

      throw new ApiError(
        'VALIDATION_ERROR',
        'Admin login RPC is missing. Run supabase/migrations/20260803030000_master_provision_tenant_admin_rpc.sql in the Supabase SQL Editor, then click Enable admin login again.',
        400,
      );
    }
  },

  masterDisableTenantAdminLogin: async (
    tenantId: string,
  ): Promise<{ tenantId: string; adminLoginEnabled: boolean; message: string }> => {
    try {
      const data = await rpcJson<Record<string, unknown>>('master_disable_tenant_admin_login', {
        p_tenant_id: tenantId,
      });
      return {
        tenantId: String(data.tenantId ?? tenantId),
        adminLoginEnabled: Boolean(data.adminLoginEnabled),
        message: String(data.message ?? 'Admin login disabled.'),
      };
    } catch (error) {
      const missingFn =
        error instanceof ApiError &&
        /could not find the function|does not exist|schema cache/i.test(error.message);
      if (missingFn) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Disable-admin-login RPC is missing. Run supabase/migrations/20260803280000_admin_login_enable_disable.sql in the Supabase SQL Editor.',
          400,
        );
      }
      throw error;
    }
  },

  masterActivateTenant: async (tenantId: string): Promise<MasterTenantDetail> => {
    const data = await rpcJson<Record<string, unknown>>('master_set_tenant_status', {
      p_tenant_id: tenantId,
      p_status: 'active',
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  },

  masterDeactivateTenant: async (tenantId: string): Promise<MasterTenantDetail> => {
    const data = await rpcJson<Record<string, unknown>>('master_set_tenant_status', {
      p_tenant_id: tenantId,
      p_status: 'inactive',
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  },

  masterVerifyTenantDns: async (tenantId: string): Promise<DnsVerificationResult> => {
    return patchDeploymentFromPublicChecks(tenantId, { mode: 'dns' });
  },

  masterVerifyTenantSsl: async (tenantId: string): Promise<DnsVerificationResult> => {
    return patchDeploymentFromPublicChecks(tenantId, { mode: 'ssl' });
  },

  masterProvisionTenant: async (tenantId: string): Promise<DnsVerificationResult> => {
    // Netlify writes still go through Edge; public DNS/SSL status is patched client-side
    // so Verify works even when the Edge verifier is stale or undeployed.
    let edgeMessage: string | null = null;
    try {
      const edge = await invokeFunction<DnsVerificationResult>('master-deploy', {
        action: 'provision',
        tenantId,
      });
      edgeMessage = edge.message ?? null;
    } catch (error) {
      // If Edge is unavailable, still attempt public verification so Master can progress.
      if (!(error instanceof ApiError && error.code === 'DEPLOYMENT_NOT_CONFIGURED')) {
        // Keep going for network/function errors after recording message
        edgeMessage = error instanceof Error ? error.message : 'Provisioning Edge call failed';
      } else {
        throw error;
      }
    }

    const checked = await patchDeploymentFromPublicChecks(tenantId, {
      mode: 'provision',
      markProvisioned: true,
    });
    return {
      ...checked,
      message: edgeMessage ? `${edgeMessage} · ${checked.message}` : checked.message,
    };
  },

  masterGetTenantDeployment: async (tenantId: string): Promise<TenantDeploymentInfo> => {
    const detail = await api.masterGetTenant(tenantId);
    return detail.deployment;
  },
};

async function patchDeploymentFromPublicChecks(
  tenantId: string,
  options: { mode: 'dns' | 'ssl' | 'provision'; markProvisioned?: boolean },
): Promise<DnsVerificationResult> {
  const detail = await api.masterGetTenant(tenantId);
  const hostname = detail.deployment.hostname;
  const expectedTarget = detail.deployment.dnsTarget;
  const now = new Date().toISOString();

  if (!hostname || hostname.endsWith('.app.example.com') || !expectedTarget) {
    throw new ApiError(
      'DEPLOYMENT_NOT_CONFIGURED',
      `Cannot verify DNS: hostname=${hostname || '(empty)'} target=${expectedTarget || '(empty)'}. Set Netlify env VITE_TENANT_BASE_DOMAIN and VITE_DEPLOYMENT_DNS_TARGET, then redeploy.`,
      400,
    );
  }

  const dns = await verifyPublicDns(hostname, expectedTarget);
  let dnsStatus: TenantDnsStatus = dns.status;
  let sslStatus: TenantSslStatus = detail.deployment.sslStatus;
  let message = `${dns.detail} (checked ${hostname} → ${expectedTarget})`;
  let code: string | null = dnsStatus === 'verified' ? null : 'DNS_NOT_READY';

  if (options.mode === 'ssl' || options.mode === 'provision') {
    if (dnsStatus !== 'verified') {
      sslStatus = 'not_configured';
      code = 'DNS_NOT_READY';
    } else {
      const tls = await checkTls(hostname);
      sslStatus = tls.ok ? 'verified' : 'pending';
      message = `${tls.detail} (checked ${hostname})`;
      code = tls.ok ? null : 'SSL_NOT_READY';
    }
  } else if (dnsStatus === 'verified') {
    message = `DNS verified for ${hostname}`;
    code = null;
  }

  const deploymentStatus = deriveDeploymentStatus(
    dnsStatus,
    options.mode === 'dns' ? detail.deployment.sslStatus : sslStatus,
  );

  let data: Record<string, unknown>;
  try {
    data = await rpcJson<Record<string, unknown>>('master_patch_tenant_deployment', {
      p_tenant_id: tenantId,
      p_dns_status: dnsStatus,
      p_ssl_status: options.mode === 'dns' ? detail.deployment.sslStatus : sslStatus,
      p_deployment_status: deploymentStatus,
      p_dns_checked_at: now,
      p_dns_verified_at: dnsStatus === 'verified' ? now : null,
      p_ssl_checked_at: options.mode === 'dns' ? null : now,
      p_last_provisioned_at: options.markProvisioned ? now : null,
      p_last_provision_error: code ? message : null,
      p_clear_provision_error: !code,
    });
  } catch (error) {
    const base = error instanceof ApiError ? error.message : 'Failed to save DNS status';
    throw new ApiError(
      'INTERNAL_ERROR',
      `${base}. DNS check result was: ${message}. If this mentions handoff_temp_password, run migration 20260802220000 in the Supabase SQL Editor.`,
      500,
    );
  }

  const tenant = mapMasterDetailRpc(data, baseDomain(), dnsTarget());
  const finalSsl = options.mode === 'dns' ? tenant.deployment.sslStatus : sslStatus;

  return {
    status: options.mode === 'ssl' ? finalSsl : dnsStatus,
    hostname,
    expectedTarget,
    deploymentStatus: tenant.deployment.deploymentStatus,
    dnsStatus,
    sslStatus: finalSsl,
    message,
    checkedAt: now,
    code,
    detail: message,
    tenant,
  };
}
