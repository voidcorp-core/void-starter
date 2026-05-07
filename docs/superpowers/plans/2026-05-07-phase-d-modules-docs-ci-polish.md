# Phase D: Modules, Docs, CI, Polish, Final Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the opt-in modules (Sentry, PostHog, Auth-Clerk + placeholders for Stripe, Resend, CMS, Audit-Log, Cookie-Consent), author the full `docs/*.md` set per the documentation policy, wire GitHub Actions CI with concurrency + caching + quality gates, polish the developer experience (`.vscode/`, `.editorconfig`, expanded README), and run the final validation gate before declaring the starter ready to template.

**Architecture:** Modules live in `_modules/` and are real workspace packages (per the Modules system in `context.md`). Each module is opt-in, activated by env var presence at build time per decision 04. Docs follow the meta-rule (every convention reflected in MD). CI runs lint + type-check + test + build + knip + gitleaks with Turbo cache and Bun cache, with concurrency to cancel stale runs.

**Reference:** `context.md` Modules system + Documentation policy + Security and RGPD, `starter-plan.md` Steps 10-14, `docs/DECISIONS.md` (all 10 entries).

**Pre-conditions:**
- `git tag phase-c-complete` exists on origin
- `apps/web` runs end-to-end (auth flows verified manually)
- All unit tests pass (Vitest + Playwright)

---

## Phase A + B + C learnings inherited

Read the prior phase plans' "learnings inherited" sections. Critical reminders unchanged. New learnings from Phase C:
- `experimental.cacheComponents: true` enabled in `next.config.ts`; verify the flag is still under experimental in current Next 16.x.
- `transpilePackages` must list every consumed `@void/*` package.
- E2E auth tests rely on a live DB and the dev server; CI must replicate this via service container + parallel `bun run dev`.

---

# Section 1: Real-package modules (Tasks 1-15)

## _modules/observability-sentry

### Task D1: Sentry module package skeleton

**Files:** `_modules/observability-sentry/package.json`, `tsconfig.json`, `src/server.ts`, `src/edge.ts`, `src/client.ts`, `src/index.ts`, `README.md`

- [ ] **Read Sentry Next.js docs**: `https://docs.sentry.io/platforms/javascript/guides/nextjs/` and `https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/`. Confirm:
  - `@sentry/nextjs` package version
  - `Sentry.init` API (server vs edge vs client config split)
  - Tunnel option name and recommended path
  - Source maps upload config

NOTE (verified 2026-05-07): `@sentry/nextjs` is at 10.x on npm. The modern setup splits into FOUR files: `instrumentation.ts` (Next.js root - dispatches to server/edge configs), `instrumentation-client.ts` (Next.js root - client init, replaces the old `sentry.client.config.ts`), `sentry.server.config.ts`, `sentry.edge.config.ts`. The wrapper `withSentryConfig(nextConfig, { ... })` is still recommended; the tunnel option is `tunnelRoute: '/sentry-tunnel'` (not just `tunnel`). A `global-error.tsx` page is also required for App Router error capture. The `onRequestError` export from `instrumentation.ts` (= `Sentry.captureRequestError`) is needed in Next.js 15+.

- [ ] **Create `_modules/observability-sentry/package.json`**

// Updated 2026-05-07 from initial draft: bumped @sentry/nextjs to ^10.0.0; added an edge.ts source file to mirror the modern setup.

```json
{
  "name": "@void/sentry",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./server": "./src/server.ts",
    "./edge": "./src/edge.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@sentry/nextjs": "^10.0.0",
    "@void/core": "workspace:*"
  },
  "devDependencies": {
    "@void/config": "workspace:*",
    "next": "^16.2.0",
    "typescript": "^5.6.0"
  },
  "peerDependencies": {
    "next": "^16.0.0"
  }
}
```

- [ ] **Create `src/server.ts`**

// Updated 2026-05-07 from initial draft: this module now exposes a registerServer() that callers wire from instrumentation.ts behind the runtime check, matching the modern Sentry pattern.

```ts
import * as Sentry from '@sentry/nextjs';

export function registerServer() {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
    sendDefaultPii: true,
  });
}

export const onRequestError = Sentry.captureRequestError;
```

