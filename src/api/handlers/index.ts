import { profileService } from '../../services/users/profile-service';
import { accountService } from '../../services/accounts/account-service';
import { walletService } from '../../services/wallets/wallet-service';
import { transactionService } from '../../services/transactions/transaction-service';
import { transferService } from '../../services/transfers/transfer-service';
import { verificationService } from '../../services/transfers/verification-service';
import { userProvisioningService } from '../../services/users/user-provisioning-service';
import { tenantService } from '../../services/tenants/tenant-service';
import { tenantResolver } from '../../services/tenants/tenant-resolver';
import { transferRepository } from '../../repositories/transfers/transfer-repository';
import { accountRepository } from '../../repositories/accounts/account-repository';
import { walletRepository } from '../../repositories/wallets/wallet-repository';
import { profileRepository } from '../../repositories/profiles/profile-repository';
import { verificationCodeRepository } from '../../repositories/transfers/verification-code-repository';
import * as authContext from '../auth-context';
import type {
  CreateTenantApiRequest,
  CreateTransferApiRequest,
  CreateUserApiRequest,
  FundWalletApiRequest,
  SubmitVerificationApiRequest,
  UpdateProfileApiRequest,
  UpdateStatusApiRequest,
  UpdateTenantApiRequest,
} from '../contracts';
import { created, ok, runApi, type ApiResult } from '../http';
import {
  toAccountResponse,
  toMasterTenantDetailResponse,
  toMasterTenantSummaryResponse,
  toProfileResponse,
  toSessionUserResponse,
  toTenantConfigurationResponse,
  toTransactionResponse,
  toTransferActionResponse,
  toTransferResponse,
  toVerificationStageResponse,
  toWalletResponse,
} from '../mappers';
import { ValidationError } from '../../utils/errors';
import { validateAccountType } from '../../utils/validation';
import { requireAdmin } from '../../middleware/authorization/authorization-service';

export type ApiHandlerInput = {
  authorization?: string | null;
  body?: unknown;
  query?: Record<string, string | undefined>;
  params?: Record<string, string>;
  headers?: Record<string, string | undefined>;
};

const asBody = <T>(body: unknown): T => {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as T;
};

