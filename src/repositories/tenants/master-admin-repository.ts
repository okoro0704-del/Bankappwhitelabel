import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '../../config/supabase';
import { ValidationError } from '../../utils/errors';

/**
 * Platform-level Master Admin membership.
 * Distinct from profiles.role (tenant admin / user).
 */
export class MasterAdminRepository {
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

  async isMasterAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.client()
      .from('master_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }

    return Boolean(data);
  }

  async grantMasterAdmin(userId: string, createdBy?: string | null): Promise<void> {
    const { error } = await this.client().from('master_admins').upsert(
      {
        user_id: userId,
        created_by: createdBy ?? null,
      },
      { onConflict: 'user_id' },
    );

    if (error) {
      throw new ValidationError(error.message);
    }
  }

  async revokeMasterAdmin(userId: string): Promise<void> {
    const { error } = await this.client()
      .from('master_admins')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new ValidationError(error.message);
    }
  }
}

export const masterAdminRepository = new MasterAdminRepository();
