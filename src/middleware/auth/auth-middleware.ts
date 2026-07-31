import { profileRepository } from '../../repositories/profiles/profile-repository';
import { accountRepository } from '../../repositories/accounts/account-repository';
import { authService } from '../../services/auth/auth-service';
import type { AuthenticatedAppUser } from '../../types';
import {
  AuthenticationError,
  AuthorizationError,
} from '../../utils/errors';
import {
  requireActiveAccount,
  requireAdmin,
  requireAuthenticatedUser,
} from '../authorization/authorization-service';

export {
  requireActiveAccount,
  requireAdmin,
  requireAuthenticatedUser,
} from '../authorization/authorization-service';

/**
 * Resolve the authenticated application user from a Supabase access token.
 * Role and status come from the database, never from client-supplied claims alone.
 */
export const resolveAuthenticatedAppUser = async (
  accessToken: string,
): Promise<AuthenticatedAppUser> => {
  const authUser = await authService.getUserFromAccessToken(accessToken);
  const profile = await profileRepository.findByUserId(authUser.id);

  if (!profile) {
    throw new AuthenticationError('Authenticated profile could not be resolved');
  }

  const account = await accountRepository.findByProfileId(profile.id);

  return {
    userId: profile.userId,
    role: profile.role,
    accountStatus:
      profile.status === 'suspended' || account?.accountStatus === 'suspended'
        ? 'suspended'
        : account?.accountStatus ?? profile.status,
  };
};

export const requireAuthenticatedFromToken = async (
  accessToken: string,
): Promise<AuthenticatedAppUser> => {
  return requireAuthenticatedUser(await resolveAuthenticatedAppUser(accessToken));
};

export const requireAdminFromToken = async (
  accessToken: string,
): Promise<AuthenticatedAppUser> => {
  return requireAdmin(await resolveAuthenticatedAppUser(accessToken));
};

export const requireActiveAccountFromToken = async (
  accessToken: string,
): Promise<AuthenticatedAppUser> => {
  return requireActiveAccount(await resolveAuthenticatedAppUser(accessToken));
};

export const assertNotSelfRoleChange = (
  actor: AuthenticatedAppUser,
  targetUserId: string,
  nextRole: string,
): void => {
  if (actor.userId === targetUserId && nextRole !== actor.role) {
    throw new AuthorizationError('Users cannot change their own role');
  }

  if (actor.role !== 'admin') {
    throw new AuthorizationError('Only administrators can change roles');
  }
};
