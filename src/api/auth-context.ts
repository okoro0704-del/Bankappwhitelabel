import { resolveAuthenticatedAppUser } from '../middleware/auth/auth-middleware';
import type { AuthenticatedAppUser } from '../types';
import { AuthenticationError, ValidationError } from '../utils/errors';

export const extractBearerToken = (
  authorizationHeader?: string | null,
): string => {
  if (!authorizationHeader || authorizationHeader.trim().length === 0) {
    throw new AuthenticationError('Authentication required');
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    throw new AuthenticationError('Bearer access token is required');
  }

  return token;
};

export const resolveActorFromAuthHeader = async (
  authorizationHeader?: string | null,
): Promise<AuthenticatedAppUser> => {
  const token = extractBearerToken(authorizationHeader);
  return resolveAuthenticatedAppUser(token);
};

/** Test-only override hook — never used by production routes directly. */
let actorResolver = resolveActorFromAuthHeader;

export const resolveActor = (
  authorizationHeader?: string | null,
): Promise<AuthenticatedAppUser> => actorResolver(authorizationHeader);

export const setActorResolverForTests = (
  resolver: typeof resolveActorFromAuthHeader,
): void => {
  actorResolver = resolver;
};

export const resetActorResolverForTests = (): void => {
  actorResolver = resolveActorFromAuthHeader;
};

export const requireUuid = (field: string, value: string): string => {
  const normalized = value?.trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!normalized || !uuidRegex.test(normalized)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }

  return normalized;
};

export const parsePagination = (query: {
  limit?: string | number;
  offset?: string | number;
}): { limit: number; offset: number } => {
  const limitRaw = query.limit == null ? 20 : Number(query.limit);
  const offsetRaw = query.offset == null ? 0 : Number(query.offset);

  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
    throw new ValidationError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offsetRaw) || offsetRaw < 0) {
    throw new ValidationError('offset must be a non-negative integer');
  }

  return { limit: limitRaw, offset: offsetRaw };
};
