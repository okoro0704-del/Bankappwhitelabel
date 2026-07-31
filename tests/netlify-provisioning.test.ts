import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchApiRequest } from '../src/api/router';
import * as authContext from '../src/api/auth-context';
import { InMemoryTenantRepository } from '../src/repositories/tenants/tenant-repository';
import {
  NetlifyDeploymentProvider,
  ManualDeploymentProvider,
  resetDeploymentProviderForTests,
  setDeploymentProviderForTests,
  type DeploymentProvider,
} from '../src/services/deployment/deployment-provider';
import {
  NetlifyApiClient,
  NetlifyApiError,
  type NetlifyDnsRecord,
  type NetlifySite,
} from '../src/services/deployment/netlify-api-client';
import {
  TenantService,
  resetTenantServiceForTests,
  setTenantServiceForTests,
} from '../src/services/tenants/tenant-service';
import { buildTenantHostname } from '../src/tenants/hostname';
import { NORTHLINE_TENANT_ID, NORTHLINE_TENANT_SLUG } from '../src/tenants/constants';
import type { AuthenticatedAppUser, TenantBrandingRecord, TenantRecord } from '../src/types';
import { AuthorizationError, AuthenticationError, DeploymentError } from '../src/utils/errors';

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
    loginHeadline: 'Welcome',
    loginSubtitle: 'Sign in',
    supportEmail: null,
    supportPhone: null,
    createdAt: now,
    updatedAt: now,
  };
  repo.seed(tenant, branding);
};

type MockState = {
  site: NetlifySite;
  zones: { id: string; name: string }[];
  records: NetlifyDnsRecord[];
  authFail?: boolean;
  siteMissing?: boolean;
  sslFail?: boolean;
  provisionSslCalls: number;
};

const createMockClient = (state: MockState): NetlifyApiClient => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (state.authFail) {
      return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
    }

    if (url.includes('/sites/') && method === 'GET' && !url.includes('/ssl')) {
      if (state.siteMissing) {
        return new Response(JSON.stringify({ message: 'missing' }), { status: 404 });
      }
      return new Response(JSON.stringify(state.site), { status: 200 });
    }

    if (url.includes('/sites/') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { domain_aliases?: string[] };
      state.site = {
        ...state.site,
        domain_aliases: body.domain_aliases ?? state.site.domain_aliases,
      };
      return new Response(JSON.stringify(state.site), { status: 200 });
    }

    if (url.endsWith('/dns_zones') && method === 'GET') {
      return new Response(JSON.stringify(state.zones), { status: 200 });
    }

    if (url.includes('/dns_records') && method === 'GET') {
      return new Response(JSON.stringify(state.records), { status: 200 });
    }

    if (url.includes('/dns_records') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as NetlifyDnsRecord;
      const created = {
        id: `rec-${state.records.length + 1}`,
        hostname: body.hostname,
        type: body.type,
        value: body.value,
      };
      state.records.push(created);
      return new Response(JSON.stringify(created), { status: 201 });
    }

    if (url.includes('/ssl') && method === 'POST') {
      state.provisionSslCalls += 1;
      if (state.sslFail) {
        return new Response(JSON.stringify({ message: 'bad dns' }), { status: 422 });
      }
      return new Response(
        JSON.stringify({ state: 'pending', domains: state.site.domain_aliases }),
        { status: 200 },
      );
    }

    if (url.includes('/ssl') && method === 'GET') {
      return new Response(
        JSON.stringify({ state: 'issued', domains: state.site.domain_aliases }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ message: 'unexpected' }), { status: 500 });
  };

  return new NetlifyApiClient({
    authToken: 'test-token-not-for-production',
    fetchImpl,
  });
};

