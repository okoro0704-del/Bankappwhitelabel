import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import { walletRepository } from '../../repositories/wallets/wallet-repository';
import type {
  AuthenticatedAppUser,
  CreateWalletInput,
  WalletRecord,
} from '../../types';
import { AuthorizationError, NotFoundError, ValidationError } from '../../utils/errors';
import {
  requireAdmin,
  requireAuthenticatedUser,
} from '../../middleware/authorization/authorization-service';

export class WalletService {
  async createWallet(
    actor: AuthenticatedAppUser,
    input: CreateWalletInput,
  ): Promise<WalletRecord> {
    requireAdmin(actor);

    const account = await accountRepository.findById(input.accountId);
    if (!account) {
      throw new NotFoundError('Account not found for wallet creation');
    }

    const existing = await walletRepository.findByAccountId(account.id);
    if (existing) {
      throw new ValidationError('Account already has a wallet');
    }

    if (input.balance != null && input.balance !== 0) {
      throw new ValidationError(
        'Wallets must be created with a zero balance; use admin funding to credit funds',
      );
    }

    return walletRepository.createWallet({
      accountId: account.id,
      balance: 0,
      currency: input.currency ?? 'USD',
    });
  }

  /**
   * Ensures a zero-balance wallet exists for an account (used by provisioning).
   */
  async ensureWalletForAccount(accountId: string): Promise<WalletRecord> {
    const existing = await walletRepository.findByAccountId(accountId);
    if (existing) {
      return existing;
    }

    return walletRepository.createWallet({
      accountId,
      balance: 0,
      currency: 'USD',
    });
  }

  async getWallet(
    actor: AuthenticatedAppUser,
    walletId: string,
  ): Promise<WalletRecord> {
    requireAuthenticatedUser(actor);

    const wallet = await walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    await this.assertCanAccessWallet(actor, wallet);
    return wallet;
  }

  async getWalletByAccount(
    actor: AuthenticatedAppUser,
    accountId: string,
  ): Promise<WalletRecord> {
    requireAuthenticatedUser(actor);

    const wallet = await walletRepository.findByAccountId(accountId);
    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    await this.assertCanAccessWallet(actor, wallet);
    return wallet;
  }

  async getOwnWallet(actor: AuthenticatedAppUser): Promise<WalletRecord> {
    requireAuthenticatedUser(actor);

    const wallet = await walletRepository.findByUserId(actor.userId);
    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    return wallet;
  }

  async adminListWallets(actor: AuthenticatedAppUser): Promise<WalletRecord[]> {
    requireAdmin(actor);
    return walletRepository.listWallets();
  }

  private async assertCanAccessWallet(
    actor: AuthenticatedAppUser,
    wallet: WalletRecord,
  ): Promise<void> {
    if (actor.role === 'admin') {
      return;
    }

    const account = await accountRepository.findById(wallet.accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }

    const profile = await profileRepository.findById(account.profileId);
    if (!profile || profile.userId !== actor.userId) {
      throw new AuthorizationError('You cannot access another user wallet');
    }
  }
}

export const walletService = new WalletService();
