# Void Factory Starter - Build Plan

This document is the execution plan for building the Void Factory Next.js 16 monorepo starter. Read `context.md` first before starting any step.

## Working method

- Each step ends with a commit (conventional commits format)
- After each step, summarize what was done and ask for validation before moving on
- If a step reveals a design question not covered in `context.md`, STOP and ask
- Use `bun` for all package operations, never `npm` or `pnpm`
- Match the layering pattern from `context.md` exactly when generating examples
- Any new convention introduced in a step must be added to the relevant `docs/*.md` in the same step
- Read the official documentation of any third-party integration before implementing it

## Step 0: Monorepo bootstrap

- Create root `package.json` with `"workspaces": ["apps/*", "packages/*", "_modules/*"]` and `"packageManager": "bun@1.x"`
- Init `bunfig.toml`
- Install Turborepo: `bun add -D turbo`
- Create `turbo.json` with pipeline tasks: `build`, `dev`, `lint`, `test`, `type-check`
- Create directories: `apps/`, `packages/`, `_modules/`, `docs/`, `tooling/`
- Add root `.gitignore` (Turbo cache, node_modules, .env*.local, .next, dist, coverage)
- Init git
- Commit: `chore: bootstrap monorepo with Turborepo and Bun workspaces`

## Step 1: Shared config package

- Create `packages/config/`:
  - `package.json` (`@void/config`, exposes JSON files only)
  - `tsconfig.base.json` - strict TS, ESNext, paths alias support
  - `tsconfig.next.json` - extends base for Next.js apps
  - `tsconfig.lib.json` - extends base for library packages (declaration: true)
  - `biome.base.json` - shared rules
  - `vitest.base.ts` - shared test setup
- Commit: `chore(config): add shared config package`

## Step 2: Tooling layer

### 2.1 Biome
- Install at root: `bun add -D @biomejs/biome`
- Create root `biome.json` extending `@void/config/biome.base.json`
- Configure: 2 spaces, single quotes, trailing comma, semicolons, organize imports, VCS git ignore enabled
- Add scripts: `lint`, `lint:fix`, `format`
- Commit: `chore: configure Biome linting and formatting`

### 2.2 Lefthook
- Install: `bun add -D lefthook`
- Create `lefthook.yml`:
  - `pre-commit`: biome check (staged) + tsc --noEmit (parallel) + gitleaks
  - `pre-push`: knip
  - `commit-msg`: commitlint
- Run `bunx lefthook install`
- Commit: `chore: configure Lefthook git hooks`

### 2.3 Commitlint
- Install: `bun add -D @commitlint/cli @commitlint/config-conventional`
- Create `commitlint.config.cjs`
- Commit: `chore: configure commitlint`

### 2.4 knip
- Install: `bun add -D knip`
- Create `knip.json` with workspace-aware config
- Add script `knip` and CI integration
- Commit: `chore: add knip dead-code detection`

### 2.5 gitleaks
- Install gitleaks binary or use bun-runnable wrapper
- Configure in `.gitleaks.toml` with default rules + custom allowlist if needed
- Wire into Lefthook pre-commit
- Commit: `chore: add gitleaks secret scanning`

### 2.6 Renovate
- Create `renovate.json`:
  - extends: `config:recommended`
  - automerge patches
  - schedule weekly for minor/major
  - workspace-aware grouping (Next/React group, Tailwind group, dev deps group)
- Commit: `chore: configure Renovate for monorepo`

## Step 3: @void/core package

Path: `packages/core/`

### 3.1 Logger
- Install: `bun add pino pino-pretty`
- Create `src/logger.ts` with Pino instance (pretty in dev, JSON in prod, `LOG_LEVEL` from env)

