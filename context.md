# Void Factory Starter - Context

## Owner

Folpe (Florent Pellegrin) - Senior React/Node.js dev, founder of VoidCorp / Void Factory.
Venture builder model: 2 MVPs/month, 4-week kill criteria.
Wing Chun philosophy: maximum efficiency, economy of means, go straight to essential.

## Mission

Build a production-grade Next.js 16 monorepo starter that serves as the foundation for every Void Factory MVP. Goal: zero setup friction, maximum code quality from day one, AI-assistant-friendly conventions, and ready for multi-target growth (web by default, mobile/admin/marketing as opt-in apps).

## Non-negotiables

- **Quality over features**: this starter is a foundation, not a kitchen sink
- **Self-documenting through examples**: canonical patterns live in the repo as code, not docs
- **Auto-updating**: dependencies update via Renovate, with auto-merge on patches
- **AI-friendly**: `CLAUDE.md` instructs AI to read examples before writing code
- **Modular by env**: optional features (analytics, error tracking) are real workspace packages activated via env vars at build time, not runtime
- **Sovereignty**: auth and user data stay on the user's infrastructure by default
- **Security and RGPD by default**: OWASP and RGPD primitives shipped, not bolted on later
- **No bloat**: project-specific concerns go in `_modules/` (opt-in packages or copy-paste), never in the core
- **Docs are source of truth**: every convention, primitive, or decision lives in a `docs/*.md` and is updated whenever the code changes

## Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Topology | Turborepo 2.x + Bun workspaces | Multi-target ready, build cache, mature |
| Framework | Next.js 16.2 (App Router) | Latest stable, Turbopack default, React Compiler, Cache Components |
| React | 19.2 | Comes with Next 16 |
| Language | TypeScript 5.x strict | Non-negotiable |
| Styling | Tailwind CSS v4 | Latest, design tokens via `@theme` |
| Linting + Formatting | Biome | Single tool, no ESLint/Prettier conflicts |
| Git hooks | Lefthook | Replaces Husky, faster, parallel |
| Commit lint | commitlint + conventional commits | Standard |
| Logger | Pino | Structured logs, pretty in dev |
| Validation | Zod | Runtime + types |
| Env validation | `@t3-oss/env-nextjs` | Server/client split, build-time safety |
| Auth | Better-Auth | Open source, TS-first, multi-provider, data sovereignty, brand integrity |
| ORM | Drizzle | Type-safe, Edge-compatible, aligned with other Void projects |
| Tests unit | Vitest | Fast, native ESM |
| Tests E2E | Playwright | Standard |
| Dead code detection | knip | CI gate, prevents drift |
| Secret scanning | gitleaks | Pre-commit hook |
| Package manager | Bun | 10-25x faster installs, native workspaces |
| Runtime (app) | Node.js | Next.js stability |
| Runtime (scripts/workers) | Bun | Speed when standalone |
| Updates | Renovate | Auto-merge patches, manual minor/major |
| Deploy | Vercel (default) | Standard for Next.js, monorepo-aware |

## Topology

```
void-starter/
├── apps/
│   └── web/                          # Next.js 16 app (only app at J0)
│       ├── src/app/                  # routes, layouts, pages
│       ├── src/components/           # web-specific components
│       ├── src/actions/              # Server Actions ("use server")
│       ├── src/instrumentation.ts    # opt-in modules registration
│       └── ...
├── packages/
│   ├── core/                         # logger, env, errors, security primitives, server-action wrapper
│   ├── auth/                         # auth service + Better-Auth implementation + policies
│   ├── db/                           # Drizzle schemas, migrations, repository helpers
│   ├── ui/                           # design tokens + reusable components
│   └── config/                       # shared tsconfig, biome, vitest configs
├── _modules/                         # opt-in workspace packages and copy-paste modules
│   ├── auth-clerk/
│   ├── observability-sentry/
│   ├── analytics-posthog/
│   ├── payment-stripe/
│   ├── email-resend/
│   ├── audit-log/
│   ├── cookie-consent/
│   └── cms-payload/
├── docs/
│   ├── DECISIONS.md                  # ADR-lite: non-obvious choices + rejected alternatives
│   ├── PATTERNS.md                   # KISS, DRY, SoC + code conventions
│   ├── ARCHITECTURE.md               # layers, package boundaries, dependency rules
│   ├── SECURITY.md                   # OWASP Top 10 + RGPD checklist
│   ├── AUTH.md                       # auth model, switching providers
│   ├── CACHING.md                    # Cache Components conventions
│   └── MODULES.md                    # modules catalogue
├── tooling/                          # internal scripts
├── turbo.json
├── package.json                      # root, workspaces declared
├── bunfig.toml
├── biome.json                        # extends from packages/config
├── lefthook.yml
├── renovate.json
├── CLAUDE.md
└── README.md
```

