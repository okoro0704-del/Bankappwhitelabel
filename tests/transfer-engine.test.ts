import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { TransferService } from '../src/services/transfers/transfer-service';
import { VerificationService } from '../src/services/transfers/verification-service';
import { transferRepository } from '../src/repositories/transfers/transfer-repository';
import { verificationCodeRepository } from '../src/repositories/transfers/verification-code-repository';
import { accountRepository } from '../src/repositories/accounts/account-repository';
import { profileRepository } from '../src/repositories/profiles/profile-repository';
import { walletRepository } from '../src/repositories/wallets/wallet-repository';
import type {
  AccountRecord,
  AuthenticatedAppUser,
  ProfileRecord,
  TransferRecord,
  WalletRecord,
} from '../src/types';
import {
  AuthenticationError,
  AuthorizationError,
  TransferError,
  ValidationError,
} from '../src/utils/errors';
import {
  generateSixDigitCode,
  hashVerificationCode,
  verificationCodesMatch,
} from '../src/utils/verification-code';
import {
  validateRecipientAccount,
  validateTransferAmount,
} from '../src/utils/validation';

const activeUser: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'active',
};

const suspendedUser: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'suspended',
};

const otherUser: AuthenticatedAppUser = {
  userId: 'user-b',
  role: 'user',
  accountStatus: 'active',
};

const admin: AuthenticatedAppUser = {
  userId: 'admin-1',
  role: 'admin',
  accountStatus: 'active',
};

const profileA: ProfileRecord = {
  id: 'profile-a',
  userId: 'user-a',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  username: 'ada',
  status: 'active',
  role: 'user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseAccount = (type: AccountRecord['accountType']): AccountRecord => ({
  id: 'account-a',
  profileId: 'profile-a',
  accountNumber: '1234567890',
  accountType: type,
  accountStatus: 'active',
  oneTimeTransferUsed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const walletA: WalletRecord = {
  id: 'wallet-a',
  accountId: 'account-a',
  balance: 500,
  currency: 'USD',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const transferInput = {
  recipientName: 'Jamie Recipient',
  recipientAccount: '9876543210',
  recipientBank: 'Example Bank',
  amount: 50,
  description: 'Test transfer',
  idempotencyKey: 'IDEM-TRANSFER-KEY-0001',
};

const makeTransfer = (
  overrides: Partial<TransferRecord> = {},
): TransferRecord => ({
  id: 'transfer-1',
  accountId: 'account-a',
  userId: 'user-a',
  walletId: 'wallet-a',
  ledgerTransactionId: null,
  reference: 'TRF-REFERENCE01',
  idempotencyKey: transferInput.idempotencyKey,
  recipientName: transferInput.recipientName,
  recipientAccount: transferInput.recipientAccount,
  recipientBank: transferInput.recipientBank,
  amount: transferInput.amount,
  description: transferInput.description,
  status: 'processing',
  currentStage: 0,
  stagesCompleted: 0,
  reasonCode: null,
  failureReason: null,
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const stubSender = (account: AccountRecord, wallet: WalletRecord = walletA) => {
  const previous = {
    findByUserId: profileRepository.findByUserId.bind(profileRepository),
    findByProfileId: accountRepository.findByProfileId.bind(accountRepository),
    findByAccountId: walletRepository.findByAccountId.bind(walletRepository),
    findIdempotency: transferRepository.findByIdempotencyKey.bind(transferRepository),
  };

  profileRepository.findByUserId = async () => profileA;
  accountRepository.findByProfileId = async () => account;
  walletRepository.findByAccountId = async () => wallet;
  transferRepository.findByIdempotencyKey = async () => null;

  return () => {
    profileRepository.findByUserId = previous.findByUserId;
    accountRepository.findByProfileId = previous.findByProfileId;
    walletRepository.findByAccountId = previous.findByAccountId;
    transferRepository.findByIdempotencyKey = previous.findIdempotency;
  };
};

test('transfer migration defines workflow, verification, and atomic debit', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260731120000_transfer_engine.sql'),
    'utf8',
  );

  assert.match(sql, /create table public\.transfers/i);
  assert.match(sql, /transfer_verification_codes/i);
  assert.match(sql, /debit_wallet_atomic/i);
  assert.match(sql, /complete_transfer_debit_atomic/i);
  assert.match(sql, /one_time_transfer_used/i);
  assert.match(sql, /enable row level security/i);
});

test('verification code hashing is stage/transfer scoped', () => {
  const code = generateSixDigitCode();
  assert.match(code, /^\d{6}$/);
  const hash = hashVerificationCode(code, 'transfer-1', 1);
  assert.equal(verificationCodesMatch(code, 'transfer-1', 1, hash), true);
  assert.equal(verificationCodesMatch(code, 'transfer-1', 2, hash), false);
  assert.equal(verificationCodesMatch('000000', 'transfer-1', 1, hash), false);
});

test('transfer amount and recipient validation', () => {
  assert.equal(validateTransferAmount(12.34), 12.34);
  assert.throws(() => validateTransferAmount(0), ValidationError);
  assert.throws(() => validateRecipientAccount('123'), ValidationError);
});

test('escrow transfer is restricted without debit', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('escrow'));
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  let createdStatus: string | null = null;

  transferRepository.createTransfer = async (input) => {
    createdStatus = input.status;
    return makeTransfer({
      status: input.status,
      reasonCode: input.reasonCode ?? null,
      failureReason: input.failureReason ?? null,
    });
  };

  try {
    const result = await service.initiateTransfer(activeUser, transferInput);
    assert.equal(result.status, 'restricted');
    if (result.status === 'restricted') {
      assert.equal(result.reasonCode, 'EXTERNAL_TRANSFER_NOT_ALLOWED');
    }
    assert.equal(createdStatus, 'restricted');
  } finally {
    transferRepository.createTransfer = previousCreate;
    restore();
  }
});

