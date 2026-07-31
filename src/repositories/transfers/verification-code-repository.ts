import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '../../config/supabase';
import type { TransferVerificationCodeRecord } from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';

const CODE_COLUMNS = `
  id,
  transfer_id,
  stage,
  code_hash,
  expires_at,
  attempts,
  max_attempts,
  consumed_at,
  created_at,
  updated_at
`;

export const mapVerificationCode = (
  row: Record<string, unknown>,
): TransferVerificationCodeRecord => ({
  id: String(row.id),
  transferId: String(row.transfer_id),
  stage: Number(row.stage),
  codeHash: String(row.code_hash),
  expiresAt: String(row.expires_at),
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  consumedAt: row.consumed_at == null ? null : String(row.consumed_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class VerificationCodeRepository {
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

  async upsertStageCode(input: {
    transferId: string;
    stage: number;
    codeHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<TransferVerificationCodeRecord> {
    const { data, error } = await this.client()
      .from('transfer_verification_codes')
      .upsert(
        {
          transfer_id: input.transferId,
          stage: input.stage,
          code_hash: input.codeHash,
          expires_at: input.expiresAt,
          attempts: 0,
          max_attempts: input.maxAttempts ?? 5,
          consumed_at: null,
        },
        { onConflict: 'transfer_id,stage' },
      )
      .select(CODE_COLUMNS)
      .single();

    if (error || !data) {
      throw new ValidationError(error?.message ?? 'Verification code persistence failed');
    }

    return mapVerificationCode(data);
  }

  async saveReveal(input: {
    transferId: string;
    stage: number;
    codePlaintext: string;
  }): Promise<void> {
    const { error } = await this.client()
      .from('transfer_verification_code_reveals')
      .upsert(
        {
          transfer_id: input.transferId,
          stage: input.stage,
          code_plaintext: input.codePlaintext,
        },
        { onConflict: 'transfer_id,stage' },
      );

    if (error) {
      throw new ValidationError(error.message);
    }
  }

  async findByTransferAndStage(
    transferId: string,
    stage: number,
  ): Promise<TransferVerificationCodeRecord | null> {
    const { data, error } = await this.client()
      .from('transfer_verification_codes')
      .select(CODE_COLUMNS)
      .eq('transfer_id', transferId)
      .eq('stage', stage)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapVerificationCode(data) : null;
  }

  async incrementAttempts(id: string): Promise<TransferVerificationCodeRecord> {
    const existing = await this.client()
      .from('transfer_verification_codes')
      .select(CODE_COLUMNS)
      .eq('id', id)
      .single();

    if (existing.error || !existing.data) {
      throw new NotFoundError('Verification code not found');
    }

    const nextAttempts = Number(existing.data.attempts) + 1;
    const { data, error } = await this.client()
      .from('transfer_verification_codes')
      .update({ attempts: nextAttempts })
      .eq('id', id)
      .select(CODE_COLUMNS)
      .single();

    if (error || !data) {
      throw new ValidationError(error?.message ?? 'Failed to update verification attempts');
    }

    return mapVerificationCode(data);
  }

  async markConsumed(id: string): Promise<TransferVerificationCodeRecord> {
    const { data, error } = await this.client()
      .from('transfer_verification_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', id)
      .select(CODE_COLUMNS)
      .single();

    if (error || !data) {
      throw new ValidationError(error?.message ?? 'Failed to consume verification code');
    }

    return mapVerificationCode(data);
  }

  async peekPlaintext(
    transferId: string,
    stage: number,
  ): Promise<string | null> {
    const { data, error } = await this.client()
      .from('transfer_verification_code_reveals')
      .select('code_plaintext')
      .eq('transfer_id', transferId)
      .eq('stage', stage)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data?.code_plaintext ? String(data.code_plaintext) : null;
  }
}

export const verificationCodeRepository = new VerificationCodeRepository();