Future targets without breaking changes: `apps/mobile/` (Expo), `apps/admin/` (Next.js dashboard), `apps/marketing/` (Astro landing).

## Architecture principles

### Package boundaries

| Tier | Packages | Activation |
|---|---|---|
| Always-on (core) | `core`, `auth`, `db`, `ui`, `config` | Imported directly, no toggle |
| Opt-in (modules) | `sentry`, `posthog`, `stripe`, `email-resend`, `auth-clerk`, etc. | Build-time via env var presence |

A workspace package exists if and only if (a) it has a clear domain scope, OR (b) it will be consumed by 2+ apps. Resist sub-packages like `@void/utils`, `@void/constants`, `@void/hooks`. Three similar lines is better than a premature abstraction.

### Layering rules

Inside any package or app:

- **Component** never calls a DB or external API directly, always through a service from a package
- **Service** orchestrates business logic, never queries DB directly, calls repository
- **Repository** is the only layer that touches DB or external API
- **Helper** = pure functions, no I/O, no side effects
- **Policy** (optional) = authorization rules, called by service
- **Types** = source of truth for shapes, derived from Zod schemas when validation is needed
- **Actions** (Next.js Server Actions) live in `apps/web/src/actions/`, NEVER inside packages, because `"use server"` carries Next-specific semantics that must not pollute platform-agnostic packages

### Service file layout

For business services inside a package or app:

```
serviceName/
├── serviceName.service.ts          # public façade, orchestration, "use cache" for reads
├── serviceName.repository.ts       # data access (DB or external API)
├── serviceName.helper.ts           # pure functions
├── serviceName.mapper.ts           # OPTIONAL - DB row <-> domain transformation (when shapes differ)
├── serviceName.types.ts            # types + Zod schemas (merged by default)
├── serviceName.events.ts           # OPTIONAL - event names + payload Zod schemas, emitted by service
├── serviceName.policy.ts           # OPTIONAL - authorization rules
├── serviceName.errors.ts           # OPTIONAL - domain-specific typed errors
├── serviceName.service.test.ts     # unit, repository mocked
├── serviceName.helper.test.ts      # unit, pure
├── serviceName.integration.test.ts # OPTIONAL but recommended for I/O services - real DB/API
└── index.ts                        # exports service + public types only
```

**Layer responsibilities:**

- **Service** owns transactions and cache strategy, never touches I/O directly
- **Repository** is the only layer that touches DB or external API; accepts optional `tx` parameter
- **Helper** is pure (no I/O, no side effects), unit-testable in isolation
- **Mapper** is the only layer that knows both DB row shape AND domain shape; lives between repository (raw) and service (clean)
- **Events** are emitted by the service (e.g., `userEvents.created.emit(payload)`), consumed by other services or async workers in `_modules/events-*`
- **Policy** answers `canActorDoX(actor, target)`; called by service before mutation
- **Types + Schemas** are merged in `types.ts` by default (use `z.infer`). Split into separate `schema.ts` / `types.ts` ONLY when bundle size hurts a heavily client-imported type (Zod is ~50KB and bundlers cannot reliably tree-shake it across `z.infer`)
- **Integration tests** spin up a real Postgres (Docker testcontainers or pglite) and verify cascade rules, transactions, constraint failures; unit tests with mocks cannot catch these
- **`index.ts`** exposes ONLY the service + public types; repository, helper, mapper, events, policy, errors stay internal

Server Actions live separately in the app (never inside packages):

```
apps/web/src/actions/
├── auth.actions.ts               # "use server" wrappers around @void/auth services
├── user.actions.ts
└── ...
```

