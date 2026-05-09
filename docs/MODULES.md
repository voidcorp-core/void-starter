# Modules

This document is the operational guide to the `_modules/*` catalogue: the two activation patterns (real workspace package vs copy-paste scaffold), how to add a new module, how to remove one cleanly, and how to test both kinds. The catalogue itself lives in `_modules/README.md`. The architectural rationale (why opt-in modules exist, why activation is build-time and not runtime) lives in `docs/DECISIONS.md` entries 04 and 07. The day-to-day patterns live in `docs/PATTERNS.md`.

Every rule here reflects what already ships in the repo. If your code disagrees, the doc is the source of truth -- update the code, or open an ADR to change the rule.

---

## 1. Intent and rules

`_modules/*` is the per-MVP opt-in surface. Every module is either:

- **Pattern A: a real workspace package** (`@void/<name>`) with `src/`, type-checked and tested, activated at build time when its env vars are present.
- **Pattern B: a copy-paste scaffold** (README plus `package.json`, no real `src/`) that documents the integration recipe a developer or AI agent executes against the consuming app.

Three rules govern every module:

- **No tier-2 module in `packages/`.** `packages/*` is the always-on substrate. `_modules/*` is the per-MVP opt-in. The split is load-bearing for the dependency graph (see `docs/ARCHITECTURE.md` section 2).
- **Tier-2 modules depend on `@void/core` at most.** They do not depend on `@void/auth`, `@void/db`, or `@void/ui`. Cross-module dependencies are forbidden.
- **Build-time activation only.** No runtime feature flags, no plugin loaders, no DI containers. Env var presence at build time is the activation signal.

For the catalogue, see `_modules/README.md`.

---

## 2. Catalogue summary

The full catalogue (with env vars, install steps, removal, upstream docs) lives in `_modules/README.md`. This summary table is for quick orientation only; do not duplicate the full README here.