test('Master-only provisioning authorization', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);

  const succeeding: DeploymentProvider = {
    id: 'netlify',
    getBaseDomain: () => 'example.com',
    getDnsTarget: () => 'shared.netlify.app',
    buildHostname: (subdomain) => buildTenantHostname(subdomain, 'example.com'),
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
      message: 'Provisioned (test)',
      code: 'DNS_NOT_READY',
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

  const service = new TenantService(repo, succeeding);
  setTenantServiceForTests(service);
  setDeploymentProviderForTests(succeeding);

  try {
    const created = await service.createTenant(masterAdmin, {
      name: 'Acme Bank',
      slug: 'acme',
    });

    await assert.rejects(
      () => service.provisionTenant(normalUser, created.tenant.id),
      AuthorizationError,
    );
    await assert.rejects(
      () => service.provisionTenant(tenantAdmin, created.tenant.id),
      AuthorizationError,
    );

    authContext.setActorResolverForTests(async () => {
      throw new AuthenticationError();
    });
    const unauth = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${created.tenant.id}/provision`,
    });
    assert.equal(unauth.statusCode, 401);

    authContext.setActorResolverForTests(async () => masterAdmin);
    const allowed = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${created.tenant.id}/provision`,
    });
    assert.equal(allowed.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(allowed.body), /test-token|NETLIFY_AUTH|service_role/i);
  } finally {
    authContext.resetActorResolverForTests();
    resetTenantServiceForTests();
    resetDeploymentProviderForTests();
  }
});

test('Netlify provider provisions idempotently and refuses DNS conflicts', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.com';
  process.env.DEPLOYMENT_DNS_TARGET = 'shared.netlify.app';

  const state: MockState = {
    site: {
      id: 'site-1',
      name: 'shared',
      domain_aliases: [],
      default_domain: 'shared.netlify.app',
    },
    zones: [{ id: 'zone-1', name: 'example.com' }],
    records: [],
    provisionSslCalls: 0,
  };

  const provider = new NetlifyDeploymentProvider({
    client: createMockClient(state),
    siteId: 'site-1',
    dnsZoneId: 'zone-1',
    resolveAny: async () => [],
    checkTls: async () => false,
  });

  const first = await provider.provisionHostname('acme');
  assert.equal(first.hostname, 'acme.example.com');
  assert.equal(first.dnsStatus, 'pending');
  assert.notEqual(first.sslStatus, 'verified');
  assert.ok(state.site.domain_aliases?.includes('acme.example.com'));
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0]?.value, 'shared.netlify.app');

  // Idempotent retry — no duplicate records.
  const second = await provider.provisionHostname('acme');
  assert.equal(state.records.length, 1);
  assert.equal(second.hostname, 'acme.example.com');

  // Conflict when unexpected target already exists.
  state.records = [
    {
      id: 'bad',
      hostname: 'other',
      type: 'CNAME',
      value: 'evil.example.net',
    },
  ];
  // Use hostname that matches label "other"
  await assert.rejects(
    () => provider.provisionHostname('other'),
    (error: unknown) =>
      error instanceof DeploymentError && error.reasonCode === 'DEPLOYMENT_CONFLICT',
  );
});

test('Netlify auth failure and missing site map to safe errors', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.com';
  process.env.DEPLOYMENT_DNS_TARGET = 'shared.netlify.app';

  const authState: MockState = {
    site: { id: 'site-1', domain_aliases: [] },
    zones: [{ id: 'zone-1', name: 'example.com' }],
    records: [],
    authFail: true,
    provisionSslCalls: 0,
  };
  const authProvider = new NetlifyDeploymentProvider({
    client: createMockClient(authState),
    siteId: 'site-1',
    resolveAny: async () => [],
    checkTls: async () => false,
  });
  await assert.rejects(
    () => authProvider.provisionHostname('bank-a'),
    (error: unknown) =>
      error instanceof DeploymentError && error.reasonCode === 'NETLIFY_AUTH_FAILED',
  );

  const missingState: MockState = {
    site: { id: 'missing', domain_aliases: [] },
    zones: [],
    records: [],
    siteMissing: true,
    provisionSslCalls: 0,
  };
  const missingProvider = new NetlifyDeploymentProvider({
    client: createMockClient(missingState),
    siteId: 'missing',
    resolveAny: async () => [],
    checkTls: async () => false,
  });
  await assert.rejects(
    () => missingProvider.provisionHostname('bank-b'),
    (error: unknown) =>
      error instanceof DeploymentError && error.reasonCode === 'NETLIFY_SITE_NOT_FOUND',
  );
});

