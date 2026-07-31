import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '../../config/supabase';
import type {
  TransferRecord,
  TransferReasonCode,
  TransferStatus,
  TransactionRecord,
} from '../../types';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { mapTransaction } from '../transactions/transaction-repository';

const TRANSFER_COLUMNS = `
  id,
  account_id,
  user_id,
  wallet_id,
  ledger_transaction_id,
  reference,
  idempotency_key,
  recipient_name,
  recipient_account,
  recipient_bank,
  amount,
  description,
  status,
  current_stage,
  stages_completed,
  reason_code,
  failure_reason,
  completed_at,
  created_at,
  updated_at
`;

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('Invalid transfer amount value');
  }
  return parsed;
};

export const mapTransfer = (row: Record<string, unknown>): TransferRecord => ({
  id: String(row.id),
  accountId: String(row.account_id),
  userId: String(row.user_id),
  walletId: String(row.wallet_id),
  ledgerTransactionId:
    row.ledger_transaction_id == null ? null : String(row.ledger_transaction_id),
  reference: String(row.reference),
  idempotencyKey: String(row.idempotency_key),
  recipientName: String(row.recipient_name),
  recipientAccount: String(row.recipient_account),
  recipientBank: String(row.recipient_bank),
  amount: toNumber(row.amount),
  description: row.description == null ? null : String(row.description),
  status: row.status as TransferStatus,
  currentStage: Number(row.current_stage),
  stagesCompleted: Number(row.stages_completed),
  reasonCode: (row.reason_code as TransferReasonCode | null) ?? null,
  failureReason: row.failure_reason == null ? null : String(row.failure_reason),
  completedAt: row.completed_at == null ? null : String(row.completed_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export interface CreateTransferRowInput {
  accountId: string;
  userId: string;
  walletId: string;
  reference: string;
  idempotencyKey: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  amount: number;
  description?: string | null;
  status: TransferStatus;
  currentStage?: number;
  stagesCompleted?: number;
  reasonCode?: TransferReasonCode | null;
  failureReason?: string | null;
}

export class TransferRepository {
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

  async createTransfer(input: CreateTransferRowInput): Promise<TransferRecord> {
    const { data, error } = await this.client()
      .from('transfers')
      .insert({
        account_id: input.accountId,
        user_id: input.userId,
        wallet_id: input.walletId,
        reference: input.reference,
        idempotency_key: input.idempotencyKey,
        recipient_name: input.recipientName,
        recipient_account: input.recipientAccount,
        recipient_bank: input.recipientBank,
        amount: input.amount,
        description: input.description ?? null,
        status: input.status,
        current_stage: input.currentStage ?? 0,
        stages_completed: input.stagesCompleted ?? 0,
        reason_code: input.reasonCode ?? null,
        failure_reason: input.failureReason ?? null,
      })
      .select(TRANSFER_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictError('transfer idempotency key or reference already exists', {
          reasonCode: 'DUPLICATE_REQUEST',
        });
      }
      throw new ValidationError(error?.message ?? 'Transfer creation failed');
    }

    return mapTransfer(data);
  }

  async findById(id: string): Promise<TransferRecord | null> {
    const { data, error } = await this.client()
      .from('transfers')
      .select(TRANSFER_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransfer(data) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<TransferRecord | null> {
    const { data, error } = await this.client()
      .from('transfers')
      .select(TRANSFER_COLUMNS)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapTransfer(data) : null;
  }

  async listByUserId(
    userId: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransferRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      this.client()
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      this.client()
        .from('transfers')
        .select(TRANSFER_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    if (countError) throw new ValidationError(countError.message);
    if (error) throw new ValidationError(error.message);

    return { items: (data ?? []).map(mapTransfer), total: count ?? 0 };
  }

  async listByAccountId(
    accountId: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransferRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      this.client()
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      this.client()
        .from('transfers')
        .select(TRANSFER_COLUMNS)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    if (countError) throw new ValidationError(countError.message);
    if (error) throw new ValidationError(error.message);

    return { items: (data ?? []).map(mapTransfer), total: count ?? 0 };
  }

  async listAll(
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransferRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      this.client().from('transfers').select('id', { count: 'exact', head: true }),
      this.client()
        .from('transfers')
        .select(TRANSFER_COLUMNS)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    if (countError) throw new ValidationError(countError.message);
    if (error) throw new ValidationError(error.message);

    return { items: (data ?? []).map(mapTransfer), total: count ?? 0 };
  }

  async updateTransfer(
    id: string,
    updates: Partial<{
      status: TransferStatus;
      currentStage: number;
      stagesCompleted: number;
      reasonCode: TransferReasonCode | null;
      failureReason: string | null;
      ledgerTransactionId: string | null;
      completedAt: string | null;
    }>,
  ): Promise<TransferRecord> {
    const payload: Record<string, unknown> = {};
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.currentStage !== undefined) payload.current_stage = updates.currentStage;
    if (updates.stagesCompleted !== undefined) {
      payload.stages_completed = updates.stagesCompleted;
    }
    if (updates.reasonCode !== undefined) payload.reason_code = updates.reasonCode;
    if (updates.failureReason !== undefined) payload.failure_reason = updates.failureReason;
    if (updates.ledgerTransactionId !== undefined) {
      payload.ledger_transaction_id = updates.ledgerTransactionId;
    }
    if (updates.completedAt !== undefined) payload.completed_at = updates.completedAt;

    const { data, error } = await this.client()
      .from('transfers')
      .update(payload)
      .eq('id', id)
      .select(TRANSFER_COLUMNS)
      .single();

    if (error || !data) {
      throw error ? new ValidationError(error.message) : new NotFoundError('Transfer not found');
    }

    return mapTransfer(data);
  }

  async completeTransferDebitAtomic(input: {
    transferId: string;
    requireOneTimeSlot?: boolean;
    requireFourStages?: boolean;
  }): Promise<{
    transfer: TransferRecord;
    ledger: TransactionRecord | null;
    idempotentReplay: boolean;
  }> {
    const { data, error } = await this.client().rpc('complete_transfer_debit_atomic', {
      p_transfer_id: input.transferId,
      p_require_one_time_slot: input.requireOneTimeSlot ?? false,
      p_require_four_stages: input.requireFourStages ?? false,
    });

    if (error || !data) {
      const message = error?.message ?? 'Transfer completion failed';
      throw new ValidationError(message, { rpcError: message });
    }

    const payload = data as Record<string, unknown>;
    const transferRow = payload.transfer as Record<string, unknown>;
    const ledgerRow = payload.ledger as Record<string, unknown> | null;

    return {
      transfer: mapTransfer(transferRow),
      ledger: ledgerRow ? mapTransaction(ledgerRow) : null,
      idempotentReplay: Boolean(payload.idempotent_replay),
    };
  }
}

export const transferRepository = new TransferRepository();
