import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import { TransferService } from '../src/services/transfers/transfer-service';
import { VerificationService } from '../src/services/transfers/verification-service';
import { transferRepository } from '../src/repositories/transfers/transfer-repository';
import { verificationCodeRepository } from '../src/repositories/transfers/verification-code-repository';
import { accountRepository } from '../src/repositories/accounts/account-repository';
import { profileRepository } from '../src/repositories/profiles/profile-repository';
import { walletRepository } from '../src/repositories/wallets/wallet-repository';
import { toTransferActionResponse } from '../src/api/mappers';
import { apiHandlers } from '../src/api/handlers';
import type {
  AccountRecord,
  AuthenticatedAppUser,
  ProfileRecord,
  TransferRecord,
  WalletRecord,
} from '../src/types';
import { hashVerificationCode } from '../src/utils/verification-code';
import { TransferError } from '../src/utils/errors';
import * as authContext from '../src/api/auth-context';
import { NORTHLINE_TENANT_ID } from '../src/tenants/constants';

const user: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'active',
  tenantId: NORTHLINE_TENANT_ID,
};

const profile: ProfileRecord = {
  id: 'profile-a',
  userId: 'user-a',
  tenantId: NORTHLINE_TENANT_ID,
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

const account = (type: AccountRecord['accountType'], used = false): AccountRecord => ({
  id: 'account-a',
  profileId: 'profile-a',
  tenantId: NORTHLINE_TENANT_ID,
  accountNumber: '1234567890',
  accountType: type,
  accountStatus: 'active',
  oneTimeTransferUsed: used,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const wallet = (balance = 500): WalletRecord => ({
  id: 'wallet-a',
  accountId: 'account-a',
  tenantId: NORTHLINE_TENANT_ID,
  balance,
  currency: 'USD',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const transferBase = (overrides: Partial<TransferRecord> = {}): TransferRecord => ({
  id: 'transfer-1',
  accountId: 'account-a',
  userId: 'user-a',
  walletId: 'wallet-a',
  tenantId: NORTHLINE_TENANT_ID,
  ledgerTransactionId: null,
  reference: 'TRF-REF00001',
  idempotencyKey: 'IDEM-WORKFLOW-0001',
  recipientName: 'Jamie Recipient',
  recipientAccount: '9876543210',
  recipientBank: 'Example Bank',
  amount: 50,
  description: 'workflow',
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

const stubSender = (acct: AccountRecord, bal = 500) => {
  const restore = {
    findByUserId: profileRepository.findByUserId.bind(profileRepository),
    findByProfileId: accountRepository.findByProfileId.bind(accountRepository),
    findByAccountId: walletRepository.findByAccountId.bind(walletRepository),
    findIdem: transferRepository.findByIdempotencyKey.bind(transferRepository),
  };
  profileRepository.findByUserId = async () => profile;
  accountRepository.findByProfileId = async () => acct;
  walletRepository.findByAccountId = async () => wallet(bal);
  transferRepository.findByIdempotencyKey = async () => null;
  return () => {
    profileRepository.findByUserId = restore.findByUserId;
    accountRepository.findByProfileId = restore.findByProfileId;
    walletRepository.findByAccountId = restore.findByAccountId;
    transferRepository.findByIdempotencyKey = restore.findIdem;
  };
};

test('Workflow A — escrow transfer restricted and balance unchanged', async () => {
  const service = new TransferService();
  const restore = stubSender(account('escrow'), 500);
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  let balance = 500;

  transferRepository.createTransfer = async (input) =>
    transferBase({
      status: input.status,
      reasonCode: input.reasonCode ?? null,
      failureReason: input.failureReason ?? null,
    });

  try {
    const result = await service.initiateTransfer(user, {
      recipientName: 'Jamie Recipient',
      recipientAccount: '9876543210',
      recipientBank: 'Example Bank',
      amount: 50,
      idempotencyKey: 'IDEM-WORKFLOW-ESCROW',
    });
    const api = toTransferActionResponse(result);
    assert.equal(api.status, 'restricted');
    assert.equal(api.reasonCode, 'EXTERNAL_TRANSFER_NOT_ALLOWED');
    assert.equal(balance, 500);
  } finally {
    transferRepository.createTransfer = previousCreate;
    restore();
  }
});

test('Workflow B — one-time first succeeds then second fails without second debit', async () => {
  const service = new TransferService();
  let used = false;
  let balance = 500;
  let debitCount = 0;

  const restoreFns = stubSender(account('one_time_transfer', false), balance);
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);
  const previousFindProfile = accountRepository.findByProfileId.bind(accountRepository);

  accountRepository.findByProfileId = async () => account('one_time_transfer', used);
  transferRepository.createTransfer = async (input) =>
    transferBase({
      id: crypto.randomUUID(),
      status: input.status,
      idempotencyKey: input.idempotencyKey,
      reasonCode: input.reasonCode ?? null,
      failureReason: input.failureReason ?? null,
    });
  transferRepository.completeTransferDebitAtomic = async () => {
    if (used) {
      throw new TransferError('TRANSFER_LIMIT_REACHED', 'limit');
    }
    used = true;
    debitCount += 1;
    balance -= 50;
    return {
      transfer: transferBase({
        status: 'completed',
        ledgerTransactionId: 'tx-1',
        completedAt: new Date().toISOString(),
      }),
      ledger: null,
      idempotentReplay: false,
    };
  };

  try {
    const first = toTransferActionResponse(
      await service.initiateTransfer(user, {
        recipientName: 'Jamie Recipient',
        recipientAccount: '9876543210',
        recipientBank: 'Example Bank',
        amount: 50,
        idempotencyKey: 'IDEM-WORKFLOW-OT-1',
      }),
    );
    assert.equal(first.status, 'completed');
    assert.equal(balance, 450);
    assert.equal(debitCount, 1);

    const second = toTransferActionResponse(
      await service.initiateTransfer(user, {
        recipientName: 'Jamie Recipient',
        recipientAccount: '9876543210',
        recipientBank: 'Example Bank',
        amount: 50,
        idempotencyKey: 'IDEM-WORKFLOW-OT-2',
      }),
    );
    assert.equal(second.status, 'failed');
    assert.equal(second.reasonCode, 'TRANSFER_LIMIT_REACHED');
    assert.equal(balance, 450);
    assert.equal(debitCount, 1);
  } finally {
    transferRepository.createTransfer = previousCreate;
    transferRepository.completeTransferDebitAtomic = previousComplete;
    accountRepository.findByProfileId = previousFindProfile;
    restoreFns();
  }
});

test('Workflow C — four-stage verification then single completion debit', async () => {
  const transferService = new TransferService();
  const verifyService = new VerificationService();
  let transfer = transferBase({
    status: 'verification_stage_1',
    currentStage: 1,
    stagesCompleted: 0,
    idempotencyKey: 'IDEM-WORKFLOW-4S',
  });
  let balance = 500;
  let debitCount = 0;
  const codes: Record<number, string> = {
    1: '111111',
    2: '222222',
    3: '333333',
    4: '444444',
  };

  const restore = stubSender(account('four_stage_verification'), balance);
  const previousCreate = transferRepository.createTransfer.bind(transferRepository);
  const previousFind = transferRepository.findById.bind(transferRepository);
  const previousUpdate = transferRepository.updateTransfer.bind(transferRepository);
  const previousComplete =
    transferRepository.completeTransferDebitAtomic.bind(transferRepository);
  const previousFindCode =
    verificationCodeRepository.findByTransferAndStage.bind(verificationCodeRepository);
  const previousConsume =
    verificationCodeRepository.markConsumed.bind(verificationCodeRepository);
  const previousGenerate = VerificationService.prototype.generateVerificationCode;
  const previousAccount = accountRepository.findById.bind(accountRepository);

  transferRepository.createTransfer = async () => transfer;
  transferRepository.findById = async () => transfer;
  accountRepository.findById = async () => account('four_stage_verification');
  VerificationService.prototype.generateVerificationCode = async (
    _actor,
    transferId,
    stage = 1,
  ) => ({
    transferId,
    stage,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  verificationCodeRepository.markConsumed = async (id) => ({
    id,
    transferId: transfer.id,
    stage: transfer.currentStage,
    codeHash: 'x',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  verificationCodeRepository.findByTransferAndStage = async (_id, stage) => ({
    id: `code-${stage}`,
    transferId: transfer.id,
    stage,
    codeHash: hashVerificationCode(codes[stage], transfer.id, stage),
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
  transferRepository.completeTransferDebitAtomic = async () => {
    debitCount += 1;
    balance -= 50;
    transfer = {
      ...transfer,
      status: 'completed',
      ledgerTransactionId: 'tx-final',
      completedAt: new Date().toISOString(),
    };
    return { transfer, ledger: null, idempotentReplay: debitCount > 1 };
  };

  try {
    const started = toTransferActionResponse(
      await transferService.initiateTransfer(user, {
        recipientName: 'Jamie Recipient',
        recipientAccount: '9876543210',
        recipientBank: 'Example Bank',
        amount: 50,
        idempotencyKey: 'IDEM-WORKFLOW-4S',
      }),
    );
    assert.equal(started.status, 'verification_required');
    assert.equal(started.stage, 1);

    for (const stage of [1, 2, 3] as const) {
      const advanced = toTransferActionResponse(
        await verifyService.verifyCode(user, transfer.id, codes[stage]),
      );
      assert.equal(advanced.status, 'verification_required');
      assert.equal(advanced.stage, stage + 1);
    }

    const stage4 = await verifyService.verifyCode(user, transfer.id, codes[4]);
    assert.ok(stage4.transfer);
    assert.equal(stage4.transfer.stagesCompleted, 4);

    const completed = toTransferActionResponse(
      await transferService.completeFourStageTransfer(user, transfer.id),
    );
    assert.equal(completed.status, 'completed');
    assert.equal(balance, 450);
    assert.equal(debitCount, 1);

    const replay = toTransferActionResponse(
      await transferService.completeFourStageTransfer(user, transfer.id),
    );
    assert.equal(replay.status, 'completed');
    assert.equal(debitCount, 1);
  } finally {
    transferRepository.createTransfer = previousCreate;
    transferRepository.findById = previousFind;
    transferRepository.updateTransfer = previousUpdate;
    transferRepository.completeTransferDebitAtomic = previousComplete;
    verificationCodeRepository.findByTransferAndStage = previousFindCode;
    verificationCodeRepository.markConsumed = previousConsume;
    VerificationService.prototype.generateVerificationCode = previousGenerate;
    accountRepository.findById = previousAccount;
    restore();
  }
});

test('API create transfer rejects unauthenticated callers', async () => {
  const result = await apiHandlers.createTransfer({
    body: {
      recipientName: 'Jamie',
      recipientAccount: '12345678',
      recipientBank: 'Bank',
      amount: 10,
      idempotencyKey: 'IDEM-API-TEST01',
    },
  });
  assert.equal(result.statusCode, 401);
});

test('API malformed transfer id is rejected', async () => {
  authContext.setActorResolverForTests(async () => user);

  try {
    const result = await apiHandlers.getTransfer({
      authorization: 'Bearer test',
      params: { id: 'not-a-uuid' },
    });
    assert.equal(result.statusCode, 400);
    assert.equal((result.body as { error: { code: string } }).error.code, 'VALIDATION_ERROR');
  } finally {
    authContext.resetActorResolverForTests();
  }
});

test('dev verification peek is isolated from normal transfer routes', async () => {
  process.env.ALLOW_VERIFICATION_CODE_PEEK = 'false';
  authContext.setActorResolverForTests(async () => ({
    userId: 'admin-1',
    role: 'admin',
    accountStatus: 'active',
    tenantId: NORTHLINE_TENANT_ID,
  }));

  try {
    const result = await apiHandlers.devPeekVerificationCode({
      authorization: 'Bearer admin',
      params: { id: '11111111-1111-4111-8111-111111111111' },
      query: { stage: '1' },
    });
    assert.equal(result.statusCode, 403);
  } finally {
    authContext.resetActorResolverForTests();
  }
});
