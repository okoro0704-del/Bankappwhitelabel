import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireActiveAccount,
  requireAdmin,
  requireAuthenticatedUser,
} from '../src/middleware/authorization/authorization-service';
import { assertNotSelfRoleChange } from '../src/middleware/auth/auth-middleware';
import type { AuthenticatedAppUser } from '../src/types';
import {
  AuthenticationError,
  AuthorizationError,
} from '../src/utils/errors';

const activeUser: AuthenticatedAppUser = {
  userId: 'user-1',
  role: 'user',
  accountStatus: 'active',
};

const adminUser: AuthenticatedAppUser = {
  userId: 'admin-1',
  role: 'admin',
  accountStatus: 'active',
};

const suspendedUser: AuthenticatedAppUser = {
  userId: 'user-2',
  role: 'user',
  accountStatus: 'suspended',
};

test('requireAuthenticatedUser accepts a valid user', () => {
  assert.equal(requireAuthenticatedUser(activeUser).userId, 'user-1');
});

test('requireAuthenticatedUser rejects missing identity', () => {
  assert.throws(() => requireAuthenticatedUser(null), AuthenticationError);
});

test('requireAdmin recognizes admin and rejects ordinary user', () => {
  assert.equal(requireAdmin(adminUser).role, 'admin');
  assert.throws(() => requireAdmin(activeUser), AuthorizationError);
});

test('requireActiveAccount accepts active and rejects suspended', () => {
  assert.equal(requireActiveAccount(activeUser).accountStatus, 'active');
  assert.throws(() => requireActiveAccount(suspendedUser), AuthorizationError);
});

test('user cannot change own role', () => {
  assert.throws(
    () => assertNotSelfRoleChange(activeUser, activeUser.userId, 'admin'),
    AuthorizationError,
  );
});

test('user cannot promote themselves even via assert helper', () => {
  assert.throws(
    () => assertNotSelfRoleChange(activeUser, 'someone-else', 'admin'),
    AuthorizationError,
  );
});

test('admin can assign roles to other users', () => {
  assert.doesNotThrow(() =>
    assertNotSelfRoleChange(adminUser, activeUser.userId, 'admin'),
  );
});
