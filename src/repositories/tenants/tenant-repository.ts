import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '../../config/supabase';
import { DEFAULT_NORTHLINE_BRANDING } from '../../tenants/constants';
import type {
  CreateTenantInput,
  TenantBranding,
  TenantBrandingRecord,
  TenantRecord,
  TenantStatus,
  TenantWithBranding,
  UpdateTenantInput,
} from '../../types';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';

const TENANT_COLUMNS = `
  id,
  name,
  slug,
  status,
  owner_user_id,
  subdomain,
  created_at,
  updated_at
`;

const BRANDING_COLUMNS = `
  tenant_id,
  application_name,
  logo_url,
  favicon_url,
  primary_color,
  secondary_color,
  accent_color,
  login_headline,
  login_subtitle,
  support_email,
  support_phone,
  created_at,
  updated_at
`;

export const mapTenant = (row: Record<string, unknown>): TenantRecord => ({
  id: String(row.id),
  name: String(row.name),
  slug: String(row.slug),
  status: row.status as TenantStatus,
  ownerUserId: row.owner_user_id == null ? null : String(row.owner_user_id),
  subdomain: String(row.subdomain),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const mapBranding = (row: Record<string, unknown>): TenantBrandingRecord => ({
  tenantId: String(row.tenant_id),
  applicationName: String(row.application_name),
  logoUrl: row.logo_url == null ? null : String(row.logo_url),
  faviconUrl: row.favicon_url == null ? null : String(row.favicon_url),
  primaryColor: String(row.primary_color),
  secondaryColor: String(row.secondary_color),
  accentColor: String(row.accent_color),
  loginHeadline: row.login_headline == null ? null : String(row.login_headline),
  loginSubtitle: row.login_subtitle == null ? null : String(row.login_subtitle),
  supportEmail: row.support_email == null ? null : String(row.support_email),
  supportPhone: row.support_phone == null ? null : String(row.support_phone),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const asConflictOrThrow = (
  error: { code?: string; message: string },
  field: string,
  value: string,
): never => {
  if (error.code === '23505') {
    throw new ConflictError(`${field} already exists`, { field, value });
  }
  throw new ValidationError(error.message);
};

const defaultBranding = (partial?: Partial<TenantBranding>): TenantBranding => ({
  applicationName: partial?.applicationName ?? DEFAULT_NORTHLINE_BRANDING.applicationName,
  logoUrl: partial?.logoUrl ?? null,
  faviconUrl: partial?.faviconUrl ?? null,
  primaryColor: partial?.primaryColor ?? DEFAULT_NORTHLINE_BRANDING.primaryColor,
  secondaryColor: partial?.secondaryColor ?? DEFAULT_NORTHLINE_BRANDING.secondaryColor,
  accentColor: partial?.accentColor ?? DEFAULT_NORTHLINE_BRANDING.accentColor,
  loginHeadline: partial?.loginHeadline ?? null,
  loginSubtitle: partial?.loginSubtitle ?? null,
  supportEmail: partial?.supportEmail ?? null,
  supportPhone: partial?.supportPhone ?? null,
});

export interface TenantRepositoryPort {
  create(input: CreateTenantInput): Promise<TenantWithBranding>;
  findById(id: string): Promise<TenantWithBranding | null>;
  findBySlug(slug: string): Promise<TenantWithBranding | null>;
  findBySubdomain(subdomain: string): Promise<TenantWithBranding | null>;
  list(options?: { limit?: number; offset?: number }): Promise<{
    items: TenantWithBranding[];
    total: number;
  }>;
  update(id: string, input: UpdateTenantInput): Promise<TenantWithBranding>;
  setStatus(id: string, status: TenantStatus): Promise<TenantWithBranding>;
}

/**
 * In-memory tenant store for unit tests (no Supabase).
 */
export class InMemoryTenantRepository implements TenantRepositoryPort {
  private tenants = new Map<string, TenantRecord>();
  private branding = new Map<string, TenantBrandingRecord>();

  async create(input: CreateTenantInput): Promise<TenantWithBranding> {
    const slug = input.slug.trim().toLowerCase();
    const subdomain = (input.subdomain ?? slug).trim().toLowerCase();

    for (const existing of this.tenants.values()) {
      if (existing.slug === slug) {
        throw new ConflictError('slug already exists', { field: 'slug', value: slug });
      }
      if (existing.subdomain === subdomain) {
        throw new ConflictError('subdomain already exists', {
          field: 'subdomain',
          value: subdomain,
        });
      }
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const tenant: TenantRecord = {
      id,
      name: input.name.trim(),
      slug,
      status: 'active',
      ownerUserId: input.ownerUserId ?? null,
      subdomain,
      createdAt: now,
      updatedAt: now,
    };
    const brandInput = defaultBranding({
      ...input.branding,
      applicationName: input.branding?.applicationName ?? input.name.trim(),
    });
    const branding: TenantBrandingRecord = {
      tenantId: id,
      ...brandInput,
      createdAt: now,
      updatedAt: now,
    };

    this.tenants.set(id, tenant);
    this.branding.set(id, branding);
    return { tenant, branding };
  }

  async findById(id: string): Promise<TenantWithBranding | null> {
    const tenant = this.tenants.get(id);
    const branding = this.branding.get(id);
    if (!tenant || !branding) return null;
    return { tenant, branding };
  }

  async findBySlug(slug: string): Promise<TenantWithBranding | null> {
    const normalized = slug.trim().toLowerCase();
    for (const tenant of this.tenants.values()) {
      if (tenant.slug === normalized) {
        return this.findById(tenant.id);
      }
    }
    return null;
  }

  async findBySubdomain(subdomain: string): Promise<TenantWithBranding | null> {
    const normalized = subdomain.trim().toLowerCase();
    for (const tenant of this.tenants.values()) {
      if (tenant.subdomain === normalized) {
        return this.findById(tenant.id);
      }
    }
    return null;
  }

  async list(options: { limit?: number; offset?: number } = {}): Promise<{
    items: TenantWithBranding[];
    total: number;
  }> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const all = [...this.tenants.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const slice = all.slice(offset, offset + limit);
    const items: TenantWithBranding[] = [];
    for (const tenant of slice) {
      const branding = this.branding.get(tenant.id);
      if (branding) items.push({ tenant, branding });
    }
    return { items, total: all.length };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantWithBranding> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError('Tenant not found');
    }

    if (input.subdomain) {
      const subdomain = input.subdomain.trim().toLowerCase();
      for (const other of this.tenants.values()) {
        if (other.id !== id && other.subdomain === subdomain) {
          throw new ConflictError('subdomain already exists', {
            field: 'subdomain',
            value: subdomain,
          });
        }
      }
      existing.tenant.subdomain = subdomain;
    }

    if (input.name != null) {
      existing.tenant.name = input.name.trim();
    }
    if (input.ownerUserId !== undefined) {
      existing.tenant.ownerUserId = input.ownerUserId;
    }
    existing.tenant.updatedAt = new Date().toISOString();

    if (input.branding) {
      existing.branding = {
        ...existing.branding,
        ...input.branding,
        tenantId: id,
        updatedAt: new Date().toISOString(),
      };
    }

    this.tenants.set(id, existing.tenant);
    this.branding.set(id, existing.branding);
    return existing;
  }

  async setStatus(id: string, status: TenantStatus): Promise<TenantWithBranding> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError('Tenant not found');
    }
    existing.tenant.status = status;
    existing.tenant.updatedAt = new Date().toISOString();
    this.tenants.set(id, existing.tenant);
    return existing;
  }

  /** Test helper */
  seed(tenant: TenantRecord, branding: TenantBrandingRecord): void {
    this.tenants.set(tenant.id, tenant);
    this.branding.set(tenant.id, branding);
  }

  clear(): void {
    this.tenants.clear();
    this.branding.clear();
  }
}

export class TenantRepository implements TenantRepositoryPort {
  private adminClient?: SupabaseClient;

  constructor(adminClient?: SupabaseClient) {
    this.adminClient = adminClient;
  }

  private client(): SupabaseClient {
    if (!this.adminClient) {
      this.adminClient = createSupabaseAdminClient();
    }
    return this.adminClient;
  }

  private async loadBranding(tenantId: string): Promise<TenantBrandingRecord> {
    const { data, error } = await this.client()
      .from('tenant_branding')
      .select(BRANDING_COLUMNS)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new ValidationError(error?.message ?? 'Tenant branding not found');
    }

    return mapBranding(data);
  }

  private async withBranding(tenant: TenantRecord): Promise<TenantWithBranding> {
    const branding = await this.loadBranding(tenant.id);
    return { tenant, branding };
  }

  async create(input: CreateTenantInput): Promise<TenantWithBranding> {
    const slug = input.slug.trim().toLowerCase();
    const subdomain = (input.subdomain ?? slug).trim().toLowerCase();
    const brand = defaultBranding({
      ...input.branding,
      applicationName: input.branding?.applicationName ?? input.name.trim(),
    });

    const { data, error } = await this.client()
      .from('tenants')
      .insert({
        name: input.name.trim(),
        slug,
        subdomain,
        owner_user_id: input.ownerUserId ?? null,
        status: 'active',
      })
      .select(TENANT_COLUMNS)
      .single();

    if (error || !data) {
      if (error) {
        asConflictOrThrow(error, 'slug', slug);
      }
      throw new ValidationError('Tenant creation failed');
    }

    const tenant = mapTenant(data);

    const { error: brandingError } = await this.client().from('tenant_branding').insert({
      tenant_id: tenant.id,
      application_name: brand.applicationName,
      logo_url: brand.logoUrl,
      favicon_url: brand.faviconUrl,
      primary_color: brand.primaryColor,
      secondary_color: brand.secondaryColor,
      accent_color: brand.accentColor,
      login_headline: brand.loginHeadline,
      login_subtitle: brand.loginSubtitle,
      support_email: brand.supportEmail,
      support_phone: brand.supportPhone,
    });

    if (brandingError) {
      await this.client().from('tenants').delete().eq('id', tenant.id);
      throw new ValidationError(brandingError.message);
    }

    return this.withBranding(tenant);
  }

  async findById(id: string): Promise<TenantWithBranding | null> {
    const { data, error } = await this.client()
      .from('tenants')
      .select(TENANT_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }
    if (!data) return null;
    return this.withBranding(mapTenant(data));
  }

  async findBySlug(slug: string): Promise<TenantWithBranding | null> {
    const { data, error } = await this.client()
      .from('tenants')
      .select(TENANT_COLUMNS)
      .eq('slug', slug.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }
    if (!data) return null;
    return this.withBranding(mapTenant(data));
  }

  async findBySubdomain(subdomain: string): Promise<TenantWithBranding | null> {
    const { data, error } = await this.client()
      .from('tenants')
      .select(TENANT_COLUMNS)
      .eq('subdomain', subdomain.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }
    if (!data) return null;
    return this.withBranding(mapTenant(data));
  }

  async list(options: { limit?: number; offset?: number } = {}): Promise<{
    items: TenantWithBranding[];
    total: number;
  }> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const { count, error: countError } = await this.client()
      .from('tenants')
      .select('id', { count: 'exact', head: true });

    if (countError) {
      throw new ValidationError(countError.message);
    }

    const { data, error } = await this.client()
      .from('tenants')
      .select(TENANT_COLUMNS)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new ValidationError(error.message);
    }

    const items: TenantWithBranding[] = [];
    for (const row of data ?? []) {
      items.push(await this.withBranding(mapTenant(row)));
    }

    return { items, total: count ?? items.length };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantWithBranding> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError('Tenant not found');
    }

    const tenantPatch: Record<string, unknown> = {};
    if (input.name != null) tenantPatch.name = input.name.trim();
    if (input.subdomain != null) tenantPatch.subdomain = input.subdomain.trim().toLowerCase();
    if (input.ownerUserId !== undefined) tenantPatch.owner_user_id = input.ownerUserId;

    if (Object.keys(tenantPatch).length > 0) {
      const { error } = await this.client()
        .from('tenants')
        .update(tenantPatch)
        .eq('id', id);

      if (error) {
        asConflictOrThrow(error, 'subdomain', String(tenantPatch.subdomain ?? ''));
      }
    }

    if (input.branding) {
      const brandingPatch: Record<string, unknown> = {};
      const b = input.branding;
      if (b.applicationName != null) brandingPatch.application_name = b.applicationName;
      if (b.logoUrl !== undefined) brandingPatch.logo_url = b.logoUrl;
      if (b.faviconUrl !== undefined) brandingPatch.favicon_url = b.faviconUrl;
      if (b.primaryColor != null) brandingPatch.primary_color = b.primaryColor;
      if (b.secondaryColor != null) brandingPatch.secondary_color = b.secondaryColor;
      if (b.accentColor != null) brandingPatch.accent_color = b.accentColor;
      if (b.loginHeadline !== undefined) brandingPatch.login_headline = b.loginHeadline;
      if (b.loginSubtitle !== undefined) brandingPatch.login_subtitle = b.loginSubtitle;
      if (b.supportEmail !== undefined) brandingPatch.support_email = b.supportEmail;
      if (b.supportPhone !== undefined) brandingPatch.support_phone = b.supportPhone;

      if (Object.keys(brandingPatch).length > 0) {
        const { error } = await this.client()
          .from('tenant_branding')
          .update(brandingPatch)
          .eq('tenant_id', id);

        if (error) {
          throw new ValidationError(error.message);
        }
      }
    }

    const updated = await this.findById(id);
    if (!updated) {
      throw new NotFoundError('Tenant not found');
    }
    return updated;
  }

  async setStatus(id: string, status: TenantStatus): Promise<TenantWithBranding> {
    const { data, error } = await this.client()
      .from('tenants')
      .update({ status })
      .eq('id', id)
      .select(TENANT_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new ValidationError(error.message);
    }
    if (!data) {
      throw new NotFoundError('Tenant not found');
    }

    return this.withBranding(mapTenant(data));
  }
}

export const tenantRepository = new TenantRepository();
