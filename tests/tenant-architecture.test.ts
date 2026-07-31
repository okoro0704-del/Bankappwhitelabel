import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchApiRequest } from '../src/api/router';
import * as authContext from '../src/api/auth-context';
import { InMemoryTenantRepository } from '../src/repositories/tenants/tenant-repository';
import {
  TenantService,
  assertPublicTenantConfigSafe,
  resetTenantServiceForTests,
  setTenantServiceForTests,
  toPublicTenantConfiguration,
} from '../src/services/tenants/tenant-service';
import {
  TenantResolver,
  extractTenantLabelFromHostname,
  resetTenantResolverForTests,
  setTenantResolverForTests,
} from '../src/services/tenants/tenant-resolver';
import { requireMasterAdmin } from '../src/middleware/authorization/authorization-service';
import { NORTHLINE_TENANT_ID, NORTHLINE_TENANT_SLUG } from '../src/tenants/constants';
import type { AuthenticatedAppUser, TenantBrandingRecord, TenantRecord } from '../src/types';
import { AuthorizationError, NotFoundError } from '../src/utils/errors';

const masterAdmin: AuthenticatedAppUser = {
  userId: 'master-1',
  role: 'user',
  accountStatus: 'active',
  isMasterAdmin: true,
  tenantId: NORTHLINE_TENANT_ID,
};

const tenantAdmin: AuthenticatedAppUser = {
  userId: 'admin-1',
  role: 'admin',
  accountStatus: 'active',
  isMasterAdmin: false,
  tenantId: NORTHLINE_TENANT_ID,
};

const normalUser: AuthenticatedAppUser = {
  userId: 'user-1',
  role: 'user',
  accountStatus: 'active',
  isMasterAdmin: false,
  tenantId: NORTHLINE_TENANT_ID,
};

const seedNorthline = (repo: InMemoryTenantRepository) => {
  const now = new Date().toISOString();
  const tenant: TenantRecord = {
    id: NORTHLINE_TENANT_ID,
    name: 'Northline',
    slug: NORTHLINE_TENANT_SLUG,
    status: 'active',
    ownerUserId: null,
    subdomain: 'northline',
    dnsStatus: 'pending',
    sslStatus: 'not_configured',
    deploymentStatus: 'waiting_for_dns',
    dnsCheckedAt: null,
    dnsVerifiedAt: null,
    lastProvisionedAt: null,
    sslCheckedAt: null,
    lastProvisionError: null,
    createdAt: now,
    updatedAt: now,
  };
  const branding: TenantBrandingRecord = {
    tenantId: NORTHLINE_TENANT_ID,
    applicationName: 'Northline',
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#0B3D2E',
    secondaryColor: '#1F6F56',
    accentColor: '#C4A35A',
    loginHeadline: 'Welcome to Northline',
    loginSubtitle: 'Sign in to manage your fictional account.',
    supportEmail: 'support@northline.example',
    supportPhone: null,
    createdAt: now,
    updatedAt: now,
  };
  repo.seed(tenant, branding);
};

const withTenantStack = async (
  run: (ctx: {
    repo: InMemoryTenantRepository;
    service: TenantService;
    resolver: TenantResolver;
  }) => Promise<void>,
) => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo);
  const resolver = new TenantResolver(repo);
  setTenantServiceForTests(service);
  setTenantResolverForTests(resolver);
  try {
    await run({ repo, service, resolver });
  } finally {
    resetTenantServiceForTests();
    resetTenantResolverForTests();
    authContext.resetActorResolverForTests();
  }
};

test('requireMasterAdmin accepts master and rejects tenant admin / user', () => {
  assert.equal(requireMasterAdmin(masterAdmin).isMasterAdmin, true);
  assert.throws(() => requireMasterAdmin(tenantAdmin), AuthorizationError);
  assert.throws(() => requireMasterAdmin(normalUser), AuthorizationError);
});

