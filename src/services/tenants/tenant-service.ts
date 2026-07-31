import type {
  AuthenticatedAppUser,
  CreateTenantInput,
  MasterTenantSummary,
  TenantBranding,
  TenantConfiguration,
  TenantWithBranding,
  UpdateTenantInput,
} from '../../types';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { requireMasterAdmin } from '../../middleware/authorization/authorization-service';
import {
  tenantRepository,
  type TenantRepositoryPort,
} from '../../repositories/tenants/tenant-repository';

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const validateSlug = (field: string, value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!SLUG_REGEX.test(normalized)) {
    throw new ValidationError(
      `${field} must be 1–63 chars: lowercase letters, digits, hyphens`,
    );
  }
  return normalized;
};

const validateOptionalColor = (field: string, value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  if (!COLOR_REGEX.test(value)) {
    throw new ValidationError(`${field} must be a hex color like #0B3D2E`);
  }
  return value;
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
  validateOptionalColor('primaryColor', branding.primaryColor ?? undefined);
  validateOptionalColor('secondaryColor', branding.secondaryColor ?? undefined);
  validateOptionalColor('accentColor', branding.accentColor ?? undefined);

  if (branding.supportEmail != null && branding.supportEmail.trim().length > 0) {
    const email = branding.supportEmail.trim().toLowerCase();
    if (!email.includes('@') || email.indexOf('@') < 1) {
      throw new ValidationError('supportEmail must be a valid email');
    }
    next.supportEmail = email;
  }

  return next;
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
    logoUrl: bundle.branding.logoUrl,
    faviconUrl: bundle.branding.faviconUrl,
    primaryColor: bundle.branding.primaryColor,
    secondaryColor: bundle.branding.secondaryColor,
    accentColor: bundle.branding.accentColor,
    loginHeadline: bundle.branding.loginHeadline,
    loginSubtitle: bundle.branding.loginSubtitle,
    supportEmail: bundle.branding.supportEmail,
    supportPhone: bundle.branding.supportPhone,
  },
});

export const toMasterTenantSummary = (bundle: TenantWithBranding): MasterTenantSummary => ({
  id: bundle.tenant.id,
  name: bundle.tenant.name,
  slug: bundle.tenant.slug,
  status: bundle.tenant.status,
  subdomain: bundle.tenant.subdomain,
  ownerUserId: bundle.tenant.ownerUserId,
  applicationName: bundle.branding.applicationName,
  createdAt: bundle.tenant.createdAt,
  updatedAt: bundle.tenant.updatedAt,
});

/**
 * Ensures public config payloads never leak sensitive keys.
 * Used by tests and as a defensive serialization check.
 */
export const assertPublicTenantConfigSafe = (config: TenantConfiguration): void => {
  const serialized = JSON.stringify(config);
  if (
    /service_role|password|secret|pepper|code_hash|codeHash|private_key/i.test(
      serialized,
    )
  ) {
    throw new ValidationError('Tenant configuration contained forbidden fields');
  }
};

export class TenantService {
  constructor(private readonly repo: TenantRepositoryPort = tenantRepository) {}

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
      items: result.items.map(toMasterTenantSummary),
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