- [ ] **Create `src/edge.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

export function registerEdge() {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
  });
}
```

- [ ] **Create `src/client.ts`**

// Updated 2026-05-07 from initial draft: tunnel option is `tunnelRoute` (passed via withSentryConfig in next.config.ts, not in Sentry.init). Removed it from here; left a comment pointing callers to next.config wiring. The DSN env var name is still NEXT_PUBLIC_SENTRY_DSN.

```ts
import * as Sentry from '@sentry/nextjs';

// This file is consumed from apps/web/instrumentation-client.ts. Do NOT add
// 'use client' here - instrumentation-client.ts is not a React component.
export function initSentryClient() {
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    environment: process.env['NODE_ENV'] ?? 'development',
    sendDefaultPii: true,
    // The tunnel route is configured in next.config.ts via
    // withSentryConfig(..., { tunnelRoute: '/sentry-tunnel' }).
  });
}
```

- [ ] **Create `_modules/observability-sentry/README.md`** documenting:
  - Required env vars: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_TRACES_SAMPLE_RATE`
  - Install steps (modern Sentry 10.x pattern):
    1. Add to `apps/web/package.json` deps: `"@void/sentry": "workspace:*"`
    2. Run `bun install`
    3. In `apps/web/instrumentation.ts`, dispatch on `process.env.NEXT_RUNTIME`:
       - if `'nodejs'`, dynamically import and call `registerServer()` from `@void/sentry/server`
       - if `'edge'`, dynamically import and call `registerEdge()` from `@void/sentry/edge`
       - re-export `onRequestError` from `@void/sentry/server`
    4. Create `apps/web/instrumentation-client.ts` that imports and calls `initSentryClient()` from `@void/sentry/client`
    5. Wrap `next.config.ts` with `withSentryConfig(config, { org, project, authToken, tunnelRoute: '/sentry-tunnel', silent: !process.env.CI })`
    6. Add `apps/web/src/app/global-error.tsx` per the Sentry docs to capture React render errors
  - Removal steps to undo

- [ ] Add to knip.json with `ignoreDependencies: []` once consumed by apps/web (later step).
- [ ] Commit: `feat(modules): add observability-sentry workspace package`

### Task D2: Sentry tunnel route handler template

**Files:** `_modules/observability-sentry/templates/sentry-tunnel-route.ts.template`

A copy-paste template that the install instructions reference. Documented because the tunnel route needs to live in `apps/web/`, not in the package itself.

NOTE (verified 2026-05-07): Modern Sentry sets `tunnelRoute: '/sentry-tunnel'` via `withSentryConfig`, which is automatically wired by Sentry's webpack plugin and does NOT require a manual route handler in most setups. If a manual handler is still needed (custom CSP, custom proxy logic), the file lives at `apps/web/src/app/sentry-tunnel/route.ts`. The earlier `/monitoring` path was an older convention; use `/sentry-tunnel` for new setups.

- [ ] Author per Sentry docs.
- [ ] Commit: `feat(modules): add Sentry tunnel route template`

### Task D3: Wire Sentry into apps/web (with env activation demo)

This task DEMONSTRATES the install procedure end-to-end so future MVPs can mirror it. Activate it but only in dev (no real DSN); verify the conditional dynamic import path works.

NOTE (verified 2026-05-07): Modern Sentry on Next.js requires both `instrumentation.ts` (server/edge dispatch) AND `instrumentation-client.ts` (client init). Both files live at the apps/web/ root (or `apps/web/src/` if `srcDir` is configured). The `withSentryConfig` wrapper in `next.config.ts` handles tunnel-route generation and source-map upload automatically.

- [ ] Add `@void/sentry: workspace:*` to apps/web/package.json deps.
- [ ] Update `apps/web/instrumentation.ts` to dispatch on NEXT_RUNTIME and dynamically import `@void/sentry/server` or `@void/sentry/edge`. Re-export `onRequestError`.
- [ ] Create `apps/web/instrumentation-client.ts` calling `initSentryClient()` from `@void/sentry/client`.
- [ ] Wrap apps/web/next.config.ts with `withSentryConfig(config, { tunnelRoute: '/sentry-tunnel', silent: !process.env.CI })`.
- [ ] Run `bun run build` and verify Sentry is NOT in the bundle when SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are unset.
- [ ] Commit: `feat(web): wire Sentry module via instrumentation.ts (build-time activation)`

## _modules/analytics-posthog

### Task D4: PostHog module package skeleton

**Files:** `_modules/analytics-posthog/package.json`, `tsconfig.json`, `src/AnalyticsProvider.tsx`, `src/index.ts`, `README.md`

- [ ] **Read PostHog Next.js docs**: `https://posthog.com/docs/libraries/next-js` and `https://posthog.com/docs/advanced/proxy/nextjs`. Confirm:
  - `posthog-js` for client init, `posthog-node` for server (if needed)
  - Reverse proxy patterns to bypass ad-blockers
  - Recommended init options (capture_pageview, autocapture, etc.)

