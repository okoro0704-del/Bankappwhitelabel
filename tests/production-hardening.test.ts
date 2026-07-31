import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { originMatchesAllowListEntry, resolveAllowedOrigin, buildCorsHeaders } from '../src/api/cors';
import { toApiError } from '../src/api/http';
import { assertProductionEnvSafety, ProductionConfigError } from '../src/config/production-guards';
import {
  assertDeploymentStatusConsistent,
  deriveDeploymentStatus,
  isDeploymentReady,
} from '../src/services/deployment/deployment-status';
import { InMemoryTenantRepository } from '../src/repositories/tenants/tenant-repository';
import {
  TenantService,
  resetTenantServiceForTests,
  setTenantServiceForTests,
} from '../src/services/tenants/tenant-service';
import {
  TenantResolver,
  extractTenantLabelUnderBaseDomain,
  resetTenantResolverForTests,
  setTenantResolverForTests,
} from '../src/services/tenants/tenant-resolver';
import {
  buildTenantHostname,
  buildTenantLoginUrl,
  isReservedSubdomain,
  isValidSubdomain,
} from '../src/tenants/hostname';
import { sanitizeBrandingPublicUrl } from '../src/tenants/branding-safe';
import { NORTHLINE_TENANT_ID, NORTHLINE_TENANT_SLUG } from '../src/tenants/constants';
import type { AuthenticatedAppUser, TenantBrandingRecord, TenantRecord } from '../src/types';
import { NotFoundError, ValidationError } from '../src/utils/errors';

