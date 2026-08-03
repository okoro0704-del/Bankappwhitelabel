import { getAccessToken, getSupabase } from '../auth/supabase';
import { ApiError } from './errors';

export async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);
  }

  const { data, error } = await getSupabase().functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) {
    const ctx = error as { context?: Response; message?: string };
    if (ctx.context) {
      try {
        const payload = await ctx.context.json();
        throw new ApiError(
          payload?.error?.code ?? 'INTERNAL_ERROR',
          payload?.error?.message ?? error.message,
          ctx.context.status,
        );
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }
    throw new ApiError('NETWORK_ERROR', error.message || 'Unable to reach the server', 0);
  }

  if (data?.error?.code) {
    throw new ApiError(data.error.code, data.error.message ?? 'Request failed', 400);
  }

  if (data && typeof data === 'object' && 'data' in data) {
    return data.data as T;
  }
  return data as T;
}

export async function rpcJson<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let data: T | null = null;
  let error: { message?: string; code?: string; details?: string; hint?: string } | null = null;
  try {
    const result = await getSupabase().rpc(fn, args);
    data = result.data as T | null;
    error = result.error;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach the server';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      throw new ApiError(
        'NETWORK_ERROR',
        'Could not reach the database. If you just ran SQL migrations, wait a few seconds and try again. Also confirm VITE_SUPABASE_URL is correct.',
        0,
      );
    }
    throw new ApiError('NETWORK_ERROR', message || 'Unable to reach the server', 0);
  }

  if (error) {
    const message = error.message || 'Request failed';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      throw new ApiError(
        'NETWORK_ERROR',
        'Could not reach the database. If create-user just broke after a migration, run supabase/migrations/20260803200000_fix_admin_create_user_rpc.sql in the Supabase SQL Editor, then try again.',
        0,
      );
    }
    const code =
      message.includes('UNAUTHENTICATED')
        ? 'UNAUTHENTICATED'
        : message.includes('FORBIDDEN')
          ? 'FORBIDDEN'
          : message.includes('NOT_FOUND')
            ? 'NOT_FOUND'
            : message.includes('ACCOUNT_INACTIVE')
              ? 'ACCOUNT_INACTIVE'
              : message.includes('INSUFFICIENT_BALANCE')
                ? 'INSUFFICIENT_BALANCE'
                : message.includes('INVALID_TRANSFER_PIN')
                  ? 'INVALID_TRANSFER_PIN'
                  : message.includes('EXTERNAL_TRANSFER_NOT_ALLOWED')
                    ? 'EXTERNAL_TRANSFER_NOT_ALLOWED'
                    : message.includes('TRANSFER_LIMIT_REACHED')
                      ? 'TRANSFER_LIMIT_REACHED'
                      : message.includes('INVALID_VERIFICATION_CODE')
                        ? 'INVALID_VERIFICATION_CODE'
                        : message.includes('VERIFICATION_EXPIRED')
                          ? 'VERIFICATION_EXPIRED'
                          : message.includes('TOO_MANY_VERIFICATION_ATTEMPTS')
                            ? 'TOO_MANY_VERIFICATION_ATTEMPTS'
                            : message.includes('VERIFICATION_REQUIRED')
                              ? 'VERIFICATION_REQUIRED'
                              : message.includes('INVALID_TRANSFER')
                                ? 'INVALID_TRANSFER'
                                : message.includes('VALIDATION_ERROR')
                                  ? 'VALIDATION_ERROR'
                                  : /could not find the function|PGRST202|schema cache/i.test(message)
                                    ? 'VALIDATION_ERROR'
                                    : 'INTERNAL_ERROR';
    const cleaned = message.replace(/^.*VALIDATION_ERROR:\s*/i, '').trim() || message;
    throw new ApiError(
      code,
      code === 'VALIDATION_ERROR'
        ? /could not find the function|PGRST202|schema cache/i.test(message)
          ? 'Create-user RPC is missing or overloaded. Run supabase/migrations/20260803200000_fix_admin_create_user_rpc.sql in the Supabase SQL Editor, then try again.'
          : cleaned
        : message,
      code === 'NOT_FOUND' ? 404 : code === 'UNAUTHENTICATED' ? 401 : 400,
    );
  }
  return data as T;
}

export function throwFromPostgrest(error: { message?: string; code?: string } | null): never {
  throw new ApiError('INTERNAL_ERROR', error?.message ?? 'Request failed', 400);
}