NOTE (verified 2026-05-07 against the URLs above): `posthog-js` is at 1.372.x on npm. The modern PostHog Next.js setup recommends initialising in a Next.js `instrumentation-client.ts` file rather than (or in addition to) a React Provider, but a client-side `<PostHogProvider>` from `posthog-js/react` is still supported and remains the cleanest "drop-in" pattern for opt-in modules. The recommended init now uses the `defaults: '2026-01-30'` option which sets sensible modern defaults; passing it instead of fine-grained `capture_pageview`/`capture_pageleave` is the canonical 2026 pattern. The reverse proxy rewrite rules use a catch-all under a chosen prefix (we use `/ingest`) and target `*-assets.i.posthog.com` for static + array files plus the bare host for everything else. `skipTrailingSlashRedirect: true` MUST be set on the Next.js config or the rewrite chain breaks.

- [ ] **Create `_modules/analytics-posthog/package.json`**

// Updated 2026-05-07 from initial draft: bumped posthog-js range to ^1.370.0 (latest is 1.372.x); kept posthog-js/react Provider pattern since it's still supported and cleaner for an opt-in module than instrumentation-client.ts.

```json
{
  "name": "@void/posthog",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./client": "./src/AnalyticsProvider.tsx"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "posthog-js": "^1.370.0"
  },
  "devDependencies": {
    "@void/config": "workspace:*",
    "@types/react": "^19.0.0",
    "react": "^19.0.0",
    "typescript": "^5.6.0"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

- [ ] **Create `src/AnalyticsProvider.tsx`**

// Updated 2026-05-07 from initial draft: switched init options to use `defaults: '2026-01-30'` (modern PostHog convention) instead of hand-picked capture_pageview/capture_pageleave; kept person_profiles override since 'identified_only' is a deliberate privacy choice; kept ui_host for EU dashboard linking.

```tsx
'use client';

import { useEffect, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const key = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
  const host = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? '/ingest';

  useEffect(() => {
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
    });
  }, [key, host]);

  if (!key) return <>{children}</>;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
```

- [ ] **Create README** documenting:
  - Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (default `/ingest`)
  - Install: add `@void/posthog: workspace:*` to apps/web; wrap `RootLayout` children with `<AnalyticsProvider>`; add `next.config.ts` rewrites for the EU proxy and `skipTrailingSlashRedirect`:

    // Updated 2026-05-07 from initial draft: rewrite rules now match the canonical PostHog Next.js proxy pattern (static + array + catch-all) and rely on skipTrailingSlashRedirect at the config level. The previous /decide one-off rule is no longer needed - it's covered by the catch-all.

    ```ts
    // next.config.ts excerpt
    {
      skipTrailingSlashRedirect: true,
      async rewrites() {
        return [
          {
            source: '/ingest/static/:path*',
            destination: 'https://eu-assets.i.posthog.com/static/:path*',
          },
          {
            source: '/ingest/array/:path*',
            destination: 'https://eu-assets.i.posthog.com/array/:path*',
          },
          {
            source: '/ingest/:path*',
            destination: 'https://eu.i.posthog.com/:path*',
          },
        ];
      },
    }
    ```
  - The `useEffect` reads env at runtime, but because `NEXT_PUBLIC_*` is build-time inlined, the entire branch is DCE'd when the var is absent at build.

- [ ] Commit: `feat(modules): add analytics-posthog workspace package with EU proxy`

### Task D5: Wire PostHog into apps/web

- [ ] Add `@void/posthog: workspace:*` to apps/web deps.
- [ ] Wrap `RootLayout` with `<AnalyticsProvider>`.
- [ ] Add the rewrites in `next.config.ts` AND set `skipTrailingSlashRedirect: true` (verified 2026-05-07: rewrite chain breaks without it).
- [ ] Verify `bun run build` produces a bundle WITHOUT PostHog when `NEXT_PUBLIC_POSTHOG_KEY` is unset at build time.
- [ ] Commit: `feat(web): wire PostHog AnalyticsProvider with EU proxy rewrites`

## _modules/auth-clerk

### Task D6: Clerk alternative auth module

**Files:** `_modules/auth-clerk/package.json`, `tsconfig.json`, `src/auth.repository.ts`, `README.md`

- [ ] **Read Clerk Next.js docs**: `https://clerk.com/docs/quickstarts/nextjs`. Confirm `@clerk/nextjs` API for server-side session reading.

