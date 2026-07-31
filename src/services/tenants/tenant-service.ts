import type {
  AuthenticatedAppUser,
  CreateTenantInput,
  MasterTenantSummary,
  TenantBranding,
  TenantConfiguration,
  TenantDeploymentInfo,
  TenantWithBranding,
  UpdateTenantInput,
} from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { requireMasterAdmin } from '../../middleware/authorization/authorization-service';
import {
  tenantRepository,
  type TenantRepositoryPort,
} from '../../repositories/tenants/tenant-repository';
import {
  deploymentProvider,
  type DeploymentProvider,
} from '../deployment/deployment-provider';
import { deriveDeploymentStatus, assertDeploymentStatusConsistent } from '../deployment/deployment-status';
import {
  buildTenantLoginUrl,
  isReservedSubdomain,
  isValidSubdomain,
} from '../../tenants/hostname';
import {
  isSafeHexColor,
  sanitizeBrandingPublicUrl,
  sanitizeBrandingText,
} from '../../tenants/branding-safe';

const validateSlug = (field: string, value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!isValidSubdomain(normalized)) {
    throw new ValidationError(
      `${field} must be 1–63 chars: lowercase letters, digits, hyphens`,
    );
  }
  if (isReservedSubdomain(normalized)) {
    throw new ValidationError(`${field} "${normalized}" is reserved`);
  }
  if (
    normalized.includes('/') ||
    normalized.includes(':') ||
    normalized.includes('?') ||
    normalized.includes(' ') ||
    normalized.includes('.')
  ) {
    throw new ValidationError(`${field} contains invalid characters`);
  }
  return normalized;
};

const validateOptionalColor = (field: string, value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  if (!isSafeHexColor(value)) {
    throw new ValidationError(`${field} must be a hex color like #0B3D2E`);
  }
  return value.trim().toUpperCase();
};

const validateOptionalPublicUrl = (
  field: string,
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const safe = sanitizeBrandingPublicUrl(value);
  if (!safe) {
    throw new ValidationError(`${field} must be an absolute http(s) URL`);
  }
  return safe;
};

const validateBrandingPatch = (branding?: Partial<TenantBranding>): Partial<TenantBranding> | undefined => {
  if (!branding) return undefined;

  const next: Partial<TenantBranding> = { ...branding };
  if (branding.applicationName != null) {
    const name = branding.applicationName.trim();
    if (name.length < 2 || name.length > 120) {
      throw new ValidationError('applicationName must be between 2 and 120 characters');
    }
    next.applicationName = name;
  }
  const primary = validateOptionalColor('primaryColor', branding.primaryColor ?? undefined);
  const secondary = validateOptionalColor('secondaryColor', branding.secondaryColor ?? undefined);
  const accent = validateOptionalColor('accentColor', branding.accentColor ?? undefined);
  if (primary !== undefined) next.primaryColor = primary;
  if (secondary !== undefined) next.secondaryColor = secondary;
  if (accent !== undefined) next.accentColor = accent;

  if (branding.logoUrl !== undefined) {
    next.logoUrl = validateOptionalPublicUrl('logoUrl', branding.logoUrl) ?? null;
  }
  if (branding.faviconUrl !== undefined) {
    next.faviconUrl = validateOptionalPublicUrl('faviconUrl', branding.faviconUrl) ?? null;
  }

  if (branding.loginHeadline !== undefined) {
    next.loginHeadline = sanitizeBrandingText(branding.loginHeadline);
  }
  if (branding.loginSubtitle !== undefined) {
    next.loginSubtitle = sanitizeBrandingText(branding.loginSubtitle);
  }

  if (branding.supportEmail != null && branding.supportEmail.trim().length > 0) {
    const email = branding.supportEmail.trim().toLowerCase();
    if (!email.includes('@') || email.indexOf('@') < 1) {
      throw new ValidationError('supportEmail must be a valid email');
    }
    next.supportEmail = email;
  }

  return next;
};

