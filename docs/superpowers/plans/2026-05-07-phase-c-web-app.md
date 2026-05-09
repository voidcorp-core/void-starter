# Phase C: Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan was patched on 2026-05-09 to reflect the Phase B post-audit polish (Lots A-F, commits past `phase-b-complete` tag at `44823e9`). All snippets below assume the post-audit code reality.

**Goal:** Build `apps/web` as a fully functional Next.js 16 application that consumes the Phase A + B packages and demonstrates the canonical patterns (sign-in/sign-up/reset-password/verify-email pages, protected dashboard, admin-only page, home page, canonical component examples). Add Vitest at app level and Playwright with end-to-end auth tests.

**Architecture:** `apps/web` is the only app at J0. It demonstrates how a Void Factory MVP consumes `@void/core`, `@void/auth`, `@void/db`, `@void/ui`. Server Actions live in `apps/web/src/actions/` and use `defineAction` (RPC) or `defineFormAction` (FormData + `useActionState`) from `@void/auth`. The `instrumentation.ts` is wired with stubs ready to receive opt-in modules in Phase D. Security headers from `@void/core` are wired in `next.config.ts`. Auth pages use Better-Auth's React client (`useSession`, `signIn`, `signOut`, `signUp` from `@void/auth` via `authClient`); the server-side `signIn` namespace was intentionally REMOVED in the post-audit (ADR not — see commit `2dca9b3`).

**Tech Stack added in this phase:** Next.js 16.2, React 19.2, @playwright/test, jsdom, @testing-library/react.

**Reference:** `context.md` Architecture principles + Topology, `starter-plan.md` Steps 7-9, `docs/DECISIONS.md` entries 03 (.actions placement), 04 (build-time module activation), 08 (service layout), 12 (lazy `getDb()`), 15 (`@void/auth` declaration:false), 16 (RSC boundary), 17 (CVA), 18 (Radix substrate), 19 (dark mode), 20 (Form composition), 21 (`defineFormAction`), 22 (pino).

**Pre-conditions:**
- `git tag phase-b-complete` exists at `44823e9` on origin (post-audit polish landed AFTER the tag; do NOT move the tag)
- `bun run test` passes all unit tests across `@void/core`, `@void/db`, `@void/auth`, `@void/ui`
- Neon dev branch URL pulled into `.env.local` (`vercel env pull .env.local`) and migration applied (ADR 11)

---

## Phase B post-audit deltas inherited (CRITICAL for the executor)

Phase B shipped, then a 6-lot post-audit polish landed (24 commits after `phase-b-complete`). The Phase C plan was drafted BEFORE that audit, so the snippets below already account for these changes. Re-read this section before touching any task; the surface differences from a "fresh post-Phase-B" mental model are non-trivial:

1. **`@void/db` exposes `getDb()`, not a `db` const.** Lazy memoized singleton via `globalThis` (ADR 12). Imports: `import { getDb } from '@void/db'`. Schema barrel still at `@void/db/schema`. Drizzle tables are PLURAL (`users`, `sessions`, `accounts`, `verifications`); Better-Auth maps to canonical singular models via `modelName`. All `id` columns are `text` (Better-Auth assigns ids itself). The `users` table has extension columns `role` (text default 'user') and `deletedAt` (timestamptz nullable, soft-delete; service-layer must filter `WHERE deleted_at IS NULL`).

2. **`@void/auth` server surface dropped `signIn`.** The `signIn` server-side namespace was REMOVED in commit `2dca9b3` — cookie passthrough was broken. `auth.service` now exports only `getCurrentUser`, `requireAuth`, `requireRole`, `signOut`. All sign-in / sign-up / magic-link flows go through the BROWSER client (`authClient.signIn.email`, `authClient.signUp.email`, `authClient.signIn.magicLink`, `authClient.signIn.social`) which is exposed at `@void/auth` (re-exports `authClient`, `signIn`, `signOut`, `signUp`, `useSession`).

3. **`@void/auth` exposes `defineAction` AND `defineFormAction`** (ADR 21). RPC version throws on validation/auth failures (use with RHF `handleSubmit`). Form version returns `ActionState` (`{ ok: true, data } | { ok: false, fieldErrors, formError? }`) — wire it to React 19 `useActionState`. Both re-export `ActionState` and `initialActionState`. ALWAYS import from `@void/auth`, never from `@void/core/server-action` directly (the bare core has stub auth resolution; ADR 5).

4. **`@void/auth` opts out of `.d.ts` declaration emit (ADR 15).** Type resolution flows through the package's TS source via `package.json#exports`. `apps/web` resolves it correctly out of the box. No action required, but do NOT add `declaration: true` to `packages/auth/tsconfig.json`.