const masterAdmin: AuthenticatedAppUser = {
  userId: 'master-1',
  role: 'user',
  accountStatus: 'active',
  isMasterAdmin: true,
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

test('hostname under base domain: valid, unknown, attacker, malformed, port, case', () => {
  const base = 'app.example.com';

  assert.equal(extractTenantLabelUnderBaseDomain('bank-a.app.example.com', base), 'bank-a');
  assert.equal(extractTenantLabelUnderBaseDomain('BANK-A.APP.EXAMPLE.COM', base), 'bank-a');
  assert.equal(extractTenantLabelUnderBaseDomain('bank-a.app.example.com:443', base), 'bank-a');
  assert.equal(extractTenantLabelUnderBaseDomain('www.bank-a.app.example.com', base), 'bank-a');

  assert.equal(extractTenantLabelUnderBaseDomain('app.example.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('unknown.app.example.com', base), 'unknown');

  // Attacker-style hosts must not resolve under the configured base.
  assert.equal(extractTenantLabelUnderBaseDomain('bank-a.attacker-example.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('bank-a.evil.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('app.example.com.attacker.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('bank-a.app.example.com.evil.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('a.b.app.example.com', base), null);

  assert.equal(extractTenantLabelUnderBaseDomain('not a host', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('http://bank-a.app.example.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('localhost', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('127.0.0.1', base), null);

  // Reserved labels never extract.
  assert.equal(extractTenantLabelUnderBaseDomain('www.app.example.com', base), null);
  assert.equal(extractTenantLabelUnderBaseDomain('api.app.example.com', base), null);
});

test('production resolver rejects localhost, attacker hosts, and X-Tenant-Slug', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo);
  const resolver = new TenantResolver(repo);
  setTenantServiceForTests(service);
  setTenantResolverForTests(resolver);

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_DEV_TENANT_HEADER: process.env.ALLOW_DEV_TENANT_HEADER,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  };

  process.env.TENANT_BASE_DOMAIN = 'app.example.com';

  try {
    await service.createTenant(masterAdmin, { name: 'Bank A', slug: 'bank-a' });

    const ok = await resolver.resolve({ hostname: 'bank-a.app.example.com' });
    assert.equal(ok.tenant.slug, 'bank-a');

    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_TENANT_HEADER = 'true';

    await assert.rejects(
      () =>
        resolver.resolve({
          hostname: 'localhost',
          headers: { 'x-tenant-slug': 'bank-a' },
        }),
      NotFoundError,
    );

    await assert.rejects(
      () => resolver.resolve({ hostname: 'bank-a.evil.com' }),
      NotFoundError,
    );

    await assert.rejects(
      () => resolver.resolve({ hostname: 'bank-a.attacker-example.com' }),
      NotFoundError,
    );

    await assert.rejects(() => resolver.resolve({ hostname: 'localhost' }), NotFoundError);

    // Missing Host in production fails closed.
    await assert.rejects(() => resolver.resolve({}), NotFoundError);
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
    if (previous.TENANT_BASE_DOMAIN === undefined) {
      delete process.env.TENANT_BASE_DOMAIN;
    } else {
      process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
    }
    resetTenantServiceForTests();
    resetTenantResolverForTests();
  }
});

test('development still allows localhost default slug and optional header', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const resolver = new TenantResolver(repo);
  setTenantResolverForTests(resolver);

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_DEV_TENANT_HEADER: process.env.ALLOW_DEV_TENANT_HEADER,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  };

  process.env.NODE_ENV = 'development';
  process.env.TENANT_BASE_DOMAIN = 'app.example.com';
  process.env.ALLOW_DEV_TENANT_HEADER = 'true';

  try {
    const local = await resolver.resolve({ hostname: 'localhost:5173' });
    assert.equal(local.tenant.slug, 'northline');

    const byHeader = await resolver.resolve({
      hostname: 'localhost',
      headers: { 'x-tenant-slug': 'northline' },
    });
    assert.equal(byHeader.tenant.slug, 'northline');
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.ALLOW_DEV_TENANT_HEADER = previous.ALLOW_DEV_TENANT_HEADER;
    if (previous.TENANT_BASE_DOMAIN === undefined) {
      delete process.env.TENANT_BASE_DOMAIN;
    } else {
      process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
    }
    resetTenantResolverForTests();
  }
});

test('reserved and invalid subdomains are rejected', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo);

  assert.equal(isReservedSubdomain('www'), true);
  assert.equal(isReservedSubdomain('api'), true);
  assert.equal(isValidSubdomain('ok-bank'), true);

  await assert.rejects(
    () => service.createTenant(masterAdmin, { name: 'WWW', slug: 'www' }),
    ValidationError,
  );
  await assert.rejects(
    () => service.createTenant(masterAdmin, { name: 'Bad', slug: 'bad/slug' }),
    ValidationError,
  );
  await assert.rejects(
    () => service.createTenant(masterAdmin, { name: 'Bad', slug: 'has.dot' }),
    ValidationError,
  );
});

test('server rejects unsafe branding logo URLs', async () => {
  const repo = new InMemoryTenantRepository();
  seedNorthline(repo);
  const service = new TenantService(repo);

  assert.equal(sanitizeBrandingPublicUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeBrandingPublicUrl('data:text/html,hi'), null);
  assert.equal(sanitizeBrandingPublicUrl('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');

  await assert.rejects(
    () =>
      service.createTenant(masterAdmin, {
        name: 'Unsafe Brand',
        slug: 'unsafe-brand',
        branding: { logoUrl: 'javascript:alert(1)' },
      }),
    ValidationError,
  );

  const created = await service.createTenant(masterAdmin, {
    name: 'Safe Brand',
    slug: 'safe-brand',
    branding: { logoUrl: 'https://cdn.example.com/a.png', applicationName: 'Safe Brand' },
  });
  assert.equal(created.branding.logoUrl, 'https://cdn.example.com/a.png');
});

test('login URL uses HTTPS for tenant hosts and HTTP only for localhost', () => {
  assert.equal(
    buildTenantLoginUrl('capitaltrust.app.example.com'),
    'https://capitaltrust.app.example.com/login',
  );
  assert.equal(buildTenantLoginUrl('localhost'), 'http://localhost/login');
  assert.throws(() => buildTenantLoginUrl('evil.com/phish'));
  assert.equal(
    buildTenantHostname('capitaltrust', 'app.example.com'),
    'capitaltrust.app.example.com',
  );
});

test('deployment status cannot jump to ready without DNS+SSL', () => {
  assert.equal(isDeploymentReady('pending', 'verified'), false);
  assert.equal(isDeploymentReady('verified', 'verified'), true);
  assert.equal(deriveDeploymentStatus('not_configured', 'not_configured'), 'not_configured');
  assert.throws(
    () => assertDeploymentStatusConsistent('pending', 'not_configured', 'ready'),
    ValidationError,
  );
  assert.doesNotThrow(() =>
    assertDeploymentStatusConsistent('verified', 'verified', 'ready'),
  );
  assert.equal(deriveDeploymentStatus('verified', 'failed'), 'dns_configured');
});

test('CORS supports tenant subdomain patterns without allowing arbitrary origins', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  };

  process.env.NODE_ENV = 'production';
  process.env.TENANT_BASE_DOMAIN = 'app.example.com';
  process.env.CORS_ORIGIN = 'https://master.example.com,https://*.app.example.com';

  try {
    assert.equal(
      resolveAllowedOrigin('https://bank-a.app.example.com'),
      'https://bank-a.app.example.com',
    );
    assert.equal(resolveAllowedOrigin('https://master.example.com'), 'https://master.example.com');
    assert.equal(resolveAllowedOrigin('https://evil.com'), null);
    assert.equal(resolveAllowedOrigin('https://bank-a.evil.com'), null);
    assert.equal(resolveAllowedOrigin('https://a.b.app.example.com'), null);
    assert.equal(resolveAllowedOrigin('http://bank-a.app.example.com'), null);

    assert.equal(
      originMatchesAllowListEntry('https://bank-a.app.example.com', 'https://*.app.example.com'),
      true,
    );
    assert.equal(originMatchesAllowListEntry('https://evil.com', 'https://*.app.example.com'), false);

    const headers = buildCorsHeaders('https://bank-b.app.example.com');
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://bank-b.app.example.com');
    assert.ok(!Object.values(headers).includes('*'));
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.CORS_ORIGIN === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    if (previous.TENANT_BASE_DOMAIN === undefined) delete process.env.TENANT_BASE_DOMAIN;
    else process.env.TENANT_BASE_DOMAIN = previous.TENANT_BASE_DOMAIN;
  }
});

