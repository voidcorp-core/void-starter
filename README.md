# Void Factory Starter

Production-grade Next.js 16 monorepo starter, the foundation for every Void Factory MVP.

> Built and maintained by **VoidCorp**.
> Wing Chun philosophy applied to engineering: maximum efficiency, economy of means, go straight to the essential.

## Status

Currently in active scaffolding (early 2026). Architecture and execution plan are documented:

- [`context.md`](./context.md) - full architecture spec
- [`starter-plan.md`](./starter-plan.md) - 14-step execution plan
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) - non-obvious choices and rejected alternatives

The `docs/` folder will be progressively populated during implementation.

## Stack

- **Topology:** Turborepo + Bun workspaces
- **Framework:** Next.js 16.2 / React 19.2 / TypeScript strict
- **Styling:** Tailwind CSS v4 with design tokens via `@theme`
- **Auth:** Better-Auth (email/password + Google OAuth + roles), data sovereignty by default
- **DB:** Drizzle + Postgres
- **Tooling:** Biome, Lefthook, knip, gitleaks, Renovate
- **Tests:** Vitest + Playwright
- **Deploy:** Vercel-ready, monorepo-aware

Optional opt-in modules in `_modules/`: Sentry, PostHog, Stripe, Resend, Clerk (auth alternative), and more.

## Usage

Once finalized, instantiate a new MVP via:

```bash
gh repo create my-mvp --template voidcorp-core/void-starter
```

Each module activates via env var presence at build time; full installation guide will live in `docs/MODULES.md`.

## License

MIT - see [`LICENSE`](./LICENSE). Free to use, fork, modify.

Copyright (c) 2026 VoidCorp.