export const buildTenantDeploymentInfo = (
  bundle: TenantWithBranding,
  provider: DeploymentProvider = deploymentProvider,
): TenantDeploymentInfo => {
  const hostname = provider.buildHostname(bundle.tenant.subdomain);
  const dnsTarget = provider.getDnsTarget();
  return {
    hostname,
    loginUrl: buildTenantLoginUrl(hostname),
    baseDomain: provider.getBaseDomain(),
    dnsTarget,
    dnsStatus: bundle.tenant.dnsStatus,
    sslStatus: bundle.tenant.sslStatus,
    deploymentStatus: deriveDeploymentStatus(
      bundle.tenant.dnsStatus,
      bundle.tenant.sslStatus,
    ),
    dnsRecord: {
      type: 'CNAME',
      name: bundle.tenant.subdomain,
      target: dnsTarget,
    },
    dnsCheckedAt: bundle.tenant.dnsCheckedAt,
    dnsVerifiedAt: bundle.tenant.dnsVerifiedAt,
    lastProvisionedAt: bundle.tenant.lastProvisionedAt,
    sslCheckedAt: bundle.tenant.sslCheckedAt,
    lastProvisionError: bundle.tenant.lastProvisionError,
    ownerAssigned: Boolean(bundle.tenant.ownerUserId),
    provider: provider.id,
  };
};

export const toPublicTenantConfiguration = (
  bundle: TenantWithBranding,
): TenantConfiguration => ({
  tenantId: bundle.tenant.id,
  name: bundle.tenant.name,
  slug: bundle.tenant.slug,
  status: bundle.tenant.status,
  subdomain: bundle.tenant.subdomain,
  branding: {
    applicationName: bundle.branding.applicationName,
    logoUrl: sanitizeBrandingPublicUrl(bundle.branding.logoUrl),
    faviconUrl: sanitizeBrandingPublicUrl(bundle.branding.faviconUrl),
    primaryColor: isSafeHexColor(bundle.branding.primaryColor)
      ? bundle.branding.primaryColor.trim().toUpperCase()
      : '#0B3D2E',
    secondaryColor: isSafeHexColor(bundle.branding.secondaryColor)
      ? bundle.branding.secondaryColor.trim().toUpperCase()
      : '#1F6F56',
    accentColor: isSafeHexColor(bundle.branding.accentColor)
      ? bundle.branding.accentColor.trim().toUpperCase()
      : '#C4A35A',
    loginHeadline: sanitizeBrandingText(bundle.branding.loginHeadline),
    loginSubtitle: sanitizeBrandingText(bundle.branding.loginSubtitle),
    supportEmail: bundle.branding.supportEmail,
    supportPhone: sanitizeBrandingText(bundle.branding.supportPhone, 40),
  },
});

export const toMasterTenantSummary = (
  bundle: TenantWithBranding,
  provider: DeploymentProvider = deploymentProvider,
): MasterTenantSummary => {
  const deployment = buildTenantDeploymentInfo(bundle, provider);
  return {
    id: bundle.tenant.id,
    name: bundle.tenant.name,
    slug: bundle.tenant.slug,
    status: bundle.tenant.status,
    subdomain: bundle.tenant.subdomain,
    hostname: deployment.hostname,
    ownerUserId: bundle.tenant.ownerUserId,
    ownerAssigned: deployment.ownerAssigned,
    applicationName: bundle.branding.applicationName,
    dnsStatus: deployment.dnsStatus,
    sslStatus: deployment.sslStatus,
    deploymentStatus: deployment.deploymentStatus,
    createdAt: bundle.tenant.createdAt,
    updatedAt: bundle.tenant.updatedAt,
  };
};

/**
 * Ensures public config payloads never leak sensitive keys.
 * Used by tests and as a defensive serialization check.
 */
export const assertPublicTenantConfigSafe = (config: TenantConfiguration): void => {
  const serialized = JSON.stringify(config);
  if (
    /service_role|password|secret|pepper|code_hash|codeHash|private_key|netlify_auth|NETLIFY_AUTH/i.test(
      serialized,
    )
  ) {
    throw new ValidationError('Tenant configuration contained forbidden fields');
  }
};

export type DnsVerificationResult = {
  dnsStatus: TenantWithBranding['tenant']['dnsStatus'];
  sslStatus: TenantWithBranding['tenant']['sslStatus'];
  hostname: string;
  expectedTarget: string;
  checkedAt: string;
  message: string;
  code?: string;
  deploymentStatus: ReturnType<typeof deriveDeploymentStatus>;
  tenant: TenantWithBranding;
};

