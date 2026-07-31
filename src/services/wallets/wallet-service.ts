import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import { walletRepository } from '../../repositories/wallets/wallet-repository';
import type {
  AuthenticatedAppUser,
  CreateWalletInput,
  WalletRecord,
} from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { requireAuthenticatedUser } from '../../middleware/authorization/authorization-service';
import {
  assertSameTenant,
  assertTenantResourceAccess,
  requireActorTenantId,
  requireTenantAdmin,
} from '../../middleware/authorization/tenant-access';

export class WalletService {
  async createWallet(
    actor: AuthenticatedAppUser,
    input: CreateWalletInput,
  ): Promise<WalletRecord> {
    requireTenantAdmin(actor);

    const account = await accountRepository.findById(input.accountId);
    if (!account) {
      throw new NotFoundError('Account not found for wallet creation');
    }

    assertSameTenant(actor, account.tenantId);

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
      tenantId: account.tenantId,
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

    const account = await accountRepository.findById(accountId);
    return walletRepository.createWallet({
      accountId,
      tenantId: account?.tenantId ?? undefined,
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

    assertSameTenant(actor, wallet.tenantId);
    return wallet;
  }

  async adminListWallets(actor: AuthenticatedAppUser): Promise<WalletRecord[]> {
    requireTenantAdmin(actor);
    const tenantId = requireActorTenantId(actor);
    return walletRepository.listWallets(tenantId);
  }

  private async assertCanAccessWallet(
    actor: AuthenticatedAppUser,
    wallet: WalletRecord,
  ): Promise<void> {
    if (actor.role === 'admin') {
      assertSameTenant(actor, wallet.tenantId);
      return;
    }

    const account = await accountRepository.findById(wallet.accountId);
    if (!account) {
      throw new NotFoundError('Wallet not found');
    }

    const profile = await profileRepository.findById(account.profileId);
    if (!profile) {
      throw new NotFoundError('Wallet not found');
    }

    assertTenantResourceAccess(actor, {
      tenantId: wallet.tenantId ?? account.tenantId ?? profile.tenantId,
      ownerUserId: profile.userId,
    });
  }
}

export const walletService = new WalletService();
