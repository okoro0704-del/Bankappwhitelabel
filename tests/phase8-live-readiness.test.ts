import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchApiRequest } from '../src/api/router';
import { resolveAllowedOrigin } from '../src/api/cors';
import * as authContext from '../src/api/auth-context';
import {
  assertProductionEnvSafety,
  getSafeDeploymentConfigSummary,
  ProductionConfigError,
} from '../src/config/production-guards';
import { InMemoryTenantRepository } from '../src/repositories/tenants/tenant-repository';
import {
  ManualDeploymentProvider,
  NetlifyDeploymentProvider,
  resetDeploymentProviderForTests,
  setDeploymentProviderForTests,
  type DeploymentProvider,
} from '../src/services/deployment/deployment-provider';
import { NetlifyApiClient } from '../src/services/deployment/netlify-api-client';
import { deriveDeploymentStatus, isDeploymentReady } from '../src/services/deployment/deployment-status';
import {
  TenantService,
  resetTenantServiceForTests,
  setTenantServiceForTests,
} from '../src/services/tenants/tenant-service';
import {
  TenantResolver,
  resetTenantResolverForTests,
  setTenantResolverForTests,
} from '../src/services/tenants/tenant-resolver';
import { buildTenantHostname } from '../src/tenants/hostname';
import { NORTHLINE_TENANT_ID, NORTHLINE_TENANT_SLUG } from '../src/tenants/constants';
import type { AuthenticatedAppUser, TenantBrandingRecord, TenantRecord } from '../src/types';
import { DeploymentError, NotFoundError } from '../src/utils/errors';

/**
 * Phase 8 readiness tests — mocked providers only.
 * Live Netlify/Supabase verification remains manual / flagged integration.
 */

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

const seedNorthline = (repo: InMemoryTenantRepository) => {
  const now = new Date().toISOString();
  repo.seed(
    {
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
    } satisfies TenantRecord,
    {
      tenantId: NORTHLINE_TENANT_ID,
      applicationName: 'Northline',
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#0B3D2E',
      secondaryColor: '#1F6F56',
      accentColor: '#C4A35A',
      loginHeadline: null,
      loginSubtitle: null,
      supportEmail: null,
      supportPhone: null,
      createdAt: now,
      updatedAt: now,
    } satisfies TenantBrandingRecord,
  );
};

test('safe deployment config summary never includes secrets', () => {
  const summary = getSafeDeploymentConfigSummary({
    DEPLOYMENT_PROVIDER: 'netlify',
    NETLIFY_AUTH_TOKEN: 'nfp_super_secret_token',
    NETLIFY_SITE_ID: 'site-123',
    TENANT_BASE_DOMAIN: 'customers.bank.example',
    DEPLOYMENT_DNS_TARGET: 'shared.netlify.app',
    CORS_ORIGIN: 'https://*.customers.bank.example',
  });
  const serialized = JSON.stringify(summary);
  assert.equal(summary.netlifyTokenSet, true);
  assert.equal(summary.netlifySiteIdSet, true);
  assert.doesNotMatch(serialized, /nfp_super_secret|NETLIFY_AUTH_TOKEN|service_role/i);
});

test('manual provision fails closed instead of inventing success', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo, new ManualDeploymentProvider());
  const created = await service.createTenant(masterAdmin, {
    name: 'Manual Co',
    slug: 'manual-co',
  });
  await assert.rejects(
    () => service.provisionTenant(masterAdmin, created.tenant.id),
    (error: unknown) =>
      error instanceof DeploymentError && error.reasonCode === 'DEPLOYMENT_NOT_CONFIGURED',
  );
});