- [ ] **Create the package** with an alternative `auth.repository.ts` that wraps Clerk and exposes the same surface as `@void/auth`'s repository (so the swap is one-file).

The README documents the swap procedure:
1. Replace `packages/auth/src/auth.repository.ts` with the Clerk version (copy from `_modules/auth-clerk/src/auth.repository.ts`)
2. Update `packages/auth/package.json` deps: replace `better-auth` with `@clerk/nextjs`
3. Update env vars: replace `BETTER_AUTH_*` and `GOOGLE_*` with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
4. Replace `apps/web/src/app/api/auth/[...all]/route.ts` with Clerk's catchall handler
5. Wrap RootLayout with `<ClerkProvider>`

- [ ] Commit: `feat(modules): add auth-clerk alternative repository`

## Stub modules

### Task D7: _modules/payment-stripe stub

**Files:** `_modules/payment-stripe/README.md` placeholder explaining scope, env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), expected install steps, and the integration points (checkout flow, webhook handler at `apps/web/src/app/api/webhooks/stripe/route.ts`, customer mirror table in `@void/db`).

- [ ] Commit: `feat(modules): scaffold payment-stripe placeholder`

### Task D8: _modules/email-resend stub

**Files:** `_modules/email-resend/README.md` documenting env vars (`RESEND_API_KEY`, `EMAIL_FROM`), the expected `sendMagicLink` adapter swap in `@void/auth`, and the integration with `@void/email/server` for transactional emails.

- [ ] Commit: `feat(modules): scaffold email-resend placeholder`

### Task D9: _modules/cms-payload stub

**Files:** `_modules/cms-payload/README.md` documenting how to install Payload CMS as an additional app (`apps/cms`) sharing the same Postgres, with env vars and install steps.

- [ ] Commit: `feat(modules): scaffold cms-payload placeholder`

### Task D10: _modules/audit-log stub

**Files:** `_modules/audit-log/README.md` documenting an `audit_logs` Drizzle table, an audit middleware that logs all writes via service-level events (per the `events.ts` pattern), and a viewer in the admin panel.

- [ ] Commit: `feat(modules): scaffold audit-log placeholder`

### Task D11: _modules/cookie-consent stub

**Files:** `_modules/cookie-consent/README.md` documenting RGPD-compliant cookie consent (banner + per-category toggles), integration with PostHog conditional init.

- [ ] Commit: `feat(modules): scaffold cookie-consent placeholder`

### Task D12: _modules/rate-limit-upstash stub

Real Upstash Redis adapter for `RateLimiter` interface from `@void/core/rate-limit`. README documents env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

- [ ] Commit: `feat(modules): scaffold rate-limit-upstash placeholder`

### Task D13: _modules/i18n-next-intl stub

Internationalization via next-intl. README documents the locale routing setup and message file structure.

- [ ] Commit: `feat(modules): scaffold i18n-next-intl placeholder`

### Task D14a: _modules/db-self-hosted-postgres stub

**Files:** `_modules/db-self-hosted-postgres/README.md` + `_modules/db-self-hosted-postgres/templates/docker-compose.yml.template`