| Module | Pattern | State | Activation trigger |
|---|---|---|---|
| `@void/sentry` | A | wired into `apps/web` | `SENTRY_DSN` plus `NEXT_PUBLIC_SENTRY_DSN` |
| `@void/posthog` | A | wired into `apps/web` | `NEXT_PUBLIC_POSTHOG_KEY` |
| `@void/auth-clerk` | A | scaffold (alternative repository) | manual swap, see `docs/AUTH.md` section 6 |
| `@void/payment-stripe` | A or B | placeholder | `STRIPE_SECRET_KEY` plus `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| `@void/email-resend` | A or B | placeholder | `RESEND_API_KEY` plus `EMAIL_FROM` |
| `@void/cms-payload` | B | placeholder | `PAYLOAD_SECRET` plus `PAYLOAD_DATABASE_URI` |
| `@void/audit-log` | B | placeholder | always-on once mounted |
| `@void/cookie-consent` | B | placeholder | always-on once mounted (cookie-driven state) |
| `@void/rate-limit-upstash` | A or B | placeholder | `UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN` |
| `@void/i18n-next-intl` | B | placeholder | `NEXT_PUBLIC_DEFAULT_LOCALE` plus `NEXT_PUBLIC_SUPPORTED_LOCALES` |
| `@void/db-self-hosted-postgres` | B | placeholder | `DATABASE_URL` repointed |

For the canonical activation example, read `_modules/observability-sentry/README.md` (Pattern A) and `_modules/payment-stripe/README.md` (Pattern B).

---

## 3. Activation Pattern A -- real workspace package

The module ships as `_modules/<name>/` with `package.json`, `src/`, `tsconfig.json`, `vitest.config.ts`. It is type-checked and tested by Turborepo and consumed via `"@void/<name>": "workspace:*"`.

Steps to activate in any consuming app inside the monorepo:

1. **Add the workspace dep.** Edit `apps/<app>/package.json`:

   ```json
   "dependencies": {
     "@void/<name>": "workspace:*"
   }
   ```

2. **Add the env vars.** Set `NEXT_PUBLIC_*` for client-inlined values (Turbopack inlines them at build time so the disabled branch dead-code-eliminates), set server vars for server-side activation. In Vercel, mark secrets as the "Sensitive" type per `docs/SECURITY.md` section 4.

3. **Wire the module per its README.** Each Pattern A module documents its integration: `instrumentation.ts` hook for server-side activation, `instrumentation-client.ts` for client-side, layout wrap for provider-style modules, `next.config.ts` rewrites for proxy-style modules.

4. **Add the package to `transpilePackages`.** Edit `apps/<app>/next.config.ts`:

   ```ts
   transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/<name>', '@void/posthog', '@void/sentry', '@void/ui'],
   ```

   Keep the list alphabetical so reviewers can spot drift.

5. **Verify the activation.** Run `bun install && bun run build`. The build must pass with the env vars set and with them unset (the absent path is the dead-code-eliminated branch).

The canonical example is `_modules/observability-sentry/README.md` (Sentry server / edge / client activation across `instrumentation.ts`, `instrumentation-client.ts`, and `withSentryConfig` in `next.config.ts`). The PostHog README is the second canonical example.

DCE caveat: Turbopack does not statically eliminate gated branches that reference `process.env['NEXT_PUBLIC_*']`, so SDK chunks may exist on disk under `.next/static/chunks/`. They are referenced only from the gated dynamic import and never fetched by users at runtime when the env var is unset. Each Pattern A module documents this in its README.

---

## 4. Activation Pattern B -- copy-paste scaffold

The module is README-only (or README plus a stub `package.json` for catalogue presence). The integration steps live as a recipe in the README, designed to be executed against the current `apps/web` source.

Steps to activate:

1. **Read the module's README.** The recipe describes which files to create, which env vars to set, which `next.config.ts` entries to add, and which call sites in `apps/web/src/` to update.

2. **Copy the documented files.** Each Pattern B module specifies the file paths: `apps/web/src/lib/<module>.ts`, `apps/web/src/components/<Module>.tsx`, etc. The recipe references the actual locations.

3. **Adapt to the MVP.** Brand voice, layout, copy, and any project-specific business logic live in the consuming app, not in the module. The recipe is a starting point; the MVP makes it production-shaped.

4. **Commit the integration.** Conventional commits per `docs/PATTERNS.md` section 7. The integration files are now part of the consuming app's source.

The canonical example is `_modules/payment-stripe/README.md` (Stripe checkout, customer portal, webhook handler, Drizzle table for `stripe_customers`). `_modules/cookie-consent/README.md` and `_modules/audit-log/README.md` are the two other representative examples.

A Pattern B module can be promoted to Pattern A later (typical path: a second app needs the same capability, the cost-of-promotion is small per ADR 07). Until that happens, the recipe is the artifact.

---

## 5. How to write a new module

Three decisions, one mirror, one catalogue update.

### Step 1 -- decide the pattern

- **Pattern A** if (a) the module ships shared code that two or more apps would reuse, OR (b) the module needs to be type-checked and tested at the workspace level.
- **Pattern B** if the integration is fundamentally project-specific (banner copy, brand voice, business logic) or is a one-off addition to `apps/web`.

When in doubt, start with Pattern B. Promote later if a second app needs the same code.

### Step 2 -- mirror the canonical structure

For Pattern A, mirror `_modules/observability-sentry/`:

```
_modules/<name>/
  src/
    <entry>.ts                # server-only entries carry `import 'server-only'`
    <entry>.test.ts           # smoke test that locks env-var gating
    index.ts                  # public barrel
  package.json                # name: @void/<scope>, exports per subpath
  tsconfig.json               # extends @void/config/tsconfig.lib.json
  vitest.config.ts            # extends @void/config/vitest.base.ts
  README.md                   # required: status, scope, env vars, install, removal
```

The package name is `@void/<scope>` where `<scope>` is the capability (e.g. `@void/sentry`, `@void/posthog`). The directory name under `_modules/` may be different and more descriptive (e.g. `observability-sentry`, `analytics-posthog`).

For Pattern B, mirror `_modules/payment-stripe/`:

```
_modules/<name>/
  README.md                   # the integration recipe IS the implementation
