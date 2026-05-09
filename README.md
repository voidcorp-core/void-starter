# Void Factory Starter

Production-grade Next.js 16 monorepo starter, the foundation for every Void Factory MVP. Built and maintained by **VoidCorp**.

The starter follows a Wing Chun engineering philosophy: maximum efficiency, economy of means, go straight to the essential. Every dependency, every layer, every file earns its place. The foundation aims to clone, configure, and ship a fresh MVP in under an hour, with production-grade observability, auth, and CI from commit one.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Topology | Turborepo + Bun workspaces | DAG-aware builds, fast install (ADR 01) |
| Framework | Next.js 16.2 / React 19.2 | Cache Components stable, App Router |
| Language | TypeScript 6.0 strict | Workspace standard, no implicit any |
| Styling | Tailwind CSS v4 with `@theme` | Token-based design system, zero-runtime |
| UI | Radix-backed primitives via `@void/ui` | Accessibility for free (ADR 16, 18, 19) |
| Auth | Better-Auth (default), Clerk (opt-in) | Data sovereignty (ADR 02) |
| DB | Drizzle + Neon Postgres | Branch-per-environment (ADR 11, 12) |
| Logger | pino | Structured logs, dev-pretty (ADR 22) |
| Tooling | Biome, Lefthook, knip, gitleaks, Renovate | Quality gates from commit one |
| Tests | Vitest, Playwright | Unit, integration, E2E |
| Deploy | Vercel-ready, monorepo-aware | Auto preview branches |

Optional opt-in modules in `_modules/`: Sentry, PostHog, Stripe, Resend, Clerk (auth alternative), Payload CMS, audit-log, cookie consent, Upstash rate limit, next-intl, self-hosted Postgres.

## Topology

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
|-- docs/                          # ADRs + the doc set
`-- tooling/                       # Reserved for repo-wide scripts
```

The split between `packages/` and `_modules/` is the load-bearing boundary: tier 1 is always installed and built, tier 2 activates at build time via env var presence. See `docs/ARCHITECTURE.md` for the full topology and `docs/DECISIONS.md` for the rationale.

## Quick start (per-MVP onboarding)

1. **Create a new MVP from this template:**

   ```bash
   gh repo create my-mvp --template voidcorp-core/void-starter
   cd my-mvp && bun install
   ```

2. **Link to a Vercel project with the Neon Marketplace integration enabled:**

   ```bash
   vercel link
   # In the Vercel dashboard, install the Neon Marketplace integration on
   # the project. Neon auto-provisions a Postgres database with dev and
   # prod branches (per ADR 11).
   vercel env pull .env.local
   ```

   This populates `DATABASE_URL` from the Neon dev branch.

3. **Generate auth secrets locally (do not commit):**

   ```bash
   echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
   echo "BETTER_AUTH_URL=http://localhost:3000" >> .env.local
   echo "NEXT_PUBLIC_APP_URL=http://localhost:3000" >> .env.local
   ```

4. **(Optional) Add Google OAuth credentials to `.env.local`:**

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

   Email/password and magic link work without Google OAuth; the credentials are only needed for the social provider button.

5. **Run migrations and start dev:**

   ```bash
   cd packages/db && bunx drizzle-kit migrate && cd ../..
   bun run dev
   ```

6. **(Optional) Run E2E tests:**

   ```bash
   cd apps/web && bunx playwright install --with-deps chromium && bun run test:e2e
   ```

7. **Smoke test the auth flows** at `http://localhost:3000`: sign up, follow the magic link from the dev console (`pino-pretty` per ADR 22), sign in, visit `/dashboard`. Promote a user to admin via `bunx drizzle-kit studio` to unlock `/admin`.

> **Note for starter contributors:** the starter repo itself never ships with a `.env.local`. The full pipeline (`bun run lint`, `bun run type-check`, `bun run test`, `bun run build`, `bunx knip`, `bunx gitleaks detect --no-git --redact`) is expected to pass with **no `DATABASE_URL` set**. Database access is fully lazy: `getDb()` and `getAuth()` only open connections when a runtime request actually needs them.

## Module activation

Modules in `_modules/` are opt-in. To activate a real workspace package (Pattern A, e.g. `@void/sentry`), add `"@void/<name>": "workspace:*"` to the consuming app's `package.json`, set the matching env vars, add the package to `transpilePackages` in `apps/web/next.config.ts`, then follow the module's README for the wiring (instrumentation hook, layout wrap, or `next.config.ts` rewrites). Activation is build-time per ADR 04: an absent env var produces zero runtime cost, no SDK fetch, no bundle weight. For copy-paste scaffolds (Pattern B, e.g. `@void/payment-stripe`), the module's README is the integration recipe. Read `docs/MODULES.md` for the full activation procedure and `_modules/README.md` for the catalogue.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) -- canonical entry point for AI assistants. Read first when the assistant joins a session.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) -- topology, package boundaries, layering rules, build-time module activation.
- [`docs/PATTERNS.md`](./docs/PATTERNS.md) -- file naming, service layout, code style, conventional commits.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) -- ADR-lite log of every non-obvious choice. Read before challenging an existing decision.
- [`docs/AUTH.md`](./docs/AUTH.md) -- Better-Auth integration, RBAC, magic link flow, the Clerk swap procedure.
- [`docs/CACHING.md`](./docs/CACHING.md) -- Cache Components conventions, tag taxonomy, `updateTag` write paths.
- [`docs/SECURITY.md`](./docs/SECURITY.md) -- OWASP Top 10 mapping, RGPD checklist, env var hygiene, secret rotation.
- [`docs/MODULES.md`](./docs/MODULES.md) -- operational guide to the `_modules/*` catalogue (activation patterns, removal procedure, testing).
- [`docs/CI.md`](./docs/CI.md) -- the `.github/workflows/ci.yml` pipeline and the recommended branch protection rules.
- [`_modules/README.md`](./_modules/README.md) -- the per-MVP opt-in module catalogue.
- [`SECURITY.md`](./SECURITY.md) -- vulnerability reporting policy (the GitHub-recognized location).
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) -- how to contribute changes back to the starter.

## Contributing

This repo enforces conventional commits via Lefthook pre-commit hooks (Biome, gitleaks, type-check, commitlint) and protects `main` via the branch protection rules described in `docs/CI.md`. Any non-obvious decision lands in `docs/DECISIONS.md` in the same PR. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide.

## License

MIT -- see [`LICENSE`](./LICENSE). Free to use, fork, modify.

Copyright (c) 2026 VoidCorp.
