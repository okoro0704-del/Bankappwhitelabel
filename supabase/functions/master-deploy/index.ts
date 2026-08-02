import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts';
import { adminClient, loadActorProfile, requireUser } from '../_shared/supabase.ts';

function deriveDeploymentStatus(dns: string, ssl: string): string {
  if (dns === 'not_configured') return 'not_configured';
  if (dns === 'pending' || dns === 'failed') return 'waiting_for_dns';
  if (ssl === 'verified') return 'ready';
  if (ssl === 'pending') return 'ssl_pending';
  return 'dns_configured';
}

function buildDeployment(tenant: Record<string, unknown>, baseDomain: string, dnsTarget: string, provider: string) {
  const subdomain = String(tenant.subdomain);
  const hostname = `${subdomain}.${baseDomain}`;
  return {
    hostname,
    loginUrl: `https://${hostname}/login`,
    baseDomain,
    dnsTarget,
    dnsStatus: tenant.dns_status,
    sslStatus: tenant.ssl_status,
    deploymentStatus: tenant.deployment_status,
    dnsRecord: { type: 'CNAME', name: subdomain, target: dnsTarget },
    dnsCheckedAt: tenant.dns_checked_at ?? null,
    dnsVerifiedAt: tenant.dns_verified_at ?? null,
    lastProvisionedAt: tenant.last_provisioned_at ?? null,
    sslCheckedAt: tenant.ssl_checked_at ?? null,
    lastProvisionError: tenant.last_provision_error ?? null,
    ownerAssigned: Boolean(tenant.owner_user_id),
    provider,
  };
}

async function loadTenantBundle(admin: ReturnType<typeof adminClient>, tenantId: string) {
  const { data: tenant, error } = await admin.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  if (error || !tenant) {
    throw Object.assign(new Error('Tenant not found'), { code: 'NOT_FOUND', status: 404 });
  }
  const { data: branding } = await admin
    .from('tenant_branding')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return { tenant, branding };
}

function toDetail(
  tenant: Record<string, unknown>,
  branding: Record<string, unknown> | null,
  baseDomain: string,
  dnsTarget: string,
  provider: string,
) {
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      ownerUserId: tenant.owner_user_id ?? null,
      subdomain: tenant.subdomain,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at,
    },
    branding: {
      applicationName: branding?.application_name ?? tenant.name,
      logoUrl: branding?.logo_url ?? null,
      faviconUrl: branding?.favicon_url ?? null,
      primaryColor: branding?.primary_color ?? '#0B1F3A',
      secondaryColor: branding?.secondary_color ?? '#1F6FEB',
      accentColor: branding?.accent_color ?? '#C9A227',
      loginHeadline: branding?.login_headline ?? null,
      loginSubtitle: branding?.login_subtitle ?? null,
      supportEmail: branding?.support_email ?? null,
      supportPhone: branding?.support_phone ?? null,
    },
    deployment: buildDeployment(tenant, baseDomain, dnsTarget, provider),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user } = await requireUser(req);
    const admin = adminClient();
    const actor = await loadActorProfile(admin, user.id);
    if (!actor.isMasterAdmin) {
      return errorResponse('FORBIDDEN', 'Master admin access required', 403);
    }

    const body = await req.json();
    const action = String(body.action ?? '');
    const tenantId = String(body.tenantId ?? '');
    const baseDomain = (Deno.env.get('TENANT_BASE_DOMAIN') ?? 'app.example.com').toLowerCase();
    const dnsTarget = (Deno.env.get('DEPLOYMENT_DNS_TARGET') ?? 'edgeserver.example.com')
      .toLowerCase()
      .replace(/\.$/, '');
    const token = Deno.env.get('NETLIFY_AUTH_TOKEN')?.trim() ?? '';
    const siteId = Deno.env.get('NETLIFY_SITE_ID')?.trim() ?? '';
    const provider = token && siteId ? 'netlify' : 'manual';

    if (!tenantId) {
      return errorResponse('VALIDATION_ERROR', 'tenantId is required', 400);
    }

    if (action === 'getDeployment') {
      const { tenant, branding } = await loadTenantBundle(admin, tenantId);
      return jsonResponse({
        data: buildDeployment(tenant, baseDomain, dnsTarget, provider),
      });
    }

    if (action === 'verifyDns' || action === 'verifySsl' || action === 'provision') {
      const { tenant, branding } = await loadTenantBundle(admin, tenantId);
      const hostname = `${tenant.subdomain}.${baseDomain}`;

      if (action === 'provision' && provider !== 'netlify') {
        return errorResponse(
          'DEPLOYMENT_NOT_CONFIGURED',
          'Netlify credentials are not configured on the server',
          400,
        );
      }

      let dnsStatus = String(tenant.dns_status);
      let sslStatus = String(tenant.ssl_status);
      let lastError: string | null = null;

      if (provider === 'netlify' && (action === 'provision' || action === 'verifyDns')) {
        try {
          await ensureNetlifyAlias(token, siteId, hostname);
          if (action === 'provision') {
            await ensureNetlifyDnsCname(token, tenant.subdomain, dnsTarget, baseDomain);
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Provisioning failed';
          dnsStatus = 'failed';
        }
      }

      const records = await lookupCname(hostname);
      const matched = records.some((r) => r.replace(/\.$/, '').toLowerCase() === dnsTarget);
      if (!lastError) {
        dnsStatus = matched ? 'verified' : records.length ? 'pending' : 'failed';
      }

      if (action === 'verifySsl' || (action === 'provision' && dnsStatus === 'verified')) {
        const tlsOk = await checkTls(hostname);
        sslStatus = tlsOk ? 'verified' : dnsStatus === 'verified' ? 'pending' : 'not_configured';
      }

      const deploymentStatus = deriveDeploymentStatus(dnsStatus, sslStatus);
      const now = new Date().toISOString();
      const { data: updated, error } = await admin
        .from('tenants')
        .update({
          dns_status: dnsStatus,
          ssl_status: sslStatus,
          deployment_status: deploymentStatus,
          dns_checked_at: now,
          dns_verified_at: dnsStatus === 'verified' ? now : tenant.dns_verified_at,
          ssl_checked_at: action === 'verifySsl' || action === 'provision' ? now : tenant.ssl_checked_at,
          last_provisioned_at: action === 'provision' ? now : tenant.last_provisioned_at,
          last_provision_error: lastError,
          updated_at: now,
        })
        .eq('id', tenantId)
        .select('*')
        .single();
      if (error) {
        return errorResponse('INTERNAL_ERROR', error.message, 500);
      }

      const detail = toDetail(updated, branding, baseDomain, dnsTarget, provider);
      return jsonResponse({
        data: {
          status: action === 'verifySsl' ? sslStatus : dnsStatus,
          hostname,
          expectedTarget: dnsTarget,
          deploymentStatus,
          dnsStatus,
          sslStatus,
          message: lastError ?? (dnsStatus === 'verified' ? 'DNS verified' : 'DNS check complete'),
          checkedAt: now,
          code: lastError ? 'DNS_PROVISIONING_FAILED' : null,
          tenant: detail,
        },
      });
    }

    return errorResponse('VALIDATION_ERROR', 'Unknown action', 400);
  } catch (error) {
    const err = error as { code?: string; status?: number; message?: string };
    return errorResponse(err.code ?? 'INTERNAL_ERROR', err.message ?? 'Request failed', err.status ?? 500);
  }
});

