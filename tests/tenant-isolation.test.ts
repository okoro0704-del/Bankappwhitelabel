import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileService } from '../src/services/users/profile-service';
import { AccountService } from '../src/services/accounts/account-service';
import { WalletService } from '../src/services/wallets/wallet-service';
import { TransactionService } from '../src/services/transactions/transaction-service';
import { TransferService } from '../src/services/transfers/transfer-service';
import { VerificationService } from '../src/services/transfers/verification-service';
import { profileRepository } from '../src/repositories/profiles/profile-repository';
import { accountRepository } from '../src/repositories/accounts/account-repository';
import { walletRepository } from '../src/repositories/wallets/wallet-repository';
import { transactionRepository } from '../src/repositories/transactions/transaction-repository';
import { transferRepository } from '../src/repositories/transfers/transfer-repository';
import { verificationCodeRepository } from '../src/repositories/transfers/verification-code-repository';
import {
  requireActorTenantId,
  requireTenantAdmin,
  assertSameTenant,
} from '../src/middleware/authorization/tenant-access';
import { NORTHLINE_TENANT_ID } from '../src/tenants/constants';
import type {
  AccountRecord,
  AuthenticatedAppUser,
  ProfileRecord,
  TransactionRecord,
  TransferRecord,
  WalletRecord,
} from '../src/types';
import { AuthorizationError, NotFoundError } from '../src/utils/errors';
import { dispatchApiRequest } from '../src/api/router';
import * as authContext from '../src/api/auth-context';

const TENANT_A = NORTHLINE_TENANT_ID;
const TENANT_B = 'b0000000-0000-4000-8000-000000000002';

const adminA: AuthenticatedAppUser = {
  userId: 'admin-a',
  role: 'admin',
  accountStatus: 'active',
  tenantId: TENANT_A,
};

const adminB: AuthenticatedAppUser = {
  userId: 'admin-b',
  role: 'admin',
  accountStatus: 'active',
  tenantId: TENANT_B,
};

const userA: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'active',
  tenantId: TENANT_A,
};

const userB: AuthenticatedAppUser = {
  userId: 'user-b',
  role: 'user',
  accountStatus: 'active',
  tenantId: TENANT_B,
};

