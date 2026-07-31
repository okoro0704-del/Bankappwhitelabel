import { apiHandlers, type ApiHandlerInput } from './handlers';
import type { ApiResult } from './http';
import type { ApiErrorBody } from './contracts';
import { NotFoundError } from '../utils/errors';
import { toApiError } from './http';

type Route = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (input: ApiHandlerInput) => Promise<ApiResult<unknown>>;
};

const route = (
  method: string,
  path: string,
  handler: (input: ApiHandlerInput) => Promise<ApiResult<unknown>>,
): Route => {
  const paramNames: string[] = [];
  const patternSource = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    method: method.toUpperCase(),
    pattern: new RegExp(`^${patternSource}$`),
    paramNames,
    handler,
  };
};

const routes: Route[] = [
  route('GET', '/health', () => apiHandlers.health()),
  route('GET', '/api/session', (input) => apiHandlers.getSession(input)),
  route('GET', '/api/me/profile', (input) => apiHandlers.getMyProfile(input)),
  route('GET', '/api/me/account', (input) => apiHandlers.getMyAccount(input)),
  route('GET', '/api/me/wallet', (input) => apiHandlers.getMyWallet(input)),
  route('GET', '/api/me/transactions', (input) => apiHandlers.getMyTransactions(input)),
  route('GET', '/api/transactions/:id', (input) => apiHandlers.getTransaction(input)),
  route('GET', '/api/me/transfers', (input) => apiHandlers.listMyTransfers(input)),
  route('POST', '/api/transfers', (input) => apiHandlers.createTransfer(input)),
  route('GET', '/api/transfers/:id', (input) => apiHandlers.getTransfer(input)),
  route('GET', '/api/transfers/:id/verification', (input) =>
    apiHandlers.getVerificationStage(input),
  ),
  route('POST', '/api/transfers/:id/verification', (input) =>
    apiHandlers.submitVerificationCode(input),
  ),
  route('POST', '/api/transfers/:id/complete', (input) =>
    apiHandlers.completeTransfer(input),
  ),

  route('POST', '/api/admin/users', (input) => apiHandlers.adminCreateUser(input)),
  route('GET', '/api/admin/users', (input) => apiHandlers.adminListUsers(input)),
  route('GET', '/api/admin/users/:id', (input) => apiHandlers.adminGetUser(input)),
  route('PATCH', '/api/admin/profiles/:id/status', (input) =>
    apiHandlers.adminUpdateUserStatus(input),
  ),
  route('PATCH', '/api/admin/profiles/:id', (input) =>
    apiHandlers.adminUpdateUserProfile(input),
  ),
  route('POST', '/api/admin/wallets/fund', (input) => apiHandlers.adminFundWallet(input)),
  route('GET', '/api/admin/wallets/:id', (input) => apiHandlers.adminGetWallet(input)),
  route('GET', '/api/admin/transactions', (input) =>
    apiHandlers.adminListTransactions(input),
  ),
  route('GET', '/api/admin/transfers', (input) => apiHandlers.adminListTransfers(input)),
  route('GET', '/api/admin/transfers/:id', (input) => apiHandlers.adminGetTransfer(input)),

  // Isolated from normal user APIs
  route('GET', '/api/dev/transfers/:id/verification-code', (input) =>
    apiHandlers.devPeekVerificationCode(input),
  ),
];

const parseQuery = (url: URL): Record<string, string | undefined> => {
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
};

export const dispatchApiRequest = async (input: {
  method: string;
  path: string;
  authorization?: string | null;
  body?: unknown;
  query?: Record<string, string | undefined>;
}): Promise<ApiResult<unknown | ApiErrorBody>> => {
  const method = input.method.toUpperCase();

  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(input.path);
    if (!match) continue;

    const params: Record<string, string> = {};
    candidate.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    });

    return candidate.handler({
      authorization: input.authorization,
      body: input.body,
      query: input.query,
      params,
    });
  }

  return toApiError(new NotFoundError(`Route not found: ${method} ${input.path}`));
};

export const dispatchFromUrl = async (input: {
  method: string;
  url: string;
  authorization?: string | null;
  body?: unknown;
}): Promise<ApiResult<unknown | ApiErrorBody>> => {
  const parsed = new URL(input.url, 'http://localhost');
  return dispatchApiRequest({
    method: input.method,
    path: parsed.pathname,
    authorization: input.authorization,
    body: input.body,
    query: parseQuery(parsed),
  });
};

export { routes };
