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

## Getting started (per-MVP onboarding)

The starter ships without any live database connection. Once you fork it into a new MVP, wire up the runtime in this exact order:

1. **Provision a Neon branch** for the new MVP (`vercel` dashboard or `neonctl`). Copy the connection string.
2. **Create `apps/web/.env.local`** with the variables required at runtime:

   ```bash
   DATABASE_URL=postgres://user:password@host/db?sslmode=require
   BETTER_AUTH_SECRET=$(openssl rand -base64 32)
   BETTER_AUTH_URL=http://localhost:3000
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) is optional for local; email/password and magic link work without it.

3. **Apply the schema migrations** (Phase B):

   ```bash
   cd packages/db && bunx drizzle-kit push && cd ../..
   ```

4. **Boot the dev server:**

   ```bash
   bun run dev
   ```

5. **Smoke test the auth flows:**
   - Visit `http://localhost:3000` — the home page renders, dark mode toggle (when present) flips the palette via the `.dark` class on `<html>`.
   - Click `Sign up` — fill the form, submit. The dev console emits the magic link / verify URL via `pino-pretty` (ADR 22). Paste the URL into the browser to verify.
   - Sign in. `/dashboard` shows the profile with `role`, `name`, `email`.
   - Visit `/admin` — expect a 403 / `requireRole` error boundary.
   - Promote the user to admin via `drizzle-kit studio`:

     ```bash
     cd packages/db && bunx drizzle-kit studio
     ```

     Open `http://local.drizzle.studio`, find the user in the `users` table (PLURAL — Better-Auth maps the singular model name via `modelName` in the adapter config), change `role` to `admin`, save.
   - Refresh `/admin` — the users table renders.
   - Sign out via the dashboard `UserMenu` — back to the home page with no session.

If anything in the smoke checklist fails after pasting your env, the runtime is misconfigured before the code; double-check `DATABASE_URL` reachability and that `BETTER_AUTH_SECRET` is a fresh 32-byte base64 string.

> **Note for starter contributors:** the starter repo itself never ships with a `.env.local`. The full pipeline (`bun run lint`, `bun run type-check`, `bun run test`, `bun run build`, `bunx knip`, `bunx gitleaks detect --no-git --redact`) is expected to pass with **no `DATABASE_URL` set**. Database access is fully lazy: `getDb()` and `getAuth()` only open connections when a runtime request actually needs them.

## License

MIT - see [`LICENSE`](./LICENSE). Free to use, fork, modify.

Copyright (c) 2026 VoidCorp.
