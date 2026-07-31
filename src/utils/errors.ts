type AppErrorOptions = {
  cause?: unknown;
  details?: Record<string, unknown>;
  expose?: boolean;
};

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly expose: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
  }

  toResponseBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', { details, expose: true });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR', { expose: true });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You are not allowed to perform this action') {
    super(message, 403, 'AUTHORIZATION_ERROR', { expose: true });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found') {
    super(message, 404, 'NOT_FOUND_ERROR', { expose: true });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT_ERROR', { details, expose: true });
  }
}

export class TransferError extends AppError {
  public readonly reasonCode: string;

  constructor(
    reasonCode: string,
    message: string,
    statusCode = 400,
    details?: Record<string, unknown>,
  ) {
    super(message, statusCode, reasonCode, { details, expose: true });
    this.reasonCode = reasonCode;
  }
}

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};