async function ensureNetlifyAlias(token: string, siteId: string, hostname: string) {
  const site = await netlifyFetch(token, `/sites/${siteId}`);
  const aliases: string[] = site.domain_aliases ?? [];
  if (!aliases.includes(hostname)) {
    await netlifyFetch(token, `/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({ domain_aliases: [...aliases, hostname] }),
    });
  }
}

async function ensureNetlifyDnsCname(
  token: string,
  label: string,
  target: string,
  baseDomain: string,
) {
  const zones = await netlifyFetch(token, '/dns_zones');
  const zone = (zones as Array<{ id: string; name: string }>).find(
    (z) => z.name.replace(/\.$/, '').toLowerCase() === baseDomain,
  );
  if (!zone) {
    throw new Error('Netlify DNS zone for TENANT_BASE_DOMAIN not found');
  }
  const records = await netlifyFetch(token, `/dns_zones/${zone.id}/dns_records`);
  const existing = (records as Array<{ hostname: string; type: string; value: string }>).find(
    (r) =>
      r.type === 'CNAME' &&
      r.hostname.replace(/\.$/, '').toLowerCase() === `${label}.${baseDomain}`,
  );
  if (existing) {
    if (existing.value.replace(/\.$/, '').toLowerCase() !== target) {
      throw Object.assign(new Error('Conflicting DNS record'), { code: 'DEPLOYMENT_CONFLICT', status: 409 });
    }
    return;
  }
  await netlifyFetch(token, `/dns_zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CNAME', hostname: label, value: target, ttl: 3600 }),
  });
}

async function netlifyFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Netlify authentication failed'), { code: 'NETLIFY_AUTH_FAILED', status: 401 });
  }
  if (res.status === 404) {
    throw Object.assign(new Error('Netlify resource not found'), { code: 'NETLIFY_SITE_NOT_FOUND', status: 404 });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Netlify error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function lookupCname(hostname: string): Promise<string[]> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`, {
      headers: { Accept: 'application/dns-json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Answer ?? []).map((a: { data?: string }) => String(a.data ?? '').replace(/\.$/, ''));
  } catch {
    return [];
  }
}

async function checkTls(hostname: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${hostname}/`, { method: 'HEAD', redirect: 'manual' });
    return res.status > 0;
  } catch {
    return false;
  }
}
