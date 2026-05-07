# Phase B: Backbone Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three backbone workspace packages that `apps/web` consumes - `@void/db` (Drizzle schemas + migrations), `@void/auth` (Better-Auth wired with email/password + Google OAuth + magic link + roles + sessions), and `@void/ui` (Tailwind v4 design tokens + base components).

**Architecture:** Each package follows the validated service file layout from `context.md` (5 standard files + 5 optional layers). Better-Auth is the default auth implementation (decision 02 in `docs/DECISIONS.md`); Clerk lives as opt-in module. The auth schema (users, sessions, accounts, verifications with cascade rules) lives in `@void/db` and is imported by `@void/auth`. Design tokens use Tailwind v4's `@theme` block in `@void/ui/styles/globals.css`.

**Tech Stack added in this phase:** Drizzle ORM, drizzle-kit, postgres (node-postgres or pg), Better-Auth (with Drizzle adapter and admin plugin), Tailwind CSS v4, lucide-react (icons), clsx, tailwind-merge.

**Reference:** `context.md` Architecture principles + Auth strategy + DB schema, `starter-plan.md` Steps 4-6, `docs/DECISIONS.md` entries 02 (Better-Auth), 08 (service file layout), 09 (schemas/types merged).

**Pre-conditions (verify before starting):**
- `git tag phase-a-complete` exists on origin
- `bun run test` passes 28 tests in `@void/core`
- `bun run lint` clean
- `bun run type-check` clean

---

## Phase A learnings inherited (CRITICAL for the executor)

These are NOT pre-flight checks; they are constraints baked into Phase A that this phase must respect. Read them before touching the repo.

1. **Tooling versions actually installed (verify with `bun pm ls`):**
   - Bun 1.3.13 (at `/opt/homebrew/bin/bun`, in default PATH; just call `bun` directly, no PATH manipulation)
   - Turborepo 2.9.x
   - Biome 2.4.14 (NOT 2.0.x; schema URL is `https://biomejs.dev/schemas/2.4.14/schema.json`)
   - Lefthook 2.x (uses `jobs:` syntax, NOT `commands:`)
   - knip 5.x
   - gitleaks 8.30+ (installed via Homebrew; CLI is `gitleaks git --staged`, NOT `gitleaks protect`)
   - commitlint 20.x

2. **Bun lockfile is `bun.lock` (text), NOT `bun.lockb` (binary). Stage as `bun.lock`.**

3. **Biome 2.4 differences from older versions:**
   - `files.includes` with `!` negation patterns (not `files.ignore`)
   - `noConsole` rule (not `noConsoleLog`)
   - `assist.actions.source.organizeImports` (not top-level `organizeImports`)
   - If you write a new Biome config, run `bunx biome migrate --write` immediately to align.

4. **TypeScript strict flags enabled in `@void/config/tsconfig.base.json`:**
   - `strict: true`
   - `noUncheckedIndexedAccess: true` (array/object index access yields `T | undefined`)
   - `noPropertyAccessFromIndexSignature: true` (use `process.env['X']`, not `process.env.X`)
   - `exactOptionalPropertyTypes: true` (cannot assign `undefined` to optional property without explicit `: undefined` type)
   - `verbatimModuleSyntax: true` (must use `import type` for type-only imports, `export type` for type-only re-exports)

5. **Biome enforces `useExportType: error` and `useImportType: error`. Use `import type { Foo }` and `export type { Foo }` for type-only.**

6. **`useLiteralKeys` Biome rule conflicts with `noPropertyAccessFromIndexSignature` TS rule on `process.env` access.** This produces info-level diagnostics (not errors). Don't try to fix; document if needed.

7. **knip workspace overrides:** When a package declares dependencies that are not yet consumed (because a sub-path file has not been written yet), knip pre-push fails. Add the unused dep names to the matching `packages/<name>` entry's `ignoreDependencies` array in `knip.json`. As soon as a dep becomes consumed, REMOVE it from that array. The current state for `packages/core` has `ignoreDependencies: ["pino-pretty"]` (pino-pretty is referenced as a string transport target which knip cannot statically detect; this is a special case).

8. **Hook chain on each commit:**
   - pre-commit (parallel): biome check on staged files, type-check via turbo, gitleaks git --staged
   - commit-msg: commitlint with conventional commits + custom type-enum
   - pre-push: knip
   - **Never bypass with --no-verify.** If a hook fails, fix the underlying issue.
   - If pre-push knip fails because a new dep is unused, either (a) consume it in the same task or (b) add to `ignoreDependencies` and remove later.

9. **Conventional commit types allowed:** feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert.

10. **Style: no em dashes anywhere, no emojis in code/docs/commits, single quotes, 2-space indent, line width 100, semicolons, trailing commas.**

11. **Editing modified files:** if a file was last modified by a tool (e.g., a linter applied formatting), the Edit tool will require a Read first. Always Read before Edit on touched files.

12. **All work happens on `main` branch.** Push after each task. Tag at end of phase: `git tag phase-b-complete && git push --tags`.

13. **Read official documentation FIRST** before configuring any third-party tool. Do not trust this plan's draft snippets blindly - the underlying APIs may have changed since 2026-05-07. This rule is inscribed in `context.md` CLAUDE.md instructions.

---

## Working method during Phase B

- Each task ends with a commit (conventional commits) and a push.
- Each TDD task: write test, verify RED, write impl, verify GREEN, commit.
- For tasks that touch a new third-party tool: read its docs first, adjust task implementation accordingly, document deviations.
- For tasks that involve env vars (Better-Auth), do NOT commit secrets; use `.env.example` and document required vars in the relevant package README.
- After every task, the full pipeline must be green: `bun run lint`, `bun run type-check`, `bun run test`. Do not move to the next task while any is red.

---

# Section 1: @void/db package (Tasks 1-10)

`@void/db` is the data layer. It exposes the Drizzle client, all schema definitions for tables required by the starter (users, sessions, accounts, verifications), and migration tooling. Other packages (notably `@void/auth`) import its schemas and types.

### Task B1: @void/db package skeleton

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@void/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@void/core": "workspace:*",
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "@void/config": "workspace:*",
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

NOTE: Versions verified against npm registry on 2026-05-07. drizzle-orm latest is 0.45.x and drizzle-kit latest is 0.31.x. The executor should still re-check `bun pm view <pkg> version` at exec time in case a new release lands. (Versions verified 2026-05-07.)

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "@void/config/tsconfig.lib.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create `packages/db/src/index.ts` placeholder**

```ts
// @void/db public API. Sub-paths ./client and ./schema are the canonical entrypoints.
export {};
```

- [ ] **Step 4: Run `bun install` and verify the symlink**

```
bun install
ls -la node_modules/@void/db
```

- [ ] **Step 5: Type-check**

```
cd packages/db && bunx tsc --noEmit && cd ../..
```