const profileB: ProfileRecord = {
  id: 'b0000000-0000-4000-8000-0000000000b1',
  userId: 'user-b',
  tenantId: TENANT_B,
  firstName: 'Bea',
  lastName: 'Other',
  email: 'bea@example.com',
  phone: null,
  username: 'bea',
  status: 'active',
  role: 'user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const accountB: AccountRecord = {
  id: 'b0000000-0000-4000-8000-0000000000b2',
  profileId: 'b0000000-0000-4000-8000-0000000000b1',
  tenantId: TENANT_B,
  accountNumber: '2222222222',
  accountType: 'escrow',
  accountStatus: 'active',
  oneTimeTransferUsed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const walletB: WalletRecord = {
  id: 'b0000000-0000-4000-8000-0000000000b3',
  accountId: 'b0000000-0000-4000-8000-0000000000b2',
  tenantId: TENANT_B,
  balance: 250,
  currency: 'USD',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const txB: TransactionRecord = {
  id: 'b0000000-0000-4000-8000-0000000000b4',
  walletId: 'b0000000-0000-4000-8000-0000000000b3',
  accountId: 'b0000000-0000-4000-8000-0000000000b2',
  tenantId: TENANT_B,
  transactionType: 'funding',
  status: 'completed',
  amount: 250,
  balanceBefore: 0,
  balanceAfter: 250,
  reference: 'FND-TENANT-B-0001',
  idempotencyKey: null,
  description: null,
  createdBy: 'admin-b',
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const transferB: TransferRecord = {
  id: 'b0000000-0000-4000-8000-0000000000b5',
  accountId: 'b0000000-0000-4000-8000-0000000000b2',
  userId: 'user-b',
  walletId: 'b0000000-0000-4000-8000-0000000000b3',
  tenantId: TENANT_B,
  ledgerTransactionId: null,
  reference: 'TRF-TENANT-B-0001',
  idempotencyKey: 'IDEM-TENANT-B-0001',
  recipientName: 'Other',
  recipientAccount: '3333333333',
  recipientBank: 'Bank B',
  amount: 10,
  description: null,
  status: 'verification_stage_1',
  currentStage: 1,
  stagesCompleted: 0,
  reasonCode: null,
  failureReason: null,
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('authorization context requires trusted tenant membership', () => {
  assert.equal(requireActorTenantId(adminA), TENANT_A);
  assert.equal(requireTenantAdmin(adminA).role, 'admin');
  assert.equal(requireActorTenantId(userA), TENANT_A);
  assert.throws(
    () => requireActorTenantId({ userId: 'x', role: 'user', accountStatus: 'active' }),
    AuthorizationError,
  );
  assert.throws(() => requireTenantAdmin(userA), AuthorizationError);
  assert.throws(() => assertSameTenant(adminA, TENANT_B), NotFoundError);
});

test('tenant A admin cannot read tenant B profile/account/wallet', async () => {
  const profiles = new ProfileService();
  const accounts = new AccountService();
  const wallets = new WalletService();

  const prevProfile = profileRepository.findById.bind(profileRepository);
  const prevAccount = accountRepository.findById.bind(accountRepository);
  const prevWallet = walletRepository.findById.bind(walletRepository);

  profileRepository.findById = async () => profileB;
  accountRepository.findById = async () => accountB;
  walletRepository.findById = async () => walletB;

  try {
    await assert.rejects(() => profiles.getProfileById(adminA, profileB.id), NotFoundError);
    await assert.rejects(() => accounts.getAccount(adminA, accountB.id), NotFoundError);
    await assert.rejects(() => wallets.getWallet(adminA, walletB.id), NotFoundError);

    await assert.rejects(() => profiles.getProfileById(userA, profileB.id), NotFoundError);
    await assert.rejects(() => accounts.getAccount(userA, accountB.id), NotFoundError);
  } finally {
    profileRepository.findById = prevProfile;
    accountRepository.findById = prevAccount;
    walletRepository.findById = prevWallet;
  }
});

test('tenant A admin cannot fund tenant B wallet via manipulated IDs', async () => {
  const service = new TransactionService();
  const prevWallet = walletRepository.findById.bind(walletRepository);
  walletRepository.findById = async () => walletB;

  try {
    await assert.rejects(
      () => service.fundWallet(adminA, { walletId: walletB.id, amount: 10 }),
      NotFoundError,
    );
  } finally {
    walletRepository.findById = prevWallet;
  }
});

test('tenant A admin cannot read tenant B transactions or transfers', async () => {
  const txService = new TransactionService();
  const transferService = new TransferService();
  const verificationService = new VerificationService();

  const prevTx = transactionRepository.findById.bind(transactionRepository);
  const prevTransfer = transferRepository.findById.bind(transferRepository);
  const prevAccount = accountRepository.findById.bind(accountRepository);
  const prevProfile = profileRepository.findById.bind(profileRepository);

  transactionRepository.findById = async () => txB;
  transferRepository.findById = async () => transferB;
  accountRepository.findById = async () => accountB;
  profileRepository.findById = async () => profileB;

  try {
    await assert.rejects(() => txService.getTransaction(adminA, txB.id), NotFoundError);
    await assert.rejects(() => txService.getTransaction(userA, txB.id), NotFoundError);
    await assert.rejects(() => transferService.getTransfer(adminA, transferB.id), NotFoundError);
    await assert.rejects(() => transferService.getTransfer(userA, transferB.id), NotFoundError);
    await assert.rejects(
      () => verificationService.getCurrentVerificationStage(adminA, transferB.id),
      NotFoundError,
    );
  } finally {
    transactionRepository.findById = prevTx;
    transferRepository.findById = prevTransfer;
    accountRepository.findById = prevAccount;
    profileRepository.findById = prevProfile;
  }
});

test('tenant B admin cannot read or modify tenant A resources', async () => {
  const profiles = new ProfileService();
  const accounts = new AccountService();

  const profileA: ProfileRecord = {
    ...profileB,
    id: 'a0000000-0000-4000-8000-0000000000a1',
    userId: 'user-a',
    tenantId: TENANT_A,
    email: 'ada@example.com',
    username: 'ada',
  };
  const accountA: AccountRecord = {
    ...accountB,
    id: 'a0000000-0000-4000-8000-0000000000a2',
    profileId: 'a0000000-0000-4000-8000-0000000000a1',
    tenantId: TENANT_A,
    accountNumber: '1111111111',
  };

  const prevProfile = profileRepository.findById.bind(profileRepository);
  const prevAccount = accountRepository.findById.bind(accountRepository);
  profileRepository.findById = async () => profileA;
  accountRepository.findById = async () => accountA;

  try {
    await assert.rejects(() => profiles.getProfileById(adminB, profileA.id), NotFoundError);
    await assert.rejects(
      () => accounts.updateAccountStatus(adminB, accountA.id, 'suspended'),
      NotFoundError,
    );
  } finally {
    profileRepository.findById = prevProfile;
    accountRepository.findById = prevAccount;
  }
});

test('admin list queries are tenant-scoped at the repository call', async () => {
  const profiles = new ProfileService();
  const accounts = new AccountService();
  const wallets = new WalletService();
  const transactions = new TransactionService();

  let listedProfileTenant: string | undefined;
  let listedAccountTenant: string | undefined;
  let listedWalletTenant: string | undefined;
  let listedTxTenant: string | undefined;

  const prevListProfiles = profileRepository.listProfiles.bind(profileRepository);
  const prevListAccounts = accountRepository.listAccounts.bind(accountRepository);
  const prevListWallets = walletRepository.listWallets.bind(walletRepository);
  const prevListTx = transactionRepository.listAll.bind(transactionRepository);
  const prevListTransfers = transferRepository.listAll.bind(transferRepository);

  profileRepository.listProfiles = async (tenantId) => {
    listedProfileTenant = tenantId;
    return { items: [], total: 0 };
  };
  accountRepository.listAccounts = async (tenantId) => {
    listedAccountTenant = tenantId;
    return [];
  };
  walletRepository.listWallets = async (tenantId) => {
    listedWalletTenant = tenantId;
    return [];
  };
  transactionRepository.listAll = async (tenantId) => {
    listedTxTenant = tenantId;
    return { items: [], total: 0 };
  };
  transferRepository.listAll = async (tenantId) => {
    assert.equal(tenantId, TENANT_A);
    return { items: [], total: 0 };
  };

  try {
    await profiles.adminListProfiles(adminA);
    await accounts.adminListAccounts(adminA);
    await wallets.adminListWallets(adminA);
    await transactions.adminListTransactions(adminA);

    assert.equal(listedProfileTenant, TENANT_A);
    assert.equal(listedAccountTenant, TENANT_A);
    assert.equal(listedWalletTenant, TENANT_A);
    assert.equal(listedTxTenant, TENANT_A);

    authContext.setActorResolverForTests(async () => adminA);
    const listed = await dispatchApiRequest({
      method: 'GET',
      path: '/api/admin/transfers',
    });
    assert.equal(listed.statusCode, 200);
  } finally {
    profileRepository.listProfiles = prevListProfiles;
    accountRepository.listAccounts = prevListAccounts;
    walletRepository.listWallets = prevListWallets;
    transactionRepository.listAll = prevListTx;
    transferRepository.listAll = prevListTransfers;
    authContext.resetActorResolverForTests();
  }
});

test('manipulated X-Tenant-Slug cannot bypass tenant authorization on protected APIs', async () => {
  authContext.setActorResolverForTests(async () => adminA);
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_DEV_TENANT_HEADER: process.env.ALLOW_DEV_TENANT_HEADER,
  };
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEV_TENANT_HEADER = 'true';

  const prevFind = profileRepository.findById.bind(profileRepository);
  profileRepository.findById = async () => profileB;

  try {
    // Even with a foreign tenant header, actor.tenantId remains Tenant A.
    const result = await dispatchApiRequest({
      method: 'PATCH',
      path: `/api/admin/profiles/${profileB.id}/status`,
      body: { status: 'suspended' },
      headers: { 'x-tenant-slug': 'tenant-b', host: 'localhost' },
    });
    assert.equal(result.statusCode, 404);
  } finally {
    profileRepository.findById = prevFind;
    authContext.resetActorResolverForTests();
    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
  }
});

test('tenant isolation migration defines financial tenant_id and scoped admin RLS', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260731190000_tenant_isolation.sql',
    ),
    'utf8',
  );
  assert.match(sql, /accounts[\s\S]*tenant_id/);
  assert.match(sql, /wallets[\s\S]*tenant_id/);
  assert.match(sql, /transactions[\s\S]*tenant_id/);
  assert.match(sql, /transfers[\s\S]*tenant_id/);
  assert.match(sql, /is_tenant_admin/);
  assert.match(sql, /tenant_admins_can_read_tenant_/);
  assert.match(sql, /locked_wallet\.tenant_id/);
});

test('verification peek cannot cross tenants', async () => {
  const service = new VerificationService();
  const previousFind = transferRepository.findById.bind(transferRepository);
  const previousPeek = verificationCodeRepository.peekPlaintext.bind(
    verificationCodeRepository,
  );
  transferRepository.findById = async () => transferB;
  verificationCodeRepository.peekPlaintext = async () => '123456';
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_VERIFICATION_CODE_PEEK = 'true';

  try {
    await assert.rejects(
      () => service.peekVerificationCodeForTesting(adminA, transferB.id, 1),
      NotFoundError,
    );
  } finally {
    transferRepository.findById = previousFind;
    verificationCodeRepository.peekPlaintext = previousPeek;
  }
});
