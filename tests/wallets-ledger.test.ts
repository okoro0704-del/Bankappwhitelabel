import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  isTransactionStatus,
  isTransactionType,
} from '../src/types';
import {
  generateIdempotencyKey,
  generateTransactionReference,
} from '../src/utils/transaction-reference';
import {
  validateFundingAmount,
  validateIdempotencyKey,
  validateTransactionReference,
  validateTransactionStatus,
  validateTransactionType,
} from '../src/utils/validation';
import { ValidationError } from '../src/utils/errors';

test('transaction type and status constants are constrained', () => {
  assert.deepEqual(TRANSACTION_TYPES, ['funding', 'debit', 'credit']);
  assert.deepEqual(TRANSACTION_STATUSES, ['pending', 'completed', 'failed']);
  assert.equal(isTransactionType('funding'), true);
  assert.equal(isTransactionType('transfer'), false);
  assert.equal(isTransactionStatus('completed'), true);
  assert.equal(isTransactionStatus('posted'), false);
  assert.equal(validateTransactionType('credit'), 'credit');
  assert.equal(validateTransactionStatus('pending'), 'pending');
});

test('funding amount validation rejects invalid money values', () => {
  assert.equal(validateFundingAmount(10.5), 10.5);
  assert.throws(() => validateFundingAmount(0), ValidationError);
  assert.throws(() => validateFundingAmount(-5), ValidationError);
  assert.throws(() => validateFundingAmount(1.234), ValidationError);
});

test('transaction reference and idempotency key validation', () => {
  const reference = generateTransactionReference('FND');
  const idempotencyKey = generateIdempotencyKey('IDEM');

  assert.match(reference, /^FND-/);
  assert.match(idempotencyKey, /^IDEM-/);
  assert.equal(validateTransactionReference(reference), reference);
  assert.equal(validateIdempotencyKey(idempotencyKey), idempotencyKey);
  assert.throws(() => validateTransactionReference('short'), ValidationError);
  assert.throws(() => validateIdempotencyKey('bad key'), ValidationError);
});

test('wallets/transactions migration defines atomic funding and protections', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260731090000_wallets_transactions_ledger.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /create table public\.wallets/i);
  assert.match(sql, /create table public\.transactions/i);
  assert.match(sql, /transaction_type/i);
  assert.match(sql, /fund_wallet_atomic/i);
  assert.match(sql, /transactions_reference_unique/i);
  assert.match(sql, /transactions_idempotency_key_unique/i);
  assert.match(sql, /protect_wallet_privileges/i);
  assert.match(sql, /protect_transaction_privileges/i);
  assert.match(sql, /enable row level security/i);
});
