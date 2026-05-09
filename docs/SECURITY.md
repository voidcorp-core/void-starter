# Security

This document maps the void-starter primitives onto the threats and obligations a typical MVP must address: OWASP Top 10 (2021), RGPD, secret management, session security, rate limiting, CSP per app, soft-delete and cascade rules, and PII handling. The architectural rationale lives in `docs/DECISIONS.md`. The day-to-day implementation patterns live in `docs/PATTERNS.md`. This file is the security boundary view.

Every rule here reflects code that already ships in the repo. If you find code that disagrees with this doc, the doc is the source of truth -- fix the code, or open an ADR to change the rule.

---

## 1. Intent and rules

The starter ships secure-by-default substrates and documents which primitive addresses which class of risk. Three rules govern every change:

- **Defense in depth.** Validate at every boundary (`defineAction`, `defineFormAction` Zod parse), authorize at the service layer (`requireRole`, `policy.ts`), and enforce headers at the framework layer (`defaultSecurityHeaders` + `next.config.ts`).
- **Sovereign by default.** No user data leaves the deploy unless an `_modules/*` integration explicitly takes it there (Sentry, PostHog, Resend). See ADR 02 and ADR 04.
- **Loud failures.** Missing env vars throw at command-time via `required()` (ADR 13). Unsafe `console.log`, raw `process.env`, or bare `'use server'` are forbidden by the patterns doc -- a reviewer or CI catches them before they ship.

---

## 2. OWASP Top 10 (2021) mapping

| OWASP # | Risk | Primitive in this starter |
|---|---|---|
| A01 | Broken Access Control | `requireAuth`, `requireRole` (`packages/auth/src/auth.service.ts`); `auth.policy.ts` per service; `defineAction({ auth: 'role:admin' })` (`packages/auth/src/auth-action.ts`) |
| A02 | Cryptographic Failures | Better-Auth password hashing (Argon2id); Vercel TLS termination at the edge; httpOnly Secure SameSite=Lax cookies (Better-Auth defaults, `packages/auth/src/auth.repository.ts`); no plaintext storage anywhere in `packages/db/src/schema/*` |
| A03 | Injection | Drizzle parameterized queries (`packages/db/src/schema/*`, every repository); Zod validation at every boundary via `defineAction` and `defineFormAction` (`packages/core/src/server-action.ts`); no string interpolation into SQL or shell |
| A04 | Insecure Design | ADR-driven architecture (`docs/DECISIONS.md`, 25 entries); service-layer authorization separated via `policy.ts` (ADR 08); component to action to service to repository import direction enforced (ADR 03 and `docs/ARCHITECTURE.md` section 3) |
| A05 | Security Misconfiguration | `defaultSecurityHeaders()` from `@void/core/security-headers` wired in `apps/web/next.config.ts`; no debug routes; no public source maps unless `_modules/observability-sentry` uploads them privately to Sentry |
| A06 | Vulnerable and Outdated Components | Renovate auto-PRs (CI doc to land in Phase D); `gitleaks` pre-commit job (`lefthook.yml`); `bunx knip` flags unused deps so the dependency surface stays minimal |
| A07 | Identification and Authentication Failures | Better-Auth session rotation on auth-state change; httpOnly Secure cookies; magic-link expiry (`verifications.expiresAt`); role-based admin (`admin` plugin in `auth.repository.ts`); `requireEmailVerification: true` (Better-Auth config) |
| A08 | Software and Data Integrity Failures | Conventional commits enforced by review; signed merges recommended at the GitHub branch-protection layer; pre-commit hooks (`lefthook.yml`); no `eval`, no dynamic `require`, no untrusted code paths in core |
| A09 | Security Logging and Monitoring Failures | `pino` structured logger (ADR 22, `packages/core/src/logger.ts`); captured by Vercel function logs and Sentry when enabled (`_modules/observability-sentry`) |
| A10 | Server-Side Request Forgery (SSRF) | No user-controlled outbound URLs in core; modules that perform outbound calls (`_modules/payment-stripe`, `_modules/email-resend`) use vendor SDKs with allow-listed endpoints; rate-limited via `@void/core/rate-limit` once a path goes live |

Each row points to the file the reader can open today. Where a primitive is opt-in, the row points at the `_modules/*` path that activates it.

---

## 3. RGPD checklist

The starter does not "make you compliant" -- compliance is a per-MVP exercise -- but it ships the surface area you need to fill in.

