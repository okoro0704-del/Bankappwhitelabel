import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts';
import { generateReference } from '../_shared/crypto.ts';
import {
  adminClient,
  loadActorProfile,
  requireUser,
  toCamelAccount,
  toCamelProfile,
  toCamelTransaction,
  toCamelWallet,
} from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user } = await requireUser(req);
    const admin = adminClient();
    const actor = await loadActorProfile(admin, user.id);
    if (actor.role !== 'admin') {
      return errorResponse('FORBIDDEN', 'Admin access required', 403);
    }

    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'fundWallet') {
      return jsonResponse({ data: await fundWallet(admin, actor, body) });
    }
    if (action === 'setProfileStatus') {
      return jsonResponse({ data: await setProfileStatus(admin, actor, body) });
    }
    if (action === 'createUser') {
      return jsonResponse({ data: await createUser(admin, actor, body) });
    }
    return errorResponse('VALIDATION_ERROR', 'Unknown action', 400);
  } catch (error) {
    const err = error as { code?: string; status?: number; message?: string };
    return errorResponse(err.code ?? 'INTERNAL_ERROR', err.message ?? 'Request failed', err.status ?? 500);
  }
});

type Actor = Awaited<ReturnType<typeof loadActorProfile>>;
// deno-lint-ignore no-explicit-any
type Admin = any;

async function fundWallet(admin: Admin, actor: Actor, body: Record<string, unknown>) {
  const amount = Number(body.amount);
  const reference = String(body.reference ?? generateReference('FND'));
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  const description = body.description ? String(body.description) : null;
  let walletId = body.walletId ? String(body.walletId) : null;

  if (!idempotencyKey || !(amount > 0)) {
    throw Object.assign(new Error('Invalid funding request'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  if (!walletId && body.accountId) {
    const { data: wallet } = await admin
      .from('wallets')
      .select('*')
      .eq('account_id', String(body.accountId))
      .maybeSingle();
    walletId = wallet?.id ?? null;
  }

  if (!walletId) {
    throw Object.assign(new Error('Wallet not found'), { code: 'NOT_FOUND', status: 404 });
  }

  const { data: wallet } = await admin.from('wallets').select('*').eq('id', walletId).maybeSingle();
  if (!wallet || wallet.tenant_id !== actor.tenantId) {
    throw Object.assign(new Error('Wallet not found'), { code: 'NOT_FOUND', status: 404 });
  }

  const { data: prior } = await admin
    .from('transactions')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (prior) {
    return {
      wallet: toCamelWallet(wallet),
      transaction: toCamelTransaction(prior),
      idempotentReplay: true,
    };
  }

  const { data: txn, error } = await admin.rpc('fund_wallet_atomic', {
    p_wallet_id: walletId,
    p_amount: amount,
    p_reference: reference,
    p_idempotency_key: idempotencyKey,
    p_description: description,
    p_created_by: actor.userId,
    p_metadata: {},
  });
  if (error) {
    throw Object.assign(new Error(error.message), { code: 'INTERNAL_ERROR', status: 500 });
  }

  const { data: refreshed } = await admin.from('wallets').select('*').eq('id', walletId).single();
  return {
    wallet: toCamelWallet(refreshed ?? wallet),
    transaction: toCamelTransaction(txn),
    idempotentReplay: false,
  };
}

async function setProfileStatus(admin: Admin, actor: Actor, body: Record<string, unknown>) {
  const profileId = String(body.profileId ?? '');
  const status = String(body.status ?? '');
  if (!profileId || !['active', 'suspended'].includes(status)) {
    throw Object.assign(new Error('Invalid status update'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  const { data: profile } = await admin.from('profiles').select('*').eq('id', profileId).maybeSingle();
  if (!profile || profile.tenant_id !== actor.tenantId) {
    throw Object.assign(new Error('Profile not found'), { code: 'NOT_FOUND', status: 404 });
  }

  const { data: updated, error } = await admin
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', profileId)
    .select('*')
    .single();
  if (error) {
    throw Object.assign(new Error(error.message), { code: 'INTERNAL_ERROR', status: 500 });
  }
  return toCamelProfile(updated);
}

async function createUser(admin: Admin, actor: Actor, body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const firstName = String(body.firstName ?? '').trim();
  const lastName = String(body.lastName ?? '').trim();
  const username = String(body.username ?? '').trim().toLowerCase();
  const phone = body.phone ? String(body.phone) : null;
  const accountType = String(body.accountType ?? 'escrow');
  const role = String(body.role ?? 'user');

  if (!email || !password || !firstName || !lastName || !username) {
    throw Object.assign(new Error('Missing required fields'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    throw Object.assign(new Error(authError?.message ?? 'Failed to create auth user'), {
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  }

  const userId = authData.user.id;
  try {
    const accountNumber = String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000));
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .insert({
        user_id: userId,
        tenant_id: actor.tenantId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        username,
        status: 'active',
        role: role === 'admin' ? 'admin' : 'user',
      })
      .select('*')
      .single();
    if (profileError) throw profileError;

    const { data: account, error: accountError } = await admin
      .from('accounts')
      .insert({
        profile_id: profile.id,
        tenant_id: actor.tenantId,
        account_number: accountNumber,
        account_type: accountType,
        account_status: 'active',
        one_time_transfer_used: false,
      })
      .select('*')
      .single();
    if (accountError) throw accountError;

    const { data: wallet, error: walletError } = await admin
      .from('wallets')
      .insert({
        account_id: account.id,
        tenant_id: actor.tenantId,
        balance: 0,
        currency: 'USD',
      })
      .select('*')
      .single();
    if (walletError) throw walletError;

    return {
      profile: toCamelProfile(profile),
      account: toCamelAccount(account, wallet),
    };
  } catch (error) {
    await admin.auth.admin.deleteUser(userId);
    const message = error instanceof Error ? error.message : 'Provisioning failed';
    throw Object.assign(new Error(message), { code: 'INTERNAL_ERROR', status: 500 });
  }
}