```

The README is the artifact and the only file. Pattern B placeholders deliberately stay out of the workspace graph (no `package.json`, no `src/`, no `tsconfig.json`) per ADR 29 so knip, Turborepo, and Renovate do not generate noise for unused scaffolds. The README must include: status banner ("placeholder, README only"), scope, env vars table, install steps, integration points, upstream docs links, removal procedure.

### Step 3 -- update the catalogue and consuming apps

- **Update `_modules/README.md`.** Add the module under the appropriate section (real workspace package vs placeholder). Cross-link to the module's README.
- **Update `transpilePackages` in `apps/<app>/next.config.ts`** for any Pattern A module the app consumes. Keep alphabetical.
- **Update `_modules/<name>/package.json`** with the right `exports` map if the module exposes subpaths (`/server`, `/edge`, `/client`).
- **Add a smoke test that locks env-var gating** for Pattern A modules. The test asserts that the module short-circuits when its env var is unset and initializes when it is set. This is the contract that prevents accidental always-on activation.

The 11-module catalogue currently in `_modules/` is the reference. New modules ship in the same shape.

---

## 6. Module removal procedure

Removal is symmetric to activation. The principle: leave no dead env vars, no dead deps, no dead code paths.

### Pattern A removal

1. **Revert all wiring.** Remove the module's calls from `apps/<app>/src/instrumentation.ts`, `instrumentation-client.ts`, `app/layout.tsx`, `next.config.ts` rewrites, and any other integration points. Each Pattern A README documents its own integration sites; remove them in the same order.
2. **Drop the workspace dep.** Remove `"@void/<name>": "workspace:*"` from the consuming app's `package.json`. Remove from `transpilePackages` in `next.config.ts`.
3. **Optionally delete the module directory.** If the module is removed permanently across every app in the monorepo, delete `_modules/<name>/` and update `_modules/README.md` to drop the entry. If you might reuse it in another app, leave it in place as opt-in.
4. **Clean env vars.** Remove the module's env vars from Vercel (Production, Preview, Development environments), from `.env.local`, and from the consuming package's env validator (`@void/core/env` schema entries or `auth.repository.ts` `createAppEnv` block).

### Pattern B removal

1. **Revert the copy-pasted code.** Each Pattern B README ships a "Removal" section listing the files the recipe added. Delete them.
2. **Revert the call sites.** Restore `apps/web/src/app/layout.tsx`, `apps/web/src/proxy.ts`, or wherever the recipe inserted hooks.
3. **Optionally delete the README scaffold.** If removed permanently, drop `_modules/<name>/` and the catalogue entry. If you might reuse the recipe later, leave it in place.
4. **Clean env vars.** Same as Pattern A.

Both: run `bun install && bun run lint && bun run type-check && bun run test && bun run build` after the removal. The build must pass with no broken imports and no dead env references.

---

## 7. Module testing strategy

Two tiers, scoped to what each pattern actually ships.

### Pattern A: smoke test the env-var gating

Real packages ship one or more smoke tests under `_modules/<name>/src/<entry>.test.ts` that lock the gating contract:

- The module is a no-op when the env var is unset (the SDK never initializes; calling the module's exported helpers either short-circuits or throws a documented "missing env" error from `@void/core/env`'s `required()`).
- The module initializes correctly when the env var is set (the SDK call fires; the public helpers return expected types).

The smoke test is the contract that prevents accidental always-on activation. It is the minimum every Pattern A module ships. Full integration tests (Sentry actually capturing an error, PostHog actually tracking an event) are MVP-specific and live in the consuming app's E2E suite, not in the module.

### Pattern B: no tests at the module level

Placeholder modules do not ship code, so they do not ship tests. The recipe lives in the README and is exercised by the consuming app once it adopts the recipe. Tests for the integration belong in the consuming app under its own conventions (`apps/web/tests/`, colocated component tests, etc.).

When a Pattern B module gets promoted to Pattern A, the smoke test ships with the promotion -- the gating contract becomes testable for the first time.

---

## Cross-references

- `_modules/README.md` -- the full catalogue (11 modules, env vars, install, upstream docs).
- `_modules/observability-sentry/README.md` -- canonical Pattern A example.
- `_modules/analytics-posthog/README.md` -- second canonical Pattern A example.
- `_modules/payment-stripe/README.md` -- canonical Pattern B example.
- `_modules/auth-clerk/README.md` -- alternative repository swap procedure (cross-linked from `docs/AUTH.md` section 6).
- `docs/DECISIONS.md` -- entry 02 (Better-Auth default vs Clerk opt-in), entry 04 (build-time activation), entry 07 (no micro-packages), entry 11 (Neon DB).
- `docs/ARCHITECTURE.md` -- topology, the tier 1 vs tier 2 split, `transpilePackages` and `instrumentation.ts` plug points.
- `docs/PATTERNS.md` -- file naming, service layout, code style commitments shared between packages and modules.
- `docs/SECURITY.md` -- env var management, "Sensitive" type, secret rotation.
- `docs/AUTH.md` -- the Clerk swap procedure as the canonical alternative-repository case.