test('inactive tenant can be provisioned; activation stays separate', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);

  let provisionCalls = 0;
  const provider: DeploymentProvider = {
    id: 'netlify',
    getBaseDomain: () => 'example.com',
    getDnsTarget: () => 'shared.netlify.app',
    buildHostname: (s) => buildTenantHostname(s, 'example.com'),
    verifyHostname: async (hostname) => ({
      dnsStatus: 'pending',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'pending',
    }),
    provisionHostname: async (subdomain) => {
      provisionCalls += 1;
      return {
        dnsStatus: 'pending',
        sslStatus: 'pending',
        hostname: buildTenantHostname(subdomain, 'example.com'),
        expectedTarget: 'shared.netlify.app',
        checkedAt: new Date().toISOString(),
        message: 'Provisioned; awaiting DNS/SSL verification',
        code: 'DNS_NOT_READY',
      };
    },
    verifySsl: async (hostname) => ({
      dnsStatus: 'pending',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'pending',
    }),
  };

  const service = new TenantService(repo, provider);
  const created = await service.createTenant(masterAdmin, {
    name: 'Inactive Co',
    slug: 'inactive-co',
  });
  assert.equal(created.tenant.status, 'inactive');

  const provisioned = await service.provisionTenant(masterAdmin, created.tenant.id);
  assert.equal(provisionCalls, 1);
  assert.equal(provisioned.tenant.tenant.status, 'inactive');
  assert.notEqual(provisioned.deploymentStatus, 'ready');

  // Repeat — idempotent at service/provider layer (provider may no-op).
  await service.provisionTenant(masterAdmin, created.tenant.id);
  assert.equal(provisionCalls, 2);

  const stillInactive = await service.getTenantForMaster(masterAdmin, created.tenant.id);
  assert.equal(stillInactive.tenant.status, 'inactive');
});

test('reserved and cross-tenant hostnames cannot be provisioned', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.com';
  process.env.DEPLOYMENT_DNS_TARGET = 'shared.netlify.app';

  const provider = new NetlifyDeploymentProvider({
    client: new NetlifyApiClient({
      authToken: 'test',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    }),
    siteId: 'site-1',
    resolveAny: async () => [],
    checkTls: async () => false,
  });

  await assert.rejects(
    () => provider.provisionHostname('www'),
    DeploymentError,
  );
  await assert.rejects(
    () => provider.provisionHostname('api'),
    DeploymentError,
  );

  // buildHostname only accepts labels under base domain — attacker FQDNs are not accepted as subdomain.
  await assert.rejects(
    () => provider.provisionHostname('evil.com'),
    (error: unknown) => error instanceof DeploymentError || error instanceof Error,
  );
});

test('deployment ready state machine remains strict', () => {
  assert.equal(isDeploymentReady('pending', 'verified'), false);
  assert.equal(isDeploymentReady('verified', 'pending'), false);
  assert.equal(isDeploymentReady('verified', 'failed'), false);
  assert.equal(isDeploymentReady('verified', 'verified'), true);
  assert.equal(deriveDeploymentStatus('verified', 'failed'), 'dns_configured');
  assert.equal(deriveDeploymentStatus('pending', 'not_configured'), 'waiting_for_dns');
});

test('production CORS cannot be overridden by arbitrary Origin', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  };
  process.env.NODE_ENV = 'production';
  process.env.TENANT_BASE_DOMAIN = 'customers.bank.example';
  process.env.CORS_ORIGIN =
    'https://master.bank.example,https://*.customers.bank.example';

  try {
    assert.equal(
      resolveAllowedOrigin('https://tenant-a.customers.bank.example'),
      'https://tenant-a.customers.bank.example',
    );
    assert.equal(resolveAllowedOrigin('https://evil.com'), null);
    assert.equal(resolveAllowedOrigin('https://customers.bank.example.evil.com'), null);
    assert.equal(resolveAllowedOrigin('*'), null);
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.CORS_ORIGIN === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    if (previous.TENANT_BASE_DOMAIN === undefined) delete process.env.TENANT_BASE_DOMAIN;
    else process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
  }
});

