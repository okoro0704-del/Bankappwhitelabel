import dns from 'node:dns/promises';
import tls from 'node:tls';
import type { TenantDnsStatus, TenantSslStatus } from '../../types';
import {
  getDeploymentEnvConfig,
  getNetlifyAuthToken,
  type DeploymentProviderId,
} from '../../config/deployment';
import { buildTenantHostname, isReservedSubdomain, isValidSubdomain, normalizeSubdomain } from '../../tenants/hostname';
import {
  NetlifyApiClient,
  NetlifyApiError,
  type NetlifyDnsRecord,
} from './netlify-api-client';
import { DeploymentError } from '../../utils/errors';
import logger from '../../utils/logger';

export type DnsVerificationOutcome = {
  dnsStatus: TenantDnsStatus;
  sslStatus: TenantSslStatus;
  hostname: string;
  expectedTarget: string;
  checkedAt: string;
  /** Safe, non-internal message for Master Admin UI */
  message: string;
  /** Safe application-level reason code when applicable */
  code?: string;
};

export type ProvisionOutcome = DnsVerificationOutcome;

export type DeploymentProvider = {
  readonly id: DeploymentProviderId;
  getBaseDomain(): string;
  getDnsTarget(): string;
  buildHostname(subdomain: string): string;
  verifyHostname(hostname: string): Promise<DnsVerificationOutcome>;
  /** Provision DNS (+ optional SSL kickoff) for a tenant subdomain. */
  provisionHostname(subdomain: string): Promise<ProvisionOutcome>;
  /** Check / refresh SSL for an already-provisioned hostname. */
  verifySsl(hostname: string): Promise<DnsVerificationOutcome>;
};

const normalizeTarget = (value: string): string =>
  value.trim().toLowerCase().replace(/\.$/, '');

const looksLikeIp = (value: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(':');

const defaultResolveAny = async (host: string): Promise<string[]> => {
  try {
    const cname = await dns.resolveCname(host);
    if (cname.length) return cname.map(normalizeTarget);
  } catch {
    // fall through
  }
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
};

const defaultCheckTls = (hostname: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        servername: hostname,
        port: 443,
        rejectUnauthorized: true,
        timeout: 5000,
      },
      () => {
        socket.end();
        resolve(true);
      },
    );
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });

const recordsMatchTarget = (records: string[], expectedTarget: string): boolean => {
  const expected = normalizeTarget(expectedTarget);
  return records.some((record) => {
    const value = normalizeTarget(record);
    if (looksLikeIp(expected)) {
      return value === expected;
    }
    return value === expected || value.endsWith(`.${expected}`);
  });
};

/**
 * Provider-neutral manual deployment adapter.
 * Performs public DNS/TLS checks only — no Netlify API calls.
 */
export class ManualDeploymentProvider implements DeploymentProvider {
  readonly id: DeploymentProviderId = 'manual';

  constructor(
    private readonly resolveCname: (hostname: string) => Promise<string[]> = (host) =>
      dns.resolveCname(host),
    private readonly resolveAny: (hostname: string) => Promise<string[]> = defaultResolveAny,
    private readonly checkTls: (hostname: string) => Promise<boolean> = defaultCheckTls,
  ) {}

  getBaseDomain(): string {
    return getDeploymentEnvConfig().baseDomain;
  }

  getDnsTarget(): string {
    return getDeploymentEnvConfig().dnsTarget;
  }

  buildHostname(subdomain: string): string {
    const label = normalizeSubdomain(subdomain);
    if (!isValidSubdomain(label)) {
      throw new Error('Invalid subdomain');
    }
    return buildTenantHostname(label, this.getBaseDomain());
  }

  async provisionHostname(subdomain: string): Promise<ProvisionOutcome> {
    throw new DeploymentError(
      'DEPLOYMENT_NOT_CONFIGURED',
      'Manual provider is active. Set DEPLOYMENT_PROVIDER=netlify with NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID to automate DNS.',
      400,
    );
  }

  async verifyHostname(hostname: string): Promise<DnsVerificationOutcome> {
    const host = normalizeTarget(hostname);
    const expectedTarget = normalizeTarget(this.getDnsTarget());
    const checkedAt = new Date().toISOString();

    if (!host || host.includes('/') || host.includes(' ')) {
      return {
        dnsStatus: 'failed',
        sslStatus: 'not_configured',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'Hostname is invalid.',
        code: 'DNS_NOT_READY',
      };
    }

    let records: string[] = [];
    try {
      records = (await this.resolveAny(host)).map(normalizeTarget);
    } catch {
      return {
        dnsStatus: 'failed',
        sslStatus: 'not_configured',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'DNS records could not be resolved for this hostname.',
        code: 'DNS_NOT_READY',
      };
    }

    if (records.length === 0) {
      return {
        dnsStatus: 'failed',
        sslStatus: 'not_configured',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'No DNS records were found for this hostname.',
        code: 'DNS_NOT_READY',
      };
    }

    let matched = recordsMatchTarget(records, expectedTarget);
    if (!matched) {
      try {
        const cnames = (await this.resolveCname(host)).map(normalizeTarget);
        matched = recordsMatchTarget(cnames, expectedTarget);
      } catch {
        // ignore
      }
    }

    if (!matched) {
      return {
        dnsStatus: 'failed',
        sslStatus: 'not_configured',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'DNS is present but does not point at the expected deployment target.',
        code: 'DNS_NOT_READY',
      };
    }

    return this.afterDnsVerified(host, expectedTarget, checkedAt);
  }