test('Netlify ready requires DNS + SSL verification, not API success alone', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.com';
  process.env.DEPLOYMENT_DNS_TARGET = 'shared.netlify.app';

  const state: MockState = {
    site: { id: 'site-1', domain_aliases: ['ready.example.com'] },
    zones: [{ id: 'zone-1', name: 'example.com' }],
    records: [
      {
        id: 'r1',
        hostname: 'ready',
        type: 'CNAME',
        value: 'shared.netlify.app',
      },
    ],
    provisionSslCalls: 0,
  };

  const pendingProvider = new NetlifyDeploymentProvider({
    client: createMockClient(state),
    siteId: 'site-1',
    dnsZoneId: 'zone-1',
    resolveAny: async () => ['shared.netlify.app'],
    checkTls: async () => false,
  });
  const pending = await pendingProvider.provisionHostname('ready');
  assert.equal(pending.dnsStatus, 'verified');
  assert.equal(pending.sslStatus, 'pending');
  assert.notEqual(pending.sslStatus, 'verified');

  const readyProvider = new NetlifyDeploymentProvider({
    client: createMockClient(state),
    siteId: 'site-1',
    dnsZoneId: 'zone-1',
    resolveAny: async () => ['shared.netlify.app'],
    checkTls: async () => true,
  });
  const ready = await readyProvider.verifySsl('ready.example.com');
  assert.equal(ready.dnsStatus, 'verified');
  assert.equal(ready.sslStatus, 'verified');

  const failedSsl = await pendingProvider.verifySsl('ready.example.com');
  assert.equal(failedSsl.sslStatus, 'failed');
  assert.equal(failedSsl.code, 'SSL_NOT_READY');
});

test('provision API persists safe error and never leaks Netlify token', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);

  const failing: DeploymentProvider = {
    id: 'netlify',
    getBaseDomain: () => 'example.com',
    getDnsTarget: () => 'shared.netlify.app',
    buildHostname: (subdomain) => buildTenantHostname(subdomain, 'example.com'),
    verifyHostname: async (hostname) => ({
      dnsStatus: 'failed',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'DNS not ready',
      code: 'DNS_NOT_READY',
    }),
    provisionHostname: async () => {
      throw new DeploymentError('NETLIFY_AUTH_FAILED', 'Netlify authentication failed', 502);
    },
    verifySsl: async (hostname) => ({
      dnsStatus: 'failed',
      sslStatus: 'not_configured',
      hostname,
      expectedTarget: 'shared.netlify.app',
      checkedAt: new Date().toISOString(),
      message: 'DNS not ready',
      code: 'DNS_NOT_READY',
    }),
  };

  setDeploymentProviderForTests(failing);
  setTenantServiceForTests(new TenantService(repo, failing));
  authContext.setActorResolverForTests(async () => masterAdmin);

  try {
    const created = await dispatchApiRequest({
      method: 'POST',
      path: '/api/master/tenants',
      body: { name: 'Fail Co', slug: 'fail-co' },
    });
    const id = (created.body as { data: { tenant: { id: string } } }).data.tenant.id;

    const provisioned = await dispatchApiRequest({
      method: 'POST',
      path: `/api/master/tenants/${id}/provision`,
    });
    assert.equal(provisioned.statusCode, 502);
    assert.equal(
      (provisioned.body as { error: { code: string } }).error.code,
      'NETLIFY_AUTH_FAILED',
    );
    assert.doesNotMatch(JSON.stringify(provisioned.body), /Bearer|test-token|NETLIFY_AUTH_TOKEN/i);

    const detail = await dispatchApiRequest({
      method: 'GET',
      path: `/api/master/tenants/${id}/deployment`,
    });
    assert.equal(detail.statusCode, 200);
    const deployment = (detail.body as { data: { lastProvisionError: string | null; provider: string } })
      .data;
    assert.equal(deployment.provider, 'netlify');
    assert.match(deployment.lastProvisionError ?? '', /Netlify authentication failed/i);
    assert.doesNotMatch(JSON.stringify(detail.body), /Bearer|test-token|NETLIFY_AUTH_TOKEN/i);
  } finally {
    authContext.resetActorResolverForTests();
    resetTenantServiceForTests();
    resetDeploymentProviderForTests();
  }
});

test('NetlifyApiError never exposes raw token in message', () => {
  const error = new NetlifyApiError(401, 'Netlify authentication failed', 'NETLIFY_AUTH_FAILED');
  assert.doesNotMatch(error.message, /Bearer|token-/i);
});