test('production hostname resolution and inactive public config', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo);
  const resolver = new TenantResolver(repo);
  setTenantServiceForTests(service);
  setTenantResolverForTests(resolver);

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
    ALLOW_DEV_TENANT_HEADER: process.env.ALLOW_DEV_TENANT_HEADER,
  };
  process.env.TENANT_BASE_DOMAIN = 'example.com';
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_DEV_TENANT_HEADER = 'true';

  try {
    const created = await service.createTenant(masterAdmin, {
      name: 'Brand Live',
      slug: 'brand-live',
      branding: { applicationName: 'Brand Live Bank' },
    });
    assert.equal(created.tenant.status, 'inactive');

    await assert.rejects(
      () => resolver.resolve({ hostname: 'brand-live.evil.com' }),
      NotFoundError,
    );
    await assert.rejects(
      () =>
        resolver.resolve({
          hostname: 'localhost',
          headers: { 'x-tenant-slug': 'brand-live' },
        }),
      NotFoundError,
    );

    const byHost = await resolver.resolve({ hostname: 'brand-live.example.com' });
    assert.equal(byHost.tenant.slug, 'brand-live');
    await assert.rejects(
      () => service.getPublicConfiguration(byHost),
      NotFoundError,
    );

    await service.activateTenant(masterAdmin, created.tenant.id);
    const active = await service.getPublicConfiguration(
      (await resolver.resolve({ hostname: 'brand-live.example.com' }))!,
    );
    assert.equal(active.branding.applicationName, 'Brand Live Bank');
    assert.doesNotMatch(JSON.stringify(active), /NETLIFY|service_role|password/i);
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
    if (previous.TENANT_BASE_DOMAIN === undefined) delete process.env.TENANT_BASE_DOMAIN;
    else process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
    resetTenantServiceForTests();
    resetTenantResolverForTests();
  }
});

test('Master cannot provision another tenant id without Master auth; tenant admin blocked', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const provider: DeploymentProvider = {
    id: 'netlify',
    getBaseDomain: () => 'example.com',
    getDnsTarget: () => 'shared.netlify.app',
    buildHostname: (s) => buildTenantHostname(s, 'example.com'),
    verifyHostname: async (hostname) => ({
      dnsStatus: 'pending',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'pending',
    }),
    provisionHostname: async (subdomain) => ({
      dnsStatus: 'pending',
      sslStatus: 'pending',
      hostname: buildTenantHostname(subdomain, 'example.com'),
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'ok',
    }),
    verifySsl: async (hostname) => ({
      dnsStatus: 'pending',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'pending',
    }),
  };
  setTenantServiceForTests(new TenantService(repo, provider));
  setDeploymentProviderForTests(provider);

  try {
    authContext.setActorResolverForTests(async () => masterAdmin);
    const a = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: { name: 'Tenant A', slug: 'tenant-a' },
    });
    const aId = (a.body as { data: { tenant: { id: string } } }).data.tenant.id;

    authContext.setActorResolverForTests(async () => tenantAdmin);
    const blocked = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${aId}/provision`,
    });
    assert.equal(blocked.statusCode, 403);

    // Arbitrary UUID still requires Master — no bypass.
    const spoof = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants/00000000-0000-4000-8000-000000000099/provision',
    });
    assert.equal(spoof.statusCode, 403);
  } finally {
    authContext.resetActorResolverForTests();
    resetTenantServiceForTests();
    resetDeploymentProviderForTests();
  }
});

test('production Netlify placeholder domains are rejected at startup validation', () => {
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'production',
        DEPLOYMENT_PROVIDER: 'netlify',
        NETLIFY_AUTH_TOKEN: 'token',
        NETLIFY_SITE_ID: 'site',
        TENANT_BASE_DOMAIN: 'app.example.com',
        DEPLOYMENT_DNS_TARGET: 'edgeserver.example.com',
        CORS_ORIGIN: 'https://*.app.example.com',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    ProductionConfigError,
  );
});

// Live Netlify / Supabase remain explicitly skipped unless env flags are set.
test('live Netlify integration is not claimed without credentials', { skip: true }, () => {
  assert.fail('Live Netlify verification was not run in this environment');
});
