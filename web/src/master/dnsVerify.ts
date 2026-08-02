import type { TenantDnsStatus, TenantSslStatus, TenantDeploymentStatus } from '../types/tenant';

export function deriveDeploymentStatus(
  dns: TenantDnsStatus,
  ssl: TenantSslStatus,
): TenantDeploymentStatus {
  if (dns === 'not_configured') return 'not_configured';
  if (dns === 'pending' || dns === 'failed') return 'waiting_for_dns';
  if (ssl === 'verified') return 'ready';
  if (ssl === 'pending' || ssl === 'failed') return 'ssl_pending';
  return 'dns_configured';
}

const DOH_ENDPOINTS = [
  // Cloudflare JSON DoH (CORS: *)
  (name: string, type: string) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  (name: string, type: string) =>
    `https://mozilla.cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
];

async function lookupDns(name: string, type: 'CNAME' | 'A' | 'AAAA'): Promise<string[]> {
  const want = type === 'CNAME' ? 5 : type === 'A' ? 1 : 28;
  const typeNum = String(want);

  for (const build of DOH_ENDPOINTS) {
    for (const typeParam of [type, typeNum]) {
      try {
        const res = await fetch(build(name, typeParam), {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/dns-json',
          },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          Status?: number;
          Answer?: Array<{ type?: number; data?: string; name?: string }>;
        };
        // Status 0 = NOERROR
        const answers = data.Answer ?? [];
        const values = answers
          .filter((a) => a.type === want)
          .map((a) => String(a.data ?? '').replace(/\.$/, '').toLowerCase())
          .filter(Boolean);
        if (values.length) return values;
      } catch {
        // try next
      }
    }
  }
  return [];
}

/** When DoH is blocked, prove the hostname at least resolves via HTTPS connectivity. */
async function connectivityResolves(hostname: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    await fetch(`https://${hostname}/`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    // opaque response means DNS worked well enough to open a connection
    return true;
  } catch {
    return false;
  }
}

export async function verifyPublicDns(
  hostname: string,
  dnsTarget: string,
): Promise<{ status: TenantDnsStatus; detail: string }> {
  const target = dnsTarget.replace(/\.$/, '').toLowerCase().replace(/\.$/, '');
  const host = hostname.replace(/\.$/, '').toLowerCase();

  if (!host || !target) {
    return {
      status: 'failed',
      detail: 'Missing hostname or DNS target. Check VITE_TENANT_BASE_DOMAIN / VITE_DEPLOYMENT_DNS_TARGET.',
    };
  }

  const cnames = await lookupDns(host, 'CNAME');

  if (cnames.some((c) => c === target)) {
    return { status: 'verified', detail: `CNAME ${host} → ${target}` };
  }

  for (const hop of cnames) {
    if (hop === host) continue;
    const next = await lookupDns(hop, 'CNAME');
    if (next.some((c) => c === target) || hop === target) {
      return {
        status: 'verified',
        detail: `CNAME chain ${host} → ${hop} → ${target}`,
      };
    }
  }

  const [hostA, hostAAAA, targetA, targetAAAA] = await Promise.all([
    lookupDns(host, 'A'),
    lookupDns(host, 'AAAA'),
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
        detail: `A/AAAA for ${host} matches ${target} (${overlap.slice(0, 2).join(', ')})`,
      };
    }
    return {
      status: 'pending',
      detail: `${host} resolves to ${[...hostIps].slice(0, 2).join(', ')}, expected IPs of ${target}`,
    };
  }

  // DoH returned nothing (often blocked). Fall back to connectivity against both hosts.
  if (hostIps.size === 0 && targetIps.size === 0) {
    const [hostOk, targetOk] = await Promise.all([
      connectivityResolves(host),
      connectivityResolves(target),
    ]);
    if (hostOk && targetOk) {
      return {
        status: 'verified',
        detail: `${host} and ${target} both resolve (DoH blocked; connectivity fallback)`,
      };
    }
    if (hostOk && target.endsWith('.netlify.app')) {
      return {
        status: 'verified',
        detail: `${host} resolves to Netlify hosting (DoH blocked; connectivity fallback)`,
      };
    }
    if (!hostOk) {
      return {
        status: 'failed',
        detail: `Cannot resolve ${host}. Create CNAME ${host} → ${target}. If the record exists, wait for DNS propagation.`,
      };
    }
  }

  if (hostIps.size > 0 && targetIps.size === 0) {
    // Host resolves; target DoH failed — if target is Netlify, accept host resolution.
    if (target.endsWith('.netlify.app')) {
      const targetOk = await connectivityResolves(target);
      if (targetOk) {
        return {
          status: 'verified',
          detail: `${host} resolves (${[...hostIps].slice(0, 2).join(', ')}); ${target} reachable`,
        };
      }
    }
    return {
      status: 'pending',
      detail: `${host} resolves, but could not look up ${target} to compare`,
    };
  }

  if (cnames.length > 0) {
    return {
      status: 'pending',
      detail: `CNAME is ${cnames.join(', ')} (expected ${target})`,
    };
  }

  return {
    status: 'failed',
    detail: `No DNS records found for ${host}. Create CNAME ${host} → ${target}`,
  };
}

export async function checkTls(hostname: string): Promise<{ ok: boolean; detail: string }> {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`https://${host}/`, {
      method: 'GET',
      mode: 'cors',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    window.clearTimeout(timer);
    if (res.status > 0) {
      return { ok: true, detail: `HTTPS ${res.status} from ${host}` };
    }
    return { ok: false, detail: `Unexpected HTTPS response from ${host}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cert|ssl|tls|name.?mismatch|expired|ERR_CERT|ERR_NAME|ENOTFOUND/i.test(msg)) {
      return { ok: false, detail: `TLS/HTTPS check failed for ${host}: ${msg}` };
    }
    if (/failed to fetch|networkerror|load failed|aborted/i.test(msg)) {
      // CORS opaque / mixed failure after DNS works — confirm with no-cors
      const reachable = await connectivityResolves(host);
      if (reachable) {
        return {
          ok: true,
          detail: `HTTPS endpoint reachable for ${host} (browser CORS blocked body; TLS assumed OK)`,
        };
      }
      return { ok: false, detail: `TLS/HTTPS check failed for ${host}: ${msg}` };
    }
    return { ok: false, detail: `TLS/HTTPS check failed for ${host}: ${msg}` };
  }
}

export function generateTemporaryPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