### 3.2 Env validation
- Install: `bun add @t3-oss/env-nextjs zod`
- Create `src/env.ts` with `createEnv` schema (server / client / runtimeEnv split)
- Minimal vars at J0: `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (server) / `NEXT_PUBLIC_APP_URL` (client)

### 3.3 Errors
- Create `src/errors.ts`: `AppError` base + `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError` + `isAppError` guard

### 3.4 Server Action wrapper
- Create `src/server-action.ts` with `defineAction({ schema, auth, handler })` per `context.md`
- Includes Zod parse, auth check, error normalization, structured logging

### 3.5 Security primitives
- Create `src/security-headers.ts` with CSP, HSTS, X-Frame-Options, Permissions-Policy defaults
- Create `src/rate-limit.ts` with in-memory adapter (interface for Upstash via module)
- Create `src/sanitize.ts` with PII helpers (`maskEmail`, `truncate`)

### 3.6 Tests
- Per-file `.test.ts` for helpers and wrapper

Commit: `feat(core): add logger, env, errors, security primitives, server-action wrapper`

## Step 4: @void/db package

Path: `packages/db/`

- Install: `bun add drizzle-orm postgres && bun add -D drizzle-kit`
- Create `src/schema/users.ts`, `sessions.ts`, `accounts.ts`, `verifications.ts` per `context.md`
- Create `src/client.ts` with Drizzle client init from `@void/core/env`
- Create `drizzle.config.ts` for migrations
- Add scripts: `db:generate`, `db:migrate`, `db:studio`
- Generate initial migration
- Commit: `feat(db): add Drizzle schema with users, sessions, accounts, verifications`

## Step 5: @void/auth package

Path: `packages/auth/`

- Install: `bun add better-auth`
- Read Better-Auth official docs for current API and Drizzle adapter setup
- Create `src/auth.repository.ts` wrapping Better-Auth init with the Drizzle adapter from `@void/db`
- Configure providers: email/password + Google OAuth + magic link
- Configure plugins: admin (for `user` / `admin` roles), 2FA (scaffolded, opt-in)
- Create `src/auth.service.ts` with public API: `getCurrentUser`, `requireAuth`, `requireRole`, `signIn.email`, `signIn.google`, `signIn.magicLink`, `signOut`
- Create `src/auth.policy.ts` with example: `canAccessAdminPanel`
- Create `src/auth.types.ts` with `User`, `Role`, `Session` types
- Create `src/auth.errors.ts` with auth-specific typed errors
- Tests: `auth.service.test.ts` with mocked repository, `auth.policy.test.ts` pure
- Commit: `feat(auth): wire Better-Auth with email/password, Google OAuth, magic link, roles`

## Step 6: @void/ui package

Path: `packages/ui/`

- Install Tailwind v4 + base setup
- Create `src/styles/globals.css` with `@theme` block defining design tokens (colors, spacing, fonts, radii)
- Create base components in canonical layout (helper, types, test, index):
  - `Button/`
  - `Input/`
  - `Card/`
  - `Label/`
- Export tokens via `src/tokens.ts` for programmatic access
- Commit: `feat(ui): add design tokens and base components`

## Step 7: apps/web

### 7.1 Next.js bootstrap
- Manually scaffold Next.js 16 in `apps/web/` (avoid create-next-app, which does not understand the workspace layout)
- `package.json` with `"next": "^16.2.x"`, `"react": "^19.2.x"`, deps on `@void/core`, `@void/auth`, `@void/db`, `@void/ui`
- `next.config.ts`: import security headers from `@void/core/security-headers`, set `experimental.cacheComponents: true`
- `tsconfig.json` extending `@void/config/tsconfig.next.json`
- Wire `app/layout.tsx`, `app/globals.css` (importing `@void/ui` styles)
- Commit: `feat(web): bootstrap Next.js 16 app with security headers`

### 7.2 instrumentation.ts
- Create `src/instrumentation.ts` with conditional dynamic imports
- Wire stubs (commented) for Sentry and PostHog server-side init
- Commit: `feat(web): add instrumentation entry for opt-in modules`

### 7.3 Middleware
- Create `src/middleware.ts` for session refresh, locale detection placeholder, and rate-limit hooks
- Commit: `feat(web): add middleware for session refresh and rate-limit`

### 7.4 Auth pages
- Read Better-Auth Next.js integration docs
- Create `src/app/(auth)/sign-in/page.tsx` with email/password form + Google button
- Create `src/app/(auth)/sign-up/page.tsx`
- Create `src/app/(auth)/reset-password/page.tsx`
- Create `src/app/(auth)/verify-email/page.tsx`
- Create `src/actions/auth.actions.ts` using `defineAction` wrappers
- Create `src/app/api/auth/[...all]/route.ts` for Better-Auth handlers
- Use `useActionState` and `useOptimistic` where applicable in forms
- Commit: `feat(web): add sign-in, sign-up, password reset, email verify pages`

### 7.5 Protected pages
- Create `src/app/dashboard/page.tsx` with `requireAuth()` guard, displays current user
- Create `src/app/admin/page.tsx` with `requireRole('admin')` guard, lists users
- Commit: `feat(web): add protected dashboard and admin pages`

### 7.6 Home page
- Create `src/app/page.tsx` with hero + CTA + feature highlights
- Showcase design tokens from `@void/ui`
- Commit: `feat(web): add home page`

## Step 8: Test setup

### 8.1 Vitest
- Install at packages level: `bun add -D vitest @vitest/ui @testing-library/react @testing-library/dom jsdom`
- Each package has a `vitest.config.ts` extending `@void/config/vitest.base.ts`
- Add scripts via Turborepo: `test`, `test:ui`, `test:watch`, `test:coverage`
- Commit: `chore: configure Vitest across workspaces`

### 8.2 Playwright
- Install in `apps/web`: `bun add -D @playwright/test`
- Run `bunx playwright install`
- Create `playwright.config.ts`
- Create `tests/e2e/auth.spec.ts` covering: sign up, email verify (dev console), sign in, sign out, role guard (404 vs 200)
- Create `tests/e2e/smoke.spec.ts` (homepage loads, dashboard redirects when logged out)
- Commit: `chore: configure Playwright with auth E2E tests`

## Step 9: Canonical examples

### 9.1 Simple component
Path: `apps/web/src/components/_examples/SimpleButton/`

```
SimpleButton.tsx
SimpleButton.helper.ts
SimpleButton.helper.test.ts
SimpleButton.types.ts
index.ts
```

Demonstrates: pure helper extracted from JSX, helper tested without rendering, types isolated, barrel export only exposes public API.

### 9.2 Complex component (consumes a service)
Path: `apps/web/src/components/_examples/UserProfileCard/`

```
UserProfileCard.tsx           # consumes @void/auth getCurrentUser, includes inline edit form
UserProfileCard.helper.ts     # formatJoinDate, computeStatus
UserProfileCard.helper.test.ts
UserProfileCard.types.ts      # Zod schema for received data
index.ts
```

Demonstrates: `useActionState` + `useOptimistic`, Zod validation of server data, helpers extracted and tested, loading and error states.

### 9.3 Full service example

`@void/auth` itself serves as the canonical service. Document the rationale and reading order in `docs/PATTERNS.md`.

Commit: `feat(examples): add canonical component examples`

## Step 10: Optional modules

### 10.1 _modules/observability-sentry
- Workspace package `@void/sentry`
- Read Sentry official docs for Next.js 16 integration
- Implement: server init via `instrumentation.ts` register, client SDK init via lazy provider
- Tunnel proxy: route handler `apps/web/src/app/monitoring/route.ts` documented in module README
- Source maps upload via Sentry CLI in CI step (documented)
- README documents env vars: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- Commit: `feat(modules): add observability-sentry module`

### 10.2 _modules/analytics-posthog
- Workspace package `@void/posthog`
- Read PostHog official docs for Next.js + reverse proxy patterns
- Implement: client SDK with `api_host: '/ingest'`, AnalyticsProvider with build-time DCE on `NEXT_PUBLIC_POSTHOG_KEY`
- Rewrites proxy in `next.config.ts`: `/ingest/:path*` to `https://eu.i.posthog.com/:path*`
- README documents env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Commit: `feat(modules): add analytics-posthog module with proxy`

