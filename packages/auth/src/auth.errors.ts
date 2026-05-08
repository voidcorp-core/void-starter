import { AppError } from '@void/core/errors';

/**
 * Domain errors for `@void/auth`.
 *
 * Each error extends `@void/core`'s `AppError` so the `defineAction`
 * middleware in `@void/core/server-action` maps it to the correct HTTP
 * status with a stable string `code` clients can match on. Status codes
 * follow standard HTTP semantics:
 *
 *   - 401 — credentials are wrong (the request was authenticated, but
 *     the principal could not be verified)
 *   - 409 — conflict on a unique constraint (email already in use)
 *   - 410 — Gone, used here for an expired magic link (the resource was
 *     valid but is no longer available)
 *
 * The `name` field is set explicitly on each subclass because the
 * default `Error.name` would otherwise be 'AppError', which loses
 * information in logs and stack traces.
 */

export class InvalidCredentialsError extends AppError {
  constructor(cause?: unknown) {
    super({
      message: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
      status: 401,
      cause,
    });
    this.name = 'InvalidCredentialsError';
  }
}

export class EmailAlreadyTakenError extends AppError {
  constructor(email: string, cause?: unknown) {
    super({
      message: `Email already registered: ${email}`,
      code: 'EMAIL_TAKEN',
      status: 409,
      cause,
    });
    this.name = 'EmailAlreadyTakenError';
  }
}

export class MagicLinkExpiredError extends AppError {
  constructor(cause?: unknown) {
    super({
      message: 'Magic link expired',
      code: 'MAGIC_LINK_EXPIRED',
      status: 410,
      cause,
    });
    this.name = 'MagicLinkExpiredError';
  }
}
