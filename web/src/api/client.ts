import { ApiError } from './errors';

export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Kept for AuthProvider compatibility; Edge invokes use getAccessToken directly. */
export function setAccessTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export function getTokenProvider(): TokenProvider {
  return tokenProvider;
}

/** @deprecated Prefer supabase-rpc / endpoints. Kept for tests that import apiRequest. */
export async function apiRequest<T>(
  _path: string,
  _options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  throw new ApiError(
    'API_UNREACHABLE',
    'REST API removed — use Supabase client endpoints',
    0,
  );
}
