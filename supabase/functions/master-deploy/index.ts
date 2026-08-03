import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts';
import { adminClient, loadActorProfile, requireUser } from '../_shared/supabase.ts';

type DnsSslStatus = 'not_configured' | 'pending' | 'verified' | 'failed';

function deriveDeploymentStatus(dns: string, ssl: string): string {
  if (dns === 'not_configured') return 'not_configured';
  if (dns === 'pending' || dns === 'failed') return 'waiting_for_dns';
  if (ssl === 'verified') return 'ready';
  if (ssl === 'pending' || ssl === 'failed') return 'ssl_pending';
  return 'dns_configured';
}

function buildDeployment(
  tenant: Record<string, unknown>,
  baseDomain: string,
  dnsTarget: string,
  provider: string,
) {
  const subdomain = String(tenant.subdomain);
  const hostname = `${subdomain}.${baseDomain}`;
  return {
    hostname,
    homeUrl: `https://${hostname}/`,
    loginUrl: `https://${hostname}/login`,
    adminDashboardUrl: `https://${hostname}/admin`,
    adminHomeUrl: `https://${hostname}/admin/home`,
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

function requireDeployEnv(baseDomain: string, dnsTarget: string): string | null {
  if (!baseDomain) {
    return 'Edge secret TENANT_BASE_DOMAIN is not configured';
  }
  if (!dnsTarget) {
    return 'Edge secret DEPLOYMENT_DNS_TARGET is not configured';
  }
  return null;
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
    const baseDomain = (Deno.env.get('TENANT_BASE_DOMAIN') ?? '').trim().toLowerCase().replace(/\.$/, '');
    const dnsTarget = (Deno.env.get('DEPLOYMENT_DNS_TARGET') ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '');
    const token = Deno.env.get('NETLIFY_AUTH_TOKEN')?.trim() ?? '';
    const siteId = Deno.env.get('NETLIFY_SITE_ID')?.trim() ?? '';
    const provider = token && siteId ? 'netlify' : 'manual';

    if (!tenantId) {
      return errorResponse('VALIDATION_ERROR', 'tenantId is required', 400);
    }

    const envError = requireDeployEnv(baseDomain, dnsTarget);
    // Allow getDeployment even with missing env so the Master UI can still load.
    if (action === 'getDeployment') {
      const { tenant } = await loadTenantBundle(admin, tenantId);
      return jsonResponse({
        data: buildDeployment(
          tenant,
          baseDomain || 'app.example.com',
          dnsTarget || 'edgeserver.example.com',
          provider,
        ),
      });
    }

    if (action === 'verifyDns' || action === 'verifySsl' || action === 'provision') {
      if (envError) {
        return errorResponse('DEPLOYMENT_NOT_CONFIGURED', envError, 400);
      }

      const { tenant, branding } = await loadTenantBundle(admin, tenantId);
      const hostname = `${String(tenant.subdomain).toLowerCase()}.${baseDomain}`;

      if (action === 'provision' && provider !== 'netlify') {
        return errorResponse(
          'DEPLOYMENT_NOT_CONFIGURED',
          'Netlify credentials are not configured (NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID)',
          400,
        );
      }

      let dnsStatus = String(tenant.dns_status) as DnsSslStatus;
      let sslStatus = String(tenant.ssl_status) as DnsSslStatus;
      let lastError: string | null = null;
      let resultCode: string | null = null;
      let checkDetail = '';

      // Provisioning writes: alias + DNS + SSL kickoff. Verify DNS/SSL are public checks only.
      if (provider === 'netlify' && action === 'provision') {
        try {
          await ensureNetlifyAlias(token, siteId, hostname);
          await ensureNetlifyDnsCname(token, String(tenant.subdomain), dnsTarget, baseDomain);
          await ensureNetlifySsl(token, siteId);
        } catch (e) {
          const err = e as { code?: string; message?: string };
          lastError = err.message ?? 'Provisioning failed';
          resultCode = err.code ?? 'DNS_PROVISIONING_FAILED';
          dnsStatus = 'failed';
        }
      }

      if (provider === 'netlify' && action === 'verifySsl' && !lastError) {
        try {
          await ensureNetlifyAlias(token, siteId, hostname);
          await ensureNetlifySsl(token, siteId);
        } catch (e) {
          // Alias/SSL kickoff failures should not block the public TLS check; record hint only.
          const msg = e instanceof Error ? e.message : 'SSL provisioning kickoff failed';
          checkDetail = msg;
        }
      }

      const dns = await verifyPublicDns(hostname, dnsTarget);
      if (!lastError) {
        dnsStatus = dns.status;
        checkDetail = dns.detail;
        if (dnsStatus === 'failed') {
          resultCode = 'DNS_NOT_READY';
          lastError = dns.detail;
        } else if (dnsStatus === 'pending') {
          resultCode = 'DNS_NOT_READY';
        }
      }

      if (action === 'verifySsl' || (action === 'provision' && dnsStatus === 'verified')) {
        if (dnsStatus !== 'verified') {
          sslStatus = 'not_configured';
          resultCode = resultCode ?? 'DNS_NOT_READY';
          lastError = lastError ?? 'DNS must verify before SSL can be checked';
          checkDetail = lastError;
        } else {
          const tls = await checkTls(hostname);
          sslStatus = tls.ok ? 'verified' : 'pending';
          checkDetail = tls.detail;
          if (!tls.ok) {
            resultCode = 'SSL_NOT_READY';
            lastError = tls.detail;
          } else {
            resultCode = null;
            lastError = null;
          }
        }
      } else if (action === 'verifyDns' && dnsStatus === 'verified') {
        resultCode = null;
        lastError = null;
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
          dns_verified_at: dnsStatus === 'verified' ? (tenant.dns_verified_at ?? now) : null,
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
      const message = buildActionMessage(action, dnsStatus, sslStatus, lastError, checkDetail);

      return jsonResponse({
        data: {
          status: action === 'verifySsl' ? sslStatus : dnsStatus,
          hostname,
          expectedTarget: dnsTarget,
          deploymentStatus,
          dnsStatus,
          sslStatus,
          message,
          checkedAt: now,
          code: resultCode,
          detail: checkDetail,
          tenant: detail,
        },
      });
    }

    if (action === 'provisionTenantAdmin') {
      const username = String(body.username ?? '')
        .trim()
        .toLowerCase();
      const password = String(body.password ?? '');
      const emailInput = String(body.email ?? '')
        .trim()
        .toLowerCase();

      if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        return errorResponse(
          'VALIDATION_ERROR',
          'Admin username must be 3–30 characters: lowercase letters, numbers, underscore.',
          400,
        );
      }
      if (password.length < 8) {
        return errorResponse('VALIDATION_ERROR', 'Temporary password must be at least 8 characters.', 400);
      }

      const { tenant } = await loadTenantBundle(admin, tenantId);
      let ownerId = (tenant.owner_user_id as string | null) ?? null;
      let email = emailInput;

      if (ownerId) {
        const { data: ownerProfile } = await admin
          .from('profiles')
          .select('id, email, username, role, tenant_id')
          .eq('user_id', ownerId)
          .maybeSingle();
        if (!email) {
          email = String(ownerProfile?.email ?? '').trim().toLowerCase();
        }
        if (!email) {
          const { data: authUser } = await admin.auth.admin.getUserById(ownerId);
          email = String(authUser.user?.email ?? '')
            .trim()
            .toLowerCase();
        }
        if (!email) {
          return errorResponse(
            'VALIDATION_ERROR',
            'Owner has no email. Provide an admin email to enable login.',
            400,
          );
        }

        const { error: pwdError } = await admin.auth.admin.updateUserById(ownerId, {
          password,
          email,
          email_confirm: true,
        });
        if (pwdError) {
          return errorResponse('VALIDATION_ERROR', pwdError.message, 400);
        }

        if (ownerProfile) {
          const { data: clash } = await admin
            .from('profiles')
            .select('id')
            .eq('username', username)
            .neq('id', ownerProfile.id)
            .maybeSingle();
          if (clash) {
            return errorResponse('VALIDATION_ERROR', 'That username is already taken.', 400);
          }
          const { error: profileError } = await admin
            .from('profiles')
            .update({
              username,
              email,
              role: 'admin',
              tenant_id: tenantId,
              status: 'active',
            })
            .eq('id', ownerProfile.id);
          if (profileError) {
            return errorResponse('INTERNAL_ERROR', profileError.message, 500);
          }
        } else {
          await ensureAdminProfile(admin, {
            userId: ownerId,
            tenantId,
            email,
            username,
          });
        }
      } else {
        if (!email || !email.includes('@')) {
          return errorResponse(
            'VALIDATION_ERROR',
            'Admin email is required when the tenant has no owner yet.',
            400,
          );
        }

        const { data: clash } = await admin
          .from('profiles')
          .select('id')
          .eq('username', username)
          .maybeSingle();
        if (clash) {
          return errorResponse('VALIDATION_ERROR', 'That username is already taken.', 400);
        }

        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (createError || !created.user) {
          return errorResponse(
            'VALIDATION_ERROR',
            createError?.message ?? 'Failed to create admin auth user',
            400,
          );
        }
        ownerId = created.user.id;
        try {
          await ensureAdminProfile(admin, {
            userId: ownerId,
            tenantId,
            email,
            username,
          });
        } catch (profileErr) {
          await admin.auth.admin.deleteUser(ownerId);
          const msg = profileErr instanceof Error ? profileErr.message : 'Failed to create admin profile';
          return errorResponse('INTERNAL_ERROR', msg, 500);
        }

        const { error: ownerError } = await admin
          .from('tenants')
          .update({ owner_user_id: ownerId, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
        if (ownerError) {
          return errorResponse('INTERNAL_ERROR', ownerError.message, 500);
        }
      }

      const { error: handoffError } = await admin
        .from('tenants')
        .update({
          handoff_admin_username: username,
          handoff_temp_password: password,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantId);
      if (handoffError) {
        return errorResponse('INTERNAL_ERROR', handoffError.message, 500);
      }

      return jsonResponse({
        data: {
          ownerUserId: ownerId,
          username,
          email,
          message: 'Admin login enabled. Username and password can be used at /admin/login.',
        },
      });
    }

    return errorResponse('VALIDATION_ERROR', 'Unknown action', 400);
  } catch (error) {
    const err = error as { code?: string; status?: number; message?: string };
    return errorResponse(err.code ?? 'INTERNAL_ERROR', err.message ?? 'Request failed', err.status ?? 500);
  }
});

async function ensureAdminProfile(
  admin: ReturnType<typeof adminClient>,
  args: { userId: string; tenantId: string; email: string; username: string },
) {
  const accountNumber = String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000));
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: args.userId,
      tenant_id: args.tenantId,
      first_name: 'Tenant',
      last_name: 'Admin',
      email: args.email,
      username: args.username,
      status: 'active',
      role: 'admin',
    })
    .select('*')
    .single();
  if (profileError) throw profileError;

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .insert({
      profile_id: profile.id,
      tenant_id: args.tenantId,
      account_number: accountNumber,
      account_type: 'escrow',
      account_status: 'active',
      one_time_transfer_used: false,
    })
    .select('*')
    .single();
  if (accountError) throw accountError;

  const { error: walletError } = await admin.from('wallets').insert({
    account_id: account.id,
    tenant_id: args.tenantId,
    balance: 0,
    currency: 'USD',
  });
  if (walletError) throw walletError;
}

