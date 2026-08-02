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
  UpdateTenantRequest,
} from '../types/tenant';
import { extractTenantLabelUnderBaseDomain } from '../tenant/resolve';

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

function pageParams(params: ListParams = {}) {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  return { limit, offset, from: offset, to: offset + limit - 1 };
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

  createTransfer: (body: CreateTransferRequest) =>
    invokeFunction<TransferActionResponse>('transfer-actions', { action: 'create', ...body }),

  getVerification: (id: string) =>
    invokeFunction<VerificationStageResponse>('transfer-actions', {
      action: 'getVerification',
      transferId: id,
    }),

  submitVerification: (id: string, code: string) =>
    invokeFunction<TransferActionResponse>('transfer-actions', {
      action: 'submitVerification',
      transferId: id,
      code,
    }),

  completeTransfer: (id: string) =>
    invokeFunction<TransferActionResponse>('transfer-actions', {
      action: 'complete',
      transferId: id,
    }),

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

    const items: AdminUser[] = [];
    for (const row of data ?? []) {
      const accountRow = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      if (!accountRow) continue;
      const { data: wallet } = await getSupabase()
        .from('wallets')
        .select('*')
        .eq('account_id', accountRow.id)
        .maybeSingle();
      items.push({
        profile: mapProfile(row),
        account: mapAccount(accountRow, wallet ? mapWallet(wallet) : null),
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
    return {
      profile: mapProfile(profile),
      account: mapAccount(accountRow, wallet ? mapWallet(wallet) : null),
    };
  },

  adminCreateUser: (body: CreateUserRequest) =>
    invokeFunction<AdminUser>('admin-ops', { action: 'createUser', ...body }),

  adminUpdateStatus: (profileId: string, status: 'active' | 'suspended') =>
    invokeFunction<Profile>('admin-ops', { action: 'setProfileStatus', profileId, status }),

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

  adminFundWallet: (body: FundWalletRequest) =>
    invokeFunction<FundWalletResult>('admin-ops', {
      action: 'fundWallet',
      ...body,
      idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
    }),

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
    const label = extractTenantLabelUnderBaseDomain(host, baseDomain());
    const devDefault = (import.meta.env.VITE_TENANT_DEV_DEFAULT_SLUG ?? 'northline').trim().toLowerCase();
    const subdomain = label ?? (import.meta.env.DEV || host === 'localhost' ? devDefault : null);
    if (!subdomain) {
      throw new ApiError('NOT_FOUND', 'Tenant not found', 404);
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
      p_clear_owner: body.ownerUserId === null,
      p_branding: body.branding ?? null,
    });
    return mapMasterDetailRpc(data, baseDomain(), dnsTarget());
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

  masterVerifyTenantDns: (tenantId: string) =>
    invokeFunction<DnsVerificationResult>('master-deploy', {
      action: 'verifyDns',
      tenantId,
    }),

  masterVerifyTenantSsl: (tenantId: string) =>
    invokeFunction<DnsVerificationResult>('master-deploy', {
      action: 'verifySsl',
      tenantId,
    }),

  masterProvisionTenant: (tenantId: string) =>
    invokeFunction<DnsVerificationResult>('master-deploy', {
      action: 'provision',
      tenantId,
    }),

  masterGetTenantDeployment: async (tenantId: string): Promise<TenantDeploymentInfo> => {
    const detail = await api.masterGetTenant(tenantId);
    return detail.deployment;
  },
};
