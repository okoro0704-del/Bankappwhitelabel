import { describe, expect, it } from 'vitest';
import { ApiError, getFriendlyErrorMessage } from '../api/errors';
import { mapProfile, mapTransfer, mapWallet } from '../api/mappers';
import { extractTenantLabelUnderBaseDomain } from '../tenant/resolve';
import { accountTypeLabel, customerAccountTypeLabel, productTypeLabel, formatMoney } from '../utils/format';

describe('Supabase row mappers', () => {
  it('maps profile and wallet rows to camelCase UI types', () => {
    expect(
      mapProfile({
        id: 'p1',
        user_id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        phone: null,
        username: 'ada',
        status: 'active',
        role: 'user',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({ userId: 'u1', firstName: 'Ada', username: 'ada' });

    expect(
      mapWallet({
        id: 'w1',
        account_id: 'a1',
        balance: '10.50',
        currency: 'USD',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({ accountId: 'a1', balance: 10.5 });
  });

  it('maps transfer recipient nested shape', () => {
    expect(
      mapTransfer({
        id: 't1',
        reference: 'TRF1',
        status: 'processing',
        amount: 5,
        recipient_name: 'Bob',
        recipient_account: '123',
        recipient_bank: 'Bank',
        description: null,
        current_stage: 1,
        stages_completed: 0,
        reason_code: null,
        failure_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        completed_at: null,
      }).recipient,
    ).toEqual({ name: 'Bob', account: '123', bank: 'Bank' });
  });
});

describe('base-domain tenant label', () => {
  it('only accepts labels under the configured base domain', () => {
    expect(extractTenantLabelUnderBaseDomain('acme.app.example.com', 'app.example.com')).toBe(
      'acme',
    );
    expect(extractTenantLabelUnderBaseDomain('acme.evil.com', 'app.example.com')).toBeNull();
    expect(extractTenantLabelUnderBaseDomain('www.app.example.com', 'app.example.com')).toBeNull();
  });
});

describe('API error handling', () => {
  it('maps known codes to friendly copy', () => {
    expect(getFriendlyErrorMessage(new ApiError('INSUFFICIENT_BALANCE', 'x'))).toContain(
      'enough balance',
    );
    expect(getFriendlyErrorMessage(new ApiError('ACCOUNT_INACTIVE', 'x'))).toContain('inactive');
    expect(getFriendlyErrorMessage(new ApiError('UNAUTHENTICATED', 'x'))).toContain('session');
    expect(getFriendlyErrorMessage(new ApiError('INVALID_CREDENTIALS', 'Bad login'))).toBe(
      'Bad login',
    );
    expect(getFriendlyErrorMessage(new ApiError('API_UNREACHABLE', 'x'))).toContain('Supabase');
  });
});

describe('format helpers', () => {
  it('maps account types to labels without encoding behavior', () => {
    expect(accountTypeLabel('escrow')).toBe('Escrow');
    expect(accountTypeLabel('one_time_transfer')).toBe('One-time transfer');
    expect(accountTypeLabel('four_stage_verification')).toBe('Four-stage verification');
  });

  it('hides backend account modes from customers', () => {
    expect(customerAccountTypeLabel('escrow')).toBe('Checking account');
    expect(customerAccountTypeLabel('one_time_transfer')).toBe('Checking account');
    expect(customerAccountTypeLabel('four_stage_verification')).toBe('Checking account');
    expect(productTypeLabel('checking')).toBe('Checking account');
    expect(productTypeLabel('current')).toBe('Current account');
    expect(productTypeLabel('savings')).toBe('Savings account');
    expect(customerAccountTypeLabel('savings')).toBe('Savings account');
  });

  it('formats money from API amounts', () => {
    expect(formatMoney(12.5, 'USD')).toMatch(/12\.50/);
  });
});

describe('homePathForUser', () => {
  it('prefers Master only on the platform apex host', async () => {
    const { homePathForUser } = await import('../auth/homePath');
    const masterUser = {
      userId: 'u1',
      role: 'admin' as const,
      accountStatus: 'active' as const,
      email: 'a@b.c',
      username: 'a',
      firstName: 'A',
      lastName: 'B',
      isMasterAdmin: true,
    };
    expect(homePathForUser(masterUser, 'webfinance.app')).toBe('/master');
    expect(homePathForUser(masterUser, 'citbankplc.webfinance.app')).toBe('/admin');
    expect(
      homePathForUser(
        {
          ...masterUser,
          isMasterAdmin: false,
        },
        'citbankplc.webfinance.app',
      ),
    ).toBe('/admin');
  });
});