function buildActionMessage(
  action: string,
  dnsStatus: string,
  sslStatus: string,
  lastError: string | null,
  detail: string,
): string {
  if (lastError && (dnsStatus === 'failed' || (action === 'verifySsl' && sslStatus !== 'verified'))) {
    return lastError;
  }
  if (action === 'verifySsl') {
    if (sslStatus === 'verified') return 'SSL verified for hostname';
    return detail || 'SSL not ready yet. Wait for certificate issuance, then retry.';
  }
  if (action === 'provision') {
    if (dnsStatus === 'verified' && sslStatus === 'verified') return 'Provisioning complete — DNS and SSL verified';
    if (dnsStatus === 'verified') return 'Hostname provisioned. DNS verified; SSL still pending.';
    return detail || 'Provisioning ran. DNS is not verified yet.';
  }
  if (dnsStatus === 'verified') return 'DNS verified';
  return detail || 'DNS check complete';
}

async function ensureNetlifyAlias(token: string, siteId: string, hostname: string) {
  const site = await netlifyFetch(token, `/sites/${siteId}`);
  const aliases: string[] = Array.isArray(site.domain_aliases) ? site.domain_aliases : [];
  const customDomain = String(site.custom_domain ?? '').toLowerCase();
  if (aliases.map((a) => a.toLowerCase()).includes(hostname.toLowerCase())) return;
  if (customDomain === hostname.toLowerCase()) return;

  await netlifyFetch(token, `/sites/${siteId}`, {
    method: 'PATCH',
    body: JSON.stringify({ domain_aliases: [...aliases, hostname] }),
  });
}

