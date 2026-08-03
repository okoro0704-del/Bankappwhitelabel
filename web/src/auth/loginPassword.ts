/** Customer convention: temporary password is the username. */
export function customerPasswordFromUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Password attempts for sign-in (entered value first, then username for customers). */
export function buildLoginPasswordCandidates(
  identifier: string,
  password: string,
): string[] {
  const raw = password ?? '';
  const trimmed = raw.trim();
  const ident = identifier.trim().toLowerCase();
  const out: string[] = [];

  for (const candidate of [raw, trimmed, trimmed.toLowerCase()]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }

  // Customers sign in with username as password.
  if (ident && !ident.includes('@') && !out.includes(ident)) {
    out.push(ident);
  }

  return out;
}
