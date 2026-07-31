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
  NETWORK_ERROR: 'Unable to reach the server. Check your connection and try again.',
};

export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
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
