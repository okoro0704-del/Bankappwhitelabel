/**
 * Smallest safe CORS helper for authenticated API traffic.
 * Never returns Access-Control-Allow-Origin: *.
 *
 * Configuration:
 * - CORS_ORIGIN — comma-separated list of allowed frontend origins
 *   e.g. https://app.example.com,https://www.example.com
 * - When unset and NODE_ENV !== production, localhost Vite origins are allowed
 *   so optional direct browser→API calls work; Vite proxy does not need CORS.
 */

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const parseAllowedOrigins = (): string[] => {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== '*');
};

export const resolveAllowedOrigin = (
  requestOrigin: string | undefined,
): string | null => {
  const configured = parseAllowedOrigins();

  if (configured.length > 0) {
    if (requestOrigin && configured.includes(requestOrigin)) {
      return requestOrigin;
    }
    return null;
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  if (requestOrigin && LOCAL_DEV_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
};

export const buildCorsHeaders = (
  requestOrigin: string | undefined,
): Record<string, string> => {
  const allowed = resolveAllowedOrigin(requestOrigin);
  if (!allowed) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};
