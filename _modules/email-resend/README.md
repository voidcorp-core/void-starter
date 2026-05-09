# @void/email-resend

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for transactional email via Resend (magic link delivery, password reset, account notifications, billing receipts) with React Email templates colocated. Replaces the dev-only `sendMagicLink` logger stub in `@void/auth` with a real sender.

## Why this module

`@void/auth/auth.repository.ts` ships a development stub for the Better-Auth `magicLink.sendMagicLink` callback that logs the URL via the project logger. This is intentional per ADR 02 -- the starter does not bake a vendor email contract. Activate this module on the first MVP that needs real email delivery (typical trigger: production deploy where users actually click magic links). Resend is the 2026 default because of first-class React Email support, simple DX, and EU data residency option.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | Resend API key. Used by the Resend Node SDK to send transactional email. |
| `EMAIL_FROM` | public | Sender address (e.g. `notifications@your-domain.com`). The sending domain must be verified in the Resend dashboard. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMAIL_REPLY_TO` | none | Override the reply-to header. Useful when `EMAIL_FROM` is a no-reply alias. |
| `RESEND_AUDIENCE_ID` | none | Resend Audience for double-opt-in or marketing flows. Not used by transactional sends. |

## Install (when implementing)

The module follows pattern A (real workspace package) once a second app needs email, otherwise pattern B (inline in `apps/web`).

1. Add the dependency to the consuming app's `package.json`:

   ```json
   "dependencies": {
     "resend": "^4.0.0",
     "react-email": "^3.0.0",
     "@react-email/components": "^0.0.30"
   }
   ```

2. Run `bun install` from the repo root.

3. Create the email adapter at `_modules/email-resend/src/email.adapter.ts` (or, if promoting to a workspace package, `packages/email/src/email.adapter.ts`). Export a `sendEmail({ to, subject, react })` function that wraps `resend.emails.send`. Mark it `import 'server-only'` per ADR 25.

4. Swap the `sendMagicLink` callback in `packages/auth/src/auth.repository.ts`. Replace the logger stub with a call to `sendEmail` plus a `<MagicLinkEmail />` React Email template. Keep the dev-only logger fallback gated on `process.env.NODE_ENV !== 'production'` so local dev still surfaces the URL without spending API credits.

5. Add React Email templates colocated with the adapter (`_modules/email-resend/src/emails/magic-link.tsx`, `welcome.tsx`, `password-reset.tsx`). Preview them locally with `bunx react-email dev`.

6. Add the sender domain to Resend, verify SPF/DKIM/DMARC, and confirm the verified status before flipping `EMAIL_FROM` in production.

## Integration points

- `packages/auth/src/auth.repository.ts` -- swap the `magicLink.sendMagicLink` callback (currently a logger stub) to call `sendEmail`
- `_modules/email-resend/src/email.adapter.ts` -- generic `sendEmail()` export, OR promote to `packages/email/` once cross-app reuse is real (per ADR 07)
- `_modules/email-resend/src/emails/*.tsx` -- React Email templates colocated with the adapter
- `apps/web/src/actions/account.actions.ts` -- call sites that send password reset and account notification emails
- `_modules/payment-stripe` integration: receipt and invoice notification emails sent from the Stripe webhook handler

## Upstream docs

- https://resend.com/docs
- https://resend.com/docs/send-with-nextjs
- https://react.email
- https://react.email/docs/components

## Removal (after implementing)

The inverse of install:

1. Restore the dev-only logger stub in `packages/auth/src/auth.repository.ts` `sendMagicLink` callback.
2. Drop the Resend and React Email dependencies from the consuming app's `package.json`.
3. Delete the email adapter and templates (`_modules/email-resend/src/` or `packages/email/src/`).
4. Unset `RESEND_API_KEY`, `EMAIL_FROM`, and any optional vars in Vercel.
5. Run `bun install` to drop the lockfile entries.
