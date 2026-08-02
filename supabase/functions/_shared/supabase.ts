import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request): Promise<{ user: User; authHeader: string }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authentication required'), { code: 'UNAUTHENTICATED', status: 401 });
  }
  const client = userClient(authHeader);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw Object.assign(new Error('Authentication required'), { code: 'UNAUTHENTICATED', status: 401 });
  }
  return { user: data.user, authHeader };
}

export async function loadActorProfile(admin: SupabaseClient, userId: string) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !profile) {
    throw Object.assign(new Error('Authentication required'), { code: 'UNAUTHENTICATED', status: 401 });
  }
  if (profile.status !== 'active') {
    throw Object.assign(new Error('Account is inactive'), { code: 'ACCOUNT_INACTIVE', status: 403 });
  }
  const { data: master } = await admin
    .from('master_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    userId,
    role: profile.role as 'admin' | 'user',
    tenantId: profile.tenant_id as string,
    profileId: profile.id as string,
    status: profile.status as string,
    isMasterAdmin: Boolean(master),
  };
}

export function toCamelTransfer(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    amount: Number(row.amount),
    recipient: {
      name: row.recipient_name,
      account: row.recipient_account,
      bank: row.recipient_bank,
    },
    description: row.description ?? null,
    currentStage: Number(row.current_stage ?? 0),
    stagesCompleted: Number(row.stages_completed ?? 0),
    reasonCode: row.reason_code ?? null,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

export function toCamelWallet(row: Record<string, unknown>) {
  return {
    id: row.id,
    accountId: row.account_id,
    balance: Number(row.balance),
    currency: row.currency,
    updatedAt: row.updated_at,
  };
}

export function toCamelTransaction(row: Record<string, unknown>) {
  return {
    id: row.id,
    accountId: row.account_id,
    walletId: row.wallet_id,
    type: row.transaction_type,
    status: row.status,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    reference: row.reference,
    description: row.description ?? null,
    createdAt: row.created_at,
  };
}

export function toCamelProfile(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone ?? null,
    username: row.username,
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCamelAccount(row: Record<string, unknown>, wallet?: Record<string, unknown> | null) {
  return {
    id: row.id,
    accountNumber: row.account_number,
    accountType: row.account_type,
    accountStatus: row.account_status,
    balance: wallet ? Number(wallet.balance) : 0,
    currency: wallet ? String(wallet.currency) : 'USD',
    oneTimeTransferUsed: Boolean(row.one_time_transfer_used),
  };
}