- [ ] **Step 6: Update `knip.json` to add `packages/db` workspace entry**

In `knip.json`, add inside `workspaces`:
```json
"packages/db": {
  "entry": "src/index.ts",
  "project": "src/**/*.ts",
  "ignoreDependencies": ["drizzle-orm", "postgres", "drizzle-kit"]
}
```

These ignoreDependencies will be removed in subsequent tasks as the deps become consumed.

- [ ] **Step 7: Verify knip clean**

```
bunx knip --no-progress
```

- [ ] **Step 8: Commit and push**

```
git add packages/db/ knip.json bun.lock package.json
git commit -m "chore(db): scaffold @void/db workspace package skeleton"
git push
```

### Task B2: Drizzle config and client

**Files:**
- Create: `packages/db/src/client.ts`
- Create: `packages/db/drizzle.config.ts`

- [ ] **Step 1: Read Drizzle ORM official docs**

Reference: `https://orm.drizzle.team/docs/get-started/postgresql-new` and `https://orm.drizzle.team/docs/connect-postgresql`. Confirm:
- The current `drizzle()` API for postgres adapter
- `drizzle.config.ts` schema for the installed `drizzle-kit` major
- Whether `postgres` (postgres-js) or `pg` is the recommended adapter for the installed major

NOTE (verified 2026-05-07): The current Drizzle 0.45.x docs default the "PostgreSQL new" guide to `node-postgres` (`pg`), but `postgres-js` is still fully supported and is the choice this plan keeps. The `drizzle(client, { schema })` two-arg signature for postgres-js is still supported (verified against `drizzle-orm/src/postgres-js/driver.ts`). Both `drizzle(client, { schema })` and `drizzle({ client, schema })` work.

- [ ] **Step 2: Create `packages/db/src/client.ts`**

```ts
import { createAppEnv } from '@void/core/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema';

const env = createAppEnv({
  server: { DATABASE_URL: z.string().url() },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env['DATABASE_URL'],
  },
});

const queryClient = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, { schema });
export type DbClient = typeof db;
```

