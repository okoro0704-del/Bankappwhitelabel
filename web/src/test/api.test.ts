import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, setAccessTokenProvider } from '../api/client';
import { ApiError, getFriendlyErrorMessage } from '../api/errors';
import { accountTypeLabel, formatMoney } from '../utils/format';

describe('API client', () => {
  beforeEach(() => {
    setAccessTokenProvider(async () => 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches Authorization bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { ok: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/session');

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('throws UNAUTHENTICATED when token provider returns null', async () => {
    setAccessTokenProvider(async () => null);
    await expect(apiRequest('/api/session')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('maps API error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Nope' } }),
      }),
    );

    await expect(apiRequest('/api/admin/users')).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest('/api/admin/users')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});

describe('API error handling', () => {
  it('maps known codes to friendly copy', () => {
    expect(getFriendlyErrorMessage(new ApiError('INSUFFICIENT_BALANCE', 'x'))).toContain(
      'enough balance',
    );
    expect(getFriendlyErrorMessage(new ApiError('ACCOUNT_INACTIVE', 'x'))).toContain('inactive');
    expect(getFriendlyErrorMessage(new ApiError('UNAUTHENTICATED', 'x'))).toContain('session');
  });
});

describe('format helpers', () => {
  it('maps account types to labels without encoding behavior', () => {
    expect(accountTypeLabel('escrow')).toBe('Escrow');
    expect(accountTypeLabel('one_time_transfer')).toBe('One-time transfer');
    expect(accountTypeLabel('four_stage_verification')).toBe('Four-stage verification');
  });

  it('formats money from API amounts', () => {
    expect(formatMoney(12.5, 'USD')).toMatch(/12\.50/);
  });
});
