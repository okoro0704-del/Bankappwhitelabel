import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient, createSupabaseClient } from '../../config/supabase';
import type {
  CreateProfileInput,
  ProfileRecord,
  UpdateProfileInput,
  UserRole,
} from '../../types';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';

const PROFILE_COLUMNS = `
  id,
  user_id,
  tenant_id,
  first_name,
  last_name,
  email,
  phone,
  username,
  status,
  role,
  created_at,
  updated_at
`;

const mapProfile = (row: Record<string, unknown>): ProfileRecord => ({
  id: String(row.id),
  userId: String(row.user_id),
  tenantId: row.tenant_id == null ? null : String(row.tenant_id),
  firstName: String(row.first_name),
  lastName: String(row.last_name),
  email: String(row.email),
  phone: row.phone == null ? null : String(row.phone),
  username: String(row.username),
  status: row.status as ProfileRecord['status'],
  role: row.role as ProfileRecord['role'],
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const asConflictOrThrow = (
  error: { code?: string; message: string },
  field: string,
  value: string,
): never => {
  if (error.code === '23505') {
    throw new ConflictError(`${field} already exists`, { field, value });
  }

  throw new ValidationError(error.message);
};

export class ProfileRepository {
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

  async createProfile(input: CreateProfileInput): Promise<ProfileRecord> {
    const { data, error } = await this.client()
      .from('profiles')
      .insert({
        user_id: input.userId,
        tenant_id: input.tenantId ?? undefined,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        username: input.username,
        status: input.status ?? 'active',
        role: input.role ?? 'user',
      })
      .select(PROFILE_COLUMNS)
      .single();

    if (error || !data) {
      if (error) {
        asConflictOrThrow(error, 'profile', input.email);
      }
      throw new ValidationError('Profile creation failed');
    }

    return mapProfile(data);
  }

  async findByUserId(userId: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapProfile(data) : null;
  }

  async findById(id: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapProfile(data) : null;
  }

  async findByEmail(email: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapProfile(data) : null;
  }

  async findByUsername(username: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('username', username)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapProfile(data) : null;
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<ProfileRecord> {
    const updates: Record<string, unknown> = {};

    if (input.firstName !== undefined) {
      updates.first_name = input.firstName;
    }

    if (input.lastName !== undefined) {
      updates.last_name = input.lastName;
    }

    if (input.phone !== undefined) {
      updates.phone = input.phone;
    }

    if (input.username !== undefined) {
      updates.username = input.username;
    }

    if (input.status !== undefined) {
      updates.status = input.status;
    }

    const { data, error } = await this.client()
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select(PROFILE_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictError('username already exists', {
          field: 'username',
          value: input.username,
        });
      }
      throw error ? new ValidationError(error.message) : new NotFoundError('Profile not found');
    }

    return mapProfile(data);
  }

  async updateRole(id: string, role: UserRole): Promise<ProfileRecord> {
    const { data, error } = await this.client()
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select(PROFILE_COLUMNS)
      .single();

    if (error || !data) {
      throw error ? new ValidationError(error.message) : new NotFoundError('Profile not found');
    }

    return mapProfile(data);
  }

  async getProfileAsUser(
    accessToken: string,
    userId: string,
  ): Promise<ProfileRecord | null> {
    const client = createSupabaseClient(accessToken);
    const { data, error } = await client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return data ? mapProfile(data) : null;
  }

  async updateProfileAsUser(
    accessToken: string,
    profileId: string,
    input: UpdateProfileInput,
  ): Promise<ProfileRecord> {
    const client = createSupabaseClient(accessToken);
    const updates: Record<string, unknown> = {};

    if (input.firstName !== undefined) {
      updates.first_name = input.firstName;
    }

    if (input.lastName !== undefined) {
      updates.last_name = input.lastName;
    }

    if (input.phone !== undefined) {
      updates.phone = input.phone;
    }

    if (input.username !== undefined) {
      updates.username = input.username;
    }

    const { data, error } = await client
      .from('profiles')
      .update(updates)
      .eq('id', profileId)
      .select(PROFILE_COLUMNS)
      .single();

    if (error || !data) {
      throw error
        ? new ValidationError(error.message)
        : new NotFoundError('Profile not found or update not permitted');
    }

    return mapProfile(data);
  }

  async listProfiles(
    tenantId: string,
    search?: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: ProfileRecord[]; total: number }> {
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.offset ?? 0;

    let countQuery = this.client()
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    let query = this.client()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at')
      .range(offset, offset + limit - 1);

    if (search && search.trim().length > 0) {
      const term = search.trim();
      const filter = `email.ilike.%${term}%,username.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`;
      countQuery = countQuery.or(filter);
      query = query.or(filter);
    }

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      countQuery,
      query,
    ]);

    if (countError) {
      throw new ValidationError(countError.message);
    }
    if (error) {
      throw new ValidationError(error.message);
    }

    return {
      items: (data ?? []).map(mapProfile),
      total: count ?? 0,
    };
  }

  async countAdmins(): Promise<number> {
    const { count, error } = await this.client()
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');

    if (error) {
      throw new ValidationError(error.message);
    }

    return count ?? 0;
  }
}

export const profileRepository = new ProfileRepository();
