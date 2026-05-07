type AppErrorOptions = {
  message: string;
  code?: string;
  status?: number;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  override readonly cause: unknown;

  constructor({ message, code = 'APP_ERROR', status = 500, cause }: AppErrorOptions) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'VALIDATION', status: 400, cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'NOT_FOUND', status: 404, cause });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'UNAUTHORIZED', status: 401, cause });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'FORBIDDEN', status: 403, cause });
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ message, code: 'CONFLICT', status: 409, cause });
    this.name = 'ConflictError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