export class TenantService {
  constructor(
    private readonly repo: TenantRepositoryPort = tenantRepository,
    private readonly deployments: DeploymentProvider = deploymentProvider,
  ) {}

  async createTenant(
    actor: AuthenticatedAppUser,
    input: CreateTenantInput,
  ): Promise<TenantWithBranding> {
    requireMasterAdmin(actor);

    const name = input.name?.trim();
    if (!name || name.length < 2 || name.length > 120) {
      throw new ValidationError('name must be between 2 and 120 characters');
    }

    const slug = validateSlug('slug', input.slug);
    const subdomain = validateSlug('subdomain', input.subdomain ?? slug);
    const branding = validateBrandingPatch(input.branding);

    return this.repo.create({
      name,
      slug,
      subdomain,
      ownerUserId: input.ownerUserId ?? null,
      branding,
    });
  }

  async listTenants(
    actor: AuthenticatedAppUser,
    pagination: { limit: number; offset: number },
  ): Promise<{ items: MasterTenantSummary[]; total: number }> {
    requireMasterAdmin(actor);
    const result = await this.repo.list(pagination);
    return {
      items: result.items.map((item) => toMasterTenantSummary(item, this.deployments)),
      total: result.total,
    };
  }

  async getTenantForMaster(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<TenantWithBranding> {
    requireMasterAdmin(actor);
    const found = await this.repo.findById(tenantId);
    if (!found) {
      throw new NotFoundError('Tenant not found');
    }
    return found;
  }

  async updateTenant(
    actor: AuthenticatedAppUser,
    tenantId: string,
    input: UpdateTenantInput,
  ): Promise<TenantWithBranding> {
    requireMasterAdmin(actor);

    const patch: UpdateTenantInput = {};
    if (input.name != null) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 120) {
        throw new ValidationError('name must be between 2 and 120 characters');
      }
      patch.name = name;
    }
    if (input.subdomain != null) {
      patch.subdomain = validateSlug('subdomain', input.subdomain);
    }
    if (input.ownerUserId !== undefined) {
      patch.ownerUserId = input.ownerUserId;
    }
    if (input.branding) {
      patch.branding = validateBrandingPatch(input.branding);
    }

