import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  TransferError,
  ValidationError,
  isAppError,
} from '../utils/errors';
import type { ApiErrorBody } from './contracts';
import logger from '../utils/logger';

export interface ApiResult<T> {
  statusCode: number;
  body: T | ApiErrorBody;
}

const KNOWN_REASON_CODES = [
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'INSUFFICIENT_BALANCE',
  'EXTERNAL_TRANSFER_NOT_ALLOWED',
  'TRANSFER_LIMIT_REACHED',
  'INVALID_TRANSFER',
  'VERIFICATION_REQUIRED',
  'INVALID_VERIFICATION_CODE',
  'VERIFICATION_EXPIRED',
  'TOO_MANY_VERIFICATION_ATTEMPTS',
  'TRANSFER_ALREADY_COMPLETED',
  'DUPLICATE_REQUEST',
  'INVALID_AMOUNT',
  'UNAUTHORIZED',
  'METHOD_NOT_ALLOWED',
] as const;

export const ok = <T>(data: T, statusCode = 200): ApiResult<{ data: T }> => ({
  statusCode,
  body: { data },
});

export const created = <T>(data: T): ApiResult<{ data: T }> => ok(data, 201);

const looksLikeInternalDbMessage = (message: string): boolean => {
  return /postgres|pgrst|relation |column |violates |syntax error|duplicate key value|stack|exception/i.test(
    message,
  );
};

const extractKnownReasonCode = (message: string): string | undefined => {
  return KNOWN_REASON_CODES.find((code) => message.includes(code));
};

const sanitizeMessage = (error: AppError, code: string): string => {
  if (!error.expose) {
    return 'An unexpected error occurred';
  }

  if (looksLikeInternalDbMessage(error.message)) {
    return code === 'VALIDATION_ERROR'
      ? 'Request could not be completed'
      : error.message.includes(code)
        ? error.message
        : 'Request could not be completed';
  }

  return error.message;
};

const mapAuthCode = (error: AppError): string => {
  if (error instanceof AuthenticationError) {
    return 'UNAUTHENTICATED';
  }
  if (error instanceof AuthorizationError) {
    return 'FORBIDDEN';
  }
  if (error instanceof TransferError) {
    return error.reasonCode;
  }
  if (error instanceof ValidationError) {
    const reason = error.details?.reasonCode;
    if (typeof reason === 'string') {
      return reason;
    }
    const fromMessage = extractKnownReasonCode(error.message);
    if (fromMessage) {
      return fromMessage;
    }
    return 'VALIDATION_ERROR';
  }
  if (error instanceof NotFoundError) {
    if (/account/i.test(error.message)) return 'ACCOUNT_NOT_FOUND';
    if (/transfer/i.test(error.message)) return 'INVALID_TRANSFER';
    if (/route not found/i.test(error.message)) return 'NOT_FOUND';
    return 'NOT_FOUND';
  }
  if (error instanceof ConflictError) {
    const reason = error.details?.reasonCode;
    return typeof reason === 'string' ? reason : 'DUPLICATE_REQUEST';
  }
  return error.code || 'INTERNAL_ERROR';
};

export const toApiError = (error: unknown): ApiResult<ApiErrorBody> => {
  if (isAppError(error)) {
    const code = mapAuthCode(error);
    const statusCode =
      error instanceof AuthenticationError
        ? 401
        : error instanceof AuthorizationError
          ? 403
          : error.statusCode;

    if (!error.expose || statusCode >= 500 || looksLikeInternalDbMessage(error.message)) {
      logger.error({ code, statusCode, details: error.details }, error.message);
    }

    return {
      statusCode,
      body: {
        error: {
          code,
          message: sanitizeMessage(error, code),
        },
      },
    };
  }

  logger.error({ error }, 'Unhandled API error');
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    },
  };
};

export const runApi = async <T>(
  operation: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T | ApiErrorBody>> => {
  try {
    return await operation();
  } catch (error) {
    return toApiError(error);
  }
};