If the docs show a different drizzle initialization for the installed version, follow the docs and adjust this code. (API verified against https://orm.drizzle.team/docs/connect-postgresql on 2026-05-07.)

- [ ] **Step 3: Create `packages/db/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for drizzle-kit commands');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 4: Stage and commit (without running drizzle commands; we have no DB yet)**

The `drizzle-kit generate` and `drizzle-kit migrate` commands require a real Postgres connection and migration files. They will be exercised in Phase C with the docker-compose dev setup.

```
git add packages/db/src/client.ts packages/db/drizzle.config.ts
git commit -m "feat(db): add Drizzle client and drizzle-kit config"
git push
```

### Task B3: schema/users table

> CRITICAL (added 2026-05-07): Better-Auth 1.6.x has a CANONICAL schema shape that the Drizzle adapter expects: singular table names (`user`, `session`, `account`, `verification`), `id` as a TEXT primary key (not uuid), `emailVerified` as a BOOLEAN (not timestamp), session has a `token` column, account has `accessTokenExpiresAt` / `refreshTokenExpiresAt` / `scope` / `password`, and verification has an `updatedAt`. The fields below have been REWRITTEN on 2026-05-07 to match Better-Auth canonical schema - the plural-name aesthetic is preserved by remapping via `modelName` in Better-Auth's adapter config (Task B13). The `role` and `deletedAt` columns are extensions that Better-Auth tolerates but does not manage. If Better-Auth schema drifts at exec time, run `bunx @better-auth/cli generate` and reconcile. (See https://www.better-auth.com/docs/concepts/database for the canonical shape.)

**Files:**
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `packages/db/src/schema/users.ts`**

// Updated 2026-05-07 from initial draft: id changed from uuid to text (Better-Auth canonical), emailVerified changed from timestamp to boolean (Better-Auth canonical), added explicit name (NOT NULL is Better-Auth canonical but we keep nullable + default empty string-friendly so OAuth signup with no name still works), kept role/deletedAt as extensions.

```ts
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 2: Create `packages/db/src/schema/index.ts`**

```ts
export * from './users';
```

- [ ] **Step 3: Type-check**

```
cd packages/db && bunx tsc --noEmit && cd ../..
```

- [ ] **Step 4: Update `knip.json`** - remove `drizzle-orm` from packages/db ignoreDependencies (now consumed).

- [ ] **Step 5: Commit**

```
git add packages/db/src/schema/users.ts packages/db/src/schema/index.ts knip.json
git commit -m "feat(db): add users table schema with role and soft delete"
git push
```

### Task B4: schema/sessions table

**Files:**
- Create: `packages/db/src/schema/sessions.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `packages/db/src/schema/sessions.ts`**

// Updated 2026-05-07 from initial draft: userId column type changed from uuid to text (matches new users.id type), added `token` column (Better-Auth canonical), added `updatedAt` (Better-Auth canonical).

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
```

- [ ] **Step 2: Update `packages/db/src/schema/index.ts`**

```ts
export * from './users';
export * from './sessions';
```

- [ ] **Step 3: Type-check + commit**

```
cd packages/db && bunx tsc --noEmit && cd ../..
git add packages/db/src/schema/sessions.ts packages/db/src/schema/index.ts
git commit -m "feat(db): add sessions table with cascade delete on user"
git push
```

### Task B5: schema/accounts table

**Files:**
- Create: `packages/db/src/schema/accounts.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `packages/db/src/schema/accounts.ts`**

// Updated 2026-05-07 from initial draft: userId column type changed from uuid to text; field names aligned with Better-Auth canonical schema (accessTokenExpiresAt + refreshTokenExpiresAt + scope + password) instead of the simpler legacy `expiresAt`.

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
```

- [ ] **Step 2: Update `packages/db/src/schema/index.ts`** - add `export * from './accounts';`

- [ ] **Step 3: Type-check + commit**

```
git add packages/db/src/schema/accounts.ts packages/db/src/schema/index.ts
git commit -m "feat(db): add accounts table for OAuth providers"
git push
```

### Task B6: schema/verifications table

**Files:**
- Create: `packages/db/src/schema/verifications.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `packages/db/src/schema/verifications.ts`**

// Updated 2026-05-07 from initial draft: added `updatedAt` (Better-Auth canonical schema requires it).

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
```

- [ ] **Step 2: Update `packages/db/src/schema/index.ts`** - add `export * from './verifications';`

- [ ] **Step 3: Type-check + commit**

```
git add packages/db/src/schema/verifications.ts packages/db/src/schema/index.ts
git commit -m "feat(db): add verifications table for magic links and email verify"
git push
```

### Task B7: @void/db barrel export

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Replace placeholder with real exports**

```ts
export { db, type DbClient } from './client';
export * from './schema';
```

- [ ] **Step 2: Update `knip.json` packages/db ignoreDependencies = []** (postgres and drizzle-kit are now reachable through client + drizzle.config; verify by running knip).

If `postgres` is still flagged, check that client.ts imports it; if `drizzle-kit` is still flagged, it's used by drizzle.config.ts which is at package root not under src/, so add `drizzle.config.ts` to the entry pattern:

```json
"packages/db": {
  "entry": ["src/index.ts", "drizzle.config.ts"],
  "project": ["src/**/*.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Verify knip clean**

```
bunx knip --no-progress
```

- [ ] **Step 4: Commit**

```
git add packages/db/src/index.ts knip.json
git commit -m "feat(db): expose public API via barrel export"
git push
```

### Task B8: docker-compose for local Postgres

**Files:**
- Create: `tooling/docker-compose.yml`

- [ ] **Step 1: Create `tooling/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: void-starter-postgres
    environment:
      POSTGRES_USER: void
      POSTGRES_PASSWORD: void
      POSTGRES_DB: void_starter
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U void -d void_starter"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Step 2: Add a script to root `package.json`**

In root `package.json` `scripts`:
```json
"db:up": "docker compose -f tooling/docker-compose.yml up -d",
"db:down": "docker compose -f tooling/docker-compose.yml down",
"db:logs": "docker compose -f tooling/docker-compose.yml logs -f postgres"
```

- [ ] **Step 3: Add `.env.example` at repo root**

```
DATABASE_URL=postgresql://void:void@localhost:5432/void_starter
```

- [ ] **Step 4: Commit**

```
git add tooling/docker-compose.yml package.json .env.example
git commit -m "chore(db): add docker-compose for local Postgres + db scripts"
git push
```

### Task B9: First migration generation

**Files:**
- Create: `packages/db/migrations/*` (auto-generated)

- [ ] **Step 1: Start local Postgres**

```
bun run db:up
```

Wait until healthy:
```
docker compose -f tooling/docker-compose.yml ps
```

- [ ] **Step 2: Set DATABASE_URL and generate migration**

```
export DATABASE_URL=postgresql://void:void@localhost:5432/void_starter
cd packages/db && bunx drizzle-kit generate && cd ../..
```

This creates `packages/db/migrations/0000_*.sql` with CREATE TABLE for all 4 tables.

- [ ] **Step 3: Apply the migration**

```
cd packages/db && bunx drizzle-kit migrate && cd ../..
```

- [ ] **Step 4: Verify schema in DB**

```
docker exec -it void-starter-postgres psql -U void -d void_starter -c "\dt"
```

Should show users, sessions, accounts, verifications, plus `__drizzle_migrations`.

- [ ] **Step 5: Commit migration files**

```
git add packages/db/migrations/
git commit -m "feat(db): add initial migration for users, sessions, accounts, verifications"
git push
```

### Task B10: @void/db integration test

**Files:**
- Create: `packages/db/src/schema/users.integration.test.ts`

- [ ] **Step 1: Read Drizzle docs on testing**

Confirm whether to use a test database, transactions with rollback, or pglite. For this starter, use a real Postgres connection (the docker-compose one) and wrap each test in a transaction that rolls back.

- [ ] **Step 2: Create the integration test**

// Updated 2026-05-07 from initial draft: users.id is now text (not uuid with defaultRandom), so the test must supply an id explicitly. Better-Auth normally provides ids via cuid/nanoid at the application layer.

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from './index';
import { users } from './users';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('users schema integration', () => {
  let queryClient: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    queryClient = postgres(databaseUrl as string, { max: 1 });
    db = drizzle(queryClient, { schema });
  });

  afterAll(async () => {
    await queryClient.end();
  });

  it('inserts and retrieves a user with default role', async () => {
    const id = randomUUID();
    const email = `test-${Date.now()}@example.com`;
    const [inserted] = await db.insert(users).values({ id, email }).returning();
    expect(inserted?.role).toBe('user');
    expect(inserted?.emailVerified).toBe(false);
    expect(inserted?.deletedAt).toBeNull();

    if (inserted) {
      const [found] = await db.select().from(users).where(eq(users.id, inserted.id));
      expect(found?.email).toBe(email);
      await db.delete(users).where(eq(users.id, inserted.id));
    }
  });

  it('enforces email uniqueness', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const [first] = await db.insert(users).values({ id: randomUUID(), email }).returning();
    await expect(
      db.insert(users).values({ id: randomUUID(), email }),
    ).rejects.toThrow();
    if (first) {
      await db.delete(users).where(eq(users.id, first.id));
    }
  });
});
```

NOTE: this test uses `describe.skipIf` so it skips when DATABASE_URL is not set. The CI in Phase D will set DATABASE_URL via service container.

- [ ] **Step 3: Run the integration test (DB must be up)**

```
export DATABASE_URL=postgresql://void:void@localhost:5432/void_starter
cd packages/db && bunx vitest run && cd ../..
```

Expect 2 passing tests.

- [ ] **Step 4: Commit**

```
git add packages/db/src/schema/users.integration.test.ts
git commit -m "test(db): add users schema integration test (uniqueness + default role)"
git push
```

---

# Section 2: @void/auth package (Tasks 11-25)

`@void/auth` ships Better-Auth as the default implementation per decision 02. It exposes a stable public API (`getCurrentUser`, `requireAuth`, `requireRole`, `signIn.*`, `signOut`) so that switching to Clerk via `_modules/auth-clerk/` requires only swapping the repository file.

This is the most architecturally dense section. **Read Better-Auth docs (https://www.better-auth.com/docs) before starting**, confirm the current adapter API for Drizzle, plugins available (admin, magic-link, two-factor), and the recommended Next.js integration.

### Task B11: @void/auth package skeleton

- [ ] **Step 1: Create `packages/auth/package.json`**

```json
{
  "name": "@void/auth",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./service": "./src/auth.service.ts",
    "./repository": "./src/auth.repository.ts",
    "./client": "./src/auth.client.ts",
    "./types": "./src/auth.types.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@void/core": "workspace:*",
    "@void/db": "workspace:*",
    "better-auth": "^1.6.0",
    "@better-auth/drizzle-adapter": "^1.6.0"
  },
  "devDependencies": {
    "@void/config": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

NOTE (verified 2026-05-07 against npm registry): Better-Auth is at 1.6.x and the drizzle adapter is now a SEPARATE package `@better-auth/drizzle-adapter` (NOT a sub-path of `better-auth/adapters/drizzle` as earlier docs implied). Both packages must be installed and version-aligned.

- [ ] **Step 2: Create `packages/auth/tsconfig.json`**

```json
{
  "extends": "@void/config/tsconfig.lib.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create `packages/auth/src/index.ts` placeholder**

```ts
export {};
```

- [ ] **Step 4: Add to knip.json**

```json
"packages/auth": {
  "entry": "src/index.ts",
  "project": "src/**/*.ts",
  "ignoreDependencies": ["better-auth", "@better-auth/drizzle-adapter"]
}
```

- [ ] **Step 5: Install + type-check + commit**

```
bun install
cd packages/auth && bunx tsc --noEmit && cd ../..
git add packages/auth/ knip.json bun.lock package.json
git commit -m "chore(auth): scaffold @void/auth workspace package skeleton"
git push
```

### Task B12: auth.types.ts

**Files:**
- Create: `packages/auth/src/auth.types.ts`

- [ ] **Step 1: Create the types**

// Updated 2026-05-07 from initial draft: id is now z.string() (was z.string().uuid()), since Better-Auth assigns its own id format (cuid-like), not strict uuid v4. This aligns with the schema rewrite in Task B3.

```ts
import { z } from 'zod';

export const roleSchema = z.enum(['user', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  image: z.string().url().nullable(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export type AuthSession = {
  user: SessionUser;
  expiresAt: Date;
};
```

- [ ] **Step 2: Commit**

```
git add packages/auth/src/auth.types.ts
git commit -m "feat(auth): add auth types and Zod schemas"
git push
```

### Task B13: auth.repository.ts (Better-Auth setup)

**Files:**
- Create: `packages/auth/src/auth.repository.ts`

- [ ] **Step 1: Read Better-Auth docs for the Drizzle adapter and Next.js integration**

`https://www.better-auth.com/docs/adapters/drizzle` and `https://www.better-auth.com/docs/integrations/next`.

Confirm the current API of `betterAuth({...})`, the `drizzleAdapter` import, and how to enable plugins (admin, magic-link).

NOTE (API verified 2026-05-07 against the URLs above):
- The drizzle adapter is now a SEPARATE package: `@better-auth/drizzle-adapter` (import: `import { drizzleAdapter } from '@better-auth/drizzle-adapter'`). The earlier `better-auth/adapters/drizzle` sub-path is GONE in 1.6.x.
- The admin plugin's option is `adminRoles` (array), not `adminRole` (singular). Defaults: `defaultRole: 'user'`, `adminRoles: ['admin']`.
- The magicLink `sendMagicLink` callback receives `({ email, token, url, metadata }, ctx)` - NOT just `{ email, url }`. The `token` and `metadata` args are useful for custom flows.
- Schema mapping uses the `schema` option in `drizzleAdapter` to map from canonical Better-Auth model names (`user`, `session`, `account`, `verification`) to the actual Drizzle table objects (`schema.users`, etc., which we keep plural).

- [ ] **Step 2: Create `packages/auth/src/auth.repository.ts`**

// Updated 2026-05-07 from initial draft: drizzleAdapter import path moved to '@better-auth/drizzle-adapter'; admin plugin uses adminRoles array; magicLink sendMagicLink signature widened to include token + metadata.

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin, magicLink } from 'better-auth/plugins';
import { createAppEnv } from '@void/core/env';
import { db } from '@void/db/client';
import * as schema from '@void/db/schema';
import { z } from 'zod';

const env = createAppEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
  },
  client: {},
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
    GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
    GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
  },
});

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Map canonical Better-Auth model names -> our plural Drizzle tables.
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [
    admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    magicLink({
      sendMagicLink: async ({ email, url, token }, _ctx) => {
        // In Phase A/B we only console.warn the link in dev. The Resend module
        // (in _modules/email-resend) will replace this in Phase D when installed.
        const { logger } = await import('@void/core/logger');
        logger.warn(
          { email, url, token },
          'magic link (dev only - install @void/email module for prod)',
        );
      },
    }),
  ],
});

