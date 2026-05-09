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

/**
 * Throw inside a Server Action handler when the request exceeds a quota.
 *
 * `defineFormAction` maps this to
 * `{ ok: false, formError: { code: 'RATE_LIMITED', message } }` via the
 * existing `isAppError` branch. `defineAction` (RPC) re-throws it; consumers
 * handle it in a try/catch or surface it through their error boundary.
 *
 * Production limiters (Upstash Redis, Vercel KV) should construct this
 * with the `retryAfter` value derived from the limiter's response so the
 * caller can render an accurate countdown / set a `Retry-After` header.
 */
export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, cause?: unknown) {
    super({
      message: `Too many requests. Retry after ${retryAfterSeconds}s.`,
      code: 'RATE_LIMITED',
      status: 429,
      cause,
    });
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
