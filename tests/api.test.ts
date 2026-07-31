import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchApiRequest } from '../src/api/router';
import { toApiError, ok } from '../src/api/http';
import { toTransferActionResponse } from '../src/api/mappers';
import {
  AuthenticationError,
  AuthorizationError,
  TransferError,
  ValidationError,
} from '../src/utils/errors';
import type { TransferServiceResult } from '../src/types';

test('API error contract maps auth and transfer codes safely', () => {
  const unauth = toApiError(new AuthenticationError());
  assert.equal(unauth.statusCode, 401);
  assert.deepEqual(unauth.body, {
    error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
  });

  const forbidden = toApiError(new AuthorizationError());
  assert.equal(forbidden.statusCode, 403);
  assert.equal((forbidden.body as { error: { code: string } }).error.code, 'FORBIDDEN');

  const transfer = toApiError(
    new TransferError('EXTERNAL_TRANSFER_NOT_ALLOWED', 'External transfers unavailable'),
  );
  assert.equal(
    (transfer.body as { error: { code: string } }).error.code,
    'EXTERNAL_TRANSFER_NOT_ALLOWED',
  );

  const internal = toApiError(new Error('secret sql boom'));
  assert.equal(internal.statusCode, 500);
  assert.equal(
    (internal.body as { error: { message: string } }).error.message,
    'An unexpected error occurred',
  );
});

test('unauthenticated API requests are rejected', async () => {
  const result = await dispatchApiRequest({
    method: 'GET',
    path: '/api/me/account',
  });

  assert.equal(result.statusCode, 401);
  assert.equal((result.body as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
});

test('unknown routes return not found without leaking internals', async () => {
  const result = await dispatchApiRequest({
    method: 'GET',
    path: '/api/does-not-exist',
  });
  assert.equal(result.statusCode, 404);
  assert.equal((result.body as { error: { code: string } }).error.code, 'NOT_FOUND');
});

test('health endpoint does not require auth', async () => {
  const result = await dispatchApiRequest({
    method: 'GET',
    path: '/health',
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { data: { status: 'ok' } });
});

test('transfer action mapper never includes hashes or secrets', () => {
  const result: TransferServiceResult = {
    status: 'verification_required',
    stage: 1,
    transferId: 't1',
    reference: 'TRF-1',
    amount: 10,
    transfer: {
      id: 't1',
      accountId: 'a1',
      userId: 'u1',
      walletId: 'w1',
      ledgerTransactionId: null,
      reference: 'TRF-1',
      idempotencyKey: 'IDEM-ABCDEFGH',
      recipientName: 'Pat',
      recipientAccount: '12345678',
      recipientBank: 'Bank',
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
    },
  };

  const mapped = toTransferActionResponse(result);
  const serialized = JSON.stringify(mapped);
  assert.equal(mapped.status, 'verification_required');
  assert.doesNotMatch(serialized, /codeHash|service_role|password/i);
});

test('validation errors use VALIDATION_ERROR code', () => {
  const result = toApiError(new ValidationError('bad input'));
  assert.equal(result.statusCode, 400);
  assert.equal((result.body as { error: { code: string } }).error.code, 'VALIDATION_ERROR');
});

test('ok helper wraps data payloads', () => {
  assert.deepEqual(ok({ hello: 'world' }), {
    statusCode: 200,
    body: { data: { hello: 'world' } },
  });
});