    return this.repo.update(tenantId, patch);
  }

  async activateTenant(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<TenantWithBranding> {
    requireMasterAdmin(actor);
    return this.repo.setStatus(tenantId, 'active');
  }

  async deactivateTenant(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<TenantWithBranding> {
    requireMasterAdmin(actor);
    return this.repo.setStatus(tenantId, 'inactive');
  }

  async verifyTenantDns(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<DnsVerificationResult> {
    requireMasterAdmin(actor);
    const found = await this.repo.findById(tenantId);
    if (!found) {
      throw new NotFoundError('Tenant not found');
    }

    const hostname = this.deployments.buildHostname(found.tenant.subdomain);
    const outcome = await this.deployments.verifyHostname(hostname);
    return this.persistDeploymentOutcome(tenantId, found, outcome, {
      touchProvision: false,
      touchSsl: outcome.dnsStatus === 'verified',
    });
  }

  async verifyTenantSsl(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<DnsVerificationResult> {
    requireMasterAdmin(actor);
    const found = await this.repo.findById(tenantId);
    if (!found) {
      throw new NotFoundError('Tenant not found');
    }

    const hostname = this.deployments.buildHostname(found.tenant.subdomain);
    const outcome = await this.deployments.verifySsl(hostname);
    return this.persistDeploymentOutcome(tenantId, found, outcome, {
      touchProvision: false,
      touchSsl: true,
    });
  }

  async provisionTenant(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<DnsVerificationResult> {
    requireMasterAdmin(actor);
    const found = await this.repo.findById(tenantId);
    if (!found) {
      throw new NotFoundError('Tenant not found');
    }

    try {
      const outcome = await this.deployments.provisionHostname(found.tenant.subdomain);
      return this.persistDeploymentOutcome(tenantId, found, outcome, {
        touchProvision: true,
        touchSsl: true,
        clearErrorOnSuccess: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 240) : 'Provisioning failed';

      await this.repo.updateDeployment(tenantId, {
        dnsStatus: found.tenant.dnsStatus,
        sslStatus: found.tenant.sslStatus,
        deploymentStatus: deriveDeploymentStatus(
          found.tenant.dnsStatus,
          found.tenant.sslStatus,
        ),
        dnsCheckedAt: found.tenant.dnsCheckedAt,
        dnsVerifiedAt: found.tenant.dnsVerifiedAt,
        lastProvisionedAt: new Date().toISOString(),
        lastProvisionError: message,
      });

      throw error;
    }
  }

  async getDeploymentForMaster(
    actor: AuthenticatedAppUser,
    tenantId: string,
  ): Promise<TenantDeploymentInfo> {
    const bundle = await this.getTenantForMaster(actor, tenantId);
    return this.getDeploymentInfo(bundle);
  }

  private async persistDeploymentOutcome(
    tenantId: string,
    previous: TenantWithBranding,
    outcome: {
      dnsStatus: TenantWithBranding['tenant']['dnsStatus'];
      sslStatus: TenantWithBranding['tenant']['sslStatus'];
      hostname: string;
      expectedTarget: string;
      checkedAt: string;
      message: string;
      code?: string;
    },
    options: {
      touchProvision: boolean;
      touchSsl: boolean;
      clearErrorOnSuccess?: boolean;
    },
  ): Promise<DnsVerificationResult> {
    const deploymentStatus = deriveDeploymentStatus(outcome.dnsStatus, outcome.sslStatus);
    assertDeploymentStatusConsistent(outcome.dnsStatus, outcome.sslStatus, deploymentStatus);
    const dnsVerifiedAt =
      outcome.dnsStatus === 'verified' ? outcome.checkedAt : previous.tenant.dnsVerifiedAt;

    const success =
      options.clearErrorOnSuccess &&
      (outcome.dnsStatus === 'verified' || outcome.dnsStatus === 'pending') &&
      outcome.code !== 'DEPLOYMENT_CONFLICT';

    const updated = await this.repo.updateDeployment(tenantId, {
      dnsStatus: outcome.dnsStatus,
      sslStatus: outcome.sslStatus,
      deploymentStatus,
      dnsCheckedAt: outcome.checkedAt,
      dnsVerifiedAt: outcome.dnsStatus === 'verified' ? dnsVerifiedAt : null,
      lastProvisionedAt: options.touchProvision
        ? outcome.checkedAt
        : previous.tenant.lastProvisionedAt,
      sslCheckedAt: options.touchSsl ? outcome.checkedAt : previous.tenant.sslCheckedAt,
      lastProvisionError: success
        ? null
        : outcome.code && outcome.dnsStatus === 'failed'
          ? outcome.message.slice(0, 240)
          : previous.tenant.lastProvisionError,
    });

    return {
      ...outcome,
      deploymentStatus,
      tenant: updated,
    };
  }

  getDeploymentInfo(bundle: TenantWithBranding): TenantDeploymentInfo {
    return buildTenantDeploymentInfo(bundle, this.deployments);
  }

  /**
   * Public branding/config for the resolved tenant.
   * Inactive tenants are not exposed on the public path.
   */
  async getPublicConfiguration(bundle: TenantWithBranding): Promise<TenantConfiguration> {
    if (bundle.tenant.status !== 'active') {
      throw new NotFoundError('Tenant not found');
    }
    const config = toPublicTenantConfiguration(bundle);
    assertPublicTenantConfigSafe(config);
    return config;
  }

  async findById(tenantId: string): Promise<TenantWithBranding | null> {
    return this.repo.findById(tenantId);
  }

  async findBySlug(slug: string): Promise<TenantWithBranding | null> {
    return this.repo.findBySlug(slug);
  }

  async findBySubdomain(subdomain: string): Promise<TenantWithBranding | null> {
    return this.repo.findBySubdomain(subdomain);
  }
}

const defaultTenantService = new TenantService();
let activeTenantService: TenantService = defaultTenantService;

/** Production singleton — delegates to the active service instance. */
export const tenantService: TenantService = new Proxy({} as TenantService, {
  get(_target, prop, _receiver) {
    const value = Reflect.get(activeTenantService, prop, activeTenantService);
    return typeof value === 'function' ? value.bind(activeTenantService) : value;
  },
});

export const setTenantServiceForTests = (service: TenantService): void => {
  activeTenantService = service;
};

export const resetTenantServiceForTests = (): void => {
  activeTenantService = defaultTenantService;
};
