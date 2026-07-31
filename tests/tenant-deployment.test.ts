import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchApiRequest } from '../src/api/router';
import * as authContext from '../src/api/auth-context';
import { getDeploymentEnvConfig } from '../src/config/deployment';
import { InMemoryTenantRepository } from '../src/repositories/tenants/tenant-repository';
import {
  ManualDeploymentProvider,
  resetDeploymentProviderForTests,
  setDeploymentProviderForTests,
  type DeploymentProvider,
} from '../src/services/deployment/deployment-provider';
import { deriveDeploymentStatus } from '../src/services/deployment/deployment-status';
import {
  TenantService,
  resetTenantServiceForTests,
  setTenantServiceForTests,
} from '../src/services/tenants/tenant-service';
import {
  buildTenantHostname,
  buildTenantLoginUrl,
  isValidSubdomain,
} from '../src/tenants/hostname';
import { NORTHLINE_TENANT_ID, NORTHLINE_TENANT_SLUG } from '../src/tenants/constants';
import type { AuthenticatedAppUser, TenantBrandingRecord, TenantRecord } from '../src/types';
import { AuthorizationError } from '../src/utils/errors';

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
    loginHeadline: 'Welcome',
    loginSubtitle: 'Sign in',
    supportEmail: null,
    supportPhone: null,
    createdAt: now,
    updatedAt: now,
  };
  repo.seed(tenant, branding);
};

test('hostname generation builds expected FQDN', () => {
  assert.equal(
    buildTenantHostname('capitaltrust', 'app.example.com'),
    'capitaltrust.app.example.com',
  );
  assert.equal(
    buildTenantLoginUrl('capitaltrust.app.example.com'),
    'https://capitaltrust.app.example.com/login',
  );
  assert.equal(isValidSubdomain('capitaltrust'), true);
  assert.equal(isValidSubdomain('-bad'), false);
  assert.throws(() => buildTenantHostname('BAD_LABEL!', 'app.example.com'));
  assert.throws(() => buildTenantHostname('ok', 'https://evil.example'));
});

test('deployment status never reports ready without verified DNS and SSL', () => {
  assert.equal(deriveDeploymentStatus('not_configured', 'not_configured'), 'not_configured');
  assert.equal(deriveDeploymentStatus('pending', 'not_configured'), 'waiting_for_dns');
  assert.equal(deriveDeploymentStatus('failed', 'not_configured'), 'waiting_for_dns');
  assert.equal(deriveDeploymentStatus('verified', 'not_configured'), 'dns_configured');
  assert.equal(deriveDeploymentStatus('verified', 'pending'), 'ssl_pending');
  assert.equal(deriveDeploymentStatus('verified', 'verified'), 'ready');
  assert.notEqual(deriveDeploymentStatus('pending', 'verified'), 'ready');
});

test('deployment env config exposes base domain and DNS target without secrets', () => {
  const config = getDeploymentEnvConfig({
    TENANT_BASE_DOMAIN: 'app.example.com',
    DEPLOYMENT_DNS_TARGET: 'edgeserver.example.com',
  });
  assert.equal(config.baseDomain, 'app.example.com');
  assert.equal(config.dnsTarget, 'edgeserver.example.com');
  assert.doesNotMatch(JSON.stringify(config), /service_role|password|secret/i);
});

test('DNS verification updates tenant deployment state from provider result', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);

  const fakeProvider: DeploymentProvider = {
    id: 'manual',
    getBaseDomain: () => 'app.example.com',
    getDnsTarget: () => 'edgeserver.example.com',
    buildHostname: (subdomain) => buildTenantHostname(subdomain, 'app.example.com'),
    verifyHostname: async (hostname) => ({
      dnsStatus: 'verified',
      sslStatus: 'pending',
      hostname,
      expectedTarget: 'edgeserver.example.com',
      checkedAt: '2026-07-31T12:00:00.000Z',
      message: 'DNS points at the expected target. SSL has not been verified yet.',
    }),
    provisionHostname: async (subdomain) => ({
      dnsStatus: 'pending',
      sslStatus: 'not_configured',
      hostname: buildTenantHostname(subdomain, 'app.example.com'),
      expectedTarget: 'edgeserver.example.com',
      checkedAt: '2026-07-31T12:00:00.000Z',
      message: 'Manual provider',
      code: 'DEPLOYMENT_NOT_CONFIGURED',
    }),
    verifySsl: async (hostname) => ({
      dnsStatus: 'verified',
      sslStatus: 'pending',
      hostname,
      expectedTarget: 'edgeserver.example.com',
      checkedAt: '2026-07-31T12:00:00.000Z',
      message: 'SSL pending',
      code: 'SSL_NOT_READY',
    }),
  };

  setDeploymentProviderForTests(fakeProvider);
  const service = new TenantService(repo, fakeProvider);
  setTenantServiceForTests(service);

  try {
    const created = await service.createTenant(masterAdmin, {
      name: 'Capital Trust',
      slug: 'capitaltrust',
    });
    assert.equal(created.tenant.status, 'inactive');
    assert.equal(created.tenant.dnsStatus, 'pending');

    const verified = await service.verifyTenantDns(masterAdmin, created.tenant.id);
    assert.equal(verified.dnsStatus, 'verified');
    assert.equal(verified.sslStatus, 'pending');
    assert.equal(verified.deploymentStatus, 'ssl_pending');
    assert.equal(verified.hostname, 'capitaltrust.app.example.com');
    assert.equal(verified.expectedTarget, 'edgeserver.example.com');
    assert.equal(verified.tenant.tenant.dnsStatus, 'verified');
    assert.equal(verified.tenant.tenant.deploymentStatus, 'ssl_pending');

    await assert.rejects(
      () => service.verifyTenantDns(tenantAdmin, created.tenant.id),
      AuthorizationError,
    );
  } finally {
    resetTenantServiceForTests();
    resetDeploymentProviderForTests();
  }
});