- **Lawful basis declared per data category.** Distinguish essential (auth session, user record), analytics (PostHog), and marketing (future ad pixels). Activate `_modules/cookie-consent` when shipping to EU users with non-essential third-party SDKs. See `_modules/cookie-consent/README.md`.
- **User data export endpoint.** Better-Auth exposes the session and user record APIs needed to implement export. Build a typed Server Action via `defineAction({ auth: 'required' })` that aggregates the user's rows from every domain table and returns JSON. The starter does not ship the endpoint by default -- it is MVP-shaped.
- **User data deletion endpoint.** The `users` row deletes via `auth.api.deleteUser`. Cascade rules in `packages/db/src/schema/*` ensure `sessions`, `accounts`, and `verifications` drop with the user (`onDelete: 'cascade'` on every `userId` foreign key). Domain tables added later must declare the same cascade explicitly -- see section 7.
- **DPO contact.** Placeholder; the real MVP populates a privacy page with a contact email. The starter does not ship copy.
- **Privacy policy and Terms of Service.** Placeholder; the starter does not ship template legal copy because boilerplate legal text is worse than none. Each MVP writes its own with counsel.
- **PII tagging via JSDoc.** Use the `@pii` JSDoc tag on every field that carries personal data. See section 8 for the convention.
- **Privacy-by-default analytics.** PostHog is configured with `person_profiles: 'identified_only'` so anonymous traffic stays out of the person index. See `_modules/analytics-posthog/README.md` and ADR 04.

---

## 4. Secret management

- **Schema-validated env via `@void/core/env`.** `createAppEnv` wraps `@t3-oss/env-nextjs` and Zod, validates on first read, and skips validation in CI when `SKIP_ENV_VALIDATION=true` is set deliberately. See `packages/core/src/env.ts`.
- **Command-time presence check via `required()`.** For CLI configs (drizzle-kit) where the full schema is overkill, `required(name)` throws `Missing required env var: <NAME>` on absent or empty values. See ADR 13 and the `dbCredentials.url` getter in `packages/db/drizzle.config.ts`.
- **Never commit secrets.** `gitleaks` runs in `lefthook.yml` as a pre-commit job. `.gitignore` excludes `.env`, `.env.local`, and `.env.*.local`. Allow-listed Next.js build artifacts live in `.gitleaks.toml`.
- **Vercel "Sensitive" type for production secrets.** Set `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `SENTRY_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, etc. as the Sensitive var type in the Vercel dashboard so they never appear in deploy logs or the Vercel UI after creation.
- **No raw `process.env` in business code.** `PATTERNS.md` section 7 forbids it. Read through `createAppEnv` or `required()` so the missing-var error message is uniform across packages.

---

## 5. Session security defaults

Pulled from `packages/auth/src/auth.repository.ts` (Better-Auth wiring). Better-Auth selects safe defaults that this starter accepts as-is:

- **httpOnly cookies.** Browser JS cannot read the session token. The cookie is the only authentication credential.
- **Secure flag in production.** Better-Auth auto-sets `Secure` based on the `BETTER_AUTH_URL` protocol. A dev URL on `http://localhost:3000` keeps the flag off so local development works; a production URL on `https://...` flips it on.
- **SameSite=Lax.** The Better-Auth default. No deviation. SameSite=Strict would break OAuth callback flows; SameSite=None requires `Secure` and weakens CSRF posture without an offsetting need.
- **Session rotation on auth-state change.** Sign-in, sign-out, and role updates rotate the session token. Old tokens become invalid immediately at the database row level.
- **Configurable expiry.** Better-Auth's session lifetime defaults are sensible (7 days sliding). Tune via the `session` config object in `auth.repository.ts` if a specific MVP needs a shorter window.

---

## 6. Rate limiting strategy

Two implementations, one interface (`RateLimiter` in `packages/core/src/rate-limit.ts`).

- **Default: in-memory `createMemoryRateLimit`.** Single-process, fine for tests and dev. INTENT documented in the source: on Vercel serverless or any horizontally-scaled deploy the `Map` state is per-invocation, so the limiter silently grants every request its own counter. Use only when you control the process model OR in unit tests.
- **Production: `_modules/rate-limit-upstash`.** Backs the same `RateLimiter` interface with Upstash Redis (auto-provisioned via the Vercel Marketplace integration). Drop-in substitution -- the consumer code does not change when swapping. See `_modules/rate-limit-upstash/README.md`.

The starter does not yet apply the limiter to any specific endpoint. The application points are documented for MVPs to wire as needed:

- **Auth endpoints** (sign-in, sign-up, password reset, magic-link request) -- candidates for IP + email keying.
- **Action wrappers** -- a future enhancement to `defineAction` and `defineFormAction` could accept a `rateLimit` option keyed on `ctx.user.id` or the request IP. Until then, call the limiter inline at the start of each action handler.
- **Routing middleware** -- `apps/web/src/proxy.ts` is the global plug point for IP-based limits. Phase D `_modules/rate-limit-upstash` wires here.

---

## 7. CSP guidance per app

`defaultSecurityHeaders()` deliberately excludes `Content-Security-Policy`. CSP is the only header that must be tuned per app: image hosts, analytics endpoints, third-party script sources, and font origins differ across MVPs and break the page when wrong. A wrong default CSP is worse than no default.

