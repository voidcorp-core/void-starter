---
date: 2026-06-18
title: "Social providers are opt-in; magic-link fails loud in production"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-06-18: Social providers are opt-in; magic-link fails loud in production

- **Date:** 2026-06-18
- **Decision:** Google OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are validated as `.optional()` and the Google provider is registered only when BOTH are present, via the pure `resolveGoogleProvider(env)` helper spread conditionally into the Better-Auth config. The magic-link `sendMagicLink` dev stub throws `AppError('MAGIC_LINK_NOT_CONFIGURED', 500)` when `NODE_ENV === 'production'`, and logs only `{ email, url }` (never the raw token) in dev.
- **Why:** The README and `docs/AUTH.md` promise that email/password and magic link work without Google. The previous code validated the Google vars as required (`z.string().min(1)`) and registered the provider unconditionally, so `getAuth()` threw on its first call whenever Google was unset -- which broke email/password and magic link too, contradicting the docs and breaking a no-Google onboarding at the first auth request. Making the provider opt-in aligns code with the documented contract. Separately, the dev magic-link stub only logs the link; if a production deploy enabled magic link without wiring a real email sender, logins would silently never arrive. Throwing in production turns a silent, hard-to-diagnose failure into a loud, actionable one at the moment of misconfiguration.
- **Rejected alternatives:**
  - _Document Google as required_ (the other way to make code and docs agree): regresses the "minimal-config onboarding" property the venture-builder cadence depends on; a fresh MVP should boot with just `BETTER_AUTH_SECRET` + DB.
  - _Keep the dev stub silent in production_: silent failure -- the exact anti-pattern the in-memory rate limiter's INTENT doc warns against. Loud beats silent.
  - _Gate the production guard on a `RESEND_API_KEY` presence check instead of `NODE_ENV`_: ties the auth package to a specific email vendor's env var before that module exists. The `NODE_ENV` check is vendor-neutral; the email module replaces the callback body entirely when activated.
- **When to revisit:** When `_modules/email-resend` is wired, the `sendMagicLink` body is replaced by the Resend call and the production-guard throw goes away with it. If a provider other than Google becomes the default, generalize `resolveGoogleProvider` into a provider-map builder.