The starter defaults to Neon Postgres via Vercel Marketplace (DECISIONS.md
entry 11). This module documents the rare migration path to a self-hosted
Postgres on a VPS or your own infrastructure.

The README documents:
- When to activate this module: data sovereignty hard requirement (regulated
  industries, specific country/hardware), cost optimization at scale (>$500/mo
  Neon bill), exotic Postgres extensions Neon does not support, or contractual
  refusal of US-based vendors
- Migration steps:
  1. Provision the self-hosted Postgres (the docker-compose template is a
     starting point; production-grade setups need backup, monitoring, replication)
  2. `pg_dump` from Neon: `pg_dump $NEON_DATABASE_URL > backup.sql`
  3. `psql` into the self-hosted DB: `psql $SELF_HOSTED_DATABASE_URL < backup.sql`
  4. Update `DATABASE_URL` env var in Vercel and locally
  5. Test thoroughly before flipping prod traffic
- The `docker-compose.yml.template` is a starting point with healthcheck and
  named volume; not production-grade

- [ ] Commit: `feat(modules): scaffold db-self-hosted-postgres placeholder`

### Task D14: _modules README

**Files:** `_modules/README.md` listing all modules, their state (real/placeholder), env vars, and quick install pointers. The catalogue MUST include `db-self-hosted-postgres` (Task D14a) alongside the other placeholders, with a one-line note that it exists for the rare cases where Neon-via-Vercel (the default per DECISIONS entry 11) is not acceptable.

- [ ] Commit: `docs(modules): add _modules catalogue README`

### Task D15: Section 1 validation

- [ ] `bun run lint`, `bun run type-check`, `bun run test`, `bun run build` all green.
- [ ] Verify `bun run build` of `apps/web` produces a bundle that:
  - Includes Sentry only if SENTRY_DSN was set
  - Includes PostHog only if NEXT_PUBLIC_POSTHOG_KEY was set
  - Otherwise excludes both via DCE
- [ ] Commit any cleanup needed.

---

# Section 2: Documentation (Tasks 16-25)

The meta-rule: every convention reflected in code must appear in the matching `docs/*.md`. Each doc opens with intent + rules + examples. Under 600 lines.

### Task D16: docs/PATTERNS.md

**Sections:**
- Principles: KISS, DRY, SoC (3 paragraphs max)
- File naming conventions
- Service file layout (5 standard + 5 optional layers, per DECISIONS.md entry 08)
- When to extract a helper
- When to extract a mapper
- When to extract a policy
- When to add integration tests
- Promotion rule from app-level use-cases to domain packages
- Examples: pointer to `@void/auth` as the canonical service example, and `apps/web/src/components/_examples/*` as canonical component examples

- [ ] Commit: `docs: write PATTERNS.md`

### Task D17: docs/ARCHITECTURE.md

**Sections:**
- Topology overview (apps, packages, _modules)
- Package boundary table: tier 1 (always-on) vs tier 2 (opt-in via env)
- Layering rules with the dependency graph (component -> service -> repository -> I/O)
- Cross-package import rules (no circular deps)
- Why `actions.ts` lives in apps not packages (DECISIONS entry 03)
- Build-time module activation (DECISIONS entry 04) with code samples
- Cache strategy summary (link to CACHING.md)

- [ ] Commit: `docs: write ARCHITECTURE.md`

### Task D18: docs/SECURITY.md

**Sections:**
- OWASP Top 10 mapping (each item with a pointer to the primitive that addresses it)
- RGPD checklist with primitive references
- Secret management (env validation, never commit secrets, gitleaks pre-commit)
- Session security defaults (httpOnly, secure, sameSite=lax, rotation)
- Rate limiting strategy (in-memory + Upstash module)
- CSP guidance per app (default headers exclude CSP; each app declares its own)
- Soft delete + cascade rules
- PII handling and JSDoc tagging convention

- [ ] Commit: `docs: write SECURITY.md with OWASP + RGPD mapping`

### Task D19: docs/AUTH.md

**Sections:**
- Public API of `@void/auth`
- Sign-in flow diagram (email/password, Google OAuth, magic link)
- Session lifecycle
- Role-based access with `requireRole`
- Switching to Clerk via `_modules/auth-clerk` (full procedure)
- Adding a new OAuth provider (env vars + Better-Auth config update)
- Customizing email templates (link to `_modules/email-resend`)

