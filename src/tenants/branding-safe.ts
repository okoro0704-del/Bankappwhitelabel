/**
 * Server-side branding field sanitization.
 * Mirrors client rules: http(s) URLs only, #RRGGBB colors, no script/protocol injection.
 */

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const MAX_TEXT_LEN = 200;

export const isSafeHexColor = (value: string): boolean => HEX_COLOR.test(value.trim());

/**
 * Allow only absolute http(s) URLs for logos/favicons.
 * Blocks javascript:, data:, vbscript:, and relative paths.
 */
export const sanitizeBrandingPublicUrl = (
  value: string | null | undefined,
): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Reject obvious injection forms before URL parsing.
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return null;
  }
  if (/[<>"']/.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const sanitizeBrandingText = (
  value: string | null | undefined,
  maxLen = MAX_TEXT_LEN,
): string | null => {
  if (value == null) return null;
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};
