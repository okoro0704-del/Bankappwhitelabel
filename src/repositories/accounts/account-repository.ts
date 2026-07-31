import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient, createSupabaseClient } from '../../config/supabase';
import type {
  AccountRecord,
  AccountType,
  CreateAccountInput,
  UpdateAccountStatusInput,
} from '../../types';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { generateAccountNumber } from '../../utils/account-number';

const ACCOUNT_COLUMNS = `
  id,
  profile_id,
  account_number,
  account_type,
  account_status,
  one_time_transfer_used,
  created_at,
  updated_at
`;

const mapAccount = (row: Record<string, unknown>): AccountRecord => ({
  id: String(row.id),
  profileId: String(row.profile_id),
  accountNumber: String(row.account_number),
  accountType: row.account_type as AccountRecord['accountType'],
  accountStatus: row.account_status as AccountRecord['accountStatus'],
  oneTimeTransferUsed: Boolean(row.one_time_transfer_used),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class AccountRepository {
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

  async createAccount(input: CreateAccountInput): Promise<AccountRecord> {
    const maxAttempts = 8;
    let lastError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const accountNumber = input.accountNumber ?? generateAccountNumber();

      const { data, error } = await this.client()
        .from('accounts')
        .insert({
          profile_id: input.profileId,
          account_type: input.accountType,
          account_number: accountNumber,
          account_status: input.accountStatus ?? 'active',
        })
        .select(ACCOUNT_COLUMNS)
        .single();

      if (!error && data) {
        return mapAccount(data);
      }

      lastError = error;

      if (error?.code === '23505' && !input.accountNumber) {
        continue;
      }

      if (error?.code === '23505') {
        throw new ConflictError('account number already exists', {
          field: 'accountNumber',
          value: accountNumber,
        });
      }

      throw new ValidationError(error?.message ?? 'Account creation failed');
    }

    throw new ValidationError(lastError?.message ?? 'Unable to generate a unique account number');
  }

  async findById(id: string): Promise<AccountRecord | null> {
    const { data, error } = await this.client()
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapAccount(data) : null;
  }

  async findByProfileId(profileId: string): Promise<AccountRecord | null> {
    const { data, error } = await this.client()
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapAccount(data) : null;
  }

  async findByUserId(userId: string): Promise<AccountRecord | null> {
    const { data, error } = await this.client()
      .from('accounts')
      .select(`${ACCOUNT_COLUMNS}, profiles!inner(user_id)`)
      .eq('profiles.user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapAccount(data) : null;
  }

  async findByAccountNumber(accountNumber: string): Promise<AccountRecord | null> {
    const { data, error } = await this.client()
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('account_number', accountNumber)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapAccount(data) : null;
  }

  async updateAccountStatus(
    id: string,
    input: UpdateAccountStatusInput,
  ): Promise<AccountRecord> {
    const { data, error } = await this.client()
      .from('accounts')
      .update({ account_status: input.accountStatus })
      .eq('id', id)
      .select(ACCOUNT_COLUMNS)
      .single();

    if (error || !data) {
      throw error ? new ValidationError(error.message) : new NotFoundError('Account not found');
    }

    return mapAccount(data);
  }

  async getAccountAsUser(
    accessToken: string,
    accountId: string,
  ): Promise<AccountRecord | null> {
    const client = createSupabaseClient(accessToken);
    const { data, error } = await client
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('id', accountId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapAccount(data) : null;
  }

  async getAccountType(accountId: string): Promise<AccountType> {
    const account = await this.findById(accountId);

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    return account.accountType;
  }

  async listAccounts(search?: string): Promise<AccountRecord[]> {
    let query = this.client().from('accounts').select(ACCOUNT_COLUMNS).order('created_at');

    if (search && search.trim().length > 0) {
      const term = search.trim();
      query = query.or(`account_number.ilike.%${term}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new ValidationError(error.message);
    }

    return (data ?? []).map(mapAccount);
  }
}

export const accountRepository = new AccountRepository();