Each app declares its own CSP in `next.config.ts`'s `headers()` array. A starting-point CSP for an app that uses PostHog (EU reverse-proxy) and Sentry:

```ts
async headers() {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return [
    {
      source: '/(.*)',
      headers: [
        ...defaultSecurityHeaders(),
        { key: 'Content-Security-Policy', value: csp },
      ],
    },
  ];
}
```

Three CSP notes for this starter:

- **PostHog connect-src.** PostHog traffic is reverse-proxied through `/ingest/*` (see ADR 04 and `_modules/analytics-posthog`), so the connect-src does NOT need an external `*.posthog.com` entry. The proxy keeps the connection same-origin.
- **`'unsafe-inline'` and `'unsafe-eval'` on script-src.** Required by Next.js's runtime hydration scripts and React 19's inline runtime. A nonce-based CSP is achievable via Next 16's experimental nonce support but adds complexity each MVP must validate. Start strict-but-functional; tighten later.
- **`frame-ancestors 'none'`.** The `X-Frame-Options: DENY` from `defaultSecurityHeaders()` covers legacy browsers; `frame-ancestors` covers modern ones. Both are belt-and-braces.

When activating Stripe, CMS, or other modules, extend the CSP per the module's README.

---

## 8. Soft delete and cascade rules

The starter ships one soft-delete column (`users.deletedAt`) and otherwise prefers physical deletes.

- **Convention: physical deletes preferred over soft delete.** Soft delete adds a permanent filter (`WHERE deleted_at IS NULL`) to every read. Forgetting the filter once leaks a deleted row. Default to physical deletes.
- **Exception: audit-loggable entities.** Users (regulatory keep-window for billing or GDPR), payments (financial audit trail), and any row referenced from an `audit_logs` table use soft delete with a `deletedAt` timestamp. Service-layer queries MUST filter `WHERE deleted_at IS NULL` -- helper queries can encode this once via a Drizzle helper to reduce drift.
- **Cascade: declare `onDelete` explicitly in the Drizzle schema.** Never rely on the Postgres default (no action). Every foreign key referencing a deletable parent declares either `onDelete: 'cascade'` (drop dependent rows), `onDelete: 'set null'` (orphan), or `onDelete: 'restrict'` (block deletion).
- **Current cascade map:**

  | Child | Parent | onDelete | Why |
  |---|---|---|---|
  | `accounts.userId` | `users.id` | cascade | Removing a user must drop every linked OAuth identity (`packages/db/src/schema/accounts.ts`) |
  | `sessions.userId` | `users.id` | cascade | Removing a user must drop every outstanding session (`packages/db/src/schema/sessions.ts`) |
  | `verifications.identifier` | n/a | n/a | Verifications use a string identifier, not an FK; expiry is the cleanup mechanism |

When a new domain table joins the schema, add it to this map and pick the cascade behavior in the same commit as the migration. No silent defaults.

---

## 9. PII handling and the `@pii` JSDoc tag

Mark every field that carries personal data with the `@pii` JSDoc tag. The tag is a grep target, not a tool-enforced rule -- but the discipline of writing it surfaces decisions at the type layer where they are visible to every reader.

```ts
import 'server-only';

import type { Role } from './auth.types';

export type SessionUser = {
  id: string;
  /** @pii email address -- never log full value, mask via `maskEmail` */
  email: string;
  /** @pii display name -- log only when identifying actor */
  name: string;
  role: Role;
};
```

Three logging conventions follow from the tags:

- **Email fields.** Mask before logging. Use `maskEmail` from `@void/core/sanitize` (`packages/core/src/sanitize.ts`).
- **Free-text fields.** Truncate to bound the log line size. Use `truncate` from `@void/core/sanitize`.
- **IP address fields.** Treated as PII under RGPD; never log unredacted in production. Mask the last octet (`192.168.1.x`) when logging.

The `@pii` tag also signals to a future export-or-delete tool which columns to traverse when implementing user data export and deletion endpoints (section 3). The convention pays interest immediately and compound interest later.

---

## Cross-references

- `docs/DECISIONS.md` -- the why behind every architectural choice. Read entry 02 (Better-Auth), entry 04 (build-time activation), entry 11 (Neon DB), entry 13 (`required()`), entry 22 (pino logger), entry 25 (server-only boundary).
- `docs/ARCHITECTURE.md` -- topology, layering rules, package boundaries.
- `docs/PATTERNS.md` -- file naming, service layout, code style commitments.
- `docs/AUTH.md` -- Better-Auth integration details, session lifecycle, role-based access.
- `docs/CACHING.md` -- read / write cache strategy and the rules that prevent caching user-scoped data globally.
- `docs/MODULES.md` -- catalogue of opt-in modules (`_modules/cookie-consent`, `_modules/rate-limit-upstash`, `_modules/audit-log`).
