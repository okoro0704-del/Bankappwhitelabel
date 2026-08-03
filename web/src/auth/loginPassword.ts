/** Customer convention: temporary password is the username. */
export function customerPasswordFromUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Password attempts for sign-in (entered value first; username fallback for customers only). */
export function buildLoginPasswordCandidates(
  identifier: string,
  password: string,
  options?: { allowUsernameAsPassword?: boolean },
): string[] {
  const raw = password ?? '';
  const trimmed = raw.trim();
  const ident = identifier.trim().toLowerCase();
  const out: string[] = [];
  const allowUsername = options?.allowUsernameAsPassword !== false;

  for (const candidate of [raw, trimmed, trimmed.toLowerCase()]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }

  // Customers sign in with username as password.
  if (allowUsername && ident && !ident.includes('@') && !out.includes(ident)) {
    out.push(ident);
  }

  return out;
}
