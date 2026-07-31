/**
 * Thin Netlify REST API client (OpenAPI: api.netlify.com/api/v1).
 * Injectable fetch for unit tests. Never logs the auth token.
 */

export type NetlifySite = {
  id: string;
  name?: string;
  url?: string;
  ssl_url?: string;
  custom_domain?: string | null;
  domain_aliases?: string[];
  default_domain?: string;
};

export type NetlifyDnsZone = {
  id: string;
  name: string;
  site_id?: string | null;
};

export type NetlifyDnsRecord = {
  id: string;
  hostname: string;
  type: string;
  value: string;
  ttl?: number;
  dns_zone_id?: string;
  site_id?: string | null;
  managed?: boolean;
};

export type NetlifySniCertificate = {
  state?: string;
  domains?: string[];
  created_at?: string;
  updated_at?: string;
  expires_at?: string;
};

export class NetlifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code:
      | 'NETLIFY_AUTH_FAILED'
      | 'NETLIFY_SITE_NOT_FOUND'
      | 'DNS_PROVISIONING_FAILED'
      | 'SSL_PROVISIONING_FAILED'
      | 'DEPLOYMENT_NOT_CONFIGURED' = 'DNS_PROVISIONING_FAILED',
  ) {
    super(message);
    this.name = 'NetlifyApiError';
  }
}

export type NetlifyApiClientOptions = {
  authToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class NetlifyApiClient {
  private readonly authToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NetlifyApiClientOptions) {
    this.authToken = options.authToken;
    this.baseUrl = (options.baseUrl ?? 'https://api.netlify.com/api/v1').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getSite(siteId: string): Promise<NetlifySite> {
    return this.request<NetlifySite>('GET', `/sites/${encodeURIComponent(siteId)}`);
  }

  async updateSite(
    siteId: string,
    body: { domain_aliases?: string[]; custom_domain?: string },
  ): Promise<NetlifySite> {
    return this.request<NetlifySite>('PATCH', `/sites/${encodeURIComponent(siteId)}`, body);
  }

  async listDnsZones(): Promise<NetlifyDnsZone[]> {
    return this.request<NetlifyDnsZone[]>('GET', '/dns_zones');
  }

  async getDnsZone(zoneId: string): Promise<NetlifyDnsZone> {
    return this.request<NetlifyDnsZone>('GET', `/dns_zones/${encodeURIComponent(zoneId)}`);
  }

  async listDnsRecords(zoneId: string): Promise<NetlifyDnsRecord[]> {
    return this.request<NetlifyDnsRecord[]>(
      'GET',
      `/dns_zones/${encodeURIComponent(zoneId)}/dns_records`,
    );
  }

  async createDnsRecord(
    zoneId: string,
    record: { type: string; hostname: string; value: string; ttl?: number },
  ): Promise<NetlifyDnsRecord> {
    return this.request<NetlifyDnsRecord>(
      'POST',
      `/dns_zones/${encodeURIComponent(zoneId)}/dns_records`,
      record,
      201,
    );
  }

  async provisionSsl(siteId: string): Promise<NetlifySniCertificate> {
    return this.request<NetlifySniCertificate>(
      'POST',
      `/sites/${encodeURIComponent(siteId)}/ssl`,
    );
  }

  async getSsl(siteId: string): Promise<NetlifySniCertificate> {
    return this.request<NetlifySniCertificate>(
      'GET',
      `/sites/${encodeURIComponent(siteId)}/ssl`,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expectedStatus?: number,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      throw new NetlifyApiError(
        response.status,
        'Netlify authentication failed',
        'NETLIFY_AUTH_FAILED',
      );
    }

    if (response.status === 404) {
      throw new NetlifyApiError(
        response.status,
        'Netlify resource not found',
        path.includes('/sites/') ? 'NETLIFY_SITE_NOT_FOUND' : 'DNS_PROVISIONING_FAILED',
      );
    }

    if (!response.ok && response.status !== expectedStatus) {
      // Never echo raw provider bodies that might contain sensitive data.
      const code =
        path.includes('/ssl') ? 'SSL_PROVISIONING_FAILED' : 'DNS_PROVISIONING_FAILED';
      throw new NetlifyApiError(
        response.status,
        'Netlify request failed',
        code,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
