# @repo/email-resend

Real server-only Resend adapter selected by `operations.email: resend`. Better Auth uses it for
email verification, password reset and magic links. The package talks directly to Resend's HTTPS
API, so it adds no vendor SDK or client bundle code.

## Environment

| Variable | Type | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | Resend sending key. |
| `EMAIL_FROM` | non-secret | Verified sender, optionally `Name <address@example.com>`. |
| `EMAIL_REPLY_TO` | non-secret, optional | Reply address. |
| `EMAIL_APP_NAME` | non-secret, optional | Product name rendered in subjects and templates. |

Local development retains the console-link flow only when both required variables are absent.
Partial configuration fails explicitly. Production always requires both values and never logs an
authentication URL.

## Delivery contract

- `sendVerificationEmail`, `sendPasswordResetEmail` and `sendMagicLinkEmail` are exported from
  `@repo/email-resend/server`.
- Every request has a stable 24-hour Resend idempotency key derived from purpose, recipient and URL.
- Messages include HTML and plain-text bodies. Dynamic values are HTML escaped.
- Provider calls time out after ten seconds. Errors contain only status metadata, never the API key
  or provider response body.
- A custom sender domain must be verified in Resend before sending to arbitrary recipients.

The Factory binds production values to Vercel separately; real values never belong in source,
manifests, generated receipts or `.env.example`.

## Removal

Select another email adapter in the manifest, remove the matching auth callback wiring, unset the
Vercel variables and regenerate. Do not leave Better Auth enabled without a production sender.

## Upstream contracts

- https://resend.com/docs/api-reference/emails/send-email
- https://better-auth.com/docs/concepts/email
- https://better-auth.com/docs/plugins/magic-link
