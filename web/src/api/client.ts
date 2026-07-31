import { ApiError } from './errors';
import type { ApiErrorBody, ApiSuccess } from '../types/api';

export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

export function setAccessTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured === undefined || configured === null) {
    return '';
  }
  return configured.replace(/\/$/, '');
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);

  if (!requestHeaders.has('Content-Type') && rest.body) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (auth) {
    const token = await tokenProvider();
    if (!token) {
      throw new ApiError('UNAUTHENTICATED', 'Authentication required', 401);
    }
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...rest,
      headers: requestHeaders,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Unable to reach the server', 0);
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('INTERNAL_ERROR', 'Unexpected response from server', response.status);
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? 'Request failed',
      response.status,
    );
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiSuccess<T>).data;
  }

  return payload as T;
}
