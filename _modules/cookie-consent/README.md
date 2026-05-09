# @void/cookie-consent

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for an RGPD/ePrivacy-compliant cookie consent banner with per-category toggles (essential / analytics / marketing) and conditional gating of analytics SDKs based on the user's choice. Activate when an MVP serves EU users and ships any non-essential third-party SDK (PostHog, Sentry session replay, ad pixels, etc.).

## Why this module

Shipping `@void/posthog` to EU traffic without a consent gate violates the ePrivacy Directive and the GDPR. The starter does not bake consent in by default for two reasons: (a) consent UX is product-specific (banner copy, brand voice, layout) and ADR 02's brand integrity stance forbids vendor-branded banners; (b) plenty of MVPs are B2B internal tools or non-EU products that need no banner at all. Activate this module only when the project's actual deployment scope demands it.

## Required env vars

None at the module level. Consent state lives in a first-party cookie on the user's browser; the server reads it via `next/headers` cookies API. If a future implementation adds a consent ledger (audit-grade record of when each user accepted), pair this module with `_modules/audit-log` rather than introducing a separate persistence path.

## Install (when implementing)

The module is a thin React component plus a server-side reader helper. It should NOT depend on a third-party consent SDK -- those are heavy, branded, and add their own analytics. Roll our own per ADR 02 (brand integrity) and per the project's quality bar.

1. Add the consent state model in `_modules/cookie-consent/src/consent.types.ts`:

   ```ts
   import { z } from 'zod';

   export const ConsentSchema = z.object({
     essential: z.literal(true),
     analytics: z.boolean(),
     marketing: z.boolean(),
     version: z.number().int().positive(),
     decidedAt: z.string().datetime(),
   });

   export type Consent = z.infer<typeof ConsentSchema>;
   ```

2. Implement the server reader at `_modules/cookie-consent/src/consent.reader.ts` (`import 'server-only'`). It reads the `void_consent` cookie via `cookies()` from `next/headers`, parses it through `ConsentSchema`, and returns a typed `Consent | null`.

3. Implement the client banner at `_modules/cookie-consent/src/banner.client.tsx` (`'use client'`). It renders a fixed-position banner with three buttons (Accept all / Reject non-essential / Customize) and writes the resulting consent to the `void_consent` cookie via `document.cookie`. Set `HttpOnly=false` (so client can read on next page load), `Secure=true`, `SameSite=Lax`, and a 13-month max-age (matching the CNIL recommendation).

4. Gate analytics on consent. In `apps/web/src/app/layout.tsx`, wrap `<AnalyticsProvider>` (the `@void/posthog` provider) with a consent-aware wrapper that only mounts when `consent.analytics === true`. The server reader feeds the initial state; client toggles update it through a context.

5. Add the per-category toggle UI to the user settings page (`apps/web/src/app/dashboard/settings/cookies/page.tsx`). It re-uses the same `Consent` schema and writes back to the same cookie.

6. Add a versioning policy. When the cookie list changes (new SDK, removed SDK, changed purpose), bump `Consent.version` and re-prompt all users whose stored version is behind the current one.

## Components

- `<CookieConsentBanner>` client component, fixed-position, 3 actions plus per-category modal
- Server-side `readConsent()` helper for App Router pages and Route Handlers
- Conditional gating wrapper around `@void/posthog` `<AnalyticsProvider>` (and any future analytics module)
- Per-category toggle UI in the user settings page
- Cookie scheme: `void_consent`, first-party, `HttpOnly=false`, `Secure=true`, `SameSite=Lax`, 13-month TTL

## Integration points

- `apps/web/src/app/layout.tsx` -- mount `<CookieConsentBanner>` and gate `<AnalyticsProvider>` on `consent.analytics`
- `apps/web/src/app/dashboard/settings/cookies/page.tsx` -- per-category toggle UI
- `_modules/cookie-consent/src/consent.reader.ts` -- server-only cookie reader
- `_modules/cookie-consent/src/banner.client.tsx` -- client banner component
- `_modules/cookie-consent/src/consent.types.ts` -- shared Zod schema and types
- `packages/ui/` -- compose with existing Card, Button, Switch primitives per ADR 16/18
- Future analytics modules (Sentry session replay, ad pixels): each must be gated through the same consent context

## Upstream docs

- https://gdpr-info.eu/art-7-gdpr/ -- GDPR Article 7 (conditions for consent)
- https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058 -- ePrivacy Directive
- https://www.cnil.fr/en/cookies-and-other-trackers -- CNIL guidance (the de-facto strict reference for EU implementations)
- https://www.iubenda.com -- third-party hosted alternative if rolling our own is out of scope for a specific MVP

## Removal (after implementing)

The inverse of install:

1. Remove the consent gate around `<AnalyticsProvider>` in `apps/web/src/app/layout.tsx`.
2. Drop the cookie settings page.
3. Delete `_modules/cookie-consent/src/`.
4. Optionally clear the `void_consent` cookie on existing users by serving a `Set-Cookie: void_consent=; Max-Age=0` once during migration.

Removal only makes sense for projects that pivot away from the EU market. For all other cases, keep the module mounted even if no analytics are active -- the legal exposure is the same regardless of bundle weight.
