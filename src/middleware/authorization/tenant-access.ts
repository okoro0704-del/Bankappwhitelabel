import type { AuthenticatedAppUser } from '../../types';
import { AuthorizationError, NotFoundError } from '../../utils/errors';
import {
  requireAdmin,
  requireAuthenticatedUser,
} from './authorization-service';

/**
 * Require a trusted server-side tenant id on the authenticated actor.
 * Never accept client-supplied tenantId as a substitute.
 */
export const requireActorTenantId = (
  actor: AuthenticatedAppUser | null | undefined,
): string => {
  const authenticated = requireAuthenticatedUser(actor);
  if (!authenticated.tenantId) {
    throw new AuthorizationError('Tenant membership is required for this action');
  }
  return authenticated.tenantId;
};

/**
 * Tenant Admin gate: admin role + non-null tenant context.
 */
export const requireTenantAdmin = (
  actor: AuthenticatedAppUser | null | undefined,
): AuthenticatedAppUser => {
  const admin = requireAdmin(actor);
  requireActorTenantId(admin);
  return admin;
};

/**
 * Ensure a resource belongs to the actor's tenant.
 * Cross-tenant access fails as NOT FOUND to avoid leaking existence.
 */
export const assertSameTenant = (
  actor: AuthenticatedAppUser,
  resourceTenantId: string | null | undefined,
): void => {
  const tenantId = requireActorTenantId(actor);
  if (!resourceTenantId || resourceTenantId !== tenantId) {
    throw new NotFoundError('Requested resource was not found');
  }
};

/**
 * Access rule for tenant-scoped resources:
 * - Must share actor.tenantId
 * - Tenant admins may access any resource in their tenant
 * - Users may only access their own resources (when ownerUserId provided)
 */
export const assertTenantResourceAccess = (
  actor: AuthenticatedAppUser,
  resource: {
    tenantId?: string | null;
    ownerUserId?: string | null;
  },
): void => {
  requireAuthenticatedUser(actor);
  assertSameTenant(actor, resource.tenantId);

  if (actor.role === 'admin') {
    return;
  }

  if (resource.ownerUserId != null && resource.ownerUserId !== actor.userId) {
    throw new AuthorizationError('You cannot access another user resource');
  }
};
