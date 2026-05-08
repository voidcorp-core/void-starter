import { isAppError } from '@void/core/errors';
import { describe, expect, it } from 'vitest';
import {
  EmailAlreadyTakenError,
  InvalidCredentialsError,
  MagicLinkExpiredError,
} from './auth.errors';

describe('auth errors', () => {
  it('InvalidCredentialsError has 401 + INVALID_CREDENTIALS code', () => {
    const err = new InvalidCredentialsError();
    expect(err.status).toBe(401);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(isAppError(err)).toBe(true);
  });

  it('EmailAlreadyTakenError has 409 + EMAIL_TAKEN code', () => {
    const err = new EmailAlreadyTakenError('a@b.c');
    expect(err.status).toBe(409);
    expect(err.code).toBe('EMAIL_TAKEN');
  });

  it('MagicLinkExpiredError has 410 + MAGIC_LINK_EXPIRED', () => {
    const err = new MagicLinkExpiredError();
    expect(err.status).toBe(410);
    expect(err.code).toBe('MAGIC_LINK_EXPIRED');
  });
});