### 10.3 _modules/auth-clerk
- Workspace package providing alternative `auth.repository.ts` for Clerk
- README documents the swap procedure and required env vars
- Commit: `feat(modules): add auth-clerk alternative`

### 10.4 Stub remaining modules
- `_modules/payment-stripe/README.md`
- `_modules/email-resend/README.md`
- `_modules/cms-payload/README.md`
- `_modules/audit-log/README.md`
- `_modules/cookie-consent/README.md`
- Each README placeholder with: scope, env vars, install steps, integration points
- Commit: `feat(modules): scaffold remaining modules`

## Step 11: Documentation

Write per the meta-rule: every convention or primitive introduced in earlier steps must be reflected here. Each doc opens with intent + rules + examples. Under 600 lines.

- `docs/PATTERNS.md` - KISS / DRY / SoC + naming + service file layout + when to split a package
- `docs/ARCHITECTURE.md` - package boundaries + dependency direction + service vs action vs repository placement + tier 1 (always-on) vs tier 2 (opt-in)
- `docs/SECURITY.md` - OWASP Top 10 mapping + RGPD checklist + primitive references with code pointers
- `docs/AUTH.md` - public API of `@void/auth` + sign-in flow diagram + switching to `_modules/auth-clerk`
- `docs/CACHING.md` - `"use cache"` placement + `cacheTag` conventions + `updateTag` in actions
- `docs/MODULES.md` - catalogue + activation patterns (real package vs copy-paste) + how to write a new module

