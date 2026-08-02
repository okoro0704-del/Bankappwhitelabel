import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts';
import { generateReference, generateSixDigitCode, hashVerificationCode } from '../_shared/crypto.ts';
import {
  adminClient,
  loadActorProfile,
  requireUser,
  toCamelTransfer,
} from '../_shared/supabase.ts';

const ESCROW_REASON = 'External transfers are unavailable for this account type.';
const ONE_TIME_FAILURE =
  'Your transfer could not be completed. Please contact the bank for assistance.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user } = await requireUser(req);
    const admin = adminClient();
    const actor = await loadActorProfile(admin, user.id);
    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'create') {
      return jsonResponse({ data: await createTransfer(admin, actor, body) });
    }
    if (action === 'getVerification') {
      return jsonResponse({ data: await getVerification(admin, actor, body.transferId) });
    }
    if (action === 'submitVerification') {
      return jsonResponse({
        data: await submitVerification(admin, actor, body.transferId, String(body.code ?? '')),
      });
    }
    if (action === 'complete') {
      return jsonResponse({ data: await completeTransfer(admin, actor, body.transferId) });
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

async function resolveOwnedTransfer(admin: Admin, actor: Actor, transferId: string) {
  const { data: transfer, error } = await admin.from('transfers').select('*').eq('id', transferId).maybeSingle();
  if (error || !transfer) {
    throw Object.assign(new Error('Transfer not found'), { code: 'NOT_FOUND', status: 404 });
  }
  if (actor.role === 'admin') {
    if (transfer.tenant_id !== actor.tenantId) {
      throw Object.assign(new Error('Transfer not found'), { code: 'NOT_FOUND', status: 404 });
    }
    return transfer;
  }
  if (transfer.user_id !== actor.userId) {
    throw Object.assign(new Error('Transfer not found'), { code: 'NOT_FOUND', status: 404 });
  }
  return transfer;
}

async function upsertStageCode(admin: Admin, transferId: string, stage: number) {
  const pepper = Deno.env.get('VERIFICATION_CODE_PEPPER') ?? 'web-finance-dev-pepper';
  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const codeHash = await hashVerificationCode(code, transferId, stage, pepper);

  const { error: upsertError } = await admin.from('transfer_verification_codes').upsert(
    {
      transfer_id: transferId,
      stage,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
      max_attempts: 5,
      consumed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'transfer_id,stage' },
  );
  if (upsertError) throw Object.assign(new Error(upsertError.message), { code: 'INTERNAL_ERROR', status: 500 });

  await admin.from('transfer_verification_code_reveals').upsert(
    { transfer_id: transferId, stage, code_plaintext: code },
    { onConflict: 'transfer_id,stage' },
  );

  return { stage, expiresAt };
}

async function createTransfer(admin: Admin, actor: Actor, body: Record<string, unknown>) {
  const recipientName = String(body.recipientName ?? '').trim();
  const recipientAccount = String(body.recipientAccount ?? '').trim();
  const recipientBank = String(body.recipientBank ?? '').trim();
  const amount = Number(body.amount);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  const description = body.description ? String(body.description).trim() : null;

  if (!recipientName || !recipientAccount || !recipientBank || !idempotencyKey || !(amount > 0)) {
    throw Object.assign(new Error('Invalid transfer input'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  const { data: existing } = await admin
    .from('transfers')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) {
    return resultFromExisting(existing, true);
  }

  const { data: account } = await admin
    .from('accounts')
    .select('*, wallets(*)')
    .eq('profile_id', actor.profileId)
    .maybeSingle();
  if (!account) {
    throw Object.assign(new Error('Account not found'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
  }
  const wallet = Array.isArray(account.wallets) ? account.wallets[0] : account.wallets;
  if (!wallet) {
    throw Object.assign(new Error('Wallet not found'), { code: 'NOT_FOUND', status: 404 });
  }
  if (account.account_status !== 'active') {
    throw Object.assign(new Error('Account is not active'), { code: 'ACCOUNT_INACTIVE', status: 403 });
  }
  if (Number(wallet.balance) < amount) {
    throw Object.assign(new Error('Insufficient wallet balance for this transfer'), {
      code: 'INSUFFICIENT_BALANCE',
      status: 400,
    });
  }

  const reference = generateReference('TRF');
  const base = {
    account_id: account.id,
    user_id: actor.userId,
    wallet_id: wallet.id,
    tenant_id: account.tenant_id ?? actor.tenantId,
    reference,
    idempotency_key: idempotencyKey,
    recipient_name: recipientName,
    recipient_account: recipientAccount,
    recipient_bank: recipientBank,
    amount,
    description,
  };

  if (account.account_type === 'escrow') {
    const { data: transfer, error } = await admin
      .from('transfers')
      .insert({
        ...base,
        status: 'restricted',
        current_stage: 0,
        stages_completed: 0,
        reason_code: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
        failure_reason: ESCROW_REASON,
      })
      .select('*')
      .single();
    if (error) {
      const dup = await admin.from('transfers').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
      if (dup.data) return resultFromExisting(dup.data, true);
      throw Object.assign(new Error(error.message), { code: 'INTERNAL_ERROR', status: 500 });
    }
    return {
      status: 'restricted',
      reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
      reason: ESCROW_REASON,
      transferId: transfer.id,
      reference: transfer.reference,
      transfer: toCamelTransfer(transfer),
    };
  }

  if (account.account_type === 'one_time_transfer') {
    if (account.one_time_transfer_used) {
      const { data: transfer } = await admin
        .from('transfers')
        .insert({
          ...base,
          status: 'failed',
          reason_code: 'TRANSFER_LIMIT_REACHED',
          failure_reason: ONE_TIME_FAILURE,
        })
        .select('*')
        .single();
      return {
        status: 'failed',
        reasonCode: 'TRANSFER_LIMIT_REACHED',
        reason: ONE_TIME_FAILURE,
        transferId: transfer?.id,
        reference: transfer?.reference,
        transfer: transfer ? toCamelTransfer(transfer) : undefined,
      };
    }

    const { data: transfer, error } = await admin
      .from('transfers')
      .insert({ ...base, status: 'processing', current_stage: 0, stages_completed: 0 })
      .select('*')
      .single();
    if (error) {
      const dup = await admin.from('transfers').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
      if (dup.data) return resultFromExisting(dup.data, true);
      throw Object.assign(new Error(error.message), { code: 'INTERNAL_ERROR', status: 500 });
    }

    const { data: completed, error: completeError } = await admin.rpc('complete_transfer_debit_atomic', {
      p_transfer_id: transfer.id,
      p_require_one_time_slot: true,
      p_require_four_stages: false,
    });
    if (completeError) {
      throw Object.assign(new Error(completeError.message), { code: 'INVALID_TRANSFER', status: 400 });
    }
    return {
      status: 'completed',
      transferId: completed.transfer?.id ?? transfer.id,
      transactionId: completed.ledger?.id ?? '',
      reference: completed.transfer?.reference ?? transfer.reference,
      amount: Number(completed.transfer?.amount ?? transfer.amount),
      idempotentReplay: Boolean(completed.idempotent_replay),
      transfer: toCamelTransfer(completed.transfer ?? transfer),
    };
  }

  // four_stage_verification
  const { data: transfer, error } = await admin
    .from('transfers')
    .insert({
      ...base,
      status: 'verification_stage_1',
      current_stage: 1,
      stages_completed: 0,
    })
    .select('*')
    .single();
  if (error) {
    const dup = await admin.from('transfers').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (dup.data) return resultFromExisting(dup.data, true);
    throw Object.assign(new Error(error.message), { code: 'INTERNAL_ERROR', status: 500 });
  }

  await upsertStageCode(admin, transfer.id, 1);
  return {
    status: 'verification_required',
    transferId: transfer.id,
    reference: transfer.reference,
    stage: 1,
    transfer: toCamelTransfer(transfer),
  };
}

function resultFromExisting(transfer: Record<string, unknown>, idempotentReplay: boolean) {
  const status = String(transfer.status);
  if (status === 'restricted') {
    return {
      status: 'restricted',
      reasonCode: transfer.reason_code,
      reason: transfer.failure_reason,
      transferId: transfer.id,
      reference: transfer.reference,
      idempotentReplay,
      transfer: toCamelTransfer(transfer),
    };
  }
  if (status === 'failed') {
    return {
      status: 'failed',
      reasonCode: transfer.reason_code,
      reason: transfer.failure_reason,
      transferId: transfer.id,
      reference: transfer.reference,
      idempotentReplay,
      transfer: toCamelTransfer(transfer),
    };
  }
  if (status.startsWith('verification_stage_')) {
    return {
      status: 'verification_required',
      transferId: transfer.id,
      reference: transfer.reference,
      stage: Number(transfer.current_stage),
      idempotentReplay,
      transfer: toCamelTransfer(transfer),
    };
  }
  return {
    status: 'completed',
    transferId: transfer.id,
    reference: transfer.reference,
    amount: Number(transfer.amount),
    idempotentReplay,
    transfer: toCamelTransfer(transfer),
  };
}

async function getVerification(admin: Admin, actor: Actor, transferId: string) {
  const transfer = await resolveOwnedTransfer(admin, actor, transferId);
  const { data: codeRow } = await admin
    .from('transfer_verification_codes')
    .select('expires_at')
    .eq('transfer_id', transferId)
    .eq('stage', transfer.current_stage)
    .maybeSingle();
  return {
    transferId: transfer.id,
    status: transfer.status,
    stage: Number(transfer.current_stage),
    stagesCompleted: Number(transfer.stages_completed),
    expiresAt: codeRow?.expires_at,
  };
}

async function submitVerification(admin: Admin, actor: Actor, transferId: string, code: string) {
  const transfer = await resolveOwnedTransfer(admin, actor, transferId);
  const stage = Number(transfer.current_stage);
  if (stage < 1 || stage > 4) {
    throw Object.assign(new Error('Transfer is not awaiting verification'), {
      code: 'INVALID_TRANSFER',
      status: 400,
    });
  }

  const { data: codeRow } = await admin
    .from('transfer_verification_codes')
    .select('*')
    .eq('transfer_id', transferId)
    .eq('stage', stage)
    .maybeSingle();
  if (!codeRow) {
    throw Object.assign(new Error('Verification code not found'), { code: 'NOT_FOUND', status: 404 });
  }
  if (codeRow.consumed_at) {
    throw Object.assign(new Error('Verification code already used'), {
      code: 'INVALID_VERIFICATION_CODE',
      status: 400,
    });
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error('Verification code expired'), { code: 'VERIFICATION_EXPIRED', status: 400 });
  }
  if (Number(codeRow.attempts) >= Number(codeRow.max_attempts)) {
    throw Object.assign(new Error('Too many incorrect attempts'), {
      code: 'TOO_MANY_VERIFICATION_ATTEMPTS',
      status: 429,
    });
  }

  const pepper = Deno.env.get('VERIFICATION_CODE_PEPPER') ?? 'web-finance-dev-pepper';
  const actual = await hashVerificationCode(code.trim(), transferId, stage, pepper);
  if (actual !== codeRow.code_hash) {
    await admin
      .from('transfer_verification_codes')
      .update({ attempts: Number(codeRow.attempts) + 1 })
      .eq('id', codeRow.id);
    throw Object.assign(new Error('Incorrect verification code'), {
      code: 'INVALID_VERIFICATION_CODE',
      status: 400,
    });
  }

  await admin
    .from('transfer_verification_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', codeRow.id);

  const nextStage = stage + 1;
  if (stage < 4) {
    const { data: updated } = await admin
      .from('transfers')
      .update({
        stages_completed: stage,
        current_stage: nextStage,
        status: `verification_stage_${nextStage}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transferId)
      .select('*')
      .single();
    await upsertStageCode(admin, transferId, nextStage);
    return {
      status: 'verification_required',
      transferId,
      stage: nextStage,
      transfer: updated ? toCamelTransfer(updated) : undefined,
    };
  }

  await admin
    .from('transfers')
    .update({
      stages_completed: 4,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transferId);

  const { data: completed, error } = await admin.rpc('complete_transfer_debit_atomic', {
    p_transfer_id: transferId,
    p_require_one_time_slot: false,
    p_require_four_stages: true,
  });
  if (error) {
    throw Object.assign(new Error(error.message), { code: 'INVALID_TRANSFER', status: 400 });
  }
  return {
    status: 'completed',
    transferId,
    transactionId: completed.ledger?.id ?? '',
    reference: completed.transfer?.reference,
    amount: Number(completed.transfer?.amount ?? 0),
    transfer: toCamelTransfer(completed.transfer ?? transfer),
  };
}

async function completeTransfer(admin: Admin, actor: Actor, transferId: string) {
  const transfer = await resolveOwnedTransfer(admin, actor, transferId);
  if (Number(transfer.stages_completed) < 4) {
    throw Object.assign(new Error('Verification required'), { code: 'VERIFICATION_REQUIRED', status: 409 });
  }
  const { data: completed, error } = await admin.rpc('complete_transfer_debit_atomic', {
    p_transfer_id: transferId,
    p_require_one_time_slot: false,
    p_require_four_stages: true,
  });
  if (error) {
    throw Object.assign(new Error(error.message), { code: 'INVALID_TRANSFER', status: 400 });
  }
  return {
    status: 'completed',
    transferId,
    transactionId: completed.ledger?.id ?? '',
    reference: completed.transfer?.reference,
    amount: Number(completed.transfer?.amount ?? 0),
    transfer: toCamelTransfer(completed.transfer ?? transfer),
  };
}
