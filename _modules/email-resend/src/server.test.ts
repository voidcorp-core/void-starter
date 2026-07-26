import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type EmailDeliveryError,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './server';

const environment = {
  RESEND_API_KEY: 're_test_secret',
  EMAIL_FROM: 'Void <auth@example.com>',
  EMAIL_REPLY_TO: 'support@example.com',
  EMAIL_APP_NAME: 'Void & Friends',
};

describe('Resend authentication email adapter', () => {
  const fetcher = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetcher.mockReset();
    fetcher.mockImplementation(async () => Response.json({ id: 'email_123' }));
  });

  it('sends escaped HTML, text fallback, reply-to and a deterministic idempotency key', async () => {
    const input = {
      to: 'USER@EXAMPLE.COM',
      url: 'https://app.example.com/api/auth/verify-email?token=a&callbackURL=%2F',
    };

    await expect(sendVerificationEmail(input, { environment, fetcher })).resolves.toEqual({
      id: 'email_123',
    });
    await sendVerificationEmail(input, { environment, fetcher });

    const [endpoint, request] = fetcher.mock.calls[0] ?? [];
    expect(endpoint).toBe('https://api.resend.com/emails');
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer re_test_secret',
      'Content-Type': 'application/json',
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual(request?.headers);

    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'Void <auth@example.com>',
      to: ['user@example.com'],
      reply_to: 'support@example.com',
      subject: 'Verify your Void & Friends email',
    });
    expect(body.text).toContain(input.url);
    expect(body.html).toContain('Void &amp; Friends');
    expect(body.html).toContain('token=a&amp;callbackURL=%2F');
  });

  it('renders distinct password-reset and magic-link messages', async () => {
    const input = { to: 'user@example.com', url: 'https://app.example.com/auth?token=one' };
    await sendPasswordResetEmail(input, { environment, fetcher });
    await sendMagicLinkEmail(input, { environment, fetcher });

    const reset = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { subject: string };
    const magic = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { subject: string };
    expect(reset.subject).toContain('Reset');
    expect(magic.subject).toContain('Sign in');
  });

  it('fails before the network when required configuration is absent', async () => {
    await expect(
      sendMagicLinkEmail(
        { to: 'user@example.com', url: 'https://app.example.com/auth' },
        { environment: {}, fetcher },
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose the API key when Resend rejects the request', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ message: 'bad key' }, { status: 401 }));

    const promise = sendMagicLinkEmail(
      { to: 'user@example.com', url: 'https://app.example.com/auth' },
      { environment, fetcher },
    );
    await expect(promise).rejects.toMatchObject<Partial<EmailDeliveryError>>({
      code: 'RESEND_HTTP_401',
      retryable: false,
    });
    await expect(promise).rejects.not.toThrow(/re_test_secret/);
  });
});