  async verifySsl(hostname: string): Promise<DnsVerificationOutcome> {
    const dns = await this.verifyHostname(hostname);
    if (dns.dnsStatus !== 'verified') {
      return {
        ...dns,
        sslStatus: dns.sslStatus === 'verified' ? 'failed' : dns.sslStatus,
        message: dns.message || 'DNS must be verified before SSL can be ready.',
        code: 'DNS_NOT_READY',
      };
    }
    return dns;
  }

  protected async afterDnsVerified(
    hostname: string,
    expectedTarget: string,
    checkedAt: string,
  ): Promise<DnsVerificationOutcome> {
    try {
      const ok = await this.checkTls(hostname);
      if (ok) {
        return {
          dnsStatus: 'verified',
          sslStatus: 'verified',
          hostname,
          expectedTarget,
          checkedAt,
          message: 'DNS and SSL verification succeeded.',
        };
      }
      return {
        dnsStatus: 'verified',
        sslStatus: 'failed',
        hostname,
        expectedTarget,
        checkedAt,
        message: 'DNS is configured. SSL certificate could not be verified.',
        code: 'SSL_NOT_READY',
      };
    } catch {
      return {
        dnsStatus: 'verified',
        sslStatus: 'failed',
        hostname,
        expectedTarget,
        checkedAt,
        message: 'DNS is configured. SSL could not be verified yet.',
        code: 'SSL_NOT_READY',
      };
    }
  }
}

export type NetlifyDeploymentProviderDeps = {
  client: NetlifyApiClient;
  siteId: string;
  dnsZoneId?: string | null;
  resolveAny?: (hostname: string) => Promise<string[]>;
  checkTls?: (hostname: string) => Promise<boolean>;
};

/**
 * Netlify DNS + shared-site domain alias provisioning.
 * One NETLIFY_SITE_ID serves every tenant hostname.
 */
export class NetlifyDeploymentProvider implements DeploymentProvider {
  readonly id: DeploymentProviderId = 'netlify';
  private readonly client: NetlifyApiClient;
  private readonly siteId: string;
  private readonly configuredZoneId: string | null;
  private readonly resolveAny: (hostname: string) => Promise<string[]>;
  private readonly checkTls: (hostname: string) => Promise<boolean>;

  constructor(deps: NetlifyDeploymentProviderDeps) {
    this.client = deps.client;
    this.siteId = deps.siteId;
    this.configuredZoneId = deps.dnsZoneId ?? null;
    this.resolveAny = deps.resolveAny ?? defaultResolveAny;
    this.checkTls = deps.checkTls ?? defaultCheckTls;
  }

  getBaseDomain(): string {
    return getDeploymentEnvConfig().baseDomain;
  }

  getDnsTarget(): string {
    return getDeploymentEnvConfig().dnsTarget;
  }

  buildHostname(subdomain: string): string {
    const label = normalizeSubdomain(subdomain);
    if (!isValidSubdomain(label)) {
      throw new DeploymentError('DNS_PROVISIONING_FAILED', 'Invalid subdomain', 400);
    }
    if (isReservedSubdomain(label)) {
      throw new DeploymentError(
        'DNS_PROVISIONING_FAILED',
        `Subdomain '${label}' is reserved`,
        400,
      );
    }
    const hostname = buildTenantHostname(label, this.getBaseDomain());
    const base = this.getBaseDomain();
    if (hostname !== `${label}.${base}` && hostname !== base) {
      throw new DeploymentError(
        'DNS_PROVISIONING_FAILED',
        'Hostname is outside the configured TENANT_BASE_DOMAIN',
        400,
      );
    }
    return hostname;
  }

