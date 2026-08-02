/** SHA-256 hex matching Node hashVerificationCode. */
export async function hashVerificationCode(
  code: string,
  transferId: string,
  stage: number,
  pepper: string,
): Promise<string> {
  const payload = `${pepper}:${transferId}:${stage}:${code}`;
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, '0');
}

export function generateReference(prefix: string): string {
  const n = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${Date.now().toString(36).toUpperCase()}${n[0]!.toString(36).toUpperCase()}`;
}