When an action grows past ~40 lines or orchestrates 3+ services, extract into a use-case:

```
apps/web/src/use-cases/
├── onboardCustomer.ts            # orchestrates userService + emailService + analyticsService
└── ...
```

Use-cases live in `apps/web/src/use-cases/` initially. **Promotion rule:** if a use-case is consumed by 2+ apps (e.g. `apps/web` and `apps/admin`), promote it to a domain package (`packages/onboarding/` or similar) and remove from the app. Do not create `packages/use-cases/` as a generic catch-all (anti-pattern: micro-package with no domain scope).

Multi-source services may split repositories: `checkout.db.repository.ts`, `checkout.stripe.repository.ts`. The service still owns transaction boundaries; repositories accept an optional `tx` parameter.

### Caching strategy (Next 16 Cache Components)

- **Reads**: `"use cache"` directive at the top of the public service function, with `cacheTag` based on entity (e.g. `user:${id}`) and `cacheLife` ('hours' | 'days' | 'minutes')
- **Writes**: `updateTag()` called inside Server Actions immediately after the mutation succeeds
- **Repository**: never caches, never tags. Cache strategy is a business decision, not an I/O detail.

Single source of truth: cache lives in the service layer.

### Optional package activation (build-time only)

Optional packages are toggled by env var presence at build time. There is no runtime feature flag service. Activation requires a redeploy (Vercel rebuilds in ~30s on env change). This is intentional: build-time activation keeps the bundle minimal, the attack surface small, and aligns with the Next.js native pattern.

- **Server-side opt-in**: `apps/web/src/instrumentation.ts` does conditional dynamic imports
  ```ts
  export async function register() {
    if (process.env.SENTRY_DSN) {
      const { register } = await import('@void/sentry/server')
      await register()
    }
  }
  ```
  Result: lazy chunk, never loaded if env var absent.

- **Client-side opt-in**: `NEXT_PUBLIC_*` env vars are inlined at build, enabling DCE
  ```ts
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) { /* ... */ }
  ```
  Result: branch eliminated at build if env var absent.

### Server Action wrapper

`@void/core/server-action` exposes `defineAction()` that standardizes patterns:

```ts
export const updateProfile = defineAction({
  schema: z.object({ name: z.string().min(1) }),
  auth: 'required',                // or 'public', 'role:admin'
  handler: async (input, ctx) => userService.updateProfile(ctx.user.id, input),
})
```

Handles: Zod parsing, auth via `@void/auth`, error normalization, structured logging via `@void/core/logger`. Zero external dependency.

## Auth strategy

`@void/auth` ships Better-Auth as the default implementation, wired at J0:

- Email/password (sign up, sign in, password reset, email verification)
- Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
- Magic link (uses `@void/email` if installed, falls back to console in dev)
- Roles via Better-Auth admin plugin: `user`, `admin`
- Sessions: DB-backed, httpOnly + secure + sameSite=lax cookies, rotation on login
- 2FA / passkey: scaffolded, opt-in per project

**Public API** exposed by `@void/auth`:

- `getCurrentUser()`, `requireAuth()`, `requireRole(role)`
- `signIn.email()`, `signIn.google()`, `signIn.magicLink()`, `signOut()`

Usable in RSC, Server Actions, route handlers, middleware.

**Implementation swap**: `_modules/auth-clerk/` provides an alternative `auth.repository.ts` that wraps Clerk. Switching = replacing one file. The rest of the app code stays intact thanks to the stable public API. Use only when an MVP requires SaaS B2B features (SSO/SCIM/orgs at scale) and the data sovereignty trade-off is accepted.

## DB schema (J0)

Inside `@void/db/src/schema/`:

- `users` (id, email unique, emailVerified, name, image, role default 'user', createdAt, updatedAt, deletedAt)
- `sessions` (id, userId FK cascade, expiresAt, ipAddress, userAgent, createdAt)
- `accounts` (id, userId FK cascade, providerId, accountId, accessToken, refreshToken, idToken, expiresAt)
- `verifications` (id, identifier, value hashed, expiresAt) for magic link / email verify / password reset

