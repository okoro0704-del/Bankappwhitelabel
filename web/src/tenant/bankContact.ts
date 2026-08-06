/** Tenant support inbox: info4{subdomain}@webfinance.app */
export function bankContactEmail(subdomain: string | null | undefined): string {
  const label = (subdomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!label) return 'info4@webfinance.app';
  return `info4${label}@webfinance.app`;
}

export function bankContactMailto(
  subdomain: string | null | undefined,
  subject = 'Transfer assistance',
): string {
  return `mailto:${bankContactEmail(subdomain)}?subject=${encodeURIComponent(subject)}`;
}
