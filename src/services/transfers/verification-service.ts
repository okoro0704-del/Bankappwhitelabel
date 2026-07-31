import { transferRepository } from '../../repositories/transfers/transfer-repository';
import { verificationCodeRepository } from '../../repositories/transfers/verification-code-repository';
import type {
  AuthenticatedAppUser,
  TransferRecord,
  TransferServiceResult,
} from '../../types';
import { AuthorizationError, NotFoundError, TransferError } from '../../utils/errors';
import {
  defaultVerificationExpiry,
  generateSixDigitCode,
  hashVerificationCode,
  verificationCodesMatch,
} from '../../utils/verification-code';
import { validateVerificationCodeInput } from '../../utils/validation';
import {
  requireActiveAccount,
  requireAdmin,
  requireAuthenticatedUser,
} from '../../middleware/authorization/authorization-service';

const stageStatus = (
  stage: 1 | 2 | 3 | 4,
): TransferRecord['status'] => `verification_stage_${stage}` as TransferRecord['status'];

export class VerificationService {
  async generateVerificationCode(
    actor: AuthenticatedAppUser,
    transferId: string,
    stage?: number,
  ): Promise<{ transferId: string; stage: number; expiresAt: string }> {
    requireActiveAccount(actor);
    const transfer = await this.requireOwnedTransfer(actor, transferId);
    const targetStage = stage ?? transfer.currentStage;

    if (targetStage < 1 || targetStage > 4) {
      throw new TransferError('INVALID_TRANSFER', 'Transfer is not awaiting verification');
    }

    if (transfer.currentStage !== targetStage) {
      throw new TransferError(
        'VERIFICATION_REQUIRED',
        `Transfer is awaiting stage ${transfer.currentStage}`,
        409,
        { stage: transfer.currentStage },
      );
    }

    if (transfer.stagesCompleted >= targetStage) {
      throw new TransferError('INVALID_TRANSFER', 'Verification stage already completed');
    }

    const code = generateSixDigitCode();
    const expiresAt = defaultVerificationExpiry(15).toISOString();
    const codeHash = hashVerificationCode(code, transfer.id, targetStage);

    await verificationCodeRepository.upsertStageCode({
      transferId: transfer.id,
      stage: targetStage,
      codeHash,
      expiresAt,
    });
    await verificationCodeRepository.saveReveal({
      transferId: transfer.id,
      stage: targetStage,
      codePlaintext: code,
    });

    return {
      transferId: transfer.id,
      stage: targetStage,
      expiresAt,
    };
  }

  /**
   * Admin/dev-only plaintext peek.
   * Requires admin role AND explicit ALLOW_VERIFICATION_CODE_PEEK=true.
   * Never available through normal user APIs.
   */
  async peekVerificationCodeForTesting(
    actor: AuthenticatedAppUser,
    transferId: string,
    stage: number,
  ): Promise<{ transferId: string; stage: number; code: string }> {
    requireAdmin(actor);
    this.assertPeekAllowed();

    const code = await verificationCodeRepository.peekPlaintext(transferId, stage);
    if (!code) {
      throw new NotFoundError('Verification code reveal not found');
    }

    return { transferId, stage, code };
  }

  async getCurrentVerificationStage(
    actor: AuthenticatedAppUser,
    transferId: string,
  ): Promise<{
    transferId: string;
    status: TransferRecord['status'];
    currentStage: number;
    stagesCompleted: number;
  }> {
    requireAuthenticatedUser(actor);
    const transfer = await this.requireOwnedTransfer(actor, transferId);

    return {
      transferId: transfer.id,
      status: transfer.status,
      currentStage: transfer.currentStage,
      stagesCompleted: transfer.stagesCompleted,
    };
  }

  async verifyCode(
    actor: AuthenticatedAppUser,
    transferId: string,
    codeInput: string,
  ): Promise<TransferServiceResult> {
    requireActiveAccount(actor);
    const code = validateVerificationCodeInput(codeInput);
    const transfer = await this.requireOwnedTransfer(actor, transferId);

    if (transfer.status === 'completed') {
      throw new TransferError(
        'TRANSFER_ALREADY_COMPLETED',
        'Transfer has already been completed',
        409,
      );
    }

    if (transfer.currentStage < 1 || transfer.currentStage > 4) {
      throw new TransferError('INVALID_TRANSFER', 'Transfer is not awaiting verification');
    }

    const stage = transfer.currentStage as 1 | 2 | 3 | 4;
    const record = await verificationCodeRepository.findByTransferAndStage(
      transfer.id,
      stage,
    );

    if (!record) {
      throw new TransferError(
        'INVALID_VERIFICATION_CODE',
        'No verification code is active for this stage',
      );
    }

    if (record.consumedAt) {
      throw new TransferError(
        'INVALID_VERIFICATION_CODE',
        'Verification code has already been used',
      );
    }

    if (record.attempts >= record.maxAttempts) {
      throw new TransferError(
        'TOO_MANY_VERIFICATION_ATTEMPTS',
        'Too many verification attempts for this stage',
        429,
      );
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      await verificationCodeRepository.incrementAttempts(record.id);
      throw new TransferError('VERIFICATION_EXPIRED', 'Verification code has expired');
    }

    if (!verificationCodesMatch(code, transfer.id, stage, record.codeHash)) {
      const updated = await verificationCodeRepository.incrementAttempts(record.id);
      if (updated.attempts >= updated.maxAttempts) {
        throw new TransferError(
          'TOO_MANY_VERIFICATION_ATTEMPTS',
          'Too many verification attempts for this stage',
          429,
        );
      }
      throw new TransferError('INVALID_VERIFICATION_CODE', 'Verification code is invalid');
    }

    await verificationCodeRepository.markConsumed(record.id);

    const stagesCompleted = stage;
    if (stage < 4) {
      const nextStage = (stage + 1) as 1 | 2 | 3 | 4;
      const updated = await transferRepository.updateTransfer(transfer.id, {
        status: stageStatus(nextStage),
        currentStage: nextStage,
        stagesCompleted,
      });

      await this.generateVerificationCode(actor, updated.id, nextStage);

      return {
        status: 'verification_required',
        stage: nextStage,
        transferId: updated.id,
        reference: updated.reference,
        amount: updated.amount,
        transfer: updated,
      };
    }

    const updated = await transferRepository.updateTransfer(transfer.id, {
      status: 'verification_stage_4',
      currentStage: 4,
      stagesCompleted: 4,
    });

    return {
      status: 'verification_required',
      stage: 4,
      transferId: updated.id,
      reference: updated.reference,
      amount: updated.amount,
      transfer: updated,
    };
  }

  private assertPeekAllowed(): void {
    if (process.env.ALLOW_VERIFICATION_CODE_PEEK !== 'true') {
      throw new AuthorizationError('Verification code peek is disabled');
    }
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
}

export const verificationService = new VerificationService();