export const apiHandlers = {
  async getSession(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const profile = await profileService.getCurrentProfile(actor);
      return ok(
        toSessionUserResponse(
          profile,
          actor.accountStatus ?? profile.status,
          Boolean(actor.isMasterAdmin),
        ),
      );
    });
  },

  async getMyProfile(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const profile = await profileService.getCurrentProfile(actor);
      return ok(toProfileResponse(profile));
    });
  },

  async getMyAccount(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const account = await accountService.getOwnAccount(actor);
      const wallet = await walletService.getWalletByAccount(actor, account.id);
      return ok(toAccountResponse(account, wallet));
    });
  },

  async getMyWallet(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const wallet = await walletService.getOwnWallet(actor);
      return ok(toWalletResponse(wallet));
    });
  },

  async getMyTransactions(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const pagination = authContext.parsePagination(input.query ?? {});
      const account = await accountService.getOwnAccount(actor);
      const result = await transactionService.listAccountTransactions(
        actor,
        account.id,
        pagination,
      );
      return ok({
        items: result.items.map(toTransactionResponse),
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  async getTransaction(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transactionId', input.params?.id ?? '');
      const transaction = await transactionService.getTransaction(actor, id);
      return ok(toTransactionResponse(transaction));
    });
  },

  async createTransfer(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const body = asBody<CreateTransferApiRequest>(input.body);
      const result = await transferService.initiateTransfer(actor, {
        recipientName: body.recipientName,
        recipientAccount: body.recipientAccount,
        recipientBank: body.recipientBank,
        amount: body.amount,
        description: body.description,
        idempotencyKey: body.idempotencyKey,
      });
      return created(toTransferActionResponse(result));
    });
  },

  async getTransfer(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transferId', input.params?.id ?? '');
      const transfer = await transferService.getTransfer(actor, id);
      return ok(toTransferResponse(transfer));
    });
  },

  async getVerificationStage(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transferId', input.params?.id ?? '');
      const stage = await verificationService.getCurrentVerificationStage(actor, id);
      let expiresAt: string | undefined;
      if (stage.currentStage >= 1 && stage.currentStage <= 4) {
        const code = await verificationCodeRepository.findByTransferAndStage(
          id,
          stage.currentStage,
        );
        expiresAt = code?.expiresAt;
      }
      return ok(
        toVerificationStageResponse({
          transferId: stage.transferId,
          status: stage.status,
          currentStage: stage.currentStage,
          stagesCompleted: stage.stagesCompleted,
          expiresAt,
        }),
      );
    });
  },

  async submitVerificationCode(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transferId', input.params?.id ?? '');
      const body = asBody<SubmitVerificationApiRequest>(input.body);
      const result = await verificationService.verifyCode(actor, id, body.code);

      // After stage 4 is fully verified, auto-complete for a single authoritative API result.
      if (
        result.status === 'verification_required' &&
        result.stage === 4 &&
        result.transfer.stagesCompleted === 4
      ) {
        const completed = await transferService.completeFourStageTransfer(actor, id);
        return ok(toTransferActionResponse(completed));
      }

      return ok(toTransferActionResponse(result));
    });
  },

  async completeTransfer(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transferId', input.params?.id ?? '');
      const result = await transferService.completeFourStageTransfer(actor, id);
      return ok(toTransferActionResponse(result));
    });
  },

  async listMyTransfers(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const pagination = authContext.parsePagination(input.query ?? {});
      const result = await transferRepository.listByUserId(actor.userId, pagination);
      return ok({
        items: result.items.map(toTransferResponse),
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  // --- Admin ---

  async adminCreateUser(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const body = asBody<CreateUserApiRequest>(input.body);
      const provisioned = await userProvisioningService.provisionUser(actor, {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        username: body.username,
        accountType: validateAccountType(body.accountType),
        accountNumber: body.accountNumber,
        password: body.password,
        initialBalance: body.initialBalance,
      });
      const wallet =
        (await walletRepository.findByAccountId(provisioned.account.id)) ??
        provisioned.wallet;
      return created({
        profile: toProfileResponse(provisioned.profile),
        account: toAccountResponse(provisioned.account, wallet),
      });
    });
  },

  async adminListUsers(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const pagination = authContext.parsePagination(input.query ?? {});
      const result = await profileService.adminListProfiles(
        actor,
        input.query?.search,
        pagination,
      );

      const items = [];
      for (const profile of result.items) {
        const account = await accountRepository.findByProfileId(profile.id);
        if (!account) continue;
        const wallet = await walletRepository.findByAccountId(account.id);
        if (!wallet) continue;
        items.push({
          profile: toProfileResponse(profile),
          account: toAccountResponse(account, wallet),
        });
      }

      return ok({
        items,
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  async adminGetUser(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const userId = authContext.requireUuid('userId', input.params?.id ?? '');
      const profile = await profileService.getProfileByUserId(actor, userId);
      const account = await accountRepository.findByProfileId(profile.id);
      if (!account) {
        throw new ValidationError('Account not found', { reasonCode: 'ACCOUNT_NOT_FOUND' });
      }
      const wallet = await walletService.getWalletByAccount(actor, account.id);
      return ok({
        profile: toProfileResponse(profile),
        account: toAccountResponse(account, wallet),
      });
    });
  },

  async adminUpdateUserStatus(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const profileId = authContext.requireUuid('profileId', input.params?.id ?? '');
      const body = asBody<UpdateStatusApiRequest>(input.body);
      const profile = await profileService.adminUpdateProfileStatus(
        actor,
        profileId,
        body.status,
      );
      return ok(toProfileResponse(profile));
    });
  },

  async adminUpdateUserProfile(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      requireAdmin(actor);
      if (!actor.tenantId) {
        throw new ValidationError('Tenant membership is required for this action');
      }
      const profileId = authContext.requireUuid('profileId', input.params?.id ?? '');
      const body = asBody<UpdateProfileApiRequest>(input.body);
      const existing = await profileRepository.findById(profileId);
      if (!existing || existing.tenantId !== actor.tenantId) {
        throw new ValidationError('Profile not found');
      }
      // Admin updates via repository (status changes use dedicated endpoint).
      const updated = await profileRepository.updateProfile(profileId, {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        username: body.username,
      });
      return ok(toProfileResponse(updated));
    });
  },

  async adminFundWallet(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const body = asBody<FundWalletApiRequest>(input.body);
      const result = await transactionService.fundWallet(actor, {
        amount: body.amount,
        walletId: body.walletId,
        accountId: body.accountId,
        reference: body.reference,
        idempotencyKey: body.idempotencyKey,
        description: body.description,
      });
      return ok({
        wallet: toWalletResponse(result.wallet),
        transaction: toTransactionResponse(result.transaction),
        idempotentReplay: result.idempotentReplay,
      });
    });
  },

  async adminGetWallet(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const walletId = authContext.requireUuid('walletId', input.params?.id ?? '');
      const wallet = await walletService.getWallet(actor, walletId);
      return ok(toWalletResponse(wallet));
    });
  },

  async adminListTransactions(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const pagination = authContext.parsePagination(input.query ?? {});
      const result = await transactionService.adminListTransactions(actor, pagination);
      return ok({
        items: result.items.map(toTransactionResponse),
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  async adminListTransfers(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      requireAdmin(actor);
      if (!actor.tenantId) {
        throw new ValidationError('Tenant membership is required for this action');
      }
      const pagination = authContext.parsePagination(input.query ?? {});
      const result = await transferRepository.listAll(actor.tenantId, pagination);
      return ok({
        items: result.items.map(toTransferResponse),
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  async adminGetTransfer(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('transferId', input.params?.id ?? '');
      const transfer = await transferService.getTransfer(actor, id);
      return ok(toTransferResponse(transfer));
    });
  },

  /**
   * Isolated development peek — NOT part of normal user transfer APIs.
   * Requires admin + ALLOW_VERIFICATION_CODE_PEEK=true.
   */
  async devPeekVerificationCode(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const transferId = authContext.requireUuid('transferId', input.params?.id ?? '');
      const stage = Number(
        input.query?.stage ??
          (input.body && typeof input.body === 'object'
            ? (input.body as { stage?: number }).stage
            : undefined),
      );
      if (!Number.isInteger(stage) || stage < 1 || stage > 4) {
        throw new ValidationError('stage must be an integer between 1 and 4');
      }
      const revealed = await verificationService.peekVerificationCodeForTesting(
        actor,
        transferId,
        stage,
      );
      return ok(revealed);
    });
  },

  // --- Tenant public config + Master Admin ---

  async getTenantConfig(input: ApiHandlerInput) {
    return runApi(async () => {
      const resolved = await tenantResolver.resolve({
        hostname: input.headers?.host,
        headers: input.headers,
        query: input.query,
      });
      const config = await tenantService.getPublicConfiguration(resolved);
      return ok(toTenantConfigurationResponse(config));
    });
  },

  async masterListTenants(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const pagination = authContext.parsePagination(input.query ?? {});
      const result = await tenantService.listTenants(actor, pagination);
      return ok({
        items: result.items.map(toMasterTenantSummaryResponse),
        limit: pagination.limit,
        offset: pagination.offset,
        total: result.total,
      });
    });
  },

  async masterCreateTenant(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const body = asBody<CreateTenantApiRequest>(input.body);
      const createdTenant = await tenantService.createTenant(actor, {
        name: body.name,
        slug: body.slug,
        subdomain: body.subdomain,
        ownerUserId: body.ownerUserId,
        branding: body.branding,
      });
      return created(toMasterTenantDetailResponse(createdTenant));
    });
  },

  async masterGetTenant(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('tenantId', input.params?.id ?? '');
      const tenant = await tenantService.getTenantForMaster(actor, id);
      return ok(toMasterTenantDetailResponse(tenant));
    });
  },

  async masterUpdateTenant(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('tenantId', input.params?.id ?? '');
      const body = asBody<UpdateTenantApiRequest>(input.body);
      const updated = await tenantService.updateTenant(actor, id, {
        name: body.name,
        subdomain: body.subdomain,
        ownerUserId: body.ownerUserId,
        branding: body.branding,
      });
      return ok(toMasterTenantDetailResponse(updated));
    });
  },

  async masterActivateTenant(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('tenantId', input.params?.id ?? '');
      const updated = await tenantService.activateTenant(actor, id);
      return ok(toMasterTenantDetailResponse(updated));
    });
  },

  async masterDeactivateTenant(input: ApiHandlerInput) {
    return runApi(async () => {
      const actor = await authContext.resolveActor(input.authorization);
      const id = authContext.requireUuid('tenantId', input.params?.id ?? '');
      const updated = await tenantService.deactivateTenant(actor, id);
      return ok(toMasterTenantDetailResponse(updated));
    });
  },

  async health() {
    return ok({ status: 'ok' });
  },
};

export type ApiHandlerName = keyof typeof apiHandlers;