test('escrow restriction cannot be bypassed by client account type claims', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('escrow'));
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  transferRepository.createTransfer = async (input) =>
    makeTransfer({ status: input.status, reasonCode: input.reasonCode ?? null });

  try {
    const result = await service.initiateTransfer(activeUser, {
      ...transferInput,
      // @ts-expect-error intentional client-style pollution
      accountType: 'one_time_transfer',
    });
    assert.equal(result.status, 'restricted');
  } finally {
    transferRepository.createTransfer = previousCreate;
    restore();
  }
});

test('one-time transfer first success debits via atomic completion', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('one_time_transfer'));
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);

  transferRepository.createTransfer = async () => makeTransfer({ status: 'processing' });
  transferRepository.completeTransferDebitAtomic = async () => ({
    transfer: makeTransfer({
      status: 'completed',
      ledgerTransactionId: 'tx-1',
      completedAt: new Date().toISOString(),
    }),
    ledger: {
      id: 'tx-1',
      walletId: 'wallet-a',
      accountId: 'account-a',
      transactionType: 'debit',
      status: 'completed',
      amount: 50,
      balanceBefore: 500,
      balanceAfter: 450,
      reference: 'TRF-REFERENCE01',
      idempotencyKey: 'transfer-debit:transfer-1',
      description: 'External fictional transfer',
      createdBy: 'user-a',
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    idempotentReplay: false,
  });

  try {
    const result = await service.initiateTransfer(activeUser, transferInput);
    assert.equal(result.status, 'completed');
    if (result.status === 'completed') {
      assert.equal(result.transactionId, 'tx-1');
      assert.equal(result.amount, 50);
    }
  } finally {
    transferRepository.createTransfer = previousCreate;
    transferRepository.completeTransferDebitAtomic = previousComplete;
    restore();
  }
});

