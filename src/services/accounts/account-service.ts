import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import type {
  AccountRecord,
  AccountType,
  AuthenticatedAppUser,
  CreateAccountInput,
} from '../../types';
import { AuthorizationError, NotFoundError } from '../../utils/errors';
import {
  validateAccountNumber,
  validateAccountStatus,
  validateAccountType,
} from '../../utils/validation';
import {
  requireAdmin,
  requireAuthenticatedUser,
} from '../../middleware/authorization/authorization-service';

export class AccountService {
  async createAccount(
    actor: AuthenticatedAppUser,
    input: CreateAccountInput,
  ): Promise<AccountRecord> {
    requireAdmin(actor);

    const profile = await profileRepository.findById(input.profileId);

    if (!profile) {
      throw new NotFoundError('Profile not found for account creation');
    }

    const existing = await accountRepository.findByProfileId(profile.id);
    if (existing) {
      throw new AuthorizationError('Profile already has an application account');
    }

    return accountRepository.createAccount({
      profileId: profile.id,
      accountType: validateAccountType(input.accountType),
      accountNumber: validateAccountNumber(input.accountNumber),
      accountStatus: input.accountStatus
        ? validateAccountStatus(input.accountStatus)
        : 'active',
    });
  }

  async getAccount(
    actor: AuthenticatedAppUser,
    accountId: string,
  ): Promise<AccountRecord> {
    requireAuthenticatedUser(actor);

    const account = await accountRepository.findById(accountId);

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    await this.assertCanAccessAccount(actor, account);

    return account;
  }

  async getAccountByUser(
    actor: AuthenticatedAppUser,
    userId: string,
  ): Promise<AccountRecord> {
    requireAuthenticatedUser(actor);

    if (actor.role !== 'admin' && actor.userId !== userId) {
      throw new AuthorizationError('You cannot access another user account');
    }

    const account = await accountRepository.findByUserId(userId);

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    return account;
  }

  async getOwnAccount(actor: AuthenticatedAppUser): Promise<AccountRecord> {
    return this.getAccountByUser(actor, actor.userId);
  }

  async updateAccountStatus(
    actor: AuthenticatedAppUser,
    accountId: string,
    accountStatus: string,
  ): Promise<AccountRecord> {
    requireAdmin(actor);

    const account = await accountRepository.findById(accountId);

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    return accountRepository.updateAccountStatus(account.id, {
      accountStatus: validateAccountStatus(accountStatus),
    });
  }

  async getAccountType(
    actor: AuthenticatedAppUser,
    accountId: string,
  ): Promise<AccountType> {
    const account = await this.getAccount(actor, accountId);
    return account.accountType;
  }

  async adminLookupByAccountNumber(
    actor: AuthenticatedAppUser,
    accountNumber: string,
  ): Promise<AccountRecord> {
    requireAdmin(actor);

    const normalized = validateAccountNumber(accountNumber);
    if (!normalized) {
      throw new NotFoundError('Account not found');
    }

    const account = await accountRepository.findByAccountNumber(normalized);

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    return account;
  }

  async adminListAccounts(
    actor: AuthenticatedAppUser,
    search?: string,
  ): Promise<AccountRecord[]> {
    requireAdmin(actor);
    return accountRepository.listAccounts(search);
  }

  private async assertCanAccessAccount(
    actor: AuthenticatedAppUser,
    account: AccountRecord,
  ): Promise<void> {
    if (actor.role === 'admin') {
      return;
    }

    const profile = await profileRepository.findById(account.profileId);

    if (!profile || profile.userId !== actor.userId) {
      throw new AuthorizationError('You cannot access another user account');
    }
  }
}

export const accountService = new AccountService();