export type Auth = typeof auth;
```

If Better-Auth's API differs significantly, follow its docs and update this file. Document deviations in the commit message. As a final exec-time check, run `bunx @better-auth/cli generate` to confirm the schema the live Better-Auth version expects, and reconcile with `packages/db/src/schema/*` if needed.

- [ ] **Step 3: Update knip.json - remove better-auth from packages/auth ignoreDependencies**

- [ ] **Step 4: Type-check + commit**

```
cd packages/auth && bunx tsc --noEmit && cd ../..
git add packages/auth/src/auth.repository.ts knip.json
git commit -m "feat(auth): wire Better-Auth with Drizzle adapter, Google OAuth, magic link, admin roles"
git push
```

### Task B14: auth.service.ts (public API)

**Files:**
- Create: `packages/auth/src/auth.service.ts`

- [ ] **Step 1: Read Better-Auth API surface**

Confirm how to read sessions on the server (typically `auth.api.getSession({ headers })` or similar). The next/headers import for server contexts is standard.

NOTE (API verified 2026-05-07 against https://www.better-auth.com/docs/integrations/next): `auth.api.getSession({ headers: await headers() })` is the canonical server-side session read. `auth.api.signInEmail` exists and takes `{ body: { email, password, ... } }`. `auth.api.signInSocial` takes `{ body: { provider, callbackURL? } }`. The magic-link server-side method is `auth.api.signInMagicLink` (also exposed as `auth.api.sendMagicLink` in older code paths - the canonical is `signInMagicLink` since 1.5.x). Most apps drive sign-in from the client (auth.client.ts) anyway; these server APIs are for Server Actions / route handlers that need to bypass the client.

- [ ] **Step 2: Create the service**

```ts
import { headers } from 'next/headers';
import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { auth } from './auth.repository';
import { type SessionUser, sessionUserSchema, type Role } from './auth.types';

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const parsed = sessionUserSchema.safeParse(session.user);
  return parsed.success ? parsed.data : null;
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Authentication required');
  return user;
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== role && user.role !== 'admin') {
    throw new ForbiddenError(`Role "${role}" required`);
  }
  return user;
}

// Thin server-side wrappers around Better-Auth's auth.api.* surface. Most flows
// should use the client (auth.client.ts) instead; these are for Server Actions
// or route handlers that need to bypass the browser fetch.
export const signIn = {
  email: auth.api.signInEmail,
  google: (callbackURL?: string) =>
    auth.api.signInSocial({ body: { provider: 'google', callbackURL } }),
  magicLink: auth.api.signInMagicLink,
};

export async function signOut() {
  return auth.api.signOut({ headers: await headers() });
}
```

NOTE: `next/headers` is a peer-dependency from Next.js. Since `@void/auth` is consumed by `apps/web` which has Next, this import will resolve at runtime. Add `"peerDependencies": { "next": "^16.0.0" }` to packages/auth/package.json. Also adjust if Better-Auth's actual API differs - if `auth.api.signInMagicLink` is not exported in the installed version, fall back to `auth.api.sendMagicLink` and document the deviation.

- [ ] **Step 3: Type-check + commit**

```
cd packages/auth && bunx tsc --noEmit && cd ../..
git add packages/auth/src/auth.service.ts packages/auth/package.json
git commit -m "feat(auth): add auth.service public API (getCurrentUser, requireAuth, requireRole, signIn, signOut)"
git push
```

### Task B15: auth.policy.ts (example policies)

**Files:**
- Create: `packages/auth/src/auth.policy.ts`
- Create: `packages/auth/src/auth.policy.test.ts`

- [ ] **Step 1: Write failing test FIRST (TDD)**

```ts
import { describe, expect, it } from 'vitest';
import { canAccessAdminPanel } from './auth.policy';
import type { SessionUser } from './auth.types';

const mkUser = (role: SessionUser['role']): SessionUser => ({
  id: '00000000-0000-0000-0000-000000000000',
  email: 'x@example.com',
  name: null,
  image: null,
  role,
});

describe('canAccessAdminPanel', () => {
  it('returns true for admin', () => {
    expect(canAccessAdminPanel(mkUser('admin'))).toBe(true);
  });

  it('returns false for user', () => {
    expect(canAccessAdminPanel(mkUser('user'))).toBe(false);
  });

  it('returns false for null user', () => {
    expect(canAccessAdminPanel(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { SessionUser } from './auth.types';

export function canAccessAdminPanel(user: SessionUser | null): boolean {
  return user?.role === 'admin';
}
```

- [ ] **Step 3: Run tests + commit**

```
cd packages/auth && bunx vitest run && cd ../..
git add packages/auth/src/auth.policy.ts packages/auth/src/auth.policy.test.ts
git commit -m "feat(auth): add auth.policy with canAccessAdminPanel example"
git push
```

### Task B16: auth.errors.ts (domain errors)

**Files:**
- Create: `packages/auth/src/auth.errors.ts`
- Create: `packages/auth/src/auth.errors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isAppError } from '@void/core/errors';
import { EmailAlreadyTakenError, InvalidCredentialsError, MagicLinkExpiredError } from './auth.errors';

describe('auth errors', () => {
  it('InvalidCredentialsError has 401 + INVALID_CREDENTIALS code', () => {
    const err = new InvalidCredentialsError();
    expect(err.status).toBe(401);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(isAppError(err)).toBe(true);
  });

  it('EmailAlreadyTakenError has 409 + EMAIL_TAKEN code', () => {
    const err = new EmailAlreadyTakenError('a@b.c');
    expect(err.status).toBe(409);
    expect(err.code).toBe('EMAIL_TAKEN');
  });

  it('MagicLinkExpiredError has 410 + MAGIC_LINK_EXPIRED', () => {
    const err = new MagicLinkExpiredError();
    expect(err.status).toBe(410);
    expect(err.code).toBe('MAGIC_LINK_EXPIRED');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { AppError } from '@void/core/errors';

export class InvalidCredentialsError extends AppError {
  constructor(cause?: unknown) {
    super({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS', status: 401, cause });
    this.name = 'InvalidCredentialsError';
  }
}

export class EmailAlreadyTakenError extends AppError {
  constructor(email: string, cause?: unknown) {
    super({ message: `Email already registered: ${email}`, code: 'EMAIL_TAKEN', status: 409, cause });
    this.name = 'EmailAlreadyTakenError';
  }
}

export class MagicLinkExpiredError extends AppError {
  constructor(cause?: unknown) {
    super({ message: 'Magic link expired', code: 'MAGIC_LINK_EXPIRED', status: 410, cause });
    this.name = 'MagicLinkExpiredError';
  }
}
```

- [ ] **Step 3: Run tests + commit**

```
cd packages/auth && bunx vitest run && cd ../..
git add packages/auth/src/auth.errors.ts packages/auth/src/auth.errors.test.ts
git commit -m "feat(auth): add typed auth errors (InvalidCredentials, EmailTaken, MagicLinkExpired)"
git push
```

### Task B17: auth.client.ts (browser-side helpers)

**Files:**
- Create: `packages/auth/src/auth.client.ts`

- [ ] **Step 1: Read Better-Auth client docs**

Confirm the current API of `createAuthClient` for browser use.

NOTE (API verified 2026-05-07): `createAuthClient` is exported from `better-auth/react` (not `better-auth/client`). To use admin/magic-link features on the client, the matching `*Client` plugins must be loaded from `better-auth/client/plugins`. `signIn`, `signUp`, `signOut`, `useSession` are all destructurable from the returned client.

- [ ] **Step 2: Create the client**

// Updated 2026-05-07 from initial draft: added adminClient + magicLinkClient plugins so the client can call admin.* and signIn.magicLink directly.

```ts
import { createAuthClient } from 'better-auth/react';
import { adminClient, magicLinkClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
  plugins: [adminClient(), magicLinkClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
```

- [ ] **Step 3: Type-check + commit**

```
cd packages/auth && bunx tsc --noEmit && cd ../..
git add packages/auth/src/auth.client.ts
git commit -m "feat(auth): add Better-Auth browser client with React hooks"
git push
```

### Task B18: defineAction integration with @void/auth

**Files:**
- Modify: `packages/core/src/server-action.ts`

This task replaces the Phase A scaffolding stub in `defineAction` with real auth resolution via `@void/auth`. Note this creates a circular-looking dep at the package level (core does NOT import auth), so we use a runtime dynamic import inside `resolveAuth` to avoid the build-time cycle.

Actually a cleaner approach: parameterize the auth resolver. Let `defineAction` accept an optional `resolveAuth` function in its config, and let the app pass it in once. But this complicates the API.

The simplest correct path:
- `@void/core` stays auth-agnostic. The auth resolution stays as a stub that throws.
- The app (`apps/web`) provides its own thin wrapper around `defineAction` that injects auth via `@void/auth`.

**Decision for this task:** create a thin wrapper module in `packages/auth/src/auth-action.ts` that re-exports `defineAction` with auth resolution wired in.

- [ ] **Step 1: Read Better-Auth on-server session API to confirm `getCurrentUser` semantics**

- [ ] **Step 2: Create `packages/auth/src/auth-action.ts`**

```ts
import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import {
  defineAction as defineActionCore,
  type ActionAuth,
  type ActionContext,
} from '@void/core/server-action';
import type { ZodType } from 'zod';
import { getCurrentUser } from './auth.service';

async function resolveAuth(auth: ActionAuth): Promise<ActionContext> {
  if (auth === 'public') return { user: null };

  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Authentication required');

  if (auth === 'required') return { user: { id: user.id, role: user.role } };

  if (auth.startsWith('role:')) {
    const requiredRole = auth.slice('role:'.length);
    if (user.role !== requiredRole && user.role !== 'admin') {
      throw new ForbiddenError(`Role "${requiredRole}" required`);
    }
    return { user: { id: user.id, role: user.role } };
  }

  throw new Error(`defineAction: unknown auth mode "${auth}"`);
}

type DefineActionConfig<TSchema extends ZodType, TResult> = Parameters<
  typeof defineActionCore<TSchema, TResult>
>[0];

export function defineAction<TSchema extends ZodType, TResult>(
  config: DefineActionConfig<TSchema, TResult>,
) {
  return defineActionCore({
    ...config,
    handler: async (input, _ctx) => {
      const ctx = await resolveAuth(config.auth);
      return config.handler(input, ctx);
    },
  });
}
```

The wrapper short-circuits the core stub by injecting its own ctx before the core handler runs. `@void/core/server-action` continues to work as a standalone primitive for testing without auth.

- [ ] **Step 3: Add `defineAction` to packages/auth/src/index.ts public exports** (Task B22 below).

- [ ] **Step 4: Type-check + commit**

```
cd packages/auth && bunx tsc --noEmit && cd ../..
git add packages/auth/src/auth-action.ts
git commit -m "feat(auth): add auth-aware defineAction wrapper around @void/core"
git push
```

### Task B19: extend defineAction tests for required + role:* paths

**Files:**
- Modify: `packages/core/src/server-action.test.ts` (extend, do not replace existing tests)

Already in Phase A, the core defineAction has 3 tests covering 'public'. Phase B adds tests that mock the auth module to cover 'required' and 'role:*' through the auth wrapper.

Actually, the cleaner placement is to test the auth wrapper in `packages/auth/src/auth-action.test.ts` instead of polluting core's tests with auth concerns.

- [ ] **Step 1: Create `packages/auth/src/auth-action.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@void/core/errors';

vi.mock('./auth.service', () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from './auth.service';
import { defineAction } from './auth-action';

const getCurrentUserMock = vi.mocked(getCurrentUser);

describe('defineAction (auth-aware)', () => {
  it('passes when auth=required and user is signed in', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'user',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'required',
      handler: async (_input, ctx) => ctx.user,
    });
    const result = await action({});
    expect(result?.id).toBe('u1');
  });

  it('throws UnauthorizedError when auth=required and user is null', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const action = defineAction({
      schema: z.object({}),
      auth: 'required',
      handler: async () => 'ok',
    });
    await expect(action({})).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('passes when auth=role:admin and user is admin', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'admin',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'role:admin',
      handler: async (_input, ctx) => ctx.user?.role,
    });
    expect(await action({})).toBe('admin');
  });

  it('throws ForbiddenError when auth=role:admin and user is regular user', async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
      role: 'user',
    });
    const action = defineAction({
      schema: z.object({}),
      auth: 'role:admin',
      handler: async () => 'ok',
    });
    await expect(action({})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run tests + commit**

```
cd packages/auth && bunx vitest run && cd ../..
git add packages/auth/src/auth-action.test.ts
git commit -m "test(auth): cover auth-aware defineAction with required + role:* paths"
git push
```

### Task B20: auth.service test (mocked Better-Auth)

**Files:**
- Create: `packages/auth/src/auth.service.test.ts`

Better-Auth's API uses next/headers internally. Tests must mock both `next/headers` and `auth.repository.auth.api.*` calls.

- [ ] **Step 1: Create the test file**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));

vi.mock('./auth.repository', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { auth } from './auth.repository';
import { getCurrentUser, requireAuth, requireRole } from './auth.service';

const getSessionMock = vi.mocked(auth.api.getSession);

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns parsed user when session exists', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.c',
        name: 'Alice',
        image: null,
        role: 'user',
      },
    } as never);
    const user = await getCurrentUser();
    expect(user?.email).toBe('a@b.c');
  });
});

describe('requireAuth', () => {
  it('throws UnauthorizedError when not signed in', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireRole', () => {
  it('throws ForbiddenError when user lacks role', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.c',
        name: null,
        image: null,
        role: 'user',
      },
    } as never);
    await expect(requireRole('admin')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('passes when user is admin', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.c',
        name: null,
        image: null,
        role: 'admin',
      },
    } as never);
    const user = await requireRole('admin');
    expect(user.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run + commit**

```
cd packages/auth && bunx vitest run && cd ../..
git add packages/auth/src/auth.service.test.ts
git commit -m "test(auth): cover auth.service public API with mocked Better-Auth"
git push
```

### Task B21: auth.helper.ts and tests

**Files:**
- Create: `packages/auth/src/auth.helper.ts`
- Create: `packages/auth/src/auth.helper.test.ts`

Pure helpers extracted from auth flows. Examples: deriving display name, formatting role labels, computing initials for avatars.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { computeInitials, displayName } from './auth.helper';

describe('displayName', () => {
  it('returns name when present', () => {
    expect(displayName({ name: 'Alice', email: 'a@b.c' })).toBe('Alice');
  });

  it('falls back to email local part when name is null', () => {
    expect(displayName({ name: null, email: 'alice@example.com' })).toBe('alice');
  });
});

describe('computeInitials', () => {
  it('returns first letter of first and last name parts', () => {
    expect(computeInitials('Alice Bob')).toBe('AB');
  });

  it('returns first 2 letters when single word', () => {
    expect(computeInitials('Alice')).toBe('AL');
  });

  it('returns ?? for empty input', () => {
    expect(computeInitials('')).toBe('??');
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function displayName(input: { name: string | null; email: string }): string {
  if (input.name) return input.name;
  const at = input.email.indexOf('@');
  return at > 0 ? input.email.slice(0, at) : input.email;
}

export function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]?.charAt(0) ?? '';
    const last = parts[parts.length - 1]?.charAt(0) ?? '';
    return `${first}${last}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 3: Run + commit**

```
cd packages/auth && bunx vitest run && cd ../..
git add packages/auth/src/auth.helper.ts packages/auth/src/auth.helper.test.ts
git commit -m "feat(auth): add displayName and computeInitials helpers with tests"
git push
```

### Task B22: @void/auth barrel export

**Files:**
- Modify: `packages/auth/src/index.ts`

```ts
export {
  getCurrentUser,
  requireAuth,
  requireRole,
  signIn,
  signOut,
} from './auth.service';
export { defineAction } from './auth-action';
export { authClient } from './auth.client';
export { canAccessAdminPanel } from './auth.policy';
export {
  EmailAlreadyTakenError,
  InvalidCredentialsError,
  MagicLinkExpiredError,
} from './auth.errors';
export {
  type Role,
  type SessionUser,
  type AuthSession,
  roleSchema,
  sessionUserSchema,
} from './auth.types';
export { displayName, computeInitials } from './auth.helper';
```

- [ ] **Type-check + lint + commit**

```
cd packages/auth && bunx tsc --noEmit && cd ../..
bun run lint
git add packages/auth/src/index.ts
git commit -m "feat(auth): expose public API via barrel export"
git push
```

### Task B23: env vars documented

**Files:**
- Create: `packages/auth/README.md`
- Modify: `.env.example`

- [ ] **Create `packages/auth/README.md`**

```markdown
# @void/auth

Default auth implementation for the void-starter. Wraps Better-Auth with Drizzle adapter, Google OAuth, magic link, and admin/role plugins.

## Required env vars

- `BETTER_AUTH_SECRET` - 32+ char random string. Generate: `openssl rand -base64 32`
- `BETTER_AUTH_URL` - Base URL of the app (e.g. `http://localhost:3000` in dev, prod URL in prod)
- `GOOGLE_CLIENT_ID` - From Google Cloud Console > APIs & Services > Credentials
- `GOOGLE_CLIENT_SECRET` - paired with the above
- `DATABASE_URL` - inherited from `@void/db`

## Public API

- `getCurrentUser(): Promise<SessionUser | null>` - read current session
- `requireAuth(): Promise<SessionUser>` - throws `UnauthorizedError` if no session
- `requireRole(role): Promise<SessionUser>` - throws `ForbiddenError` if role mismatch (admin always passes)
- `signIn.email({ email, password })`, `signIn.google()`, `signIn.magicLink({ email })`
- `signOut()`
- `defineAction({ schema, auth, handler })` - auth-aware Server Action wrapper

## Switching to Clerk

If an MVP requires SaaS-grade B2B auth (SSO/SCIM/orgs), install `_modules/auth-clerk/` which provides an alternative `auth.repository.ts`. The rest of the app code stays intact thanks to the stable public API.

See `docs/AUTH.md` for the full switch procedure (added in Phase D).
```

- [ ] **Append to `.env.example` at repo root**

```
BETTER_AUTH_SECRET=replace-me-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Commit**

```
git add packages/auth/README.md .env.example
git commit -m "docs(auth): document required env vars and public API"
git push
```

### Task B24: full pipeline check after Section 2

```
bun run lint
bun run type-check
bun run test
bunx knip --no-progress
bunx gitleaks detect --no-git --redact
```

All five must pass with zero errors. If any fail, fix before proceeding to Section 3.

### Task B25: integration test for auth flow (with real DB)

**Files:**
- Create: `packages/auth/src/auth.integration.test.ts`

This test exercises the full auth flow against a real Better-Auth + Postgres setup. Skips when DATABASE_URL is not set.

- [ ] **Step 1: Create the integration test**

The test should:
1. Sign up a new user via `auth.api.signUpEmail({ body: { email, password, name } })`
2. Sign in with the same credentials via `auth.api.signInEmail({ body: { email, password } })`
3. Verify session contains the user (use the returned token to read session)
4. Sign out via `auth.api.signOut({ headers })`
5. Clean up by deleting the test user from the `users` table directly

Implement based on Better-Auth's actual server-side test utilities. (API verified 2026-05-07 against https://www.better-auth.com/docs/basic-usage and https://www.better-auth.com/docs/integrations/next.) If `requireEmailVerification: true` blocks the signup-then-signin flow in tests, either use a test-mode flag or pre-set `users.emailVerified = true` after signup before testing signin.

- [ ] **Step 2: Run with DB up**

```
bun run db:up
export DATABASE_URL=postgresql://void:void@localhost:5432/void_starter
cd packages/auth && bunx vitest run && cd ../..
```

- [ ] **Step 3: Commit**

```
git add packages/auth/src/auth.integration.test.ts
git commit -m "test(auth): add integration test exercising signup/signin/signout against real DB"
git push
```

---

# Section 3: @void/ui package (Tasks 26-35)

`@void/ui` exposes Tailwind v4 design tokens via `@theme` and a small set of base components used across apps (Button, Input, Card, Label, Avatar). Components follow the canonical layout from `context.md`.

### Task B26: @void/ui package skeleton

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@void/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles/globals.css": "./src/styles/globals.css",
    "./tokens": "./src/tokens.ts"
  },
  "scripts": {
    "lint": "biome check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "clsx": "^2.1.0",
    "lucide-react": "^1.14.0",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@void/config": "workspace:*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

NOTE (versions verified 2026-05-07 against npm registry): lucide-react has crossed its 1.x boundary (latest 1.14.x); tailwindcss is at 4.2.x. The executor should still re-check `bun pm view <pkg> version` at exec time.

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "@void/config/tsconfig.lib.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "**/*.test.ts", "**/*.test.tsx"]
}
```

- [ ] **Step 3: Create `packages/ui/src/index.ts` placeholder**

```ts
export {};
```

- [ ] **Step 4: Add to knip.json**

```json
"packages/ui": {
  "entry": "src/index.ts",
  "project": "src/**/*.{ts,tsx}",
  "ignoreDependencies": ["clsx", "lucide-react", "tailwind-merge", "tailwindcss"]
}
```

- [ ] **Step 5: Install + type-check + commit**

```
bun install
cd packages/ui && bunx tsc --noEmit && cd ../..
git add packages/ui/ knip.json bun.lock package.json
git commit -m "chore(ui): scaffold @void/ui workspace package skeleton"
git push
```

### Task B27: design tokens via Tailwind v4 @theme

**Files:**
- Create: `packages/ui/src/styles/globals.css`
- Create: `packages/ui/src/tokens.ts`

- [ ] **Step 1: Read Tailwind v4 docs on `@theme`**

Reference: `https://tailwindcss.com/docs/theme`. Confirm the `@theme` directive syntax for v4.