test('master admin can create a tenant; normal user and tenant admin cannot', async () => {
  await withTenantStack(async ({ service }) => {
    const created = await service.createTenant(masterAdmin, {
      name: 'Brand A',
      slug: 'brand-a',
      branding: { applicationName: 'Brand A Bank', primaryColor: '#112233' },
    });
    assert.equal(created.tenant.slug, 'brand-a');
    assert.equal(created.tenant.status, 'inactive');
    assert.equal(created.tenant.dnsStatus, 'pending');
    assert.equal(created.tenant.deploymentStatus, 'waiting_for_dns');
    assert.equal(created.branding.applicationName, 'Brand A Bank');

    await assert.rejects(
      () => service.createTenant(normalUser, { name: 'Nope', slug: 'nope' }),
      AuthorizationError,
    );
    await assert.rejects(
      () => service.createTenant(tenantAdmin, { name: 'Nope2', slug: 'nope2' }),
      AuthorizationError,
    );
  });
});

test('only master admin can modify tenant configuration', async () => {
  await withTenantStack(async ({ service }) => {
    const created = await service.createTenant(masterAdmin, {
      name: 'Brand B',
      slug: 'brand-b',
    });

    const updated = await service.updateTenant(masterAdmin, created.tenant.id, {
      branding: { accentColor: '#ABCDEF' },
    });
    assert.equal(updated.branding.accentColor, '#ABCDEF');

    await assert.rejects(
      () =>
        service.updateTenant(tenantAdmin, created.tenant.id, {
          branding: { accentColor: '#000000' },
        }),
      AuthorizationError,
    );

    const deactivated = await service.deactivateTenant(masterAdmin, created.tenant.id);
    assert.equal(deactivated.tenant.status, 'inactive');

    const activated = await service.activateTenant(masterAdmin, created.tenant.id);
    assert.equal(activated.tenant.status, 'active');

    await assert.rejects(
      () => service.activateTenant(normalUser, created.tenant.id),
      AuthorizationError,
    );
  });
});

test('public branding config never includes secrets', async () => {
  await withTenantStack(async ({ service, repo }) => {
    const northline = await repo.findById(NORTHLINE_TENANT_ID);
    assert.ok(northline);
    const config = await service.getPublicConfiguration(northline);
    const serialized = JSON.stringify(config);
    assert.doesNotMatch(serialized, /service_role|password|secret|pepper|codeHash/i);
    assert.equal(config.branding.applicationName, 'Northline');
    assertPublicTenantConfigSafe(config);
    assert.equal(toPublicTenantConfiguration(northline).slug, 'northline');
  });
});

test('tenant A master detail is not available to non-master callers', async () => {
  await withTenantStack(async ({ service }) => {
    const a = await service.createTenant(masterAdmin, { name: 'Tenant A', slug: 'tenant-a' });
    await assert.rejects(
      () => service.getTenantForMaster(tenantAdmin, a.tenant.id),
      AuthorizationError,
    );
    await assert.rejects(
      () => service.getTenantForMaster(normalUser, a.tenant.id),
      AuthorizationError,
    );
  });
});

test('hostname and slug resolution; unknown tenant fails safely', async () => {
  await withTenantStack(async ({ resolver, service }) => {
    process.env.TENANT_BASE_DOMAIN = process.env.TENANT_BASE_DOMAIN ?? 'app.example.com';

    assert.equal(extractTenantLabelFromHostname('brand-a.example.com'), 'brand-a');
    assert.equal(extractTenantLabelFromHostname('localhost:5173'), null);

    await service.createTenant(masterAdmin, { name: 'Brand C', slug: 'brand-c' });

    const byHost = await resolver.resolve({ hostname: 'brand-c.app.example.com' });
    assert.equal(byHost.tenant.slug, 'brand-c');

    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const byLocal = await resolver.resolve({ hostname: 'localhost' });
      assert.equal(byLocal.tenant.slug, 'northline');
    } finally {
      process.env.NODE_ENV = previousEnv;
    }

    await assert.rejects(
      () => resolver.resolve({ hostname: 'unknown.app.example.com' }),
      NotFoundError,
    );

    await assert.rejects(
      () => resolver.resolve({ hostname: 'brand-c.evil.com' }),
      NotFoundError,
    );
  });
});

