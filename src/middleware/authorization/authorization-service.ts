import type { AuthenticatedAppUser } from '../../types';
import {
  AuthenticationError,
  AuthorizationError,
} from '../../utils/errors';

export const requireAuthenticatedUser = (
  user: AuthenticatedAppUser | null | undefined,
): AuthenticatedAppUser => {
  if (!user) {
    throw new AuthenticationError();
  }

  return user;
};

export const requireAdmin = (
  user: AuthenticatedAppUser | null | undefined,
): AuthenticatedAppUser => {
  const authenticatedUser = requireAuthenticatedUser(user);

  if (authenticatedUser.role !== 'admin') {
    throw new AuthorizationError('Administrator access is required');
  }

  if (authenticatedUser.accountStatus === 'suspended') {
    throw new AuthorizationError('Suspended administrators cannot perform this action');
  }

  return authenticatedUser;
};

/**
 * Master Admin is platform-level (master_admins table), not profiles.role.
 * Tenant admins and owners do not automatically receive this privilege.
 */
export const requireMasterAdmin = (
  user: AuthenticatedAppUser | null | undefined,
): AuthenticatedAppUser => {
  const authenticatedUser = requireAuthenticatedUser(user);

  if (!authenticatedUser.isMasterAdmin) {
    throw new AuthorizationError('Master administrator access is required');
  }

  if (authenticatedUser.accountStatus === 'suspended') {
    throw new AuthorizationError('Suspended accounts cannot perform master actions');
  }

  return authenticatedUser;
};

export const requireActiveAccount = (
  user: AuthenticatedAppUser | null | undefined,
): AuthenticatedAppUser => {
  const authenticatedUser = requireAuthenticatedUser(user);

  if (authenticatedUser.accountStatus === 'suspended') {
    throw new AuthorizationError('Suspended accounts cannot perform this action');
  }

  return authenticatedUser;
};
