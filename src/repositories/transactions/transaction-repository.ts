import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient, createSupabaseClient } from '../../config/supabase';
import type {
  FundWalletResult,
  TransactionRecord,
  WalletRecord,
} from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { mapWallet } from '../wallets/wallet-repository';

const TRANSACTION_COLUMNS = `
  id,
  wallet_id,
  account_id,
  transaction_type,
  status,
  amount,
  balance_before,
  balance_after,
  reference,
  idempotency_key,
  description,
  created_by,
  metadata,
  created_at,
  updated_at
`;

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('Invalid transaction amount value');
  }
  return parsed;
};

export const mapTransaction = (row: Record<string, unknown>): TransactionRecord => ({
  id: String(row.id),
  walletId: String(row.wallet_id),
  accountId: String(row.account_id),
  transactionType: row.transaction_type as TransactionRecord['transactionType'],
  status: row.status as TransactionRecord['status'],
  amount: toNumber(row.amount),
  balanceBefore: toNumber(row.balance_before),
  balanceAfter: toNumber(row.balance_after),
  reference: String(row.reference),
  idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
  description: row.description == null ? null : String(row.description),
  createdBy: row.created_by == null ? null : String(row.created_by),
  metadata:
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {},
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export interface AtomicFundInput {
  walletId: string;
  amount: number;
  reference: string;
  idempotencyKey?: string;
  description?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export class TransactionRepository {
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

  async findById(id: string): Promise<TransactionRecord | null> {
    const { data, error } = await this.client()
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransaction(data) : null;
  }

  async findByReference(reference: string): Promise<TransactionRecord | null> {
    const { data, error } = await this.client()
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('reference', reference)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransaction(data) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<TransactionRecord | null> {
    const { data, error } = await this.client()
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransaction(data) : null;
  }

  async listByWalletId(walletId: string): Promise<TransactionRecord[]> {
    const { data, error } = await this.client()
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('wallet_id', walletId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new ValidationError(error.message);
    }

    return (data ?? []).map(mapTransaction);
  }

  async listByAccountId(
    accountId: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransactionRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      this.client()
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      this.client()
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    if (countError) {
      throw new ValidationError(countError.message);
    }
    if (error) {
      throw new ValidationError(error.message);
    }

    return {
      items: (data ?? []).map(mapTransaction),
      total: count ?? 0,
    };
  }

  async listAll(
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransactionRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      this.client().from('transactions').select('id', { count: 'exact', head: true }),
      this.client()
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    if (countError) {
      throw new ValidationError(countError.message);
    }
    if (error) {
      throw new ValidationError(error.message);
    }

    return {
      items: (data ?? []).map(mapTransaction),
      total: count ?? 0,
    };
  }

  async getTransactionAsUser(
    accessToken: string,
    transactionId: string,
  ): Promise<TransactionRecord | null> {
    const client = createSupabaseClient(accessToken);
    const { data, error } = await client
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('id', transactionId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransaction(data) : null;
  }

  /**
   * Atomically funds a wallet and creates a ledger transaction via DB function.
   * Duplicate reference/idempotency key returns the existing completed funding row.
   */
  async fundWalletAtomic(input: AtomicFundInput): Promise<{
    transaction: TransactionRecord;
    wallet: WalletRecord;
    idempotentReplay: boolean;
  }> {
    const existingByKey = input.idempotencyKey
      ? await this.findByIdempotencyKey(input.idempotencyKey)
      : null;
    const existingByReference = existingByKey
      ? null
      : await this.findByReference(input.reference);
    const prior = existingByKey ?? existingByReference;

    const { data, error } = await this.client().rpc('fund_wallet_atomic', {
      p_wallet_id: input.walletId,
      p_amount: input.amount,
      p_reference: input.reference,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_description: input.description ?? null,
      p_created_by: input.createdBy ?? null,
      p_metadata: input.metadata ?? {},
    });

    if (error || !data) {
      throw new ValidationError(error?.message ?? 'Atomic wallet funding failed');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new ValidationError('Atomic wallet funding returned no transaction');
    }

    const transaction = mapTransaction(row as Record<string, unknown>);

    const { data: walletRow, error: walletError } = await this.client()
      .from('wallets')
      .select('id, account_id, balance, currency, created_at, updated_at')
      .eq('id', transaction.walletId)
      .single();

    if (walletError || !walletRow) {
      throw walletError
        ? new ValidationError(walletError.message)
        : new NotFoundError('Wallet not found after funding');
    }

    return {
      transaction,
      wallet: mapWallet(walletRow as Record<string, unknown>),
      idempotentReplay: Boolean(prior && prior.id === transaction.id),
    };
  }
}

export type { FundWalletResult };

export const transactionRepository = new TransactionRepository();
