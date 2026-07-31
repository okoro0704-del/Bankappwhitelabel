import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import { authService } from '../auth/auth-service';
import { walletService } from '../wallets/wallet-service';
import { transactionService } from '../transactions/transaction-service';
import type {
  AccountRecord,
  AccountType,
  AuthenticatedAppUser,
  ProfileRecord,
  ProvisionUserInput,
  TransactionRecord,
  UserRole,
  WalletRecord,
} from '../../types';
import { ConflictError, ValidationError } from '../../utils/errors';
import logger from '../../utils/logger';
import { generateTransactionReference } from '../../utils/transaction-reference';
import {
  throwIfDuplicate,
  validateAccountNumber,
  validateAccountType,
  validateEmail,
  validateInitialBalance,
  validateName,
  validatePhone,
  validateUsername,
} from '../../utils/validation';
import { requireAdmin } from '../../middleware/authorization/authorization-service';

export interface ProvisionedUserResult {
  profile: ProfileRecord;
  account: AccountRecord;
  wallet: WalletRecord;
  fundingTransaction?: TransactionRecord;
  temporaryPassword?: string;
}

export interface InitialAdminInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string | null;
  username: string;
  accountType?: AccountType;
  accountNumber?: string;
}

/**
 * Admin user provisioning.
 *
 * Supabase Auth and PostgreSQL are separate systems, so this service uses a
 * compensating cleanup strategy:
 * 1. Create the Auth user.
 * 2. Create profile + account rows with the service-role client.
 * 3. If database steps fail, delete the Auth user to avoid orphaned identities.
 */
export class UserProvisioningService {
  async provisionUser(
    actor: AuthenticatedAppUser,
    input: ProvisionUserInput,
    role: UserRole = 'user',
  ): Promise<ProvisionedUserResult> {
    requireAdmin(actor);
    return this.provisionInternal(input, role, actor);
  }

  /**
   * Controlled bootstrap path for the first administrator.
   * Rejects if any admin already exists — never a public self-promotion endpoint.
   */
  async provisionInitialAdmin(input: InitialAdminInput): Promise<ProvisionedUserResult> {
    const adminCount = await profileRepository.countAdmins();

    if (adminCount > 0) {
      throw new ValidationError(
        'An administrator already exists. Initial admin setup is locked.',
      );
    }

    if (!input.password || input.password.length < 8) {
      throw new ValidationError('Initial admin password must be at least 8 characters');
    }

    return this.provisionInternal(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        password: input.password,
        phone: input.phone,
        username: input.username,
        accountType: input.accountType ?? 'escrow',
        accountNumber: input.accountNumber,
      },
      'admin',
    );
  }

  private async provisionInternal(
    input: ProvisionUserInput,
    role: UserRole,
    fundingActor?: AuthenticatedAppUser,
  ): Promise<ProvisionedUserResult> {
    const firstName = validateName('firstName', input.firstName);
    const lastName = validateName('lastName', input.lastName);
    const email = validateEmail(input.email);
    const username = validateUsername(input.username);
    const phone = validatePhone(input.phone);
    const accountType = validateAccountType(input.accountType);
    const accountNumber = validateAccountNumber(input.accountNumber);
    validateInitialBalance(input.initialBalance);

    const existingEmail = await profileRepository.findByEmail(email);
    if (existingEmail) {
      throwIfDuplicate('email', email);
    }

    const existingUsername = await profileRepository.findByUsername(username);
    if (existingUsername) {
      throwIfDuplicate('username', username);
    }

    if (accountNumber) {
      const existingNumber = await accountRepository.findByAccountNumber(accountNumber);
      if (existingNumber) {
        throwIfDuplicate('accountNumber', accountNumber);
      }
    }

    const { user: authUser, temporaryPassword } = await authService.createAuthUser(
      email,
      input.password,
    );

    try {
      const profile = await profileRepository.createProfile({
        userId: authUser.id,
        firstName,
        lastName,
        email,
        phone,
        username,
        status: 'active',
        role,
      });

      const account = await accountRepository.createAccount({
        profileId: profile.id,
        accountType,
        accountNumber,
        accountStatus: 'active',
      });

      const wallet = await walletService.ensureWalletForAccount(account.id);
      let fundingTransaction: TransactionRecord | undefined;

      const initialBalance = validateInitialBalance(input.initialBalance);
      if (initialBalance != null && initialBalance > 0) {
        const actorForFunding: AuthenticatedAppUser = fundingActor ?? {
          userId: authUser.id,
          role: 'admin',
          accountStatus: 'active',
        };

        const funded = await transactionService.fundWallet(actorForFunding, {
          walletId: wallet.id,
          amount: initialBalance,
          reference: generateTransactionReference('PROV'),
          idempotencyKey: `provision-funding:${account.id}`,
          description: 'Initial fictional balance at provisioning',
        });
        fundingTransaction = funded.transaction;
      }

      return {
        profile,
        account,
        wallet: fundingTransaction
          ? { ...wallet, balance: fundingTransaction.balanceAfter }
          : wallet,
        fundingTransaction,
        temporaryPassword,
      };
    } catch (error) {
      logger.error(
        {
          authUserId: authUser.id,
          email,
          error,
        },
        'Provisioning failed after auth user creation; attempting auth cleanup',
      );

      try {
        await authService.deleteAuthUser(authUser.id);
      } catch (cleanupError) {
        logger.error(
          {
            authUserId: authUser.id,
            cleanupError,
          },
          'Auth user cleanup failed after provisioning error',
        );
      }

      if (error instanceof ConflictError || error instanceof ValidationError) {
        throw error;
      }

      throw new ValidationError('User provisioning failed and was rolled back', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

export const userProvisioningService = new UserProvisioningService();