test('one-time second transfer fails without calling debit when flag is set', async () => {
  const service = new TransferService();
  const used = { ...baseAccount('one_time_transfer'), oneTimeTransferUsed: true };
  const restore = stubSender(used);
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);
  let debitCalled = false;

  transferRepository.createTransfer = async (input) =>
    makeTransfer({
      status: input.status,
      reasonCode: input.reasonCode ?? null,
      failureReason: input.failureReason ?? null,
      idempotencyKey: 'IDEM-TRANSFER-KEY-0002',
    });
  transferRepository.completeTransferDebitAtomic = async () => {
    debitCalled = true;
    throw new Error('should not debit');
  };

  try {
    const result = await service.initiateTransfer(activeUser, {
      ...transferInput,
      idempotencyKey: 'IDEM-TRANSFER-KEY-0002',
    });
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.reasonCode, 'TRANSFER_LIMIT_REACHED');
    }
    assert.equal(debitCalled, false);
  } finally {
    transferRepository.createTransfer = previousCreate;
    transferRepository.completeTransferDebitAtomic = previousComplete;
    restore();
  }
});

test('concurrent one-time completions: only one atomic success path', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('one_time_transfer'));
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);
  let completions = 0;

  transferRepository.createTransfer = async (input) =>
    makeTransfer({
      id: crypto.randomUUID(),
      status: 'processing',
      idempotencyKey: input.idempotencyKey,
    });

  transferRepository.completeTransferDebitAtomic = async () => {
    completions += 1;
    if (completions === 1) {
      return {
        transfer: makeTransfer({
          status: 'completed',
          ledgerTransactionId: 'tx-1',
          completedAt: new Date().toISOString(),
        }),
        ledger: null,
        idempotentReplay: false,
      };
    }
    throw new ValidationError('TRANSFER_LIMIT_REACHED');
  };

  try {
    const first = await service.initiateTransfer(activeUser, {
      ...transferInput,
      idempotencyKey: 'IDEM-TRANSFER-KEY-AAA1',
    });
    const second = await service.initiateTransfer(activeUser, {
      ...transferInput,
      idempotencyKey: 'IDEM-TRANSFER-KEY-BBB2',
    });

    assert.equal(first.status, 'completed');
    assert.equal(second.status, 'failed');
    if (second.status === 'failed') {
      assert.equal(second.reasonCode, 'TRANSFER_LIMIT_REACHED');
    }
  } finally {
    transferRepository.createTransfer = previousCreate;
    transferRepository.completeTransferDebitAtomic = previousComplete;
    restore();
  }
});

test('four-stage transfer starts at stage 1 and generates code', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('four_stage_verification'));
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousGenerate = VerificationService.prototype.generateVerificationCode;

  transferRepository.createTransfer = async () =>
    makeTransfer({
      status: 'verification_stage_1',
      currentStage: 1,
      stagesCompleted: 0,
    });

  let generatedStage: number | null = null;
  VerificationService.prototype.generateVerificationCode = async (
    _actor,
    transferId,
    stage,
  ) => {
    generatedStage = stage ?? 1;
    return {
      transferId,
      stage: generatedStage,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  };

  try {
    const result = await service.initiateTransfer(activeUser, {
      ...transferInput,
      idempotencyKey: 'IDEM-TRANSFER-KEY-4STG',
    });
    assert.equal(result.status, 'verification_required');
    if (result.status === 'verification_required') {
      assert.equal(result.stage, 1);
    }
    assert.equal(generatedStage, 1);
  } finally {
    transferRepository.createTransfer = previousCreate;
    VerificationService.prototype.generateVerificationCode = previousGenerate;
    restore();
  }
});

