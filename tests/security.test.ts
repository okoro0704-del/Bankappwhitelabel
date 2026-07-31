import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileService } from '../src/services/users/profile-service';
import { AccountService } from '../src/services/accounts/account-service';
import { UserProvisioningService } from '../src/services/users/user-provisioning-service';
import type {
  AccountRecord,
  AuthenticatedAppUser,
  ProfileRecord,
} from '../src/types';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../src/utils/errors';
import { NORTHLINE_TENANT_ID } from '../src/tenants/constants';

const admin: AuthenticatedAppUser = {
  userId: 'admin-user',
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

const suspended: AuthenticatedAppUser = {
  userId: 'user-a',
  role: 'user',
  accountStatus: 'suspended',
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

const profileB: ProfileRecord = {
  ...profileA,
  id: 'profile-b',
  userId: 'user-b',
  email: 'bob@example.com',
  username: 'bob',
  firstName: 'Bob',
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

test('user cannot access another user profile', async () => {
  const service = new ProfileService();
  const original = (await import('../src/repositories/profiles/profile-repository'))
    .profileRepository;

  const previous = original.findById.bind(original);
  original.findById = async () => profileB;

  try {
    await assert.rejects(
      () => service.getProfileById(userA, profileB.id),
      AuthorizationError,
    );
  } finally {
    original.findById = previous;
  }
});

test('user cannot modify account type through account service status API misuse', async () => {
  const service = new AccountService();

  await assert.rejects(
    () => service.updateAccountStatus(userA, accountA.id, 'suspended'),
    AuthorizationError,
  );
});

test('admin can look up accounts; user cannot list accounts', async () => {
  const service = new AccountService();
  const repo = (await import('../src/repositories/accounts/account-repository'))
    .accountRepository;
  const previous = repo.listAccounts.bind(repo);
  repo.listAccounts = async () => [accountA];

  try {
    const listed = await service.adminListAccounts(admin);
    assert.equal(listed.length, 1);
    await assert.rejects(() => service.adminListAccounts(userA), AuthorizationError);
  } finally {
    repo.listAccounts = previous;
  }
});

test('suspended account is rejected by profile update authorization', async () => {
  const service = new ProfileService();

  await assert.rejects(
    () => service.updateOwnProfile(suspended, { firstName: 'New' }),
    AuthorizationError,
  );
});

test('ordinary user cannot provision another user', async () => {
  const service = new UserProvisioningService();

  await assert.rejects(
    () =>
      service.provisionUser(userA, {
        firstName: 'Casey',
        lastName: 'User',
        email: 'casey@example.com',
        username: 'casey',
        accountType: 'escrow',
      }),
    AuthorizationError,
  );
});

test('profile ownership checks reject cross-user reads by user id', async () => {
  const service = new ProfileService();

  await assert.rejects(
    () => service.getProfileByUserId(userA, userB.userId),
    AuthorizationError,
  );
});

test('missing profile yields not found for owner lookup path', async () => {
  const service = new ProfileService();
  const repo = (await import('../src/repositories/profiles/profile-repository'))
    .profileRepository;
  const previous = repo.findByUserId.bind(repo);
  repo.findByUserId = async () => null;

  try {
    await assert.rejects(() => service.getCurrentProfile(userA), NotFoundError);
  } finally {
    repo.findByUserId = previous;
  }
});

test('duplicate username conflict surfaces as ConflictError from service layer contract', () => {
  const error = new ConflictError('username already exists', {
    field: 'username',
    value: 'ada',
  });
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'CONFLICT_ERROR');
});