5. **`RateLimitError` exists at `@void/core/errors`** (extends `AppError`, code `RATE_LIMITED`, status 429, readonly `retryAfterSeconds`). `defineFormAction` maps it to `formError` automatically. The in-memory limiter helper is `createMemoryRateLimit` (renamed from `createInMemoryRateLimit`), with a heavy footgun warning in JSDoc: per-process map, useless on serverless. Production must use the Phase D `_modules/rate-limit-upstash`.

6. **`@void/core/env` exports `required(name)`** (ADR 13). Throws `Missing required env var: NAME`. Use it for cheap presence checks (e.g., in config files, route handlers). For Zod-validated app envs, keep `createAppEnv`.

7. **`@void/ui` is now Radix-backed and CVA-driven** (ADRs 17, 18). DO NOT use `forwardRef` in any consumer code — React 19 ref-as-prop is the idiom. DO NOT hand-roll variant maps — wrap CVA. Public components shipped:
   - **Card** has 6 slots: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`. `CardBody` does NOT exist; use `CardContent`.
   - **Avatar** is on `@radix-ui/react-avatar`. Public API: `<Avatar src? alt? fallback size? className? />`.
   - **Button** has `asChild?: boolean` via `@radix-ui/react-slot`. Use `<Button asChild><Link href="/x">Go</Link></Button>` for button-as-link instead of wrapping a `<Button>` inside a `<Link>`.
   - **Label** is on `@radix-ui/react-label`.
   - **Skeleton** is `<Skeleton radius="sm|md|lg|full|none" />` (server component, no `'use client'`).
   - **Spinner** is `<Spinner size="sm|md|lg|xl" label? />` on `lucide-react` Loader2.
   - **Toaster** + `toast`: import from `@void/ui` (not `sonner` directly). Mount `<Toaster />` once in the root layout. Call `toast.success(...)`, `toast.error(...)`, etc.
   - **ThemeProvider** + `useTheme`: import from `@void/ui` (wraps `next-themes`). Mount `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` in the root layout (ADR 19). Tailwind v4 `dark:` variant + `.dark` palette in `globals.css`.
   - **Form composition**: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl` (Radix Slot, auto-wires aria), `FormDescription`, `FormMessage`, `useFormField` (ADR 20). Pattern: `useForm({ resolver: zodResolver(schema), defaultValues })`. ALL Form composition components are `'use client'`.
   - **`tokens.ts` was deleted.** Tailwind v4 `@theme` in `packages/ui/src/styles/globals.css` is the source of truth. Do not reference a `tokens` accessor anywhere.
   - **`cn`** from `@void/ui` (clsx + tailwind-merge).

8. **Versions installed (post-Lot F).** TypeScript ^6.0.3, Vitest ^4.1.5, @vitest/coverage-v8 ^4.1.5, @t3-oss/env-nextjs ^0.13.11, drizzle-orm ^0.45.0, drizzle-kit ^0.31.0, postgres ^3.4.0, better-auth ^1.6.0, @better-auth/drizzle-adapter ^1.6.0, react-hook-form ^7.75.0, @hookform/resolvers ^5.2.2, class-variance-authority ^0.7.1, clsx ^2.1.1, tailwind-merge ^3.5.0, lucide-react ^1.14.0, @radix-ui/react-avatar ^1.1.11, @radix-ui/react-slot ^1.2.4, @radix-ui/react-label ^2.1.8, next-themes ^0.4.6, sonner ^2.0.7, @testing-library/react ^16.0.0, @testing-library/user-event ^14.6.1, @testing-library/jest-dom ^6.9.1, jsdom ^25.0.0, pino ^9.5.0, pino-pretty ^11.3.0, zod ^3.23.0. Reference these when writing `apps/web/package.json` so the lockfile stays consistent.

9. **`packages/<name>/vitest.config.ts` shape.** Mirror `packages/auth/vitest.config.ts` (single `import { baseConfig } from '@void/config/vitest.base'; export default baseConfig`) UNLESS the package needs jsdom (`apps/web`). The base already sets `passWithNoTests: true` (ADR 14), so do NOT add `--passWithNoTests` per-package.

10. **`pino` is the logger** (ADR 22). For Phase C, no manual logger plumbing required; the dev-mode magic link handler in `@void/auth` already logs through pino. Just be aware that the dev console output is JSON-pretty rather than raw text when grepping E2E logs.

---

## Phase A + B learnings inherited

