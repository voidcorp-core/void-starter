import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_TIMEOUT_MS = 10_000;

const recipientSchema = z.email().max(320);
const senderSchema = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .refine((value) => !/[\r\n]/.test(value), 'Sender must not contain line breaks');
const authUrlSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Authentication URL must use HTTP or HTTPS',
  });
const environmentSchema = z.strictObject({
  RESEND_API_KEY: z.string().trim().min(1),
  EMAIL_FROM: senderSchema,
  EMAIL_REPLY_TO: recipientSchema.optional(),
  EMAIL_APP_NAME: z.string().trim().min(1).max(100).optional(),
});
const resendSuccessSchema = z.object({ id: z.string().trim().min(1) });

type AuthEmailKind = 'magic-link' | 'password-reset' | 'verification';

export type AuthEmailEnvironment = {
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  EMAIL_REPLY_TO?: string | undefined;
  EMAIL_APP_NAME?: string | undefined;
};

export type AuthEmailDeliveryOptions = {
  environment?: AuthEmailEnvironment;
  fetcher?: typeof fetch;
};

export class EmailDeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = code;
    this.retryable = retryable;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function idempotencyKey(kind: AuthEmailKind, recipient: string, url: string): string {
  const digest = createHash('sha256').update(`${kind}\0${recipient}\0${url}`).digest('hex');
  return `void-auth-${kind}-${digest}`;
}

function content(kind: AuthEmailKind, appName: string, url: string) {
  const escapedAppName = escapeHtml(appName);
  const escapedUrl = escapeHtml(url);
  const copy = {
    'magic-link': {
      subject: `Sign in to ${appName}`,
      heading: 'Sign in securely',
      action: 'Sign in',
      expiry: 'This link expires in 5 minutes and can only be used once.',
    },
    'password-reset': {
      subject: `Reset your ${appName} password`,
      heading: 'Reset your password',
      action: 'Reset password',
      expiry: 'This link expires in 1 hour.',
    },
    verification: {
      subject: `Verify your ${appName} email`,
      heading: 'Verify your email address',
      action: 'Verify email',
      expiry: 'This link expires in 1 hour.',
    },
  }[kind];

  return {
    subject: copy.subject,
    text: `${copy.heading}\n\n${url}\n\n${copy.expiry}\nIf you did not request this, you can ignore this email.`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7f9;color:#111827;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center" style="padding:40px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px">${escapedAppName}</p>
            <h1 style="margin:0 0 16px;font-size:24px">${copy.heading}</h1>
            <p style="margin:0 0 24px;line-height:1.6">Use the button below to continue.</p>
            <p style="margin:0 0 24px"><a href="${escapedUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px">${copy.action}</a></p>
            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5">${copy.expiry}</p>
            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">If you did not request this, you can ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}

async function sendAuthEmail(
  kind: AuthEmailKind,
  input: { to: string; url: string },
  options: AuthEmailDeliveryOptions = {},
): Promise<{ id: string }> {
  const recipient = recipientSchema.parse(input.to.trim().toLowerCase());
  const url = authUrlSchema.parse(input.url);
  const environment = options.environment ?? process.env;
  const config = environmentSchema.parse({
    RESEND_API_KEY: environment.RESEND_API_KEY,
    EMAIL_FROM: environment.EMAIL_FROM,
    EMAIL_REPLY_TO: environment.EMAIL_REPLY_TO || undefined,
    EMAIL_APP_NAME: environment.EMAIL_APP_NAME || undefined,
  });
  const rendered = content(kind, config.EMAIL_APP_NAME ?? 'Your application', url);
  const fetcher = options.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher(RESEND_EMAILS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey(kind, recipient, url),
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [recipient],
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        ...(config.EMAIL_REPLY_TO ? { reply_to: config.EMAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EmailDeliveryError(
      'RESEND_UNREACHABLE',
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Resend email delivery timed out'
        : 'Resend email delivery could not be reached',
      true,
    );
  }

  if (!response.ok) {
    throw new EmailDeliveryError(
      `RESEND_HTTP_${response.status}`,
      `Resend rejected email delivery with HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  }

  const parsed = resendSuccessSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new EmailDeliveryError(
      'RESEND_RESPONSE_INVALID',
      'Resend returned an invalid success response',
      true,
    );
  }
  return parsed.data;
}

export function sendVerificationEmail(
  input: { to: string; url: string },
  options?: AuthEmailDeliveryOptions,
) {
  return sendAuthEmail('verification', input, options);
}

export function sendPasswordResetEmail(
  input: { to: string; url: string },
  options?: AuthEmailDeliveryOptions,
) {
  return sendAuthEmail('password-reset', input, options);
}

export function sendMagicLinkEmail(
  input: { to: string; url: string },
  options?: AuthEmailDeliveryOptions,
) {
  return sendAuthEmail('magic-link', input, options);
}
