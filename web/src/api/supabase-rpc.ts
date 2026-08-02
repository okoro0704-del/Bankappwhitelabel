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
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) {
    const message = error.message || 'Request failed';
    const code =
      message.includes('UNAUTHENTICATED')
        ? 'UNAUTHENTICATED'
        : message.includes('FORBIDDEN')
          ? 'FORBIDDEN'
          : message.includes('NOT_FOUND')
            ? 'NOT_FOUND'
            : message.includes('ACCOUNT_INACTIVE')
              ? 'ACCOUNT_INACTIVE'
              : 'INTERNAL_ERROR';
    throw new ApiError(code, message, code === 'NOT_FOUND' ? 404 : code === 'UNAUTHENTICATED' ? 401 : 400);
  }
  return data as T;
}

export function throwFromPostgrest(error: { message?: string; code?: string } | null): never {
  throw new ApiError('INTERNAL_ERROR', error?.message ?? 'Request failed', 400);
}