Update root `CLAUDE.md` with pointers to all docs and the meta-rules.

Commit: `docs: write architecture, patterns, security, auth, caching, modules documentation`

## Step 12: CI

Create `.github/workflows/ci.yml`:

- Triggers: push, pull_request
- `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`
- Jobs:
  - setup-bun (`oven-sh/setup-bun@v1`)
  - cache `node_modules` and `.turbo` via `actions/cache`
  - `bun install --frozen-lockfile`
  - `bunx turbo run lint`
  - `bunx turbo run type-check`
  - `bunx turbo run test`
  - `bunx turbo run build`
  - `bunx knip --no-progress`
  - gitleaks scan via `gitleaks/gitleaks-action`

Commit: `chore: add GitHub Actions CI with concurrency, caching, and quality gates`

## Step 13: Repo polish

- `.vscode/settings.json` - Biome as default formatter, disable ESLint/Prettier extensions, format on save
- `.vscode/extensions.json` - recommend Biome, Tailwind CSS IntelliSense, Drizzle, Error Lens
- `.editorconfig`
- Root `README.md` covering: what this starter is, how to instantiate (`gh repo create --template`), stack overview, quick start commands, links to all `docs/*.md`
- `LICENSE` (MIT)
- Commit: `chore: add VSCode workspace settings, editorconfig, README`

## Step 14: Final validation

Run from repo root unless noted:

- `bun run lint` - must pass
- `bun run type-check` - must pass
- `bun run test` - must pass
- `bun run build` - must pass
- In `apps/web`: `bun run test:e2e` - must pass
- `bun run knip` - must pass with zero issues
- gitleaks scan - clean
- Verify all canonical examples render in dev (`bun run dev`)
- Verify CLAUDE.md correctly references all `docs/*.md` paths
- Verify `apps/web` end-to-end: home > sign-up > email verify (dev console) > sign-in > dashboard > admin (with role flip in DB studio)
- Verify a sample MVP can install Sentry: add `@void/sentry` to `apps/web/package.json`, set `SENTRY_DSN`, rebuild, trigger error, verify report
- Verify a sample MVP can install PostHog: add `@void/posthog`, set `NEXT_PUBLIC_POSTHOG_KEY`, rebuild, navigate, verify event captured via proxy

Commit: `chore: final starter validation`

## After completion

The starter is ready to be:
1. Pushed to GitHub as a template repo
2. Used to instantiate new Void Factory MVPs via `gh repo create --template`

Future work (not part of this session):
- Populate placeholder modules (`_modules/payment-stripe`, `email-resend`, `cms-payload`, `audit-log`, `cookie-consent`)
- Build a CLI (`create-void-app`) on top of the template that prompts for module selection and writes the starter
- Add `apps/mobile/` (Expo) once a real MVP needs it
- Add `apps/marketing/` (Astro) once a real MVP needs a separate marketing site