- [ ] **Step 2: Create `packages/ui/src/styles/globals.css`**

```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-background: oklch(0.99 0.005 270);
  --color-foreground: oklch(0.15 0.02 270);
  --color-muted: oklch(0.95 0.005 270);
  --color-muted-foreground: oklch(0.45 0.02 270);
  --color-primary: oklch(0.55 0.2 250);
  --color-primary-foreground: oklch(0.98 0.005 250);
  --color-destructive: oklch(0.55 0.2 25);
  --color-destructive-foreground: oklch(0.98 0.005 25);
  --color-border: oklch(0.9 0.005 270);
  --color-ring: oklch(0.55 0.2 250);

  /* Spacing */
  --spacing-0: 0;
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  --spacing-12: 3rem;
  --spacing-16: 4rem;

  /* Typography */
  --font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, monospace;

  /* Radii */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}

@layer base {
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 3: Create `packages/ui/src/tokens.ts`** for programmatic access

```ts
export const tokens = {
  colors: {
    background: 'var(--color-background)',
    foreground: 'var(--color-foreground)',
    muted: 'var(--color-muted)',
    mutedForeground: 'var(--color-muted-foreground)',
    primary: 'var(--color-primary)',
    primaryForeground: 'var(--color-primary-foreground)',
    destructive: 'var(--color-destructive)',
    destructiveForeground: 'var(--color-destructive-foreground)',
    border: 'var(--color-border)',
    ring: 'var(--color-ring)',
  },
  radius: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
  },
} as const;

