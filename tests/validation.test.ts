import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_NUMBER_LENGTH,
  generateAccountNumber,
} from '../src/utils/account-number';
import {
  validateAccountNumber,
  validateAccountStatus,
  validateAccountType,
  validateEmail,
  validateName,
  validatePhone,
  validateUsername,
} from '../src/utils/validation';
import { ValidationError } from '../src/utils/errors';

test('generateAccountNumber creates unique 10-digit values', () => {
  const samples = new Set(
    Array.from({ length: 50 }, () => generateAccountNumber()),
  );

  assert.equal(samples.size, 50);

  for (const value of samples) {
    assert.equal(value.length, ACCOUNT_NUMBER_LENGTH);
    assert.match(value, /^\d{10}$/);
    assert.notEqual(value[0], '0');
  }
});

test('validation accepts well-formed provisioning fields', () => {
  assert.equal(validateEmail('Admin@Example.com'), 'admin@example.com');
  assert.equal(validateUsername('Jane_Doe'), 'jane_doe');
  assert.equal(validateName('firstName', "Mary-Jane"), "Mary-Jane");
  assert.equal(validatePhone('+15551234567'), '+15551234567');
  assert.equal(validateAccountType('escrow'), 'escrow');
  assert.equal(validateAccountStatus('suspended'), 'suspended');
  assert.equal(validateAccountNumber('1234567890'), '1234567890');
});

test('validation rejects invalid inputs', () => {
  assert.throws(() => validateEmail('not-an-email'), ValidationError);
  assert.throws(() => validateUsername('ab'), ValidationError);
  assert.throws(() => validatePhone('123'), ValidationError);
  assert.throws(() => validateAccountType('savings'), ValidationError);
  assert.throws(() => validateAccountStatus('closed'), ValidationError);
  assert.throws(() => validateAccountNumber('123'), ValidationError);
  assert.throws(() => validateName('firstName', ''), ValidationError);
});