async function ensureNetlifyDnsCname(
  token: string,
  label: string,
  target: string,
  baseDomain: string,
) {
  const zoneId = Deno.env.get('NETLIFY_DNS_ZONE_ID')?.trim();
  const zones = await netlifyFetch(token, '/dns_zones');
  const zoneList = zones as Array<{ id: string; name: string }>;
  const zone =
    (zoneId ? zoneList.find((z) => z.id === zoneId) : null) ??
    zoneList.find((z) => z.name.replace(/\.$/, '').toLowerCase() === baseDomain);
  if (!zone) {
    throw Object.assign(new Error(`Netlify DNS zone for ${baseDomain} not found`), {
      code: 'DEPLOYMENT_NOT_CONFIGURED',
      status: 400,
    });
  }

  const fqdn = `${label}.${baseDomain}`.toLowerCase();
  const records = await netlifyFetch(token, `/dns_zones/${zone.id}/dns_records`);
  const existing = (records as Array<{ id?: string; hostname?: string; type?: string; value?: string }>).find(
    (r) => {
      const host = normalizeRecordHostname(r.hostname, baseDomain);
      const type = String(r.type ?? '').toUpperCase();
      return host === fqdn && (type === 'CNAME' || type === 'NETLIFY');
    },
  );

  if (existing) {
    const value = String(existing.value ?? '')
      .replace(/\.$/, '')
      .toLowerCase();
    const type = String(existing.type ?? '').toUpperCase();
    if (type === 'CNAME' && value && value !== target) {
      throw Object.assign(
        new Error(`Conflicting DNS record: ${fqdn} → ${value} (expected ${target})`),
        { code: 'DEPLOYMENT_CONFLICT', status: 409 },
      );
    }
    return;
  }

  await netlifyFetch(token, `/dns_zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CNAME', hostname: label, value: target, ttl: 3600 }),
  });
}

async function ensureNetlifySsl(token: string, siteId: string) {
  try {
    await netlifyFetch(token, `/sites/${siteId}/ssl`, { method: 'POST' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Already issued / renew-required / DNS not ready yet — verification will report status.
    if (/already|exist|pending|certificate parameter|bad dns|no custom domain|422/i.test(msg)) {
      return;
    }
    throw e;
  }
}

function normalizeRecordHostname(hostname: string | undefined, baseDomain: string): string {
  const raw = String(hostname ?? '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!raw) return '';
  if (raw.includes('.')) return raw;
  return `${raw}.${baseDomain}`;
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
    throw Object.assign(new Error('Netlify authentication failed'), {
      code: 'NETLIFY_AUTH_FAILED',
      status: 401,
    });
  }
  if (res.status === 404) {
    throw Object.assign(new Error(`Netlify resource not found: ${path}`), {
      code: 'NETLIFY_SITE_NOT_FOUND',
      status: 404,
    });
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(text || `Netlify error ${res.status}`), {
      code: 'DNS_PROVISIONING_FAILED',
      status: res.status,
    });
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function lookupDns(name: string, type: 'CNAME' | 'A' | 'AAAA'): Promise<string[]> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
      if (!res.ok) continue;
      const data = await res.json();
      const answers = (data.Answer ?? []) as Array<{ type?: number; data?: string }>;
      // CNAME=5, A=1, AAAA=28
      const want = type === 'CNAME' ? 5 : type === 'A' ? 1 : 28;
      const values = answers
        .filter((a) => a.type == null || a.type === want)
        .map((a) => String(a.data ?? '').replace(/\.$/, '').toLowerCase())
        .filter(Boolean);
      if (values.length) return values;
    } catch {
      // try next resolver
    }
  }
  return [];
}

async function verifyPublicDns(
  hostname: string,
  dnsTarget: string,
): Promise<{ status: DnsSslStatus; detail: string; records: string[] }> {
  const target = dnsTarget.replace(/\.$/, '').toLowerCase();
  const cnames = await lookupDns(hostname, 'CNAME');

  if (cnames.some((c) => c === target)) {
    return { status: 'verified', detail: `CNAME ${hostname} → ${target}`, records: cnames };
  }

  // One-hop CNAME chain (CDN / intermediate)
  for (const hop of cnames) {
    if (hop === hostname) continue;
    const next = await lookupDns(hop, 'CNAME');
    if (next.some((c) => c === target)) {
      return {
        status: 'verified',
        detail: `CNAME chain ${hostname} → ${hop} → ${target}`,
        records: cnames,
      };
    }
  }

  // Netlify DNS / ALIAS often flattens to A/AAAA — compare address sets with the target host.
  const [hostA, hostAAAA, targetA, targetAAAA] = await Promise.all([
    lookupDns(hostname, 'A'),
    lookupDns(hostname, 'AAAA'),
    lookupDns(target, 'A'),
    lookupDns(target, 'AAAA'),
  ]);
  const hostIps = new Set([...hostA, ...hostAAAA]);
  const targetIps = new Set([...targetA, ...targetAAAA]);
  if (hostIps.size > 0 && targetIps.size > 0) {
    const overlap = [...hostIps].filter((ip) => targetIps.has(ip));
    if (overlap.length > 0) {
      return {
        status: 'verified',
        detail: `A/AAAA for ${hostname} matches ${target}`,
        records: [...hostIps],
      };
    }
    return {
      status: 'pending',
      detail: `${hostname} resolves, but IPs do not match ${target} yet`,
      records: [...hostIps],
    };
  }

  if (cnames.length > 0) {
    return {
      status: 'pending',
      detail: `CNAME is ${cnames.join(', ')} (expected ${target})`,
      records: cnames,
    };
  }

  return {
    status: 'failed',
    detail: `No DNS records found for ${hostname}. Create CNAME ${hostname} → ${target}`,
    records: [],
  };
}

async function checkTls(hostname: string): Promise<{ ok: boolean; detail: string }> {
  // Prefer raw TLS handshake (validates certificate hostname in Deno).
  try {
    // deno-lint-ignore no-explicit-any
    const connectTls = (Deno as any).connectTls as
      | ((args: { hostname: string; port: number }) => Promise<{ close: () => void }>)
      | undefined;
    if (typeof connectTls === 'function') {
      const conn = await connectTls({ hostname, port: 443 });
      try {
        conn.close();
      } catch {
        // ignore close errors
      }
      return { ok: true, detail: `TLS handshake ok for ${hostname}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Fall through to HTTPS fetch for more detail
    if (/invalid|certificate|unknown|mismatch|expired/i.test(msg)) {
      // still try fetch — some runtimes differ
    }
  }

  try {
    const res = await fetch(`https://${hostname}/`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'WebFinance-DeployCheck/1.0' },
    });
    // Any HTTP response means TCP+TLS succeeded for this hostname.
    if (res.status > 0) {
      return { ok: true, detail: `HTTPS ${res.status} from ${hostname}` };
    }
    return { ok: false, detail: `Unexpected HTTPS response from ${hostname}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      detail: `TLS/HTTPS check failed for ${hostname}: ${msg}`,
    };
  }
}