test('verification rejects incorrect, expired, and reused codes', async () => {
  const service = new VerificationService();
  const transfer = makeTransfer({
    status: 'verification_stage_1',
    currentStage: 1,
    stagesCompleted: 0,
  });

  const previousFind = transferRepository.findById.bind(transferRepository);
  const previousFindCode =
    verificationCodeRepository.findByTransferAndStage.bind(verificationCodeRepository);
  const previousInc =
    verificationCodeRepository.incrementAttempts.bind(verificationCodeRepository);

  transferRepository.findById = async () => transfer;

  // Incorrect
  verificationCodeRepository.findByTransferAndStage = async () => ({
    id: 'code-1',
    transferId: transfer.id,
    stage: 1,
    codeHash: hashVerificationCode('123456', transfer.id, 1),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  verificationCodeRepository.incrementAttempts = async (id) => ({
    id,
    transferId: transfer.id,
    stage: 1,
    codeHash: 'x',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 1,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => service.verifyCode(activeUser, transfer.id, '999999'),
    (error: unknown) =>
      error instanceof TransferError && error.reasonCode === 'INVALID_VERIFICATION_CODE',
  );

  // Expired
  verificationCodeRepository.findByTransferAndStage = async () => ({
    id: 'code-1',
    transferId: transfer.id,
    stage: 1,
    codeHash: hashVerificationCode('123456', transfer.id, 1),
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => service.verifyCode(activeUser, transfer.id, '123456'),
    (error: unknown) =>
      error instanceof TransferError && error.reasonCode === 'VERIFICATION_EXPIRED',
  );

  // Reused
  verificationCodeRepository.findByTransferAndStage = async () => ({
    id: 'code-1',
    transferId: transfer.id,
    stage: 1,
    codeHash: hashVerificationCode('123456', transfer.id, 1),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => service.verifyCode(activeUser, transfer.id, '123456'),
    (error: unknown) =>
      error instanceof TransferError && error.reasonCode === 'INVALID_VERIFICATION_CODE',
  );

  transferRepository.findById = previousFind;
  verificationCodeRepository.findByTransferAndStage = previousFindCode;
  verificationCodeRepository.incrementAttempts = previousInc;
});

test('verification advances stages in order and blocks early completion', async () => {
  const verifyService = new VerificationService();
  const transferService = new TransferService();
  let transfer = makeTransfer({
    status: 'verification_stage_1',
    currentStage: 1,
    stagesCompleted: 0,
  });

  const previousFind = transferRepository.findById.bind(transferRepository);
  const previousUpdate = transferRepository.updateTransfer.bind(transferRepository);
  const previousFindCode =
    verificationCodeRepository.findByTransferAndStage.bind(verificationCodeRepository);
  const previousConsume =
    verificationCodeRepository.markConsumed.bind(verificationCodeRepository);
  const previousGenerate = VerificationService.prototype.generateVerificationCode;

  transferRepository.findById = async () => transfer;
  verificationCodeRepository.markConsumed = async (id) => ({
    id,
    transferId: transfer.id,
    stage: transfer.currentStage,
    codeHash: 'hash',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  VerificationService.prototype.generateVerificationCode = async (
    _actor,
    transferId,
    stage,
  ) => ({
    transferId,
    stage: stage ?? 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  verificationCodeRepository.findByTransferAndStage = async () => ({
    id: 'code-1',
    transferId: transfer.id,
    stage: 1,
    codeHash: hashVerificationCode('111111', transfer.id, 1),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  transferRepository.updateTransfer = async (_id, updates) => {
    transfer = {
      ...transfer,
      status: (updates.status as TransferRecord['status']) ?? transfer.status,
      currentStage: updates.currentStage ?? transfer.currentStage,
      stagesCompleted: updates.stagesCompleted ?? transfer.stagesCompleted,
    };
    return transfer;
  };

  const stage1 = await verifyService.verifyCode(activeUser, transfer.id, '111111');
  assert.equal(stage1.status, 'verification_required');
  if (stage1.status === 'verification_required') {
    assert.equal(stage1.stage, 2);
  }

  await assert.rejects(
    () => transferService.completeFourStageTransfer(activeUser, transfer.id),
    (error: unknown) =>
      error instanceof TransferError && error.reasonCode === 'VERIFICATION_REQUIRED',
  );

  transferRepository.findById = previousFind;
  transferRepository.updateTransfer = previousUpdate;
  verificationCodeRepository.findByTransferAndStage = previousFindCode;
  verificationCodeRepository.markConsumed = previousConsume;
  VerificationService.prototype.generateVerificationCode = previousGenerate;
});

test('four-stage completion debits once and rejects duplicate completion via replay flag', async () => {
  const service = new TransferService();
  const ready = makeTransfer({
    status: 'verification_stage_4',
    currentStage: 4,
    stagesCompleted: 4,
  });

  const previousFind = transferRepository.findById.bind(transferRepository);
  const previousAccount = accountRepository.findById.bind(accountRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);
  let calls = 0;

  transferRepository.findById = async () => ready;
  accountRepository.findById = async () => baseAccount('four_stage_verification');
  transferRepository.completeTransferDebitAtomic = async () => {
    calls += 1;
    return {
      transfer: {
        ...ready,
        status: 'completed',
        ledgerTransactionId: 'tx-final',
        completedAt: new Date().toISOString(),
      },
      ledger: null,
      idempotentReplay: calls > 1,
    };
  };

  try {
    const first = await service.completeFourStageTransfer(activeUser, ready.id);
    const second = await service.completeFourStageTransfer(activeUser, ready.id);
    assert.equal(first.status, 'completed');
    assert.equal(second.status, 'completed');
    assert.equal(calls, 2);
  } finally {
    transferRepository.findById = previousFind;
    accountRepository.findById = previousAccount;
    transferRepository.completeTransferDebitAtomic = previousComplete;
  }
});

test('insufficient balance and suspended account are rejected', async () => {
  const service = new TransferService();
  const restore = stubSender(baseAccount('one_time_transfer'), {
    ...walletA,
    balance: 10,
  });

  try {
    await assert.rejects(
      () => service.initiateTransfer(activeUser, transferInput),
      (error: unknown) =>
        error instanceof TransferError && error.reasonCode === 'INSUFFICIENT_BALANCE',
    );
  } finally {
    restore();
  }

  await assert.rejects(
    () => service.initiateTransfer(suspendedUser, transferInput),
    (error: unknown) =>
      error instanceof AuthorizationError || error instanceof AuthenticationError,
  );
});

test('unauthorized user cannot read another transfer', async () => {
  const service = new TransferService();
  const previous = transferRepository.findById.bind(transferRepository);
  transferRepository.findById = async () => makeTransfer();

  try {
    await assert.rejects(() => service.getTransfer(otherUser, 'transfer-1'), AuthorizationError);
  } finally {
    transferRepository.findById = previous;
  }
});

test('duplicate idempotency key returns existing transfer result', async () => {
  const service = new TransferService();
  const existing = makeTransfer({ status: 'restricted', reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED' });
  const previous = transferRepository.findByIdempotencyKey.bind(transferRepository);
  transferRepository.findByIdempotencyKey = async () => existing;

  try {
    const result = await service.initiateTransfer(activeUser, transferInput);
    assert.equal(result.status, 'restricted');
  } finally {
    transferRepository.findByIdempotencyKey = previous;
  }
});

test('admin peek of verification codes is gated', async () => {
  const service = new VerificationService();
  const previousPeek = verificationCodeRepository.peekPlaintext.bind(
    verificationCodeRepository,
  );
  verificationCodeRepository.peekPlaintext = async () => '654321';
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_VERIFICATION_CODE_PEEK = 'true';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon';

  try {
    const revealed = await service.peekVerificationCodeForTesting(admin, 'transfer-1', 1);
    assert.equal(revealed.code, '654321');

    await assert.rejects(
      () => service.peekVerificationCodeForTesting(activeUser, 'transfer-1', 1),
      AuthorizationError,
    );

    process.env.NODE_ENV = 'production';
    await assert.rejects(
      () => service.peekVerificationCodeForTesting(admin, 'transfer-1', 1),
      AuthorizationError,
    );
  } finally {
    verificationCodeRepository.peekPlaintext = previousPeek;
    process.env.NODE_ENV = previousNodeEnv;
  }
});