- [ ] Commit: `docs: write AUTH.md`

### Task D20: docs/CACHING.md

**Sections:**
- Cache Components in Next 16: `"use cache"` directive, `cacheTag`, `cacheLife`
- Convention: cache lives at service layer for reads
- Convention: `updateTag()` lives in actions for writes
- Repository never caches
- Examples from `@void/auth` and from canonical UserProfileCard
- Pitfalls: do NOT cache mutations, do NOT cache user-specific data without user-scoped tags

- [ ] Commit: `docs: write CACHING.md`

### Task D21: docs/MODULES.md

**Sections:**
- Catalogue of all modules with state (real/placeholder)
- Activation pattern A (real workspace package) vs pattern B (copy-paste)
- How to write a new module: package.json shape, env var declaration, instrumentation hook (server) or AnalyticsProvider-style (client)
- Module removal procedure
- Module testing strategy

- [ ] Commit: `docs: write MODULES.md`

### Task D22: docs/DECISIONS.md - finalize

The 10 entries seeded during brainstorm + architecture phase are intact. Append any new decisions taken during Phase B/C/D execution (e.g., postgres-js vs pg, magic link sender stub, redirect target on UnauthorizedError).

- [ ] For each new entry, format: Decision / Why / Rejected alternatives / When to revisit.
- [ ] Commit: `docs: append phase B/C/D decisions to DECISIONS.md`

### Task D23: Update root CLAUDE.md

**Files:** `CLAUDE.md` (repo root)

