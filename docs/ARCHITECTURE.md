# Architecture

This document describes the topology of the void-starter monorepo: what each package owns, how they depend on each other, where the runtime boundaries are, and how opt-in modules activate. Patterns that govern day-to-day code (file naming, service layout, code style) live in `docs/PATTERNS.md`. The reasoning behind each architectural choice lives in `docs/DECISIONS.md`.

---

## 1. Topology overview

```
void-starter/
|-- apps/
|   `-- web/                       # Next.js 16 App Router (Cache Components, RSC)
|
|-- packages/                      # Tier 1: always-on workspace packages
|   |-- core/                      # @void/core   -- logger, env, errors, server-action, ...
|   |-- auth/                      # @void/auth   -- Better-Auth wrapper, RBAC, action factories
|   |-- db/                        # @void/db     -- Drizzle schema + getDb()
|   |-- ui/                        # @void/ui     -- Radix-backed primitives, ThemeProvider
|   `-- config/                    # @void/config -- shared tsconfig, biome, vitest base
|
|-- _modules/                      # Tier 2: opt-in, build-time activation via env vars
|   |-- observability-sentry/      # @void/sentry        -- ready, wired into apps/web
|   |-- analytics-posthog/         # @void/posthog       -- ready, wired into apps/web
|   |-- auth-clerk/                # @void/auth-clerk    -- alternative repository (not env-driven)
|   |-- payment-stripe/            # placeholder (README only)
|   |-- email-resend/              # placeholder
|   |-- cms-payload/               # placeholder
|   |-- audit-log/                 # placeholder
|   |-- cookie-consent/            # placeholder
|   |-- rate-limit-upstash/        # placeholder
|   |-- i18n-next-intl/            # placeholder
|   `-- db-self-hosted-postgres/   # placeholder (Docker templates only)
|
|-- docs/                          # ADRs + this doc set
`-- tooling/                       # Currently sparse; reserved for repo-wide scripts
```

Workspaces are declared in the root `package.json` as `apps/*`, `packages/*`, `_modules/*`. Bun handles workspace linking; Turborepo orchestrates the per-package `lint` / `type-check` / `test` / `build` tasks.

The split between `packages/` and `_modules/` is the load-bearing boundary:

- **`packages/`** are tier 1 -- always installed, always built, always tested. Apps depend on them unconditionally. Removing one is a refactor, not a config change.
- **`_modules/`** are tier 2 -- opt-in. They activate at build time via env var presence (see section 6). An MVP that does not need Sentry simply does not set `SENTRY_DSN`, and the entire Sentry SDK gets dead-code-eliminated from the bundle.

---

## 2. Package boundary table

| Package | Tier | Always-on | Opt-in trigger | Public surface |
|---|---|---|---|---|
| `@void/core` | 1 | yes | n/a | `logger`, `createAppEnv`, error classes (`AppError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`), `defineAction`, `defineFormAction`, `ActionState`, `initialActionState`, `defaultSecurityHeaders`, `createMemoryRateLimit`, `maskEmail`, `truncate` |
| `@void/auth` | 1 | yes | n/a | `authClient` (browser-safe via `/client` subpath), `getCurrentUser`, `requireAuth`, `requireRole`, `signOut`, auth-aware `defineAction` and `defineFormAction`, `EmailAlreadyTakenError`, `InvalidCredentialsError`, `MagicLinkExpiredError`, `computeInitials`, `displayName`, `canAccessAdminPanel`, `SessionUser`, `Role`, `AuthSession` |
| `@void/db` | 1 | yes | n/a | `getDb()`, `Database`, `DbClient`, schema re-exports (users + Better-Auth tables) |
| `@void/ui` | 1 | yes | n/a | `Button`, `Input`, `Label`, `Avatar`, `Card` (+ subparts), `Form` (+ slots), `Skeleton`, `Spinner`, `ThemeProvider`, `Toaster`, `toast` (re-exported from `sonner`), `cn` |
| `@void/config` | 1 | yes (devDep only) | n/a | `tsconfig.base.json`, `tsconfig.lib.json`, `tsconfig.next.json`, `biome.base.json`, `vitest.base` |
| `@void/sentry` | 2 | no | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | `registerServer`, `registerEdge`, `initSentryClient`, `onRequestError` (subpath imports only: `/server`, `/edge`, `/client`) |
| `@void/posthog` | 2 | no | `NEXT_PUBLIC_POSTHOG_KEY` | `AnalyticsProvider` (via `/client` subpath) |
| `@void/auth-clerk` | 2 | no | n/a (alternative repository, not env-driven) | Replaces `auth.repository.ts` when adopted; consumed by editing the auth wiring, not by setting an env var |

Placeholder modules (Stripe, Resend, Payload CMS, audit-log, cookie-consent, Upstash rate-limit, next-intl, self-hosted Postgres) ship with a README describing the activation contract but no source yet. They are filled in on demand per MVP.

`@void/auth-clerk` is the only tier-2 module that is NOT env-driven. It is an alternative repository: an MVP that wants Clerk swaps the auth wiring at adoption time and never goes back. See `docs/DECISIONS.md` entry 02 for why Better-Auth is the default and Clerk is opt-in.

