import assert from 'node:assert/strict';
import test from 'node:test';

import { WalletService } from '../src/services/wallets/wallet-service';
import { TransactionService } from '../src/services/transactions/transaction-service';
import { walletRepository } from '../src/repositories/wallets/wallet-repository';
import { transactionRepository } from '../src/repositories/transactions/transaction-repository';
import { accountRepository } from '../src/repositories/accounts/account-repository';
import { profileRepository } from '../src/repositories/profiles/profile-repository';
import type {
  AccountRecord,
  AuthenticatedAppUser,
  ProfileRecord,
  TransactionRecord,
  WalletRecord,
} from '../src/types';
import { AuthorizationError, NotFoundError, ValidationError } from '../src/utils/errors';
import { NORTHLINE_TENANT_ID } from '../src/tenants/constants';

const admin: AuthenticatedAppUser = {
  userId: 'admin-1',
  role: 'admin',
  accountStatus: 'active',
  tenantId: NORTHLINE_TENANT_ID,
};

const userA: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'active',
  tenantId: NORTHLINE_TENANT_ID,
};

const userB: AuthenticatedAppUser = {
  userId: 'user-b',
  role: 'user',
  accountStatus: 'active',
  tenantId: NORTHLINE_TENANT_ID,
};

const profileA: ProfileRecord = {
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

const accountA: AccountRecord = {
  id: 'account-a',
  profileId: 'profile-a',
  tenantId: NORTHLINE_TENANT_ID,
  accountNumber: '1234567890',
  accountType: 'escrow',
  accountStatus: 'active',
  oneTimeTransferUsed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const walletA: WalletRecord = {
  id: 'wallet-a',
  accountId: 'account-a',
  tenantId: NORTHLINE_TENANT_ID,
  balance: 0,
  currency: 'USD',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const fundingTx: TransactionRecord = {
  id: 'tx-1',
  walletId: 'wallet-a',
  accountId: 'account-a',
  tenantId: NORTHLINE_TENANT_ID,
  transactionType: 'funding',
  status: 'completed',
  amount: 100,
  balanceBefore: 0,
  balanceAfter: 100,
  reference: 'FND-TEST-REFERENCE1',
  idempotencyKey: 'IDEM-TEST-KEY-0001',
  description: 'test funding',
  createdBy: 'admin-1',
  metadata: { source: 'admin_funding' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('admin can create a zero-balance wallet; user cannot', async () => {
  const service = new WalletService();
  const previousFindAccount = accountRepository.findById.bind(accountRepository);
  const previousFindWallet = walletRepository.findByAccountId.bind(walletRepository);
  const previousCreate = walletRepository.createWallet.bind(walletRepository);

  accountRepository.findById = async () => accountA;
  walletRepository.findByAccountId = async () => null;
  walletRepository.createWallet = async () => walletA;

  try {
    const created = await service.createWallet(admin, { accountId: accountA.id });
    assert.equal(created.balance, 0);

    await assert.rejects(
      () => service.createWallet(userA, { accountId: accountA.id }),
      AuthorizationError,
    );
  } finally {
    accountRepository.findById = previousFindAccount;
    walletRepository.findByAccountId = previousFindWallet;
    walletRepository.createWallet = previousCreate;
  }
});

test('wallet creation rejects non-zero opening balance', async () => {
  const service = new WalletService();
  const previousFindAccount = accountRepository.findById.bind(accountRepository);
  const previousFindWallet = walletRepository.findByAccountId.bind(walletRepository);

  accountRepository.findById = async () => accountA;
  walletRepository.findByAccountId = async () => null;

  try {
    await assert.rejects(
      () => service.createWallet(admin, { accountId: accountA.id, balance: 50 }),
      ValidationError,
    );
  } finally {
    accountRepository.findById = previousFindAccount;
    walletRepository.findByAccountId = previousFindWallet;
  }
});

test('user cannot access another user wallet', async () => {
  const service = new WalletService();
  const previousFindWallet = walletRepository.findById.bind(walletRepository);
  const previousFindAccount = accountRepository.findById.bind(accountRepository);
  const previousFindProfile = profileRepository.findById.bind(profileRepository);

  walletRepository.findById = async () => walletA;
  accountRepository.findById = async () => accountA;
  profileRepository.findById = async () => profileA;

  try {
    await assert.rejects(() => service.getWallet(userB, walletA.id), AuthorizationError);
    const own = await service.getWallet(userA, walletA.id);
    assert.equal(own.id, walletA.id);
  } finally {
    walletRepository.findById = previousFindWallet;
    accountRepository.findById = previousFindAccount;
    profileRepository.findById = previousFindProfile;
  }
});

test('ordinary user cannot fund wallets', async () => {
  const service = new TransactionService();

  await assert.rejects(
    () =>
      service.fundWallet(userA, {
        walletId: walletA.id,
        amount: 25,
      }),
    AuthorizationError,
  );
});

test('admin funding creates transaction atomically and supports idempotent replay', async () => {
  const service = new TransactionService();
  const previousFindWallet = walletRepository.findById.bind(walletRepository);
  const previousFund = transactionRepository.fundWalletAtomic.bind(transactionRepository);

  let callCount = 0;
  walletRepository.findById = async () => walletA;
  transactionRepository.fundWalletAtomic = async (input) => {
    callCount += 1;
    const fundedWallet = { ...walletA, balance: 100 };
    const tx = {
      ...fundingTx,
      amount: input.amount,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey ?? null,
    };

    return {
      wallet: fundedWallet,
      transaction: tx,
      idempotentReplay: callCount > 1,
    };
  };

  try {
    const first = await service.fundWallet(admin, {
      walletId: walletA.id,
      amount: 100,
      reference: 'FND-TEST-REFERENCE1',
      idempotencyKey: 'IDEM-TEST-KEY-0001',
    });

    assert.equal(first.wallet.balance, 100);
    assert.equal(first.transaction.transactionType, 'funding');
    assert.equal(first.idempotentReplay, false);

    const second = await service.fundWallet(admin, {
      walletId: walletA.id,
      amount: 100,
      reference: 'FND-TEST-REFERENCE1',
      idempotencyKey: 'IDEM-TEST-KEY-0001',
    });

    assert.equal(second.transaction.id, first.transaction.id);
    assert.equal(second.idempotentReplay, true);
    assert.equal(callCount, 2);
  } finally {
    walletRepository.findById = previousFindWallet;
    transactionRepository.fundWalletAtomic = previousFund;
  }
});

test('funding requires wallet or account target', async () => {
  const service = new TransactionService();

  await assert.rejects(
    () => service.fundWallet(admin, { amount: 10 }),
    ValidationError,
  );
});

test('missing wallet yields not found for funding', async () => {
  const service = new TransactionService();
  const previous = walletRepository.findById.bind(walletRepository);
  walletRepository.findById = async () => null;

  try {
    await assert.rejects(
      () => service.fundWallet(admin, { walletId: 'missing', amount: 10 }),
      NotFoundError,
    );
  } finally {
    walletRepository.findById = previous;
  }
});

test('user cannot list another account transactions', async () => {
  const service = new TransactionService();
  const previousFindAccount = accountRepository.findById.bind(accountRepository);
  const previousFindProfile = profileRepository.findById.bind(profileRepository);

  accountRepository.findById = async () => accountA;
  profileRepository.findById = async () => profileA;

  try {
    await assert.rejects(
      () => service.listAccountTransactions(userB, accountA.id),
      AuthorizationError,
    );
  } finally {
    accountRepository.findById = previousFindAccount;
    profileRepository.findById = previousFindProfile;
  }
});
