export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY: Record<string, string> = {
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  INVALID_CREDENTIALS: 'Invalid username or password.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  ACCOUNT_NOT_FOUND: 'Account could not be found.',
  ACCOUNT_INACTIVE: 'This account is inactive. Contact support if you need help.',
  INSUFFICIENT_BALANCE: 'There is not enough balance for this request.',
  EXTERNAL_TRANSFER_NOT_ALLOWED: 'External transfers are not allowed for this account type.',
  TRANSFER_LIMIT_REACHED:
    'Your transfer could not be completed. Please contact the bank for assistance.',
  INVALID_TRANSFER: 'This transfer cannot be completed.',
  VERIFICATION_REQUIRED: 'Additional verification is required to continue.',
  INVALID_VERIFICATION_CODE: 'Incorrect verification code',
  VERIFICATION_EXPIRED: 'Verification code expired',
  TOO_MANY_VERIFICATION_ATTEMPTS: 'Too many incorrect attempts. Try again later.',
  TRANSFER_ALREADY_COMPLETED: 'This transfer is already complete.',
  DUPLICATE_REQUEST: 'This request was already processed.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  NOT_FOUND: 'The requested resource was not found.',
  METHOD_NOT_ALLOWED: 'This action is not supported.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  API_UNREACHABLE:
    'Unable to reach Supabase. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and that Edge Functions are deployed.',
  NETWORK_ERROR: 'Unable to reach the server. Check your connection and try again.',
  DEPLOYMENT_NOT_CONFIGURED: 'Deployment provider is not configured on the server.',
  NETLIFY_AUTH_FAILED: 'Netlify authentication failed. Check server credentials.',
  NETLIFY_SITE_NOT_FOUND: 'Configured Netlify site was not found.',
  DNS_PROVISIONING_FAILED: 'DNS provisioning failed. Try again or check Netlify DNS.',
  DNS_NOT_READY: 'DNS is not ready yet for this hostname.',
  SSL_PROVISIONING_FAILED: 'SSL provisioning failed.',
  SSL_NOT_READY: 'SSL is not ready yet for this hostname.',
  DEPLOYMENT_CONFLICT: 'A conflicting DNS record already exists for this hostname.',
  DEPLOYMENT_NOT_READY: 'Deployment is not ready yet.',
};

export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Prefer detailed server messages for deployment / activation diagnostics.
    if (
      error.message &&
      [
        'DEPLOYMENT_NOT_CONFIGURED',
        'DNS_NOT_READY',
        'SSL_NOT_READY',
        'DNS_PROVISIONING_FAILED',
        'SSL_PROVISIONING_FAILED',
        'DEPLOYMENT_CONFLICT',
        'NETLIFY_AUTH_FAILED',
        'NETLIFY_SITE_NOT_FOUND',
        'INTERNAL_ERROR',
        'VALIDATION_ERROR',
        'FORBIDDEN',
        'NOT_FOUND',
        'INVALID_CREDENTIALS',
      ].includes(error.code)
    ) {
      return error.message;
    }
    return FRIENDLY[error.code] ?? error.message ?? FRIENDLY.INTERNAL_ERROR;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return FRIENDLY.INTERNAL_ERROR;
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'UNAUTHENTICATED' || error.status === 401);
}