---

## 3. Layering rules

Every request flows through the same layered shape:

```
component (Server or Client)
  -> action (Server Action, defineAction / defineFormAction)
    -> service (domain logic, optionally policy)
      -> repository (the only layer that touches the DB or external HTTP)
        -> getDb() OR external SDK
```

Imports flow component -> action -> service -> repository -> I/O. No backward arrows.

### Per-layer rules

- **Component layer.** Server Components and Client Components in `apps/<app>/src/`. They render markup, optionally read auth via `getCurrentUser()` (Server Component only), and dispatch to actions. Components NEVER call repositories or `getDb()` directly. Components NEVER call services directly -- they go through actions even for read paths, so the action becomes the single typed RPC entry point.

- **Action layer (apps only).** `apps/<app>/src/actions/<name>.actions.ts` or colocated `<Component>.actions.ts`. Always built with `defineAction` (typed RPC) or `defineFormAction` (FormData + `useActionState`). The action does Zod parsing, auth resolution, error mapping, and structured logging -- all via the wrapper. The action then delegates to a service. Lives in `apps/`, NEVER in `packages/`. See `docs/DECISIONS.md` entry 03.

- **Service layer (packages).** `packages/<domain>/src/<name>.service.ts`. Pure domain logic over typed inputs. Reads via `<name>.repository.ts`. Writes via `<name>.repository.ts`. May call `<name>.policy.ts` for authorization. Carries `import 'server-only'` so a stray client import fails loud at build time. Services NEVER import from apps -- the dependency is one-way.

- **Repository layer (packages).** `packages/<domain>/src/<name>.repository.ts`. The only layer allowed to call `getDb()` from `@void/db` or to make external HTTP requests. Carries `import 'server-only'`. Returns plain TS objects (mapped via `<name>.mapper.ts` if DB shape differs from domain shape).

- **Helper layer.** `<name>.helper.ts`. Pure functions, no side effects, no I/O. Importable from anywhere, including Client Components.

- **Policy layer.** `<name>.policy.ts`. Authorization checks. Called by the service before write paths. May be called by the action layer too, for early redirect-on-forbidden flows.

A one-line summary fits on a sticky note: **imports flow component -> action -> service -> repository -> I/O. No backward arrows.**

---

## 4. Cross-package import rules (no circular deps)

The dependency graph is intentionally a DAG:

- **`@void/core`** has no `@void/*` dependencies. It is the base of the graph. It depends on `pino`, `zod`, `@t3-oss/env-nextjs` -- all pure libs.

- **`@void/db`** depends on `@void/core` only (for `required()` and `logger`). It additionally depends on `drizzle-orm`, `postgres`, and `server-only`.

- **`@void/auth`** depends on `@void/core` and `@void/db`. It pulls in `better-auth`, `@better-auth/drizzle-adapter`, `server-only`, and `zod`.

- **`@void/ui`** depends on no `@void/*` package. It is React-side and self-contained: `clsx`, `tailwind-merge`, `class-variance-authority`, `next-themes`, `react-hook-form`, `@hookform/resolvers`, `sonner`, `lucide-react`, the matching `@radix-ui/react-*` packages, and React itself.

- **`@void/config`** has no runtime dependencies. It is a devDep only, providing shared `tsconfig.lib.json`, `biome.base.json`, and `vitest.base.ts`.

- **Apps** depend on any tier-1 package and on tier-2 packages they actively consume (e.g., `apps/web` depends on `@void/sentry`, `@void/posthog`).

- **Tier-2 packages** depend on `@void/core` at most. They do NOT depend on `@void/auth`, `@void/db`, or `@void/ui` -- those couplings would force every tier-2 module to track auth or schema upgrades. Cross-tier-2 imports are forbidden too: a Sentry module that depends on a PostHog module is a sign the abstraction is wrong.

The result: no circular dependencies, predictable build order (Turborepo derives it from the graph), and every package is replaceable in isolation.

---

## 5. Why `actions.ts` lives in apps, not packages

Server Actions carry Next.js-specific semantics: the `'use server'` directive, `revalidatePath`, `redirect`, FormData handling, route invalidation. Putting actions inside a shared package would couple that package to Next.js, breaking reusability for future targets like Expo, Tauri, or Astro. Actions therefore live in `apps/<app>/src/actions/` (or colocated with their component) and consume services from packages. The package exports the domain primitives; the app composes them into a Next.js-shaped RPC entry. See `docs/DECISIONS.md` entry 03.

---

## 6. Build-time module activation

Tier-2 modules activate at build time via env var presence. There is no runtime feature flag service, no plugin loader, no DI container. The Next.js native pattern (`instrumentation.ts` + conditional dynamic imports + `NEXT_PUBLIC_*` build-time inlining) does the job in ~20 lines and produces a smaller bundle than any flag service would.

