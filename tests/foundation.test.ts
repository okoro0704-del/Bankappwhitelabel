import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_TYPES,
  APP_ROLES,
  isAccountType,
  isUserRole,
} from '../src/types';
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from '../src/utils/errors';

test('account type constants are valid', () => {
  assert.deepEqual(ACCOUNT_TYPES, [
    'escrow',
    'one_time_transfer',
    'four_stage_verification',
  ]);
  assert.equal(isAccountType('escrow'), true);
  assert.equal(isAccountType('invalid_type'), false);
});

test('role constants are valid', () => {
  assert.deepEqual(APP_ROLES, ['admin', 'user']);
  assert.equal(isUserRole('admin'), true);
  assert.equal(isUserRole('guest'), false);
});

test('validation error shape is consistent', () => {
  const error = new ValidationError('Invalid input');
  assert.equal(error.name, 'ValidationError');
  assert.equal(error.statusCode, 400);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.expose, true);
});

test('authentication and conflict errors expose expected metadata', () => {
  const authError = new AuthenticationError();
  const conflictError = new ConflictError('Duplicate resource');

  assert.equal(authError.statusCode, 401);
  assert.equal(authError.code, 'AUTHENTICATION_ERROR');
  assert.equal(conflictError.statusCode, 409);
  assert.equal(conflictError.code, 'CONFLICT_ERROR');
});
