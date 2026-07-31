import { accountRepository } from '../../repositories/accounts/account-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import { walletRepository } from '../../repositories/wallets/wallet-repository';
import { transferRepository } from '../../repositories/transfers/transfer-repository';
import { verificationService } from './verification-service';
import type {
  AuthenticatedAppUser,
  CreateTransferInput,
  TransferRecord,
  TransferServiceResult,
  TransactionRecord,
} from '../../types';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  TransferError,
  ValidationError,
} from '../../utils/errors';
import { generateTransactionReference } from '../../utils/transaction-reference';
import {
  validateRecipientAccount,
  validateRecipientBank,
  validateRecipientName,
  validateRequiredIdempotencyKey,
  validateTransferAmount,
} from '../../utils/validation';
import {
  requireActiveAccount,
  requireAuthenticatedUser,
} from '../../middleware/authorization/authorization-service';

const ONE_TIME_FAILURE_REASON =
  'Your transfer could not be completed. Please contact the bank for assistance.';

const ESCROW_REASON =
  'External transfers are unavailable for this account type.';

export class TransferService {
  async initiateTransfer(
    actor: AuthenticatedAppUser,
    input: CreateTransferInput,
  ): Promise<TransferServiceResult> {
    requireActiveAccount(actor);

    const recipientName = validateRecipientName(input.recipientName);
    const recipientAccount = validateRecipientAccount(input.recipientAccount);
    const recipientBank = validateRecipientBank(input.recipientBank);
    const amount = validateTransferAmount(input.amount);
    const idempotencyKey = validateRequiredIdempotencyKey(input.idempotencyKey);
    const description = input.description?.trim() || null;

    const existing = await transferRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return this.toResultFromExisting(existing, true);
    }

    const { account, wallet } = await this.resolveSenderContext(actor);

    if (account.accountStatus !== 'active') {
      throw new TransferError('ACCOUNT_INACTIVE', 'Account is not active', 403);
    }

    if (wallet.balance < amount) {
      throw new TransferError(
        'INSUFFICIENT_BALANCE',
        'Insufficient wallet balance for this transfer',
        400,
      );
    }

    const reference = generateTransactionReference('TRF');

    const createTransferSafely = async (
      inputRow: Parameters<typeof transferRepository.createTransfer>[0],
    ) => {
      try {
        return await transferRepository.createTransfer(inputRow);
      } catch (error) {
        if (error instanceof ConflictError) {
          const duplicate = await transferRepository.findByIdempotencyKey(idempotencyKey);
          if (duplicate) {
            return duplicate;
          }
        }
        throw error;
      }
    };

    if (account.accountType === 'escrow') {
      const transfer = await createTransferSafely({
        accountId: account.id,
        userId: actor.userId,
        walletId: wallet.id,
        reference,
        idempotencyKey,
        recipientName,
        recipientAccount,
        recipientBank,
        amount,
        description,
        status: 'restricted',
        currentStage: 0,
        stagesCompleted: 0,
        reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
        failureReason: ESCROW_REASON,
      });

      if (transfer.status !== 'restricted' || transfer.idempotencyKey !== idempotencyKey) {
        return this.toResultFromExisting(transfer, true);
      }

      return {
        status: 'restricted',
        reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
        reason: ESCROW_REASON,
        transferId: transfer.id,
        reference: transfer.reference,
        transfer,
      };
    }

    if (account.accountType === 'one_time_transfer') {
      if (account.oneTimeTransferUsed) {
        const transfer = await createTransferSafely({
          accountId: account.id,
          userId: actor.userId,
          walletId: wallet.id,
          reference,
          idempotencyKey,
          recipientName,
          recipientAccount,
          recipientBank,
          amount,
          description,
          status: 'failed',
          reasonCode: 'TRANSFER_LIMIT_REACHED',
          failureReason: ONE_TIME_FAILURE_REASON,
        });

        return {
          status: 'failed',
          reasonCode: 'TRANSFER_LIMIT_REACHED',
          reason: ONE_TIME_FAILURE_REASON,
          transferId: transfer.id,
          reference: transfer.reference,
          transfer,
        };
      }

      const transfer = await createTransferSafely({
        accountId: account.id,
        userId: actor.userId,
        walletId: wallet.id,
        reference,
        idempotencyKey,
        recipientName,
        recipientAccount,
        recipientBank,
        amount,
        description,
        status: 'processing',
      });

      if (transfer.status === 'completed') {
        return this.toResultFromExisting(transfer, true);
      }

      if (transfer.status === 'failed') {
        return this.toResultFromExisting(transfer, true);
      }

      try {
        const completed = await transferRepository.completeTransferDebitAtomic({
          transferId: transfer.id,
          requireOneTimeSlot: true,
          requireFourStages: false,
        });

        return {
          status: 'completed',
          transferId: completed.transfer.id,
          transactionId: completed.ledger?.id ?? '',
          reference: completed.transfer.reference,
          amount: completed.transfer.amount,
          idempotentReplay: completed.idempotentReplay,
          transfer: completed.transfer,
          transaction: completed.ledger ?? undefined,
        };
      } catch (error) {
        return this.mapCompletionFailure(error, transfer);
      }
    }

    // four_stage_verification
    const transfer = await createTransferSafely({
      accountId: account.id,
      userId: actor.userId,
      walletId: wallet.id,
      reference,
      idempotencyKey,
      recipientName,
      recipientAccount,
      recipientBank,
      amount,
      description,
      status: 'verification_stage_1',
      currentStage: 1,
      stagesCompleted: 0,
    });

    if (transfer.status !== 'verification_stage_1' || transfer.currentStage !== 1) {
      return this.toResultFromExisting(transfer, true);
    }

