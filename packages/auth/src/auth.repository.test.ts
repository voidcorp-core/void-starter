import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a server bundle (including vitest); neutralize it
// so the pure resolveGoogleProvider export can be imported in isolation.
vi.mock('server-only', () => ({}));

const emailMocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendMagicLinkEmail: vi.fn(),
}));

vi.mock('@repo/email-resend/server', () => ({
  ...emailMocks,
}));

vi.mock('@repo/core/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { logger } from '@repo/core/logger';
import { deliverAuthEmail, resolveGoogleProvider } from './auth.repository';

describe('resolveGoogleProvider', () => {
  it('returns the google provider when both credentials are present', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toEqual({ google: { clientId: 'id', clientSecret: 'secret' } });
  });

  it('returns undefined when the client id is missing', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toBeUndefined();
  });

  it('returns undefined when the client secret is missing', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: undefined }),
    ).toBeUndefined();
  });

  it('returns undefined when both are missing (email/password + magic link only)', () => {
    expect(resolveGoogleProvider({})).toBeUndefined();
  });

  it('treats empty strings as not configured', () => {
    expect(
      resolveGoogleProvider({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }),
    ).toBeUndefined();
  });
});

describe('deliverAuthEmail', () => {
  it('keeps URL logging limited to development with no Resend configuration', async () => {
    await expect(
      deliverAuthEmail(
        { kind: 'magic-link', email: 'user@example.com', url: 'http://localhost/link' },
        { NODE_ENV: 'development' },
      ),
    ).resolves.toBe('development-log');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'magic-link', url: 'http://localhost/link' }),
      expect.stringContaining('development only'),
    );
  });

  it('fails closed in production rather than logging an auth URL', async () => {
    await expect(
      deliverAuthEmail(
        { kind: 'verification', email: 'user@example.com', url: 'https://app.test/verify' },
        { NODE_ENV: 'production' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_NOT_CONFIGURED' });
  });

  it('rejects partial Resend configuration in development', async () => {
    await expect(
      deliverAuthEmail(
        { kind: 'password-reset', email: 'user@example.com', url: 'http://localhost/reset' },
        { NODE_ENV: 'development', RESEND_API_KEY: 're_partial' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_NOT_CONFIGURED' });
  });

  it('routes every supported purpose through its Resend adapter', async () => {
    const environment = {
      NODE_ENV: 'production',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'auth@example.com',
    };
    await deliverAuthEmail(
      { kind: 'verification', email: 'user@example.com', url: 'https://app.test/verify' },
      environment,
    );
    await deliverAuthEmail(
      { kind: 'password-reset', email: 'user@example.com', url: 'https://app.test/reset' },
      environment,
    );
    await deliverAuthEmail(
      { kind: 'magic-link', email: 'user@example.com', url: 'https://app.test/magic' },
      environment,
    );

    expect(emailMocks.sendVerificationEmail).toHaveBeenCalledOnce();
    expect(emailMocks.sendPasswordResetEmail).toHaveBeenCalledOnce();
    expect(emailMocks.sendMagicLinkEmail).toHaveBeenCalledOnce();
  });
});
