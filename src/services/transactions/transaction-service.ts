import { accountRepository } from '../../repositories/accounts/account-repository';
import { transactionRepository } from '../../repositories/transactions/transaction-repository';
import { walletRepository } from '../../repositories/wallets/wallet-repository';
import type {
  AuthenticatedAppUser,
  FundWalletInput,
  FundWalletResult,
  TransactionRecord,
} from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { generateTransactionReference } from '../../utils/transaction-reference';
import {
  validateFundingAmount,
  validateIdempotencyKey,
  validateTransactionReference,
} from '../../utils/validation';
import { requireAuthenticatedUser } from '../../middleware/authorization/authorization-service';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import {
  assertSameTenant,
  assertTenantResourceAccess,
  requireActorTenantId,
  requireTenantAdmin,
} from '../../middleware/authorization/tenant-access';

export class TransactionService {
  /**
   * Admin-only fictional wallet funding.
   * Balance update and ledger insert happen atomically in PostgreSQL.
   * Replaying the same idempotency key or reference returns the original funding result.
   */
  async fundWallet(
    actor: AuthenticatedAppUser,
    input: FundWalletInput,
  ): Promise<FundWalletResult> {
    requireTenantAdmin(actor);

    const amount = validateFundingAmount(input.amount);
    const reference = validateTransactionReference(
      input.reference ?? generateTransactionReference('FND'),
    );
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);

    const wallet = await this.resolveWallet(input);
    assertSameTenant(actor, wallet.tenantId);

    const result = await transactionRepository.fundWalletAtomic({
      walletId: wallet.id,
      amount,
      reference,
      idempotencyKey,
      description: input.description?.trim() || 'Admin fictional wallet funding',
      createdBy: actor.userId,
      metadata: {
        ...(input.metadata ?? {}),
        source: 'admin_funding',
      },
    });

    return {
      wallet: result.wallet,
      transaction: result.transaction,
      idempotentReplay: result.idempotentReplay,
    };
  }

  async getTransaction(
    actor: AuthenticatedAppUser,
    transactionId: string,
  ): Promise<TransactionRecord> {
    requireAuthenticatedUser(actor);

    const transaction = await transactionRepository.findById(transactionId);
    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    await this.assertCanAccessTransaction(actor, transaction);
    return transaction;
  }

  async listWalletTransactions(
    actor: AuthenticatedAppUser,
    walletId: string,
  ): Promise<TransactionRecord[]> {
    requireAuthenticatedUser(actor);

    const wallet = await walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    assertSameTenant(actor, wallet.tenantId);
    await this.assertCanAccessAccount(actor, wallet.accountId, wallet.tenantId);
    return transactionRepository.listByWalletId(walletId);
  }

  async listAccountTransactions(
    actor: AuthenticatedAppUser,
    accountId: string,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransactionRecord[]; total: number }> {
    requireAuthenticatedUser(actor);
    await this.assertCanAccessAccount(actor, accountId);
    return transactionRepository.listByAccountId(accountId, pagination);
  }

  async adminListTransactions(
    actor: AuthenticatedAppUser,
    pagination?: { limit: number; offset: number },
  ): Promise<{ items: TransactionRecord[]; total: number }> {
    requireTenantAdmin(actor);
    const tenantId = requireActorTenantId(actor);
    return transactionRepository.listAll(tenantId, pagination);
  }

  private async resolveWallet(input: FundWalletInput) {
    if (input.walletId) {
      const wallet = await walletRepository.findById(input.walletId);
      if (!wallet) {
        throw new NotFoundError('Wallet not found');
      }
      return wallet;
    }

    if (input.accountId) {
      const wallet = await walletRepository.findByAccountId(input.accountId);
      if (!wallet) {
        throw new NotFoundError('Wallet not found for account');
      }
      return wallet;
    }

    throw new ValidationError('walletId or accountId is required for funding');
  }

  private async assertCanAccessTransaction(
    actor: AuthenticatedAppUser,
    transaction: TransactionRecord,
  ): Promise<void> {
    await this.assertCanAccessAccount(
      actor,
      transaction.accountId,
      transaction.tenantId,
    );
  }

  private async assertCanAccessAccount(
    actor: AuthenticatedAppUser,
    accountId: string,
    knownTenantId?: string | null,
  ): Promise<void> {
    const account = await accountRepository.findById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }

    const tenantId = knownTenantId ?? account.tenantId;

    if (actor.role === 'admin') {
      assertSameTenant(actor, tenantId);
      return;
    }

    const profile = await profileRepository.findById(account.profileId);
    if (!profile) {
      throw new NotFoundError('Account not found');
    }

    assertTenantResourceAccess(actor, {
      tenantId: tenantId ?? profile.tenantId,
      ownerUserId: profile.userId,
    });
  }
}

export const transactionService = new TransactionService();