test('production env guards reject unsafe flags', () => {
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'production',
        ALLOW_DEV_TENANT_HEADER: 'true',
        CORS_ORIGIN: 'https://app.example.com',
        TENANT_BASE_DOMAIN: 'app.example.com',
        DEPLOYMENT_DNS_TARGET: 'site.netlify.app',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    ProductionConfigError,
  );
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'production',
        ALLOW_VERIFICATION_CODE_PEEK: 'true',
        CORS_ORIGIN: 'https://app.example.com',
        TENANT_BASE_DOMAIN: 'app.example.com',
        DEPLOYMENT_DNS_TARGET: 'site.netlify.app',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    ProductionConfigError,
  );
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'production',
        CORS_ORIGIN: '*',
        TENANT_BASE_DOMAIN: 'app.example.com',
        DEPLOYMENT_DNS_TARGET: 'site.netlify.app',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    ProductionConfigError,
  );
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'production',
        // missing CORS_ORIGIN
        TENANT_BASE_DOMAIN: 'app.example.com',
        DEPLOYMENT_DNS_TARGET: 'site.netlify.app',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    ProductionConfigError,
  );
  assert.throws(
    () =>
      assertProductionEnvSafety({
        NODE_ENV: 'development',
        DEPLOYMENT_PROVIDER: 'netlify',
        // missing token/site
        TENANT_BASE_DOMAIN: 'customers.bank.example',
        DEPLOYMENT_DNS_TARGET: 'shared.netlify.app',
      }),
    ProductionConfigError,
  );
  assert.doesNotThrow(() =>
    assertProductionEnvSafety({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://*.customers.bank.example,https://master.bank.example',
      TENANT_BASE_DOMAIN: 'customers.bank.example',
      DEPLOYMENT_DNS_TARGET: 'shared.netlify.app',
      DEPLOYMENT_PROVIDER: 'netlify',
      NETLIFY_AUTH_TOKEN: 'nfp_test_not_real',
      NETLIFY_SITE_ID: 'site-abc',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    }),
  );
  assert.doesNotThrow(() =>
    assertProductionEnvSafety({
      NODE_ENV: 'development',
      ALLOW_DEV_TENANT_HEADER: 'true',
      DEPLOYMENT_PROVIDER: 'manual',
    }),
  );
});

test('API errors never include stack traces in the response body', () => {
  const err = new Error('secret boom');
  err.stack = 'Error: secret boom\n    at /app/src/secret.ts:1:1';
  const result = toApiError(err);
  const body = JSON.stringify(result.body);
  assert.equal(result.statusCode, 500);
  assert.doesNotMatch(body, /stack|secret\.ts|secret boom/i);
  assert.ok(!('stack' in (result.body as object)));
});

test('production web bundle does not contain server secrets when dist exists', () => {
  const distDir = path.join(process.cwd(), 'web', 'dist');
  if (!fs.existsSync(distDir)) {
    // NOT VERIFIED in this run — build:web must be executed separately for full audit.
    return;
  }

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (/\.(js|css|html|map)$/i.test(entry.name)) files.push(full);
    }
    return files;
  };

  const forbidden = [
    /SUPABASE_SERVICE_ROLE_KEY/i,
    /service_role/i,
    /VERIFICATION_CODE_PEPPER/i,
    /INITIAL_ADMIN_PASSWORD/i,
    /NETLIFY_AUTH_TOKEN/i,
    /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
    /postgres:\/\//i,
  ];

  for (const file of walk(distDir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path.relative(process.cwd(), file)} matched ${pattern}`,
      );
    }
  }
});
