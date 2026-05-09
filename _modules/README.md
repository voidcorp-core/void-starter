# _modules -- Opt-in modules catalogue

`_modules/` is the curated catalogue of opt-in capabilities a fresh void-starter MVP can layer on top of the core stack. Each subfolder is either a **real workspace package** (already wired into `apps/web`, activated by env var presence at build time) or a **placeholder scaffold** (README-only, with the full integration recipe ready to copy into the consuming app when an MVP needs it).

The catalogue lives under `_modules/` rather than `packages/` to keep the dependency graph honest. `packages/` is the always-on substrate consumed by every app in the monorepo (`@void/core`, `@void/db`, `@void/auth`, `@void/ui`). `_modules/` is the per-MVP opt-in surface: build-time activation via env var presence (per [ADR 04](../docs/DECISIONS.md)) means absence of an env var produces zero runtime cost, no SDK fetch, and no bundle weight. Add the env var, redeploy, the module flips on. Drop the env var, redeploy, the module flips off.

## Real workspace packages

These three modules ship real code under `_modules/<name>/src/`, are type-checked + tested + built by Turborepo, and self-activate the moment their env vars exist at build time. No extra steps for a fresh starter clone: `apps/web` already imports them.

### @void/sentry -- Sentry observability

- **State:** real package, type-checked + tested, wired into `apps/web`
- **Env vars:** `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (optional: `SENTRY_TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`)
- **Install:** see [`observability-sentry/README.md`](./observability-sentry/README.md)
- **Pattern:** A. Workspace package, build-time activation via `instrumentation.ts` and `instrumentation-client.ts`, source map upload via `withSentryConfig` in `next.config.ts`.

Server, edge, and client capture for production error tracking. Dynamic-imports the Sentry SDK so chunks stay un-fetched at runtime when `NEXT_PUBLIC_SENTRY_DSN` is unset.

### @void/posthog -- Analytics with EU proxy

- **State:** real package, type-checked + tested, wired into `apps/web`
- **Env vars:** `NEXT_PUBLIC_POSTHOG_KEY` (optional: `NEXT_PUBLIC_POSTHOG_HOST`, defaults to `/ingest` for the EU reverse proxy)
- **Install:** see [`analytics-posthog/README.md`](./analytics-posthog/README.md)
- **Pattern:** A. Workspace package, `<AnalyticsProvider>` mounted in `app/layout.tsx`, EU reverse-proxy rewrites under `/ingest/*` in `next.config.ts`.

Browser-side PostHog analytics with a first-party `/ingest/*` reverse proxy so EU traffic never hits a third-party domain (helps with `connect-src` CSP, ad-blockers, and ePrivacy positioning). The `posthog.init` block dead-code-eliminates when the public key is absent at build time.

### @void/auth-clerk -- Clerk alternative auth

- **State:** real package (alternative repository scaffold), type-checked, NOT wired into `apps/web` by default
- **Env vars:** `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (optional: `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`)
- **Install:** see [`auth-clerk/README.md`](./auth-clerk/README.md)
- **Pattern:** A. Workspace package containing a swap-in `auth.repository.ts`. Activation is a deliberate per-MVP choice (see [ADR 02](../docs/DECISIONS.md)): copy the repository over `packages/auth/src/auth.repository.ts`, swap deps, replace the `[...all]` route handler with `clerkMiddleware()` in `proxy.ts`, wrap `RootLayout` with `<ClerkProvider>`. Full procedure in the module README.

The starter ships Better-Auth as default for data sovereignty, brand integrity, and custom-domain-by-default reasons. Activate Clerk only when an MVP genuinely needs B2B SaaS features at J1 (SSO, SCIM, advanced organizations) and the trade-off flips.

## Placeholders

The following eight modules are intentional scaffolds, not abandoned work. Each ships a `README.md` ONLY, with the full integration recipe inside. They deliberately stay out of the workspace graph (no `package.json`, no `src/`) so knip, Turborepo, and Renovate do not generate noise for capabilities no MVP has activated yet. See [ADR 29](../docs/DECISIONS.md) for the rationale. Implement when a real MVP needs the capability.

### @void/payment-stripe -- Stripe checkout, customer portal, webhooks

- **State:** placeholder, README only
- **Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optional: `STRIPE_PRICE_ID`)
- **Install:** see [`payment-stripe/README.md`](./payment-stripe/README.md)
- **Pattern:** A or B. Workspace package once a second app needs payments, otherwise inline in `apps/web`.

Checkout sessions, Customer Portal, signed webhook handler, and a `stripe_customers` Drizzle table linking `users.id` to `stripe_customer_id`.

### @void/email-resend -- Transactional email via Resend + React Email

- **State:** placeholder, README only
- **Env vars:** `RESEND_API_KEY`, `EMAIL_FROM` (optional: `EMAIL_REPLY_TO`, `RESEND_AUDIENCE_ID`)
- **Install:** see [`email-resend/README.md`](./email-resend/README.md)
- **Pattern:** A or B. Workspace package once a second app needs email, otherwise inline in `apps/web`.

Replaces the dev-only `sendMagicLink` logger stub in `@void/auth` with real Resend delivery. Ships React Email templates colocated with the adapter.

### @void/cms-payload -- Payload CMS as a sibling app

- **State:** placeholder, README only
- **Env vars:** `PAYLOAD_SECRET`, `PAYLOAD_DATABASE_URI` (optional: `PAYLOAD_PUBLIC_SERVER_URL`, `PAYLOAD_CONFIG_PATH`)
- **Install:** see [`cms-payload/README.md`](./cms-payload/README.md)
- **Pattern:** B. Separate `apps/cms/` Next.js app sharing the Postgres database with `apps/web`.

Editorial content managed outside the codebase, schema introspected back into `@void/db` as read-only Drizzle tables, `revalidateTag` called on the public app via Payload `afterChange` hooks.

### @void/audit-log -- Structured audit trail

- **State:** placeholder, README only
- **Env vars:** none (always-on once mounted; gate on `NODE_ENV` if needed)
- **Install:** see [`audit-log/README.md`](./audit-log/README.md)
- **Pattern:** B. Inline `audit_logs` Drizzle table + event consumer subscribing to typed service events per ADR 08.

"Who did what, when, and to which row" persisted in Postgres next to the data it audits. Ships a paginated admin viewer at `/admin/audit-log` gated by `requireRole('admin')`.

### @void/cookie-consent -- RGPD/ePrivacy consent banner

- **State:** placeholder, README only
- **Env vars:** none (consent state lives in a first-party `void_consent` cookie)
- **Install:** see [`cookie-consent/README.md`](./cookie-consent/README.md)
- **Pattern:** B. Inline client banner + server reader, gates `<AnalyticsProvider>` on `consent.analytics`.

Per-category toggles (essential / analytics / marketing), 13-month TTL matching CNIL guidance, no third-party SDK so brand integrity stays intact.

### @void/rate-limit-upstash -- Upstash Redis rate limiter

- **State:** placeholder, README only
- **Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (auto-provisioned by the Vercel Marketplace integration)
- **Install:** see [`rate-limit-upstash/README.md`](./rate-limit-upstash/README.md)
- **Pattern:** A or B. Implements the `RateLimiter` interface from `@void/core/rate-limit`, replacing the in-memory limiter that ships by default.

Real distributed rate limiting on Vercel serverless, where the in-memory limiter silently grants every request its own counter. Sliding window / token bucket / fixed window via `@upstash/ratelimit`.

### @void/i18n-next-intl -- Internationalization with next-intl

- **State:** placeholder, README only
- **Env vars:** `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_SUPPORTED_LOCALES`
- **Install:** see [`i18n-next-intl/README.md`](./i18n-next-intl/README.md)
- **Pattern:** B. Locale segment routing under `app/[locale]/...`, JSON message files in `apps/web/messages/`, locale-aware proxy in `proxy.ts`.

Server Components-first i18n with static generation per locale and ICU MessageFormat for plurals and dates. Activate when an MVP genuinely ships in two or more languages.

### @void/db-self-hosted-postgres -- Self-hosted Postgres migration path

- **State:** placeholder, README only (templates under `templates/`)
- **Env vars:** `DATABASE_URL` (replaces the Neon URL after migration), `POSTGRES_PASSWORD` (only used by the docker-compose template, not at runtime)
- **Install:** see [`db-self-hosted-postgres/README.md`](./db-self-hosted-postgres/README.md)
- **Pattern:** B. Repoint `DATABASE_URL` to a self-managed Postgres instance, no app code change needed (per [ADR 11](../docs/DECISIONS.md)).

The rare migration path away from Neon when data sovereignty, cost-at-scale, exotic extensions, or contractual constraints force the move. Below those triggers, stay on Neon.

## Module activation patterns

### Pattern A. Workspace package

The module is a real npm workspace under `_modules/<name>/` with `package.json`, `src/`, and a `tsconfig.json`. It is consumed via `"@void/<name>": "workspace:*"` in the app's `package.json`, transpiled through `transpilePackages` in `next.config.ts`, and activates at build time when its env var is present.

Used by `@void/sentry`, `@void/posthog`, and `@void/auth-clerk` (activation deliberate, not env-var-driven).

The DCE story matters here: client-side modules (`@void/posthog`, `@void/sentry` client) use a dynamic `import()` gated on `process.env['NEXT_PUBLIC_*']` so the SDK never enters the eager bundle. Turbopack does not statically eliminate the gated branch, so the SDK chunks may exist on disk under `.next/static/chunks/`, but they are only referenced from the gated dynamic import and never fetched by users at runtime when the env var is unset. Both real-package modules document this caveat in their READMEs.

### Pattern B. Copy-paste / scaffold

The module is README-only. The integration steps live as a recipe in the README, designed to be executed by a developer or AI agent against the current `apps/web` source. There is no workspace dep to add for the placeholder itself; the README tells you what to install in the consuming app. See [ADR 29](../docs/DECISIONS.md) for why placeholders deliberately stay out of the workspace graph.

Used by all eight placeholders. The "module" is the recipe + scope contract, not a shipped package. This avoids dead workspace deps and keeps the workspace graph honest about what is actually consumed.

A placeholder can be promoted to Pattern A later (typical path: a second app needs the same capability, the cost-of-promotion is small per ADR 07). Until that happens, the recipe is the artifact.

## See also

- [ADR 02](../docs/DECISIONS.md) -- Better-Auth as default, Clerk as opt-in
- [ADR 04](../docs/DECISIONS.md) -- Build-time module activation via env vars, not runtime
- [ADR 07](../docs/DECISIONS.md) -- No micro-packages
- [ADR 11](../docs/DECISIONS.md) -- Neon Postgres as default DB, no docker-compose in core
- [ADR 24](../docs/DECISIONS.md) -- Routing Middleware as `proxy.ts` (Next 16 rename)
- [ADR 25](../docs/DECISIONS.md) -- `@void/auth` client/server import boundary via 'server-only' + subpath split
