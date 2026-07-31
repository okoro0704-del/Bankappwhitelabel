import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthService } from '../src/services/auth/auth-service';
import { AuthenticationError, ValidationError } from '../src/utils/errors';

test('AuthService rejects empty access tokens for session lookup', async () => {
  const service = new AuthService();

  await assert.rejects(
    () => service.getUserFromAccessToken(''),
    AuthenticationError,
  );
});

test('AuthService validates email before password reset', async () => {
  const service = new AuthService();

  await assert.rejects(
    () => service.requestPasswordReset('bad-email'),
    ValidationError,
  );
});

test('AuthService.getInitialAdminConfig reads optional env values', () => {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    INITIAL_ADMIN_EMAIL: process.env.INITIAL_ADMIN_EMAIL,
    INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD,
  };

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.INITIAL_ADMIN_EMAIL = 'admin@example.com';
  process.env.INITIAL_ADMIN_PASSWORD = 'super-secret-password';

  try {
    const service = new AuthService();
    const config = service.getInitialAdminConfig();
    assert.equal(config.email, 'admin@example.com');
    assert.equal(config.password, 'super-secret-password');
    assert.equal(config.accountType, 'escrow');
  } finally {
    process.env.SUPABASE_URL = previous.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = previous.SUPABASE_ANON_KEY;
    process.env.INITIAL_ADMIN_EMAIL = previous.INITIAL_ADMIN_EMAIL;
    process.env.INITIAL_ADMIN_PASSWORD = previous.INITIAL_ADMIN_PASSWORD;
  }
});