  async provisionHostname(subdomain: string): Promise<ProvisionOutcome> {
    const label = normalizeSubdomain(subdomain);
    const hostname = this.buildHostname(label);
    const expectedTarget = normalizeTarget(this.getDnsTarget());
    const checkedAt = new Date().toISOString();

    // Defense in depth — never provision arbitrary external domains.
    if (!hostname.endsWith(`.${this.getBaseDomain()}`) && hostname !== this.getBaseDomain()) {
      throw new DeploymentError(
        'DNS_PROVISIONING_FAILED',
        'Hostname is outside the configured TENANT_BASE_DOMAIN',
        400,
      );
    }

    logger.info(
      { provider: 'netlify', hostname, operation: 'provision' },
      'Starting Netlify tenant provisioning',
    );

    try {
      const site = await this.client.getSite(this.siteId);
      const aliases = new Set(
        [...(site.domain_aliases ?? []), site.custom_domain]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase()),
      );

      if (!aliases.has(hostname)) {
        const nextAliases = [...(site.domain_aliases ?? []), hostname];
        await this.client.updateSite(this.siteId, { domain_aliases: nextAliases });
      }

      const zoneId = await this.resolveDnsZoneId();
      const records = await this.client.listDnsRecords(zoneId);
      const conflict = this.findConflictingRecord(records, label, hostname, expectedTarget);
      if (conflict === 'conflict') {
        throw new DeploymentError(
          'DEPLOYMENT_CONFLICT',
          'A DNS record already exists for this hostname with an unexpected target',
          409,
        );
      }

      if (conflict === 'missing') {
        await this.client.createDnsRecord(zoneId, {
          type: 'CNAME',
          hostname: label,
          value: expectedTarget,
          ttl: 3600,
        });
      }

      // Kick SSL provisioning; failure here is non-fatal (DNS may still be propagating).
      let sslStatus: TenantSslStatus = 'pending';
      let message = 'Hostname associated and DNS record configured. SSL is pending.';
      try {
        await this.client.provisionSsl(this.siteId);
        message =
          'Hostname associated and DNS record configured. SSL provisioning requested.';
      } catch (error) {
        if (error instanceof NetlifyApiError && error.code === 'SSL_PROVISIONING_FAILED') {
          sslStatus = 'pending';
          message =
            'DNS configured. SSL provisioning is not ready yet (DNS may still be propagating).';
        } else if (error instanceof NetlifyApiError) {
          throw this.mapNetlifyError(error);
        } else {
          throw error;
        }
      }

      // Public DNS check — never mark ready solely because Netlify API succeeded.
      const publicRecords = (await this.resolveAny(hostname)).map(normalizeTarget);
      const dnsReady = recordsMatchTarget(publicRecords, expectedTarget);
      const dnsStatus: TenantDnsStatus = dnsReady ? 'verified' : 'pending';

      if (dnsReady) {
        const tlsOk = await this.checkTls(hostname);
        if (tlsOk) {
          return {
            dnsStatus: 'verified',
            sslStatus: 'verified',
            hostname,
            expectedTarget,
            checkedAt,
            message: 'DNS and SSL verification succeeded.',
          };
        }
        sslStatus = 'pending';
        message = 'DNS is verified. SSL certificate is not ready yet.';
      }

      return {
        dnsStatus,
        sslStatus,
        hostname,
        expectedTarget,
        checkedAt,
        message,
        code: dnsStatus === 'verified' ? 'SSL_NOT_READY' : 'DNS_NOT_READY',
      };
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }
      if (error instanceof NetlifyApiError) {
        throw this.mapNetlifyError(error);
      }
      logger.error(
        { provider: 'netlify', hostname, operation: 'provision', code: 'DNS_PROVISIONING_FAILED' },
        'Netlify provisioning failed',
      );
      throw new DeploymentError(
        'DNS_PROVISIONING_FAILED',
        'DNS provisioning failed',
        502,
      );
    }
  }

  async verifyHostname(hostname: string): Promise<DnsVerificationOutcome> {
    const host = normalizeTarget(hostname);
    const expectedTarget = normalizeTarget(this.getDnsTarget());
    const checkedAt = new Date().toISOString();

    const records = (await this.resolveAny(host)).map(normalizeTarget);
    if (!recordsMatchTarget(records, expectedTarget)) {
      return {
        dnsStatus: 'failed',
        sslStatus: 'not_configured',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'DNS is not pointing at the expected Netlify deployment target.',
        code: 'DNS_NOT_READY',
      };
    }

    const tlsOk = await this.checkTls(host);
    return {
      dnsStatus: 'verified',
      sslStatus: tlsOk ? 'verified' : 'pending',
      hostname: host,
      expectedTarget,
      checkedAt,
      message: tlsOk
        ? 'DNS and SSL verification succeeded.'
        : 'DNS is verified. SSL certificate is not ready yet.',
      code: tlsOk ? undefined : 'SSL_NOT_READY',
    };
  }

  async verifySsl(hostname: string): Promise<DnsVerificationOutcome> {
    const host = normalizeTarget(hostname);
    const expectedTarget = normalizeTarget(this.getDnsTarget());
    const checkedAt = new Date().toISOString();

    const dns = await this.verifyHostname(host);
    if (dns.dnsStatus !== 'verified') {
      return { ...dns, code: 'DNS_NOT_READY' };
    }

    try {
      await this.client.provisionSsl(this.siteId);
    } catch (error) {
      if (!(error instanceof NetlifyApiError)) {
        throw error;
      }
      // Continue to public TLS check — API may fail while cert is already live.
    }

    const tlsOk = await this.checkTls(host);
    if (!tlsOk) {
      return {
        dnsStatus: 'verified',
        sslStatus: 'failed',
        hostname: host,
        expectedTarget,
        checkedAt,
        message: 'SSL certificate could not be verified for this hostname.',
        code: 'SSL_NOT_READY',
      };
    }

    return {
      dnsStatus: 'verified',
      sslStatus: 'verified',
      hostname: host,
      expectedTarget,
      checkedAt,
      message: 'DNS and SSL verification succeeded.',
    };
  }

  private async resolveDnsZoneId(): Promise<string> {
    if (this.configuredZoneId) {
      return this.configuredZoneId;
    }

    const base = this.getBaseDomain();
    const zones = await this.client.listDnsZones();
    const exact = zones.find((zone) => zone.name.toLowerCase() === base);
    if (exact) return exact.id;

    // Prefer longest matching parent zone (e.g. example.com for app.example.com).
    const parents = zones
      .filter((zone) => base === zone.name || base.endsWith(`.${zone.name.toLowerCase()}`))
      .sort((a, b) => b.name.length - a.name.length);
    if (parents[0]) return parents[0].id;

    throw new DeploymentError(
      'DNS_PROVISIONING_FAILED',
      'No Netlify DNS zone matches TENANT_BASE_DOMAIN',
      502,
    );
  }

  private findConflictingRecord(
    records: NetlifyDnsRecord[],
    label: string,
    hostname: string,
    expectedTarget: string,
  ): 'missing' | 'match' | 'conflict' {
    const candidates = records.filter((record) => {
      const host = normalizeTarget(record.hostname);
      return (
        host === label ||
        host === hostname ||
        host === `${label}.` ||
        host.startsWith(`${label}.`)
      );
    });

    if (candidates.length === 0) return 'missing';

    const match = candidates.some((record) => {
      const type = record.type.toUpperCase();
      if (type !== 'CNAME' && type !== 'NETLIFY' && type !== 'NETLIFYv6') {
        return false;
      }
      return recordsMatchTarget([record.value], expectedTarget);
    });

    return match ? 'match' : 'conflict';
  }

  private mapNetlifyError(error: NetlifyApiError): DeploymentError {
    const status =
      error.code === 'NETLIFY_AUTH_FAILED'
        ? 502
        : error.code === 'NETLIFY_SITE_NOT_FOUND'
          ? 502
          : 502;
    return new DeploymentError(error.code, this.safeMessage(error.code), status);
  }

  private safeMessage(code: string): string {
    switch (code) {
      case 'NETLIFY_AUTH_FAILED':
        return 'Netlify authentication failed';
      case 'NETLIFY_SITE_NOT_FOUND':
        return 'Configured Netlify site was not found';
      case 'SSL_PROVISIONING_FAILED':
        return 'SSL provisioning failed';
      case 'DEPLOYMENT_NOT_CONFIGURED':
        return 'Netlify deployment is not configured';
      default:
        return 'DNS provisioning failed';
    }
  }
}

export const createDeploymentProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): DeploymentProvider => {
  const config = getDeploymentEnvConfig(env);
  if (config.provider !== 'netlify') {
    return new ManualDeploymentProvider();
  }

  const token = getNetlifyAuthToken(env);
  if (!token || !config.netlifySiteId) {
    // Misconfigured Netlify — fail closed on provision instead of silently pretending success.
    return new ManualDeploymentProvider();
  }

  return new NetlifyDeploymentProvider({
    client: new NetlifyApiClient({ authToken: token }),
    siteId: config.netlifySiteId,
    dnsZoneId: config.netlifyDnsZoneId,
  });
};

let activeProvider: DeploymentProvider = createDeploymentProviderFromEnv();

export const deploymentProvider: DeploymentProvider = new Proxy({} as DeploymentProvider, {
  get(_target, prop, _receiver) {
    const value = Reflect.get(activeProvider, prop, activeProvider);
    return typeof value === 'function' ? value.bind(activeProvider) : value;
  },
});

export const setDeploymentProviderForTests = (provider: DeploymentProvider): void => {
  activeProvider = provider;
};

export const resetDeploymentProviderForTests = (): void => {
  activeProvider = createDeploymentProviderFromEnv();
};