**Cascade rules**: sessions, accounts, and verifications are hard-deleted with their user. Soft delete on users (`deletedAt`) is for application logic; auth-related rows are wiped via FK cascade. Audit log via separate module.

## Modules system

Modules live in `_modules/`. Workspaces config includes `_modules/*`, so most modules are real packages. Two patterns:

**Pattern A - Real package** (default): module is a workspace package (`@void/sentry`), versionable, importable. Activated by adding to `apps/web/package.json` deps and setting the relevant env var. Tree-shaken or lazy-loaded otherwise.

**Pattern B - Copy-paste**: when files must live inside the consuming app (e.g. specific page templates). README documents file paths and dependencies to add.

Default modules at J0:
- `_modules/auth-clerk/` - alternative auth backend (real package)
- `_modules/observability-sentry/` - error tracking with tunnel proxy (real package)
- `_modules/analytics-posthog/` - product analytics with rewrites proxy (real package)
- `_modules/payment-stripe/` - placeholder
- `_modules/email-resend/` - placeholder
- `_modules/cms-payload/` - placeholder
- `_modules/audit-log/` - placeholder
- `_modules/cookie-consent/` - placeholder

Each module has a README with: env vars required, install command, integration points, removal procedure.

## Documentation policy

**Meta-rule**: any new convention, primitive, or architecture decision MUST be reflected in the relevant `docs/*.md` at the moment it is introduced. Removed concepts must be removed from the docs at the same time. Non-obvious decisions where alternatives were considered MUST be logged in `docs/DECISIONS.md` with the rejected alternatives. The starter is wrong if its docs disagree with its code.

Files:

- `CLAUDE.md` (repo root) - rules for AI assistants, points to `docs/`
- `README.md` (repo root) - human entry point
- `docs/DECISIONS.md` - ADR-lite: non-obvious architectural choices with rejected alternatives and revisit conditions
- `docs/PATTERNS.md` - KISS, DRY, SoC + code conventions, file naming, exports
- `docs/ARCHITECTURE.md` - package boundaries, layering rules, dependency direction
- `docs/SECURITY.md` - OWASP Top 10 + RGPD checklist with primitive mapping
- `docs/AUTH.md` - auth model, helpers, switching to Clerk module
- `docs/CACHING.md` - Cache Components conventions
- `docs/MODULES.md` - modules catalogue with activation patterns

If a doc grows past 600 lines, split it.

## Code conventions

- **KISS**: prefer the simplest implementation that solves the current need. No speculative generality.
- **DRY**: but only when the duplication is real and stable. Three similar lines is better than a premature abstraction.
- **SoC**: each file has one responsibility; package boundaries enforce domain isolation.
- **Naming**: `camelCase` for files inside services, `PascalCase` for component folders, `kebab-case` for package names.
- **Imports**: workspace deps via `@void/*`; in-app paths via `@/*` alias.
- **Exports**: prefer named exports; default exports only for Next.js pages, layouts, route handlers.
- **Async**: always `async/await`, never raw `.then()` chains in business code.
- **Errors**: typed error classes from `@void/core/errors`, never throw strings.
- **Logger**: import from `@void/core/logger`, never `console.log` in committed code.
- **Env**: validated via `@t3-oss/env-nextjs`, accessed only through the typed `env` object.
- **No em dashes** in any documentation, comments, or generated content (use hyphens or rephrase).
- **No emojis** in code, docs, or commits unless explicitly requested.

## Security and RGPD

Primitives shipped in `@void/core`:
- `security-headers.ts` - CSP, HSTS, X-Frame-Options, Permissions-Policy defaults
- `rate-limit.ts` - in-memory adapter, Upstash adapter via module
- `sanitize.ts` - PII helpers (maskEmail, truncate)

Conventions enforced:
- Drizzle parameterized queries only (no raw SQL)
- `@t3-oss/env-nextjs` validation at startup
- Sessions: httpOnly + secure + sameSite=lax + rotation on login
- Soft delete pattern with `deletedAt`, hard delete via cron in module