test('dev X-Tenant-Slug works only when explicitly allowed outside production', async () => {
  await withTenantStack(async ({ resolver, service }) => {
    await service.createTenant(masterAdmin, { name: 'Dev Brand', slug: 'dev-brand' });

    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_DEV_TENANT_HEADER: process.env.ALLOW_DEV_TENANT_HEADER,
      TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
    };

    process.env.TENANT_BASE_DOMAIN = 'app.example.com';
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_TENANT_HEADER = 'true';
    try {
      const resolved = await resolver.resolve({
        hostname: 'localhost',
        headers: { 'x-tenant-slug': 'dev-brand' },
      });
      assert.equal(resolved.tenant.slug, 'dev-brand');
    } finally {
      process.env.NODE_ENV = previous.NODE_ENV;
      process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
    }

    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_TENANT_HEADER = 'true';
    try {
      await assert.rejects(
        () =>
          resolver.resolve({
            hostname: 'localhost',
            headers: { 'x-tenant-slug': 'dev-brand' },
          }),
        NotFoundError,
      );
    } finally {
      process.env.NODE_ENV = previous.NODE_ENV;
      process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
      if (previous.TENANT_BASE_DOMAIN === undefined) {
        delete process.env.TENANT_BASE_DOMAIN;
      } else {
        process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
      }
    }
  });
});

test('API: public tenant config and master tenant routes', async () => {
  await withTenantStack(async () => {
    const publicConfig = await dispatchApiRequest({
      method: 'GET',
      path: '/api/tenant/config',
      headers: { host: 'localhost' },
    });
    assert.equal(publicConfig.statusCode, 200);
    const publicBody = publicConfig.body as {
      data: { slug: string; branding: { applicationName: string } };
    };
    assert.equal(publicBody.data.slug, 'northline');
    assert.equal(publicBody.data.branding.applicationName, 'Northline');
    assert.doesNotMatch(JSON.stringify(publicBody), /service_role|password/i);

    authContext.setActorResolverForTests(async () => normalUser);
    const forbiddenCreate = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: { name: 'X', slug: 'x-brand' },
    });
    assert.equal(forbiddenCreate.statusCode, 403);

    authContext.setActorResolverForTests(async () => tenantAdmin);
    const forbiddenAsTenantAdmin = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: { name: 'Y', slug: 'y-brand' },
    });
    assert.equal(forbiddenAsTenantAdmin.statusCode, 403);

    authContext.setActorResolverForTests(async () => masterAdmin);
    const created = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: {
        name: 'API Brand',
        slug: 'api-brand',
        branding: { applicationName: 'API Brand App' },
      },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.body as {
      data: {
        tenant: { id: string; slug: string; status: string };
        deployment: { hostname: string; dnsStatus: string; deploymentStatus: string };
      };
    };
    assert.equal(createdBody.data.tenant.slug, 'api-brand');
    assert.equal(createdBody.data.tenant.status, 'inactive');
    assert.equal(createdBody.data.deployment.dnsStatus, 'pending');
    assert.match(createdBody.data.deployment.hostname, /api-brand\./);

    const listed = await dispatchApiRequest({
      method: 'GET',
      path: '/api/master/tenants',
    });
    assert.equal(listed.statusCode, 200);

    const activated = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${createdBody.data.tenant.id}/activate`,
    });
    assert.equal(activated.statusCode, 200);

    const deactivated = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${createdBody.data.tenant.id}/deactivate`,
    });
    assert.equal(deactivated.statusCode, 200);
  });
});

test('tenant architecture migration defines tenants and master_admins', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260731180000_tenant_architecture.sql',
    ),
    'utf8',
  );
  assert.match(sql, /create table public\.tenants/);
  assert.match(sql, /create table public\.tenant_branding/);
  assert.match(sql, /create table public\.master_admins/);
  assert.match(sql, /a0000000-0000-4000-8000-000000000001/);
  assert.match(sql, /profiles.*tenant_id|tenant_id uuid/i);
  assert.match(sql, /is_master_admin/);

  const deploySql = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260731200000_tenant_deployment.sql',
    ),
    'utf8',
  );
  assert.match(deploySql, /tenant_dns_status/);
  assert.match(deploySql, /tenant_deployment_status/);
  assert.match(deploySql, /dns_status/);
});