Read `docs/superpowers/plans/2026-05-07-phase-a-foundation.md` "Phase A learnings inherited" section AND `docs/superpowers/plans/2026-05-07-phase-b-backbone-packages.md` for full context. Critical reminders:

1. Bun at `/opt/homebrew/bin/bun` (in PATH).
2. Biome 2.4.14 schema URL.
3. Bun lockfile is `bun.lock`.
4. Lefthook 2.x uses `jobs:` syntax.
5. gitleaks 8.x: `gitleaks git --staged`.
6. TS strict + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`. Bracket access required: `process.env['X']`, `env['X']`. Use `import type { Foo }` and `export type { Foo }` (Biome `useImportType` / `useExportType` are errors).
7. Biome `useExportType` and `useImportType` are errors.
8. knip ignoreDependencies pattern for staged-but-not-yet-consumed deps.
9. Hooks active on every commit; never bypass.
10. Conventional commits, no em dashes, no emojis, single quotes, 2-space indent, line width 100.
11. Read official docs FIRST for any tool. Next 16 + React 19 APIs may have evolved since the plan was drafted.
12. All work on `main` branch; tag at end of phase: `git tag phase-c-complete && git push --tags`.

---

# Section 1: apps/web bootstrap (Tasks 1-8)

### Task C1: apps/web package skeleton

**Files:** Create `apps/web/package.json`

```json
{
  "name": "@void/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  },
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@void/auth": "workspace:*",
    "@void/core": "workspace:*",
    "@void/db": "workspace:*",
    "@void/ui": "workspace:*",
    "next": "^16.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.75.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@void/config": "workspace:*",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.3.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

NOTE: Versions above match the post-Phase-B-audit lockfile (Lot F). Verify Next 16.2 / React 19 / Playwright 1.48 are still the recommended pair before installing; bump in lockstep with the rest of the monorepo if newer minors are available. `react-hook-form` and `@hookform/resolvers` are needed because the Form composition (ADR 20) is consumed directly in Tasks C10-C14.

- [ ] Install: `bun install`
- [ ] Add to knip.json with appropriate apps/web entry (default in current knip.json already covers apps/*).
- [ ] Verify `node_modules/@void/web` symlink exists.
- [ ] Commit: `chore(web): scaffold apps/web Next.js app skeleton`

### Task C2: Next.js config + tsconfig

**Files:**
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next-env.d.ts` (auto-generated by Next on first dev/build, but prepare placeholder)

- [ ] **Create `apps/web/tsconfig.json`**

```json
{
  "extends": "@void/config/tsconfig.next.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "next.config.ts"],
  "exclude": ["node_modules", ".next", "tests/**", "**/*.test.ts", "**/*.test.tsx"]
}
```

- [ ] **Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';
import { defaultSecurityHeaders } from '@void/core/security-headers';

const config: NextConfig = {
  experimental: {
    cacheComponents: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: defaultSecurityHeaders(),
      },
    ];
  },
  transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/ui'],
};

export default config;
```

NOTE: Verify the `experimental.cacheComponents` flag against current Next 16 docs. The flag may have been promoted to stable or renamed.

- [ ] Commit: `chore(web): configure Next.js with security headers and Cache Components`

### Task C3: Tailwind v4 setup at app level

**Files:**
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/globals.css`

- [ ] **Read Tailwind v4 + Next.js integration docs**

Reference: `https://tailwindcss.com/docs/installation/framework-guides/nextjs`. Confirm the postcss plugin (likely `@tailwindcss/postcss`).

- [ ] **Create `apps/web/postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Add `@tailwindcss/postcss` as dev dep**

```
cd apps/web && bun add -D @tailwindcss/postcss && cd ../..
```

- [ ] **Create `apps/web/src/app/globals.css`**

```css
@import "@void/ui/styles/globals.css";
```

- [ ] Commit: `feat(web): wire Tailwind v4 via @void/ui design tokens`

### Task C4: instrumentation.ts (opt-in modules entry point)

**Files:** Create `apps/web/src/instrumentation.ts`

```ts
export async function register() {
  // Opt-in observability and analytics modules register here.
  // Each conditional dynamic import keeps the module out of the bundle when its
  // env var is not set at build time.

  if (process.env['SENTRY_DSN']) {
    // Phase D installs @void/sentry and uncomments this:
    // const { register: registerSentry } = await import('@void/sentry/server');
    // await registerSentry();
  }

  // PostHog client-side init lives in a Client Component, not here.
  // See @void/posthog README in Phase D.
}
```

- [ ] Commit: `feat(web): add instrumentation entry for opt-in modules (Sentry stub)`

### Task C5: Better-Auth route handler

**Files:** Create `apps/web/src/app/api/auth/[...all]/route.ts`

- [ ] **Read Better-Auth Next.js handler docs**

Reference: `https://www.better-auth.com/docs/integrations/next`. Confirm the helper export (e.g. `toNextJsHandler`).

- [ ] **Create the route handler**

```ts
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@void/auth/repository';

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] Verify build does not error on this file. Note: `@void/auth/repository` is the subpath export of `packages/auth`; the route handler is the only place that should import `auth` directly. Everything else uses the public surface (`@void/auth`) for `getCurrentUser` / `requireAuth` / `defineAction`. ADR 15 — `@void/auth` opts out of `.d.ts` declaration emit, so type resolution flows through TS source automatically.
- [ ] Commit: `feat(web): wire Better-Auth route handler at /api/auth/[...all]`

### Task C6: Root layout

**Files:** Create `apps/web/src/app/layout.tsx`

The root layout mounts `<ThemeProvider>` (next-themes wrapper, ADR 19) and `<Toaster>` (sonner, ADR not — see commit `5fd22c7`) ONCE for the whole app. Both are imported from `@void/ui`. Adding `suppressHydrationWarning` on `<html>` is required by next-themes to avoid the class-based theme attribute mismatching the SSR output on first paint.

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider, Toaster } from '@void/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Void Factory App',
  description: 'Built with the Void Factory starter',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] Commit: `feat(web): add root layout with theme provider and toaster`

### Task C7: Middleware (session refresh + locale stub)

**Files:** Create `apps/web/src/middleware.ts`

- [ ] **Read Next 16 middleware (proxy) docs**

Reference: `https://nextjs.org/docs/app/api-reference/file-conventions/middleware`. Confirm whether middleware should be at `src/middleware.ts` and matchers config.

- [ ] **Create middleware.ts**

```ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_request: NextRequest) {
  // Session refresh / rate-limit / locale detection slots.
  // Phase D modules (rate-limit-upstash) plug in here.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] Commit: `feat(web): add middleware with matcher excluding auth API and static assets`

### Task C8: Home page

**Files:** Create `apps/web/src/app/page.tsx`

- [ ] **Read Next 16 metadata + RSC docs** to confirm the canonical home page structure.

- [ ] **Create the home page**

This is a pure server component (no `'use client'`): `Card`, `CardHeader`, `CardTitle`, `CardContent` are all server-friendly per ADR 16. `Button asChild` (ADR 18, via Radix Slot) lets `next/link` provide the anchor element directly so we get a real `<a href>` instead of a `<button>` wrapped in an `<a>`.

```tsx
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@void/ui';
import { getCurrentUser } from '@void/auth';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Void Factory App</h1>
        <p className="text-muted-foreground">Production-grade Next.js 16 starter.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{user ? `Welcome back, ${user.email}` : 'Get started'}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Run `bun run dev` and verify the home page renders at http://localhost:3000.
- [ ] Commit: `feat(web): add home page with auth-aware CTA`

---

# Section 2: Auth pages (Tasks 9-15)

### Task C9: actions/auth.actions.ts

**Files:** Create `apps/web/src/actions/auth.actions.ts`

CRITICAL: the server-side `signIn` namespace was REMOVED from `@void/auth` in the post-audit (cookie passthrough was broken; commit `2dca9b3`). All sign-in / sign-up / magic-link flows MUST go through the BROWSER client (`authClient.signIn.email`, `authClient.signUp.email`, `authClient.signIn.magicLink`, `authClient.signIn.social`) directly from a `'use client'` component — see Tasks C10-C14.

The only Server Action this app needs at `apps/web/src/actions/auth.actions.ts` is `signOutAction`. (If a future flow needs server-side credential redemption, add a single typed helper deliberately rather than re-exposing `auth.api.signIn*`.)

```ts
'use server';

import { redirect } from 'next/navigation';
import { signOut } from '@void/auth';

export async function signOutAction() {
  await signOut();
  redirect('/');
}
```

The `defineAction` and `defineFormAction` factories from `@void/auth` (ADR 21) ARE used elsewhere in `apps/web/src/actions/` — for example, in Tasks C24 (`UserProfileCard.actions.ts` for `updateProfileAction`) and any future domain action. Their canonical shape:

```ts
'use server';

import { z } from 'zod';
import { defineFormAction } from '@void/auth';

export const exampleAction = defineFormAction({
  schema: z.object({ name: z.string().min(1) }),
  auth: 'required',
  handler: async (input, ctx) => {
    // ctx.user is typed { id: string; role: string }
    return { name: input.name, by: ctx.user.id };
  },
});
```

Pair with React 19 `useActionState` on the client. Returns `{ ok: true, data }` or `{ ok: false, fieldErrors, formError }` — never throws for validation or `AppError` (incl. `UnauthorizedError`, `ForbiddenError`, `RateLimitError`); only re-throws `NEXT_REDIRECT` and unexpected errors.

- [ ] Commit: `feat(web): add signOut Server Action`

### Task C10: Sign-in page

**Files:** Create `apps/web/src/app/(auth)/sign-in/page.tsx`

- [ ] **Read RHF + Form composition docs**: ADR 20 in `docs/DECISIONS.md` and `packages/ui/src/Form/Form.tsx` for the canonical 7-slot pattern (`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`). All Form composition components are `'use client'`.

- [ ] **Create the sign-in page**

The page is `'use client'` because it uses `useForm` (RHF) and the Form composition. Sign-in goes through `authClient.signIn.email` (browser flow); the server-side `signIn` namespace was removed in the post-audit. Errors from the client return `{ data, error }` (Better-Auth convention) — render the error via `toast.error` from `@void/ui`. Redirect on success via `router.push('/dashboard')` (NOT `window.location.href` — `router.push` keeps client navigation cache warm).

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { authClient } from '@void/auth';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@void/ui';

const signInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const router = useRouter();
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInValues) {
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      callbackURL: '/dashboard',
    });
    if (error) {
      toast.error(error.message ?? 'Sign in failed');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </Form>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() =>
              authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })
            }
          >
            Continue with Google
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            No account?{' '}
            <Link href="/sign-up" className="underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Commit: `feat(web): add sign-in page with RHF + zod + authClient`

### Task C11: Sign-up page

**Files:** Create `apps/web/src/app/(auth)/sign-up/page.tsx`

Mirror the sign-in page structure (RHF + zodResolver + Form composition + `toast` for errors + `router.push` on success). Use `authClient.signUp.email({ email, password, name, callbackURL: '/dashboard' })` and add a `name` FormField. Include the Google button (`authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })`).

- [ ] Commit: `feat(web): add sign-up page with RHF + zod + authClient`

### Task C12: Reset password page

**Files:** Create `apps/web/src/app/(auth)/reset-password/page.tsx`

Client component, RHF + Form composition. Single email field. Submit calls `authClient.forgetPassword({ email, redirectTo: '/reset-password/confirm' })`. Toast success ("Check your email") on `{ error: null }`, toast error otherwise.

- [ ] Read Better-Auth's password reset flow docs (`https://www.better-auth.com/docs/concepts/email-password`) and confirm the helper name is `forgetPassword` in v1.6.x.
- [ ] Commit: `feat(web): add reset-password page`

### Task C13: Verify email page

**Files:** Create `apps/web/src/app/(auth)/verify-email/page.tsx`

Server component. Reads the `token` query param via `searchParams`, calls Better-Auth's verify endpoint via `authClient.verifyEmail({ query: { token } })` from a child `'use client'` component (the verification call needs to run on mount). Display success / failure with `toast` and a `Button asChild` link back to `/sign-in`.

- [ ] Commit: `feat(web): add verify-email page`

### Task C14: Magic link request page

**Files:** Create `apps/web/src/app/(auth)/magic-link/page.tsx`

Client component, RHF + Form composition. Single email field. Submit calls `authClient.signIn.magicLink({ email, callbackURL: '/dashboard' })`. Toast success ("Check your email") on `{ error: null }`, toast error otherwise. In dev, the magic link is logged via `pino` from `@void/auth`'s `sendMagicLink` stub (ADR 22) — the E2E test in Task C32 reads the dev server stdout for the URL.

- [ ] Commit: `feat(web): add magic-link request page`

### Task C15: Sign-out trigger (header dropdown)

**Files:** Create `apps/web/src/components/UserMenu/`

Components canonical layout (mirrors the 5-file service convention from ADR 8 adapted to a UI component — see also Task C23):
```
UserMenu/
├── UserMenu.tsx           # client component, dropdown with Sign out button
├── UserMenu.helper.ts     # extracts label / initials (re-uses computeInitials from @void/auth)
├── UserMenu.helper.test.ts
├── UserMenu.types.ts
└── index.ts
```

The Sign out button calls `signOutAction()` from `@/actions/auth.actions`. Uses `useSession` from `@void/auth` (re-exported from `authClient`) to read current state in the browser. Render the user's avatar via `<Avatar src={user.image} fallback={computeInitials(user)} />` from `@void/ui` — `computeInitials` is already exported from `@void/auth` (no need to re-implement). Wrap the trigger in `<Button asChild variant="ghost">` to render an accessible trigger element.

- [ ] Commit: `feat(web): add UserMenu component with sign-out button`

---

# Section 3: Protected pages (Tasks 16-19)

### Task C16: Dashboard page (auth required)

**Files:** Create `apps/web/src/app/dashboard/page.tsx`

```tsx
import { requireAuth } from '@void/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@void/ui';

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p>
            <strong>Email:</strong> {user.email}
          </p>
          <p>
            <strong>Name:</strong> {user.name ?? 'Not set'}
          </p>
          <p>
            <strong>Role:</strong> {user.role}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

`requireAuth()` throws `UnauthorizedError` (401) when no session is present. Next 16's default error handling renders the `error.tsx` boundary; for a redirect to `/sign-in` instead, wrap the call site:

```ts
const user = await getCurrentUser();
if (!user) redirect('/sign-in?next=/dashboard');
```

Either pattern is acceptable for the starter; document the choice in `docs/DECISIONS.md` if the executor picks the redirect flavour.

- [ ] Commit: `feat(web): add dashboard page with requireAuth guard`

### Task C17: Admin page (role required)

**Files:** Create `apps/web/src/app/admin/page.tsx`

`@void/db` exposes `getDb()` (lazy memoized singleton, ADR 12), NOT a `db` const. Call it once per request handler. The `users` table has a `deletedAt` soft-delete column; filter `WHERE deleted_at IS NULL` so this admin listing never surfaces tombstoned rows.

```tsx
import { isNull } from 'drizzle-orm';
import { requireRole } from '@void/auth';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@void/ui';

export default async function AdminPage() {
  await requireRole('admin');
  const db = getDb();
  const allUsers = await db.select().from(users).where(isNull(users.deletedAt)).limit(50);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-semibold">Admin</h1>
      <Card>
        <CardHeader>
          <CardTitle>Users ({allUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map((u) => (
                <tr key={u.id} className="border-b border-border">
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2 text-muted-foreground">
                    {u.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] Commit: `feat(web): add admin page listing users with requireRole guard`

### Task C18: 404 + not-found pages

**Files:**
- Create: `apps/web/src/app/not-found.tsx`

- [ ] Standard Next 16 not-found component using @void/ui.
- [ ] Commit: `feat(web): add not-found page`

### Task C19: Error boundary

**Files:**
- Create: `apps/web/src/app/error.tsx`

```tsx
'use client';

import { useEffect } from 'react';
import { Button } from '@void/ui';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Future: forward to @void/sentry when installed (Phase D module).
    // pino is server-only (ADR 22), so the browser-side error path stays on
    // console.error until the Sentry module is wired.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center space-y-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
```

NOTE: this `console.error` is acceptable in a `'use client'` error boundary (Biome may flag; if so, add an inline disable comment with justification). The proper logging path is a Sentry forward, added in Phase D.

- [ ] Commit: `feat(web): add error boundary with manual reset`

---

# Section 4: Vitest unit tests at app level (Tasks 20-22)

### Task C20: Vitest config for jsdom

**Files:** Create `apps/web/vitest.config.ts`

The `baseConfig` from `@void/config/vitest.base` already sets `passWithNoTests: true` (ADR 14); do not add `--passWithNoTests` to scripts. `apps/web` needs jsdom + Testing Library setup, so we override `environment` and `setupFiles`.

```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from '@void/config/vitest.base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./tests/vitest.setup.ts'],
    },
    resolve: {
      alias: { '@': './src' },
    },
  }),
);
```

- [ ] Create `apps/web/tests/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] `@testing-library/jest-dom` is already declared in the C1 `package.json` snippet — `bun install` from the workspace root is sufficient. No per-app `bun add -D` step needed.
- [ ] Commit: `chore(web): configure Vitest for jsdom + Testing Library`

### Task C21: Test for UserMenu helper

Already covered in Task C15. Verify tests run from app via `cd apps/web && bunx vitest run`.

### Task C22: Test for one Server Action (mocked auth)

**Files:** Create `apps/web/src/actions/auth.actions.test.ts`

Since `signInWithEmailAction` was removed (Task C9), test `signOutAction` instead, OR test the canonical `defineFormAction`-based action introduced by Task C24 (`UserProfileCard.actions.ts`). Mock `@void/auth` (`vi.mock('@void/auth', ...)`) to stub `signOut` / `getCurrentUser`, and verify:
1. `signOutAction` calls the mocked `signOut` once and triggers a `redirect('/')` (catch the `NEXT_REDIRECT` digest).
2. The example `defineFormAction`-wrapped action returns `{ ok: false, fieldErrors }` on schema failure and `{ ok: true, data }` on success.

- [ ] Commit: `test(web): cover signOutAction and a defineFormAction with mocked @void/auth`

---

# Section 5: Canonical examples (Tasks 23-26)

### Task C23: SimpleButton example

**Files:** `apps/web/src/components/_examples/SimpleButton/{SimpleButton.tsx,SimpleButton.helper.ts,SimpleButton.helper.test.ts,SimpleButton.types.ts,index.ts}`

Demonstrates the canonical layout for a presentational component: pure helper extracted, helper unit-tested without React rendering, types isolated, barrel exposes only the component + types.

- [ ] Commit: `feat(web): add SimpleButton canonical example`

### Task C24: UserProfileCard example (consumes service)

**Files:** `apps/web/src/components/_examples/UserProfileCard/{UserProfileCard.tsx,UserProfileCard.helper.ts,UserProfileCard.helper.test.ts,UserProfileCard.types.ts,UserProfileCard.actions.ts,index.ts}`

Component consumes `getCurrentUser` from `@void/auth`. Includes an inline edit form using `useActionState` + `useOptimistic`. The Server Action `updateProfileAction` lives next to it via the `apps/web` pattern (ADR 3) and uses `defineFormAction` from `@void/auth` (ADR 21):

```ts
// UserProfileCard.actions.ts
'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineFormAction } from '@void/auth';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';

export const updateProfileAction = defineFormAction({
  schema: z.object({ name: z.string().min(1, 'Name is required').max(100) }),
  auth: 'required',
  handler: async (input, ctx) => {
    const db = getDb();
    await db.update(users).set({ name: input.name }).where(eq(users.id, ctx.user.id));
    return { name: input.name };
  },
});
```

The component uses RHF + Form composition (ADR 20) for the edit form OR React 19's `useActionState` for progressive enhancement — pick ONE pattern per example so this stays a clean reference. The recommendation: use `useActionState` + the bare Form composition (no RHF) for this example, since the point is to demonstrate the React 19 progressive-enhancement path and `defineFormAction`'s `ActionState` shape end-to-end. Tasks C10-C14 already demonstrate the RHF + zodResolver path.

Helpers cover: `formatJoinDate`, `computeStatus(user)`, `validateNameInput(input)`.

Demonstrates: component that uses a service, `defineFormAction` with `auth: 'required'`, optimistic UI via `useOptimistic` for the update mutation, helper extraction, Zod schema for the received user shape, soft-delete-safe DB write through `getDb()`.

- [ ] Commit: `feat(web): add UserProfileCard canonical example with useActionState + useOptimistic`

### Task C25: Document the canonical examples

**Files:** Create `apps/web/src/components/_examples/README.md`

Brief readme explaining the two examples, what each demonstrates, and why a fresh AI assistant or new contributor should read them before writing components in the app.

- [ ] Commit: `docs(web): add canonical examples README`

### Task C26: Confirm @void/auth services as canonical service example

The plan in `context.md` says `@void/auth` itself serves as the canonical service. Add a one-paragraph note to `docs/PATTERNS.md` (which will be authored in Phase D Section "Documentation"). For now, ensure `packages/auth/README.md` says "this package is the canonical service example for the starter; mirror its file layout when creating new services."

- [ ] Modify `packages/auth/README.md` to add the canonical-example note.
- [ ] Commit: `docs(auth): mark @void/auth as the canonical service example`

---

# Section 6: Playwright E2E (Tasks 27-32)

### Task C27: Playwright install + config

```
cd apps/web && bunx playwright install --with-deps && cd ../..
```

- [ ] **Create `apps/web/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
```

- [ ] Commit: `chore(web): configure Playwright for E2E with chromium`

### Task C28: Smoke test (homepage loads)

**Files:** Create `apps/web/tests/e2e/smoke.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /void factory/i })).toBeVisible();
});

test('dashboard redirects to sign-in when logged out', async ({ page }) => {
  const response = await page.goto('/dashboard');
  // Better-Auth's requireAuth throws UnauthorizedError; default Next behavior
  // depends on the app; verify the actual redirect target after running once.
  expect(response?.status()).toBeGreaterThanOrEqual(200);
  // Adjust the assertion once the exact redirect behavior is observed.
});
```

- [ ] Run: `cd apps/web && bun run test:e2e && cd ../..`
- [ ] Commit: `test(web): add E2E smoke tests for homepage and unauth dashboard`

### Task C29: Auth E2E - sign up flow

**Files:** `apps/web/tests/e2e/auth-signup.spec.ts`

Test:
1. Navigate to /sign-up
2. Fill name, email, password
3. Submit
4. Expect verification message OR auto-login (depends on `requireEmailVerification` config)
5. Clean up: delete the test user from DB after

NOTE: requires DATABASE_URL and a live Better-Auth setup. The teardown uses `getDb()` from `@void/db`:

```ts
import { eq } from 'drizzle-orm';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';

const db = getDb();
await db.delete(users).where(eq(users.email, testEmail));
```

(Tests run in Node, not in a Next request scope — `getDb()` works fine outside a request.)

- [ ] Commit: `test(web): E2E sign up flow`

### Task C30: Auth E2E - sign in / sign out

**Files:** `apps/web/tests/e2e/auth-signin.spec.ts`

1. Programmatically create a user via `auth.api.signUpEmail` in `beforeAll` (import `auth` from `@void/auth/repository`).
2. Test: navigate /sign-in, fill credentials, submit, verify redirect to /dashboard.
3. Test: from dashboard, click sign-out, verify back at home with no session.
4. Teardown: `getDb().delete(users).where(eq(users.email, testEmail))`.

- [ ] Commit: `test(web): E2E sign in and sign out`

### Task C31: Auth E2E - role guard

**Files:** `apps/web/tests/e2e/auth-role.spec.ts`

1. Create a user with role 'user'.
2. Sign in.
3. Navigate to /admin - expect 403 or redirect.
4. Promote user to admin via `getDb().update(users).set({ role: 'admin' }).where(eq(users.email, testEmail))`.
5. Refresh /admin - expect to see the users list.

- [ ] Commit: `test(web): E2E role guard for /admin page`

### Task C32: Auth E2E - magic link (dev console capture)

In dev, the magic link is logged via the `@void/core` `pino` logger (ADR 22). pino emits JSON lines (or pretty lines via `pino-pretty` when `NODE_ENV !== 'production'`); the test reads the dev server stdout for the magic link URL and navigates to it. This is acceptable for the starter; production will replace the sender via `_modules/email-resend`.

- [ ] Commit: `test(web): E2E magic link via dev console capture`

---

# Section 7: Phase C validation (Tasks 33-35)

### Task C33: full pipeline check

```
bun run lint
bun run type-check
bun run test
bun run build  # apps/web should build successfully
bunx knip --no-progress
bunx gitleaks detect --no-git --redact
```

All six must pass. Do not proceed if any fail.

### Task C34: dev server end-to-end manual smoke

```
vercel env pull .env.local
# .env.local now contains DATABASE_URL (Neon dev branch) and any other Vercel-injected vars.
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export BETTER_AUTH_URL=http://localhost:3000
export NEXT_PUBLIC_APP_URL=http://localhost:3000
# (Google OAuth is optional for local smoke; the email/password and magic link paths work without it)
bun run dev
```

In a browser:
1. Visit http://localhost:3000 - home page renders, dark mode toggle (if added) flips palette via `.dark` class on `<html>` (ADR 19)
2. Click Sign up - fill form - submit
3. Read dev console for the magic link / email verify URL (pino-pretty output, ADR 22) - paste it in browser
4. Sign in works
5. /dashboard shows the user (with `role`, `name`, `email` from `sessionUserSchema`)
6. /admin shows 403 or the admin guard
7. Promote the user to admin in the DB (via drizzle-kit studio):
   ```
   cd packages/db && bunx drizzle-kit studio
   ```
   Open http://local.drizzle.studio - find the user in the `users` table (PLURAL) - change role to 'admin' - save. Note: the table name is `users`, NOT `user`; Better-Auth maps the singular model name via `modelName` in the adapter config (Phase B Task B13).
8. Refresh /admin - the user listing renders
9. Sign out - back to home

If anything fails, fix before tagging.

### Task C35: tag and push

```
git tag phase-c-complete
git push --tags
```

---

## Phase C done. Next steps:

- Phase D (`docs/superpowers/plans/2026-05-07-phase-d-modules-docs-ci-polish.md`) covers all opt-in modules (Sentry, PostHog, Auth-Clerk, stubs), the full `docs/*.md` set, GitHub Actions CI, VS Code workspace settings, README expansion, and final validation gates.
- Open Phase D in a fresh Claude Code session.
- Update `docs/DECISIONS.md` if any non-obvious decision was taken (e.g., choice of redirect strategy when Server Actions throw, choice of how to capture magic link in E2E).
