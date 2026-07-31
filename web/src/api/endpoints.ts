import { apiRequest } from './client';
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
  MasterTenantDetail,
  MasterTenantSummary,
  TenantConfiguration,
  UpdateTenantRequest,
} from '../types/tenant';

export interface ListParams {
  limit?: number;
  offset?: number;
  search?: string;
}

function toQuery(params: ListParams = {}): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.search) query.set('search', params.search);
  const value = query.toString();
  return value ? `?${value}` : '';
}

export const api = {
  getSession: () => apiRequest<SessionUser>('/api/session'),

  getProfile: () => apiRequest<Profile>('/api/me/profile'),

  getAccount: () => apiRequest<Account>('/api/me/account'),

  getWallet: () => apiRequest<Wallet>('/api/me/wallet'),

  getTransactions: (params?: ListParams) =>
    apiRequest<Paginated<Transaction>>(`/api/me/transactions${toQuery(params)}`),

  getTransaction: (id: string) => apiRequest<Transaction>(`/api/transactions/${id}`),

  getTransfers: (params?: ListParams) =>
    apiRequest<Paginated<Transfer>>(`/api/me/transfers${toQuery(params)}`),

  getTransfer: (id: string) => apiRequest<Transfer>(`/api/transfers/${id}`),

  createTransfer: (body: CreateTransferRequest) =>
    apiRequest<TransferActionResponse>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getVerification: (id: string) =>
    apiRequest<VerificationStageResponse>(`/api/transfers/${id}/verification`),

  submitVerification: (id: string, code: string) =>
    apiRequest<TransferActionResponse>(`/api/transfers/${id}/verification`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  completeTransfer: (id: string) =>
    apiRequest<TransferActionResponse>(`/api/transfers/${id}/complete`, {
      method: 'POST',
    }),

  adminListUsers: (params?: ListParams) =>
    apiRequest<Paginated<AdminUser>>(`/api/admin/users${toQuery(params)}`),

  adminGetUser: (userId: string) =>
    apiRequest<AdminUser>(`/api/admin/users/${userId}`),

  adminCreateUser: (body: CreateUserRequest) =>
    apiRequest<AdminUser>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  adminUpdateStatus: (profileId: string, status: 'active' | 'suspended') =>
    apiRequest<Profile>(`/api/admin/profiles/${profileId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  adminUpdateProfile: (
    profileId: string,
    body: { firstName?: string; lastName?: string; phone?: string | null; username?: string },
  ) =>
    apiRequest<Profile>(`/api/admin/profiles/${profileId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  adminFundWallet: (body: FundWalletRequest) =>
    apiRequest<FundWalletResult>('/api/admin/wallets/fund', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  adminGetWallet: (walletId: string) =>
    apiRequest<Wallet>(`/api/admin/wallets/${walletId}`),

  adminListTransactions: (params?: ListParams) =>
    apiRequest<Paginated<Transaction>>(`/api/admin/transactions${toQuery(params)}`),

  adminListTransfers: (params?: ListParams) =>
    apiRequest<Paginated<Transfer>>(`/api/admin/transfers${toQuery(params)}`),

  adminGetTransfer: (id: string) =>
    apiRequest<Transfer>(`/api/admin/transfers/${id}`),

  /** Public tenant branding for the server-resolved tenant (no auth). */
  getTenantConfig: () =>
    apiRequest<TenantConfiguration>('/api/tenant/config', { auth: false }),

  // --- Master Admin (platform) ---

  masterListTenants: (params?: ListParams) =>
    apiRequest<Paginated<MasterTenantSummary>>(`/api/master/tenants${toQuery(params)}`),

  masterGetTenant: (tenantId: string) =>
    apiRequest<MasterTenantDetail>(`/api/master/tenants/${tenantId}`),

  masterCreateTenant: (body: CreateTenantRequest) =>
    apiRequest<MasterTenantDetail>('/api/master/tenants', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  masterUpdateTenant: (tenantId: string, body: UpdateTenantRequest) =>
    apiRequest<MasterTenantDetail>(`/api/master/tenants/${tenantId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  masterActivateTenant: (tenantId: string) =>
    apiRequest<MasterTenantDetail>(`/api/master/tenants/${tenantId}/activate`, {
      method: 'POST',
    }),

  masterDeactivateTenant: (tenantId: string) =>
    apiRequest<MasterTenantDetail>(`/api/master/tenants/${tenantId}/deactivate`, {
      method: 'POST',
    }),
};