test('failed DNS verification does not invent ready state', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const provider = new ManualDeploymentProvider(
    async () => {
      throw new Error('ENOTFOUND');
    },
    async () => [],
    async () => false,
  );
  const service = new TenantService(repo, provider);
  const created = await service.createTenant(masterAdmin, {
    name: 'Pending Co',
    slug: 'pending-co',
  });
  const result = await service.verifyTenantDns(masterAdmin, created.tenant.id);
  assert.equal(result.dnsStatus, 'failed');
  assert.notEqual(result.deploymentStatus, 'ready');
  assert.equal(result.tenant.tenant.deploymentStatus, 'waiting_for_dns');
});

test('Master-only verify-dns API rejects tenant admins and returns safe payload', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const fakeProvider: DeploymentProvider = {
    id: 'manual',
    getBaseDomain: () => 'app.example.com',
    getDnsTarget: () => 'edgeserver.example.com',
    buildHostname: (subdomain) => buildTenantHostname(subdomain, 'app.example.com'),
    verifyHostname: async (hostname) => ({
      dnsStatus: 'failed',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'edgeserver.example.com',
      checkedAt: new Date().toISOString(),
      message: 'No DNS records were found for this hostname.',
    }),
    provisionHostname: async (subdomain) => ({
      dnsStatus: 'failed',
      sslStatus: 'not_configured',
      hostname: buildTenantHostname(subdomain, 'app.example.com'),
      expectedTarget: 'edgeserver.example.com',
      checkedAt: new Date().toISOString(),
      message: 'No DNS records were found for this hostname.',
      code: 'DNS_NOT_READY',
    }),
    verifySsl: async (hostname) => ({
      dnsStatus: 'failed',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'edgeserver.example.com',
      checkedAt: new Date().toISOString(),
      message: 'DNS not ready',
      code: 'DNS_NOT_READY',
    }),
  };
  setDeploymentProviderForTests(fakeProvider);
  setTenantServiceForTests(new TenantService(repo, fakeProvider));

  try {
    authContext.setActorResolverForTests(async () => masterAdmin);
    const created = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: { name: 'Verify Co', slug: 'verify-co' },
    });
    assert.equal(created.statusCode, 201);
    const id = (created.body as { data: { tenant: { id: string } } }).data.tenant.id;

    authContext.setActorResolverForTests(async () => tenantAdmin);
    const forbidden = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${id}/verify-dns`,
    });
    assert.equal(forbidden.statusCode, 403);

    authContext.setActorResolverForTests(async () => masterAdmin);
    const verified = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${id}/verify-dns`,
    });
    assert.equal(verified.statusCode, 200);
    const body = verified.body as {
      data: {
        status: string;
        hostname: string;
        expectedTarget: string;
        deploymentStatus: string;
      };
    };
    assert.equal(body.data.status, 'failed');
    assert.equal(body.data.hostname, 'verify-co.app.example.com');
    assert.equal(body.data.expectedTarget, 'edgeserver.example.com');
    assert.notEqual(body.data.deploymentStatus, 'ready');
    assert.doesNotMatch(JSON.stringify(body), /service_role|stack|ENOTFOUND|password/i);
  } finally {
    authContext.resetActorResolverForTests();
    resetTenantServiceForTests();
    resetDeploymentProviderForTests();
  }
});