export type DesignTokens = typeof tokens;
```

- [ ] **Step 4: Commit**

```
git add packages/ui/src/styles/globals.css packages/ui/src/tokens.ts
git commit -m "feat(ui): add Tailwind v4 design tokens via @theme + programmatic accessor"
git push
```

### Task B28: cn() utility (clsx + tailwind-merge)

**Files:**
- Create: `packages/ui/src/cn.ts`
- Create: `packages/ui/src/cn.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins classes', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Update knip.json - remove clsx and tailwind-merge from ui ignoreDependencies.**

- [ ] **Step 4: Run tests + commit**

```
cd packages/ui && bunx vitest run && cd ../..
git add packages/ui/src/cn.ts packages/ui/src/cn.test.ts knip.json
git commit -m "feat(ui): add cn utility for class merging (clsx + tailwind-merge)"
git push
```

### Task B29: Button component

**Files:**
- Create: `packages/ui/src/Button/Button.tsx`
- Create: `packages/ui/src/Button/Button.helper.ts`
- Create: `packages/ui/src/Button/Button.helper.test.ts`
- Create: `packages/ui/src/Button/Button.types.ts`
- Create: `packages/ui/src/Button/index.ts`

- [ ] **Step 1: Types** (`Button.types.ts`)

```ts
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};
```

