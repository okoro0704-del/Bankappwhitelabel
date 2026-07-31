import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient, createSupabaseClient } from '../../config/supabase';
import type { CreateWalletInput, WalletRecord } from '../../types';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';

const WALLET_COLUMNS = `
  id,
  account_id,
  tenant_id,
  balance,
  currency,
  created_at,
  updated_at
`;

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('Invalid wallet balance value');
  }
  return parsed;
};

export const mapWallet = (row: Record<string, unknown>): WalletRecord => ({
  id: String(row.id),
  accountId: String(row.account_id),
  tenantId: row.tenant_id == null ? null : String(row.tenant_id),
  balance: toNumber(row.balance),
  currency: String(row.currency),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class WalletRepository {
  private adminClient?: SupabaseClient;

  constructor(adminClient?: SupabaseClient) {
    this.adminClient = adminClient;
  }

  private client(): SupabaseClient {
    if (!this.adminClient) {
      this.adminClient = createSupabaseAdminClient();
    }

    return this.adminClient;
  }

  async createWallet(input: CreateWalletInput): Promise<WalletRecord> {
    const { data, error } = await this.client()
      .from('wallets')
      .insert({
        account_id: input.accountId,
        tenant_id: input.tenantId ?? undefined,
        balance: input.balance ?? 0,
        currency: input.currency ?? 'USD',
      })
      .select(WALLET_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictError('wallet already exists for account', {
          field: 'accountId',
          value: input.accountId,
        });
      }
      throw new ValidationError(error?.message ?? 'Wallet creation failed');
    }

    return mapWallet(data);
  }

  async findById(id: string, tenantId?: string): Promise<WalletRecord | null> {
    let query = this.client()
      .from('wallets')
      .select(WALLET_COLUMNS)
      .eq('id', id);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapWallet(data) : null;
  }

  async findByAccountId(accountId: string): Promise<WalletRecord | null> {
    const { data, error } = await this.client()
      .from('wallets')
      .select(WALLET_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapWallet(data) : null;
  }

  async findByUserId(userId: string): Promise<WalletRecord | null> {
    const { data, error } = await this.client()
      .from('wallets')
      .select(`${WALLET_COLUMNS}, accounts!inner(profile_id, profiles!inner(user_id))`)
      .eq('accounts.profiles.user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapWallet(data) : null;
  }

  async getWalletAsUser(
    accessToken: string,
    walletId: string,
  ): Promise<WalletRecord | null> {
    const client = createSupabaseClient(accessToken);
    const { data, error } = await client
      .from('wallets')
      .select(WALLET_COLUMNS)
      .eq('id', walletId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapWallet(data) : null;
  }

  async requireById(id: string): Promise<WalletRecord> {
    const wallet = await this.findById(id);
    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }
    return wallet;
  }

  async listWallets(tenantId: string): Promise<WalletRecord[]> {
    const { data, error } = await this.client()
      .from('wallets')
      .select(WALLET_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at');

    if (error) {
      throw new ValidationError(error.message);
    }

    return (data ?? []).map(mapWallet);
  }
}

export const walletRepository = new WalletRepository();