OWASP Top 10 mapping (full detail in `docs/SECURITY.md`):
- A01 Broken Access Control - policy layer + `requireRole()`
- A02 Cryptographic Failures - secret env validation + HSTS + secure cookies
- A03 Injection - Drizzle params + Zod input validation
- A04 Insecure Design - layered architecture
- A05 Security Misconfiguration - security headers in `next.config.ts`
- A06 Vulnerable Components - Renovate auto-merge patches
- A07 Auth Failures - Better-Auth + sessions hardened by default
- A08 Software/Data Integrity - CSP strict
- A09 Logging/Monitoring - Pino + `_modules/observability-sentry`
- A10 SSRF - URL validation primitive in `@void/core`

RGPD checklist (full detail in `docs/SECURITY.md`):
- Cookie consent - `_modules/cookie-consent/`
- Data export endpoint - template in canonical examples
- Data deletion (right to erasure) - soft delete + hard delete cron
- PII tagging - convention in Drizzle schemas (JSDoc `@pii`)
- Audit log - `_modules/audit-log/`
- Data residency - default Better-Auth + self-hosted DB = data on user infra

## gstack boundary

[gstack](https://github.com/garrytan/gstack) is user-level meta-tooling installed at `~/.claude/skills/gstack/`. It operates on top of the starter when working in any MVP: design brainstorming, code review, QA, security audit, ship workflows.

The starter MUST NEVER:
- Depend on gstack (must work without it installed)
- Duplicate gstack features (no in-starter design orchestration, no comparison board, no model benchmark)

The starter MAY adopt conventions that happen to be gstack-friendly (`DESIGN.md` at root, standard `bun run dev`, predictable structure) without coupling.

## CLAUDE.md (repo root)

The starter ships with a `CLAUDE.md` at the root that instructs AI assistants:

1. Read `docs/DECISIONS.md` before challenging any architectural choice (Better-Auth vs Clerk, monorepo, build-time activation, etc.). The alternatives were already considered.
2. Before writing any new component, read `apps/web/src/components/_examples/*` first
3. Before writing any new service, read the canonical service in `packages/auth/` first
4. Match the file structure and naming conventions exactly
5. Follow conventions in `docs/PATTERNS.md`
6. Never modify the layering pattern without explicit user approval
7. Any new convention MUST be added to the relevant `docs/*.md` at the time of introduction
8. Any non-obvious decision (where a credible alternative exists) MUST be logged in `docs/DECISIONS.md`
9. Use `defineAction()` from `@void/core/server-action` for all Server Actions
10. Read the official documentation of any third-party integration before implementing it (do not invent the configuration)

## What we DON'T want

- Multitenant logic (project-specific, lives in app)
- Blog system (project-specific or `_modules/cms-payload`)
- Pre-built admin dashboards (project-specific)
- ESLint, Prettier, Husky (replaced by Biome + Lefthook)
- Storybook (canonical examples + tests cover the need)
- tRPC (Server Actions + `defineAction` cover the need)
- In-starter design tooling (gstack handles it externally)
- Runtime feature flag service (build-time activation is the pattern)
- Micro-packages (no `@void/utils`, `@void/constants`, `@void/hooks`)
- DI container (no `tsyringe`, no `awilix`); services export functions, tests inject deps via parameters
- Explicit CQRS pattern; soft CQRS via Cache Components is sufficient (cache reads at service layer, mutate via Server Actions with `updateTag`)
- `packages/use-cases/` generic package (use-cases live in `apps/*/src/use-cases/` initially, promoted to domain packages on cross-app reuse)

## What we DO want

- Monorepo Turborepo + Bun workspaces, ready for multi-target growth
- Auth functional out of the box (email/password + Google + roles + sessions)
- Solid layering examples in canonical components and services
- Logger, env validation, error primitives, security headers in `@void/core`
- Test setup ready to go (Vitest + Playwright with auth E2E)
- CI minimal but solid (lint + type-check + test + build + knip + gitleaks, with concurrency + caching)
- Renovate config with auto-merge rules
- Lefthook running Biome + tsc + commitlint + gitleaks on commit, knip on push
- A clear `CLAUDE.md` and `docs/*.md` documenting the why behind every convention
- `.vscode/settings.json` and `extensions.json` versioned for consistent IDE setup
- Sentry and PostHog modules ready to activate via env var, with proxy configured to bypass ad blockers