- [ ] **Step 2: Helper test** (`Button.helper.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { getButtonClasses } from './Button.helper';

describe('getButtonClasses', () => {
  it('returns base classes for default variant + size', () => {
    const cls = getButtonClasses('primary', 'md');
    expect(cls).toContain('bg-primary');
  });

  it('applies destructive variant styles', () => {
    expect(getButtonClasses('destructive', 'md')).toContain('bg-destructive');
  });

  it('applies size-specific padding', () => {
    expect(getButtonClasses('primary', 'sm')).toContain('h-8');
    expect(getButtonClasses('primary', 'lg')).toContain('h-12');
  });
});
```

- [ ] **Step 3: Helper** (`Button.helper.ts`)

```ts
import type { ButtonSize, ButtonVariant } from './Button.types';

const baseClasses =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-muted text-foreground hover:bg-muted/80',
  ghost: 'bg-transparent hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function getButtonClasses(variant: ButtonVariant, size: ButtonSize): string {
  return `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]}`;
}
```

- [ ] **Step 4: Component** (`Button.tsx`)

```tsx
import { forwardRef } from 'react';
import { cn } from '../cn';
import { getButtonClasses } from './Button.helper';
import type { ButtonProps } from './Button.types';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(getButtonClasses(variant, size), className)}
      {...props}
    >
      {children}
    </button>
  ),
);

Button.displayName = 'Button';
```

