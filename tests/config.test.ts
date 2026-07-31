import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupabaseAdminClient,
  getClientEnvConfig,
  getServerEnvConfig,
} from '../src/config/supabase';
import { ValidationError } from '../src/utils/errors';

const originalEnv = { ...process.env };

const setBaseEnv = () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-anon-key';
};

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test('client env config returns client-safe values', () => {
  setBaseEnv();

  const config = getClientEnvConfig();

  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.supabaseAnonKey, 'public-anon-key');
});

test('server env config keeps service role server-only', () => {
  setBaseEnv();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

  const config = getServerEnvConfig();

  assert.equal(config.supabaseServiceRoleKey, 'service-role-key');
});

test('missing client env throws validation error', () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;

  assert.throws(() => getClientEnvConfig(), (error: unknown) => {
    assert.equal(error instanceof ValidationError, true);
    return true;
  });
});

test('missing service role key throws validation error for admin client', () => {
  setBaseEnv();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.throws(() => createSupabaseAdminClient(), (error: unknown) => {
    assert.equal(error instanceof ValidationError, true);
    return true;
  });
});