```markdown
# Project Conventions for AI Assistants

This is the void-starter repo. Read these files in order before writing code:

1. `docs/DECISIONS.md` - non-obvious choices, alternatives rejected, do NOT re-litigate
2. `docs/PATTERNS.md` - KISS / DRY / SoC + file naming + service layout
3. `docs/ARCHITECTURE.md` - package boundaries + dependency direction

For specific tasks:
- Touching auth: read `docs/AUTH.md` + the canonical service `packages/auth/`
- Touching cache: read `docs/CACHING.md`
- Touching security: read `docs/SECURITY.md`
- Adding a module: read `docs/MODULES.md`
- Writing a component: read `apps/web/src/components/_examples/`
- Writing a service: read `packages/auth/` (canonical example)

## Hard rules

- Match file naming exactly (`Name.tsx`, `Name.helper.ts`, `Name.test.ts`, etc.)
- Service layer NEVER touches DB directly - always through repository
- Component layer NEVER touches DB - always through service
- Helpers are PURE: no I/O, no side effects
- Use `@void/core/logger`, never `console.log` in committed code
- Use `@void/core/env`, never `process.env` directly in business code
- Use typed errors from `@void/core/errors`, never throw strings
- Use `defineAction` from `@void/auth` for all Server Actions
- Server Actions live in `apps/*/src/actions/`, NEVER in packages
- No em dashes anywhere; no emojis in code/docs/commits
- Read official documentation of any third-party tool BEFORE writing its config

## Meta-rules

- Any new convention MUST be added to the matching `docs/*.md` in the same commit
- Any non-obvious decision (where a credible alternative exists) MUST be logged in `docs/DECISIONS.md`
- Removed concepts must be removed from the docs at the same time
- Tests use `bunx vitest run` (unit) and `bunx playwright test` (E2E); do not skip TDD when adding business logic

## gstack note

If gstack is installed at the user level (~/.claude/skills/gstack/), prefer its slash commands for design (/design-shotgun, /design-consultation, /design-html), QA (/qa, /qa-only), and shipping (/ship, /land-and-deploy) over reinventing those workflows.
```

- [ ] Commit: `docs: rewrite CLAUDE.md as canonical AI assistant entry point`

### Task D24: Verify docs internal links

```
grep -r '\.md' docs/ CLAUDE.md README.md
```

Confirm every referenced file exists. Fix dangling links.

- [ ] Commit if changes: `docs: fix internal links`

### Task D25: Section 2 validation

- [ ] `bun run lint`, `bun run knip`, all docs render correctly in GitHub web view (manually check after push).
- [ ] No file in docs/ exceeds 600 lines.

---

# Section 3: CI (Tasks 26-30)

### Task D26: GitHub Actions CI workflow

**Files:** `.github/workflows/ci.yml`

```yaml
# CI uses a postgres service container (16-alpine) instead of a Neon CI branch.
# Rationale: CI tests verify schema migrations and queries, not connection pool
# behavior. Drift between docker postgres and Neon is negligible for these tests.
# Production and dev use Neon (DECISIONS entry 11).
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: void
          POSTGRES_PASSWORD: void
          POSTGRES_DB: void_starter
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U void -d void_starter"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://void:void@localhost:5432/void_starter
      BETTER_AUTH_SECRET: test-secret-this-is-long-enough-for-the-validator
      BETTER_AUTH_URL: http://localhost:3000
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      GOOGLE_CLIENT_ID: ci-stub
      GOOGLE_CLIENT_SECRET: ci-stub
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.13'
      - name: Cache bun + turbo
        uses: actions/cache@v4
        with:
          path: |
            ~/.bun/install/cache
            .turbo
          key: ${{ runner.os }}-bun-turbo-${{ hashFiles('bun.lock') }}
          restore-keys: ${{ runner.os }}-bun-turbo-
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run type-check
      - name: Apply DB migrations
        run: cd packages/db && bunx drizzle-kit migrate
      - run: bun run test
      - run: bun run build
      - run: bunx knip --no-progress
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  e2e:
    needs: quality
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: void
          POSTGRES_PASSWORD: void
          POSTGRES_DB: void_starter
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U void -d void_starter"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://void:void@localhost:5432/void_starter
      BETTER_AUTH_SECRET: test-secret-this-is-long-enough-for-the-validator
      BETTER_AUTH_URL: http://localhost:3000
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      GOOGLE_CLIENT_ID: ci-stub
      GOOGLE_CLIENT_SECRET: ci-stub
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.13'
      - run: bun install --frozen-lockfile
      - run: cd packages/db && bunx drizzle-kit migrate
      - run: cd apps/web && bunx playwright install --with-deps chromium
      - run: cd apps/web && bun run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report
```

- [ ] Verify the workflow runs successfully in a PR.
- [ ] Commit: `ci: add GitHub Actions workflow with quality + e2e jobs`

### Task D27: Branch protection (manual via GitHub web UI - documented in README)

Document in `docs/MODULES.md` or a new `docs/CI.md` the recommended branch protection rules: require quality + e2e jobs to pass before merge to main.

- [ ] Commit: `docs(ci): document branch protection recommendation`

### Task D28: PR template

**Files:** `.github/pull_request_template.md`

```markdown
## What this changes

<!-- One sentence summary -->

## Why

<!-- Link to issue / context -->

## Validation

- [ ] `bun run lint`
- [ ] `bun run type-check`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bun run test:e2e` (if UI changed)
- [ ] DECISIONS.md updated (if non-obvious decision taken)
- [ ] docs/*.md updated (if convention introduced or changed)
```

- [ ] Commit: `chore(ci): add pull request template`

### Task D29: Issue templates

**Files:** `.github/ISSUE_TEMPLATE/bug.md`, `.github/ISSUE_TEMPLATE/feature.md`

Standard templates with conventional commit prefixes suggested.

- [ ] Commit: `chore(ci): add issue templates`

### Task D30: Section 3 validation

Push a small change to a feature branch, open a PR, verify CI runs both jobs and they go green.

---

# Section 4: Repo polish (Tasks 31-35)

### Task D31: VS Code workspace settings

**Files:**
- Create: `.vscode/settings.json`
- Create: `.vscode/extensions.json`

```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[json]": { "editor.defaultFormatter": "biomejs.biome" },
  "[jsonc]": { "editor.defaultFormatter": "biomejs.biome" },
  "eslint.enable": false,
  "prettier.enable": false,
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.experimental.classRegex": [
    ["cn\\(([^)]*)\\)", "['\"`]([^'\"`]*)['\"`]"]
  ]
}
```

```json
// .vscode/extensions.json
{
  "recommendations": [
    "biomejs.biome",
    "bradlc.vscode-tailwindcss",
    "drizzle-team.vscode-drizzle-orm",
    "usernamehw.errorlens",
    "ms-playwright.playwright"
  ],
  "unwantedRecommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode"
  ]
}
```

- [ ] Commit: `chore: add VSCode workspace settings and recommended extensions`

### Task D32: .editorconfig

**Files:** `.editorconfig`

```
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] Commit: `chore: add editorconfig`

### Task D33: Expanded README

**Files:** `README.md` (replace the seed)

Sections:
- Project description (1-2 paragraphs)
- Stack overview (table from context.md)
- Topology (tree diagram)
- Quick start: `gh repo create my-mvp --template voidcorp-core/void-starter`, then `bun install`, link the repo to a Vercel project with the Neon Marketplace integration enabled, run `vercel env pull .env.local` to fetch the Neon dev branch URL, then `bun run dev` (DECISIONS entry 11)
- Module activation (link to docs/MODULES.md)
- Documentation (links to all docs/*.md)
- Contributing (conventional commits, hooks, branch protection)
- License

Keep under ~250 lines.

- [ ] Commit: `docs: expand README with quick start, topology, modules, contributing`

### Task D34: CONTRIBUTING.md

**Files:** `CONTRIBUTING.md`

Brief: how to clone, install, develop. References `CLAUDE.md` for AI assistants and `docs/PATTERNS.md` for human contributors.

- [ ] Commit: `docs: add CONTRIBUTING guide`

### Task D35: SECURITY policy

**Files:** `SECURITY.md` (root, GitHub-recognized location)

Brief: how to report a vulnerability, link to docs/SECURITY.md for the technical primitives.

- [ ] Commit: `docs: add SECURITY policy`

---

# Section 5: Final validation (Tasks 36-40)

### Task D36: full pipeline at root

```
bun run lint
bun run type-check
bun run test
bun run build
bunx knip --no-progress
bunx gitleaks detect --no-git --redact
```

All six MUST pass. Zero tolerance.

### Task D37: apps/web E2E in fresh dev environment

Reset the Neon dev branch to a clean state (Neon dashboard: "Reset from parent" on the dev branch, OR drop and recreate via the Vercel Neon integration UI). Then:

```
vercel env pull .env.local
source <(grep -v '^#' .env.local | sed -e 's/^/export /')
cd packages/db && bunx drizzle-kit migrate && cd ../..
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export BETTER_AUTH_URL=http://localhost:3000
export NEXT_PUBLIC_APP_URL=http://localhost:3000
cd apps/web && bun run test:e2e && cd ../..
```

All Playwright tests pass.

### Task D38: Module install dry-run for one MVP scenario

Pretend a fresh user instantiates the template and adds Sentry:

1. Add `@void/sentry: workspace:*` to apps/web/package.json
2. Set `SENTRY_DSN` in `.env.local`
3. Run `bun install && bun run build`
4. Verify Sentry chunks are produced
5. Unset SENTRY_DSN, rebuild, verify Sentry chunks absent

This proves the build-time activation pattern works end-to-end.

- [ ] Document the dry-run in a commit message: `chore: validate Sentry module activation end-to-end`

### Task D39: docs sanity check

Read every doc/*.md from top to bottom. Confirm:
- Every conventionn the doc claims is implemented in code
- Every code primitive has a doc reference
- No dangling TODOs

- [ ] Fix any drift.
- [ ] Commit: `docs: final sanity check after Phase D`

### Task D40: tag and announce

```
git tag phase-d-complete
git tag v0.1.0  # first release-ready tag
git push --tags
```

- [ ] Update GitHub repo: enable "Template repository" toggle in Settings (manual step).
- [ ] Verify `gh repo create test-mvp --template voidcorp-core/void-starter` works (test on a throwaway repo, then delete).

---

## Phase D done. The starter is ready to template.

After completion:
- Push announcement to whatever channel Folpe uses (Linear, Slack, etc.)
- Begin templating MVPs from the starter and iterate based on real-world friction
- Future work tracked separately:
  - Populate placeholder modules with real implementations
  - Build a `create-void-app` CLI on top of the template
  - Add `apps/mobile` (Expo) when a real MVP demands it
  - Add `apps/admin` (separate Next.js dashboard) when a real MVP demands it
