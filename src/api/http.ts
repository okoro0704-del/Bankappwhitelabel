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

export const ok = <T>(data: T, statusCode = 200): ApiResult<{ data: T }> => ({
  statusCode,
  body: { data },
});

export const created = <T>(data: T): ApiResult<{ data: T }> => ok(data, 201);

const sanitizeMessage = (error: AppError): string => {
  if (!error.expose) {
    return 'An unexpected error occurred';
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
    return typeof reason === 'string' ? reason : 'VALIDATION_ERROR';
  }
  if (error instanceof NotFoundError) {
    if (/account/i.test(error.message)) return 'ACCOUNT_NOT_FOUND';
    if (/transfer/i.test(error.message)) return 'INVALID_TRANSFER';
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

    if (!error.expose || statusCode >= 500) {
      logger.error({ code, statusCode, details: error.details }, error.message);
    }

    return {
      statusCode,
      body: {
        error: {
          code,
          message: sanitizeMessage(error),
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