The canonical example is `apps/web/src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env['SENTRY_DSN']) {
    if (process.env['NEXT_RUNTIME'] === 'nodejs') {
      const { registerServer } = await import('@void/sentry/server');
      registerServer();
    }

    if (process.env['NEXT_RUNTIME'] === 'edge') {
      const { registerEdge } = await import('@void/sentry/edge');
      registerEdge();
    }
  }
}

export { onRequestError } from '@void/sentry/server';
```

When `SENTRY_DSN` is unset, the dynamic import branch never executes and the Sentry SDK never enters the server bundle. When it is set, the matching runtime entry initializes Sentry on cold start.

Client-side activation uses `NEXT_PUBLIC_*` vars so Turbopack can inline the value at build time and dead-code-eliminate the disabled branch. The `_modules/observability-sentry/README.md` shows the full client-side activation pattern (instrumentation-client + global-error). The `_modules/analytics-posthog/README.md` shows the equivalent for PostHog (`NEXT_PUBLIC_POSTHOG_KEY` -> `AnalyticsProvider` mounted in the root layout).

See `docs/DECISIONS.md` entry 04 for why this beats LaunchDarkly, GrowthBook, conditional install, and always-on imports with empty implementations.

---

## 7. Cache strategy summary

Reads are cached at the service layer via Cache Components (`'use cache'`), tagged so writes can invalidate via `updateTag()`. Server Actions on the write path call `updateTag(...)` after persisting. See `docs/CACHING.md` for the full convention, tag taxonomy, and migration notes from `unstable_cache`.

---

## 8. Testing topology

Four test tiers, each with a clear scope and runtime cost.

### Unit tests

- **Location:** colocated `<name>.test.ts` next to source.
- **Runner:** Vitest with default node env.
- **Scope:** pure functions, services with mocked repositories, helpers, error classes.
- **Speed target:** entire package suite under 5 seconds.
- **Convention:** never mock the DB at the service level. Mock the repository instead.

### Component tests

- **Location:** colocated `<Component>.test.tsx` next to the component file.
- **Runner:** Vitest with `jsdom` env, `@testing-library/react`, `@testing-library/user-event`.
- **Scope:** rendered tree assertions, user interaction flows, accessibility checks (via `axe` or `@testing-library/jest-dom`).
- **Note:** prefer testing helpers (`<Component>.helper.test.ts`) over rendered trees when possible -- helper tests are faster, more stable, and survive markup refactors.

### Integration tests

- **Location:** colocated `<name>.integration.test.ts`.
- **Runner:** Vitest, real DB connection.
- **Scope:** services that touch multiple tables, transactions, cascade deletes, foreign-key constraints.
- **Skip behavior:** integration tests skip gracefully when `DATABASE_URL` is unset (so a fresh clone runs `bun run test` without a database). The CI pipeline sets `DATABASE_URL` against a Neon test branch.

### End-to-end tests

- **Location:** `apps/web/tests/e2e/*.spec.ts`.
- **Runner:** Playwright against a real dev server with a real database.
- **Scope:** full user flows -- sign-up, sign-in, magic-link, sign-out, role-gated pages.
- **Skip behavior:** the auth-related e2e tests skip gracefully when `DATABASE_URL` is unset (see ADR 11 and the e2e skip guard). CI runs them against the same Neon test branch.

The four-tier split keeps each test fast in isolation: a contributor running `bun run test` on a fresh clone exercises only the unit and component layers; CI exercises the full pipeline including integration and e2e.

---

## 9. Build and CI

### Local

- `bun install` -- workspace-aware, hoists shared deps, links workspace packages.
- `bun run lint` -- Biome across the whole repo (root config delegates per-package).
- `bun run type-check` -- Turborepo runs `tsc --noEmit` per package, in dependency order.
- `bun run test` -- Turborepo runs `vitest run` per package; the `passWithNoTests` flag (centralized in `@void/config/vitest.base.ts`, see ADR 14) means skeleton packages without tests yet do not fail the pipeline.
- `bun run build` -- Turborepo runs the per-package `build` task. For most packages this is a no-op (we publish source via `package.json#exports` to `./src/*.ts` -- see ADR 15). For `apps/web`, it is `next build`.

### CI

The full pipeline lives in `.github/workflows/ci.yml` (lands in Phase D Task D26). Today the local pipeline is the de-facto contract.

The full CI pipeline runs:

- The local pipeline (lint + type-check + test + build).
- `knip` -- dead-code and unused-export detection across the workspace.
- `gitleaks` -- secret scanning across the diff.
- Playwright e2e tests against a Neon-backed test branch.

### Release

A future release flow ships under `tooling/release/` and uses Changesets. Today the repo is at `0.1.0` and pre-release; versioning is manual and tracked in `docs/DECISIONS.md` only when a non-obvious choice is made.

---

## Cross-references

- `docs/DECISIONS.md` -- the why behind every architectural choice. Read before challenging.
- `docs/PATTERNS.md` -- file naming, service layout, code style.
- `docs/CACHING.md` -- cache read / write strategy.
- `docs/SECURITY.md` -- security boundary mappings.
- `docs/AUTH.md` -- auth-specific patterns and Better-Auth integration.
- `docs/MODULES.md` -- catalogue of opt-in `_modules/*` and their activation rules.
