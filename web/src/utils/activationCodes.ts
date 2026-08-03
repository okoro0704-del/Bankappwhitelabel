import type { ActivationCodes } from '../types/api';
import { VERIFICATION_CODE_TITLES } from '../transfer/visualProgress';

export function parseActivationCodes(raw: unknown): ActivationCodes | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const codes: ActivationCodes = {};
  for (const key of ['1', '2', '3', '4'] as const) {
    const value = obj[key];
    if (typeof value === 'string' && /^\d{6}$/.test(value)) {
      codes[key] = value;
    }
  }
  return codes['1'] && codes['2'] && codes['3'] && codes['4'] ? codes : null;
}

export function activationCodeDeliverables(
  codes: ActivationCodes | null | undefined,
): Array<{ key: '1' | '2' | '3' | '4'; label: string; value: string }> {
  if (!codes) return [];
  return (['1', '2', '3', '4'] as const)
    .filter((key) => Boolean(codes[key]))
    .map((key) => ({
      key,
      label: VERIFICATION_CODE_TITLES[Number(key) as 1 | 2 | 3 | 4],
      value: codes[key] as string,
    }));
}
