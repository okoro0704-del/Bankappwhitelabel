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
};
