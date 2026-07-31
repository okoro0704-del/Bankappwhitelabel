import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import type {
  AuthenticatedAppUser,
  ProfileRecord,
  UpdateProfileInput,
} from '../../types';
import { AuthorizationError, ConflictError, NotFoundError } from '../../utils/errors';
import {
  validateName,
  validatePhone,
  validateUsername,
  validateAccountStatus,
} from '../../utils/validation';
import {
  requireActiveAccount,
  requireAuthenticatedUser,
} from '../../middleware/authorization/authorization-service';
import {
  assertSameTenant,
  assertTenantResourceAccess,
  requireActorTenantId,
  requireTenantAdmin,
} from '../../middleware/authorization/tenant-access';

const toPublicProfile = (profile: ProfileRecord): ProfileRecord => profile;

export class ProfileService {
  async getCurrentProfile(actor: AuthenticatedAppUser): Promise<ProfileRecord> {
    requireAuthenticatedUser(actor);

    const profile = await profileRepository.findByUserId(actor.userId);

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertSameTenant(actor, profile.tenantId);
    return toPublicProfile(profile);
  }

  async getProfileById(
    actor: AuthenticatedAppUser,
    profileId: string,
  ): Promise<ProfileRecord> {
    requireAuthenticatedUser(actor);

    const profile = await profileRepository.findById(profileId);

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertTenantResourceAccess(actor, {
      tenantId: profile.tenantId,
      ownerUserId: profile.userId,
    });

    return toPublicProfile(profile);
  }

  async getProfileByUserId(
    actor: AuthenticatedAppUser,
    userId: string,
  ): Promise<ProfileRecord> {
    requireAuthenticatedUser(actor);

    if (actor.role !== 'admin' && actor.userId !== userId) {
      throw new AuthorizationError('You cannot access another user profile');
    }

    const profile = await profileRepository.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertSameTenant(actor, profile.tenantId);
    return toPublicProfile(profile);
  }

  async updateOwnProfile(
    actor: AuthenticatedAppUser,
    input: UpdateProfileInput,
  ): Promise<ProfileRecord> {
    requireActiveAccount(actor);

    if (input.status !== undefined) {
      throw new AuthorizationError('Users cannot change their own status');
    }

    const profile = await profileRepository.findByUserId(actor.userId);

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertSameTenant(actor, profile.tenantId);

    const updates: UpdateProfileInput = {};

    if (input.firstName !== undefined) {
      updates.firstName = validateName('firstName', input.firstName);
    }

    if (input.lastName !== undefined) {
      updates.lastName = validateName('lastName', input.lastName);
    }

    if (input.phone !== undefined) {
      updates.phone = validatePhone(input.phone);
    }

    if (input.username !== undefined) {
      updates.username = validateUsername(input.username);

      const existing = await profileRepository.findByUsername(updates.username);
      if (existing && existing.id !== profile.id) {
        throw new ConflictError('username already exists', {
          field: 'username',
          value: updates.username,
        });
      }
    }

    return toPublicProfile(await profileRepository.updateProfile(profile.id, updates));
  }

  async adminUpdateProfileStatus(
    actor: AuthenticatedAppUser,
    profileId: string,
    status: string,
  ): Promise<ProfileRecord> {
    requireTenantAdmin(actor);

    const profile = await profileRepository.findById(profileId);

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertSameTenant(actor, profile.tenantId);

    const nextStatus = validateAccountStatus(status);
    const updated = await profileRepository.updateProfile(profile.id, {
      status: nextStatus,
    });

    const account = await accountRepository.findByProfileId(profile.id);
    if (account) {
      assertSameTenant(actor, account.tenantId);
      await accountRepository.updateAccountStatus(account.id, {
        accountStatus: nextStatus,
      });
    }

    return toPublicProfile(updated);
  }

  async adminListProfiles(
    actor: AuthenticatedAppUser,
    search?: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: ProfileRecord[]; total: number }> {
    requireTenantAdmin(actor);
    const tenantId = requireActorTenantId(actor);
    const result = await profileRepository.listProfiles(tenantId, search, pagination);
    return {
      items: result.items.map(toPublicProfile),
      total: result.total,
    };
  }

  async adminLookupByEmail(
    actor: AuthenticatedAppUser,
    email: string,
  ): Promise<ProfileRecord> {
    requireTenantAdmin(actor);

    const profile = await profileRepository.findByEmail(email.toLowerCase().trim());

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    assertSameTenant(actor, profile.tenantId);
    return toPublicProfile(profile);
  }
}

export const profileService = new ProfileService();