- [ ] **Step 5: Barrel** (`index.ts`)

```ts
export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.types';
```

- [ ] **Step 6: Run tests + commit**

```
cd packages/ui && bunx vitest run && cd ../..
git add packages/ui/src/Button/
git commit -m "feat(ui): add Button component with variants (primary/secondary/ghost/destructive) and sizes"
git push
```

### Task B30: Input component

**Files:**
- Create: `packages/ui/src/Input/Input.tsx`
- Create: `packages/ui/src/Input/Input.types.ts`
- Create: `packages/ui/src/Input/index.ts`

Input is simple enough that no helper.ts is justified.

- [ ] **Types**

```ts
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};
```

- [ ] **Component**

```tsx
import { forwardRef } from 'react';
import { cn } from '../cn';
import type { InputProps } from './Input.types';

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
```

- [ ] **Barrel + commit**

```ts
// index.ts
export { Input } from './Input';
export type { InputProps } from './Input.types';
```

```
git add packages/ui/src/Input/
git commit -m "feat(ui): add Input component with invalid state"
git push
```

### Task B31: Label component

Trivial wrapper around `<label>` with consistent styling.

```tsx
// Label.tsx
import { forwardRef } from 'react';
import { cn } from '../cn';
import type { LabelHTMLAttributes } from 'react';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
      {...props}
    />
  ),
);

Label.displayName = 'Label';
```

```ts
// index.ts
export { Label } from './Label';
```

```
git add packages/ui/src/Label/
git commit -m "feat(ui): add Label component"
git push
```

### Task B32: Card component

Standard card with header / body slots.

```tsx
// Card.tsx
import { forwardRef } from 'react';
import { cn } from '../cn';
import type { HTMLAttributes } from 'react';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-background shadow-sm', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pb-2', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-2', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';
```

```ts
// index.ts
export { Card, CardHeader, CardBody } from './Card';
```

```
git add packages/ui/src/Card/
git commit -m "feat(ui): add Card with Header and Body slots"
git push
```

### Task B33: Avatar component

```tsx
// Avatar.tsx
import { cn } from '../cn';

type AvatarProps = {
  src?: string | null;
  alt?: string;
  fallback: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
} as const;

export function Avatar({ src, alt = '', fallback, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium overflow-hidden',
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
}
```

```ts
// index.ts
export { Avatar } from './Avatar';
```

```
git add packages/ui/src/Avatar/
git commit -m "feat(ui): add Avatar component with image + fallback initials"
git push
```

### Task B34: @void/ui barrel export

```ts
// packages/ui/src/index.ts
export * from './Button';
export * from './Input';
export * from './Label';
export * from './Card';
export * from './Avatar';
export { cn } from './cn';
export { tokens, type DesignTokens } from './tokens';
```

```
cd packages/ui && bunx tsc --noEmit && cd ../..
git add packages/ui/src/index.ts
git commit -m "feat(ui): expose public API via barrel export"
git push
```

### Task B35: Phase B end-to-end validation

```
bun run lint
bun run type-check
bun run test
bunx knip --no-progress
bunx gitleaks detect --no-git --redact
```

All five must pass with zero errors.

- [ ] **Verify final structure**

```
find packages/{db,auth,ui} -type f -not -path '*/node_modules/*'
```

Expected:
- packages/db: package.json, tsconfig.json, drizzle.config.ts, src/client.ts, src/index.ts, src/schema/{users,sessions,accounts,verifications,index}.ts, src/schema/users.integration.test.ts, migrations/0000_*.sql
- packages/auth: package.json, README.md, tsconfig.json, src/{auth.types,auth.repository,auth.service,auth.policy,auth.errors,auth.client,auth.helper,auth-action,index}.ts, with matching .test.ts files
- packages/ui: package.json, tsconfig.json, src/styles/globals.css, src/tokens.ts, src/cn.ts (+ test), src/{Button,Input,Label,Card,Avatar}/* with matching test files

- [ ] **Tag and push**

```
git tag phase-b-complete
git push --tags
```

---

## Phase B done. Next steps:

- Phase C plan at `docs/superpowers/plans/2026-05-07-phase-c-web-app.md` covers `apps/web` bootstrap, auth pages, protected pages, canonical examples, Vitest + Playwright tests.
- Open Phase C in a fresh Claude Code session for best results (context budget for execution is small once the plan is in place).
- Update `docs/DECISIONS.md` if any non-obvious decision was taken during Phase B execution (e.g., choice between postgres-js vs pg, choice of magic-link sender stub strategy).
- If a third-party API turned out to differ materially from this plan, document the deviation in the relevant package's README and in the Phase B completion commit message.