    await verificationService.generateVerificationCode(actor, transfer.id, 1);

    return {
      status: 'verification_required',
      stage: 1,
      transferId: transfer.id,
      reference: transfer.reference,
      amount: transfer.amount,
      transfer,
    };
  }

  async completeFourStageTransfer(
    actor: AuthenticatedAppUser,
    transferId: string,
  ): Promise<TransferServiceResult> {
    requireActiveAccount(actor);
    const transfer = await this.requireOwnedTransfer(actor, transferId);

    if (transfer.status === 'completed') {
      return this.toResultFromExisting(transfer, true);
    }

    if (transfer.stagesCompleted < 4) {
      throw new TransferError(
        'VERIFICATION_REQUIRED',
        'All four verification stages must be completed first',
        409,
        { stage: transfer.currentStage, stagesCompleted: transfer.stagesCompleted },
      );
    }

    const account = await accountRepository.findById(transfer.accountId);
    if (!account || account.accountType !== 'four_stage_verification') {
      throw new TransferError('INVALID_TRANSFER', 'Transfer is not a four-stage transfer');
    }

    try {
      const completed = await transferRepository.completeTransferDebitAtomic({
        transferId: transfer.id,
        requireOneTimeSlot: false,
        requireFourStages: true,
      });

      return {
        status: 'completed',
        transferId: completed.transfer.id,
        transactionId: completed.ledger?.id ?? '',
        reference: completed.transfer.reference,
        amount: completed.transfer.amount,
        idempotentReplay: completed.idempotentReplay,
        transfer: completed.transfer,
        transaction: completed.ledger ?? undefined,
      };
    } catch (error) {
      return this.mapCompletionFailure(error, transfer);
    }
  }

  async getTransfer(
    actor: AuthenticatedAppUser,
    transferId: string,
  ): Promise<TransferRecord> {
    requireAuthenticatedUser(actor);
    return this.requireOwnedTransfer(actor, transferId);
  }

  private async resolveSenderContext(actor: AuthenticatedAppUser) {
    const profile = await profileRepository.findByUserId(actor.userId);
    if (!profile) {
      throw new TransferError('ACCOUNT_NOT_FOUND', 'Profile not found', 404);
    }

    const account = await accountRepository.findByProfileId(profile.id);
    if (!account) {
      throw new TransferError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
    }

    const wallet = await walletRepository.findByAccountId(account.id);
    if (!wallet) {
      throw new TransferError('ACCOUNT_NOT_FOUND', 'Wallet not found', 404);
    }

    return { profile, account, wallet };
  }

  private async requireOwnedTransfer(
    actor: AuthenticatedAppUser,
    transferId: string,
  ): Promise<TransferRecord> {
    const transfer = await transferRepository.findById(transferId);
    if (!transfer) {
      throw new NotFoundError('Transfer not found');
    }

    if (actor.role !== 'admin' && transfer.userId !== actor.userId) {
      throw new AuthorizationError('You cannot access another user transfer');
    }

    return transfer;
  }

  private toResultFromExisting(
    transfer: TransferRecord,
    idempotentReplay: boolean,
  ): TransferServiceResult {
    if (transfer.status === 'restricted') {
      return {
        status: 'restricted',
        reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
        reason: transfer.failureReason ?? ESCROW_REASON,
        transferId: transfer.id,
        reference: transfer.reference,
        transfer,
      };
    }

    if (transfer.status === 'failed') {
      return {
        status: 'failed',
        reasonCode: transfer.reasonCode ?? 'INVALID_TRANSFER',
        reason: transfer.failureReason ?? 'Transfer failed',
        transferId: transfer.id,
        reference: transfer.reference,
        transfer,
      };
    }

    if (transfer.status === 'completed') {
      return {
        status: 'completed',
        transferId: transfer.id,
        transactionId: transfer.ledgerTransactionId ?? '',
        reference: transfer.reference,
        amount: transfer.amount,
        idempotentReplay,
        transfer,
      };
    }

    if (transfer.status.startsWith('verification_stage_')) {
      const stage = Math.max(1, transfer.currentStage) as 1 | 2 | 3 | 4;
      return {
        status: 'verification_required',
        stage,
        transferId: transfer.id,
        reference: transfer.reference,
        amount: transfer.amount,
        transfer,
        idempotentReplay,
      };
    }

    return {
      status: 'failed',
      reasonCode: 'DUPLICATE_REQUEST',
      reason: 'A transfer with this idempotency key already exists',
      transferId: transfer.id,
      reference: transfer.reference,
      transfer,
    };
  }

  private mapCompletionFailure(
    error: unknown,
    transfer: TransferRecord,
  ): TransferServiceResult {
    const message =
      error instanceof Error ? error.message : 'Transfer completion failed';

    if (message.includes('TRANSFER_LIMIT_REACHED')) {
      return {
        status: 'failed',
        reasonCode: 'TRANSFER_LIMIT_REACHED',
        reason: ONE_TIME_FAILURE_REASON,
        transferId: transfer.id,
        reference: transfer.reference,
      };
    }

    if (message.includes('INSUFFICIENT_BALANCE')) {
      throw new TransferError(
        'INSUFFICIENT_BALANCE',
        'Insufficient wallet balance for this transfer',
      );
    }

    if (message.includes('VERIFICATION_REQUIRED')) {
      throw new TransferError(
        'VERIFICATION_REQUIRED',
        'Verification is still required before completion',
        409,
      );
    }

    if (error instanceof TransferError || error instanceof ValidationError) {
      throw error;
    }

    throw new TransferError('INVALID_TRANSFER', 'Transfer could not be completed', 400, {
      cause: message,
    });
  }
}

export const transferService = new TransferService();
export type { TransactionRecord };
