# Architecture Decisions

This file is an ADR-lite log of non-obvious architectural choices made for this starter. Each entry captures **what we decided, why, what we rejected, and when to revisit**.

## How to use this file

**Read it first** before challenging any architectural choice. The alternatives were already considered, often through several rounds of debate.

**Add to it** when you make a new decision where a credible alternative existed. Format below.

**Do not log** here:

- Implementation details (those go in `PATTERNS.md`)
- Security mappings (those go in `SECURITY.md`)
- Caching rules (those go in `CACHING.md`)
- Conventions or rules without an alternative considered

## Format

```
### NN. <Title>

- **Date:** YYYY-MM-DD
- **Decision:** what was chosen
- **Why:** the load-bearing reason in 1-3 sentences
- **Rejected alternatives:** what was considered and why it lost
- **When to revisit:** the condition under which this decision should be re-opened
```

---

### 01. Monorepo Turborepo + Bun workspaces from day 0

- **Date:** 2026-05-07
- **Decision:** The starter is a monorepo from the start: `apps/web/` plus `packages/{core,auth,db,ui,config}` plus `_modules/*`. Turborepo orchestrates, Bun handles workspaces.
- **Why:** Folpe's venture builder model ships ~24 MVPs/year. Some will need mobile (Expo), admin separate, marketing standalone. The setup cost is paid once for the starter; the optionality is permanent. Smaller scoped packages also give AI assistants cleaner context.
- **Rejected alternatives:**
  - Single Next.js app: simpler upfront, but migrating to multi-target later means a painful refactor of every MVP that grows
  - Nx: heavier, more opinionated, less aligned with Bun
  - pnpm workspaces: redundant since Bun handles workspaces natively
- **When to revisit:** Never, unless Bun workspaces or Turborepo undergo a major incompatibility with Next.js.

### 02. Better-Auth as default, Clerk as opt-in module

- **Date:** 2026-05-07
- **Decision:** `@repo/auth` ships Better-Auth (self-hosted, open source) wired with email/password + Google OAuth + magic link + roles. Clerk is available as an alternative via `_modules/auth-clerk/`.
- **Why:** Three non-negotiables for Folpe: data sovereignty (user data on his infrastructure), brand integrity (no vendor branding visible in MVPs), custom auth domain by default. The time cost (~60-80h/year of auth code maintenance over 24 MVPs) is accepted in exchange for control.
- **Rejected alternatives:**
  - Clerk default: best DX, free tier covers 10k MAU per project, but data lives at Clerk, branding visible in free tier, custom domain requires Pro plan
  - Auth.js (NextAuth v5): less feature-rich than Better-Auth, ergonomics issues with App Router
  - Lucia: deprecated in early 2025
  - WorkOS / Stytch: B2B-focused, overkill for B2C MVPs
- **When to revisit:** When an MVP requires SaaS B2B features at J1 (SSO, SCIM, advanced orgs) AND the data sovereignty trade-off is acceptable for that specific project. Switch to `_modules/auth-clerk` for that MVP only.

### 03. `.actions.ts` lives in apps, not in packages

- **Date:** 2026-05-07
- **Decision:** Server Actions ("use server" files) live in `apps/web/src/actions/`. They consume services from packages. They never live inside `packages/*`.
- **Why:** Server Actions carry Next.js-specific semantics (`"use server"`, `revalidatePath`, `redirect`, FormData handling). Putting them in shared packages would couple the package to Next.js, breaking reusability for future targets like Expo or Astro.
- **Rejected alternatives:**
  - Co-locate actions with services in packages: simpler import paths, but locks the package to Next.js
  - Single `@repo/actions` package: doesn't change the Next coupling, just centralizes the problem
- **When to revisit:** If the project decides to ship only Next.js apps forever and accepts the coupling. Currently no plan to do so.

### 04. Build-time module activation via env vars, not runtime

- **Date:** 2026-05-07
- **Decision:** Optional packages (Sentry, PostHog, etc.) are activated by env var presence at build time. Server-side via conditional dynamic imports in `instrumentation.ts`. Client-side via `NEXT_PUBLIC_*` vars enabling DCE. No runtime feature flag service.
- **Why:** This is the Next.js native pattern (`instrumentation.ts` was designed for it). It minimizes bundle size, reduces attack surface, and aligns with the Vercel deploy model where env changes trigger a 30-second redeploy. Runtime toggling has no real use case for Void Factory's profile (4-week MVPs that commit to a vendor at start).
- **Rejected alternatives:**
  - LaunchDarkly / GrowthBook / custom flag service: latency, vendor lock-in, complexity, real flagging not needed
  - Conditional package install (no `@repo/sentry` in package.json if unused): more friction than env var, requires `bun add` to enable
  - Always-on imports with empty implementations: wastes bundle size
- **When to revisit:** If a project legitimately needs runtime feature flags for A/B testing or multi-tenant feature gating. Then add a feature flag module, do not migrate the activation pattern.

### 05. Custom `defineAction()` wrapper instead of `next-safe-action`

- **Date:** 2026-05-07
- **Decision:** `@repo/core/server-action` ships a ~60-line custom wrapper exposing `defineAction({ schema, auth, handler })` covering Zod parse, auth check via `@repo/auth`, error normalization, and structured logging.
- **Why:** Folpe prefers fewer dependencies when quality and non-maintenance are not at stake. 60 lines of in-house code with full control over error serialization beats an external library that imposes its own format and update cycle. Aligns with the data sovereignty / brand integrity stance.
- **Rejected alternatives:**
  - `next-safe-action`: mature, typed, supports middlewares. But adds a dep with its own evolution, and forces its error format on the client.
  - No wrapper at all: 30 lines of boilerplate per action, divergence between contributors and AI assistants
- **When to revisit:** If the wrapper grows past 200 lines, or if a Server Actions standard emerges from React/Next that makes the wrapper redundant.

### 06. gstack stays out of the starter

- **Date:** 2026-05-07
- **Decision:** The starter does not depend on, integrate with, or duplicate any feature from gstack. Design brainstorming, multi-LLM comparison, QA, security audit, ship workflows are handled by gstack at the user level (`~/.claude/skills/gstack/`), operating on top of any starter-derived MVP.
- **Why:** Mixing the starter (runtime foundation) with gstack (meta-tooling) would create a dependency on an external tool, duplicate features (gstack already has `/design-shotgun`, `/cso`, `/qa`, `/ship`, etc.), and break the "starter works without gstack" property. Folpe explicitly requested the separation.
- **Rejected alternatives:**
  - In-starter design orchestration (multi-LLM comparison board, playground): would duplicate gstack and lock the starter to a workflow
  - In-starter security audit / QA primitives: gstack covers it better at user level
- **When to revisit:** If gstack disappears or becomes incompatible with Claude Code / Folpe's workflow. Then re-evaluate which capabilities must move into the starter.

### 07. No micro-packages

- **Date:** 2026-05-07
- **Decision:** A workspace package exists if and only if (a) it has a clear domain scope (auth, db, ui, core, config), OR (b) it will be consumed by 2+ apps. Forbidden: `@repo/utils`, `@repo/constants`, `@repo/hooks`, `@repo/types`, `@repo/helpers`.
- **Why:** Each package costs a `package.json`, a `tsconfig.json`, a build step, cross-package imports, Renovate entries, and CI overhead. Micro-packages multiply this cost without delivering domain value. KISS prevails.
- **Rejected alternatives:**
  - Atomic-style decomposition (`@repo/types`, `@repo/utils`, etc.): premature abstraction, slow iteration, unclear ownership
  - Single mega-package (`@repo/lib`): defeats the purpose of monorepo isolation
- **When to revisit:** If a real cross-app reuse case emerges that does not fit existing packages. Then create the new package with clear domain scope; do not split existing packages into smaller ones for ergonomic reasons.

### 08. Service file layout: 5 standard layers + 5 optional

- **Date:** 2026-05-07
- **Decision:** A service folder ships 5 standard files (`service.ts`, `repository.ts`, `helper.ts`, `types.ts`, `index.ts`) plus 5 optional layers used when the domain warrants: `mapper.ts`, `events.ts`, `policy.ts`, `errors.ts`, `integration.test.ts`.
- **Why:** Each optional layer earns its place by addressing a specific failure mode of inline code. `mapper.ts` keeps DB shape out of the domain when they differ. `events.ts` declares event names and payload schemas for async workflows (Inngest-style modules consume them). `policy.ts` pulls authorization out of the service for testability. `errors.ts` types domain errors when generic `AppError` is too coarse. `integration.test.ts` catches cascade / constraint / transaction bugs that mocked unit tests miss. By marking them OPTIONAL, the starter teaches the pattern but does not impose it on trivial services.
- **Rejected alternatives:**
  - Always-required layers: bloats trivial services and slows iteration; engineers create empty files just to satisfy the convention
  - Free-form structure: AI assistants generate inconsistent code, harder to navigate across MVPs
  - `use-case.ts` as a service-level layer: rejected because use-cases by definition cross multiple services, so they don't belong inside one. They live in `apps/*/src/use-cases/` instead, with a documented promotion rule to a domain package on cross-app reuse
- **When to revisit:** If we find ourselves systematically using all 5 optional layers on every service, those should become standard. If we never use one across multiple MVPs, retire it from the catalogue.

### 09. Schemas and types merged by default (split only on bundle pressure)

- **Date:** 2026-05-07
- **Decision:** Zod schemas and TypeScript types live together in `serviceName.types.ts` using `z.infer`, by default. Split into separate `schema.ts` and `types.ts` only when a heavily client-imported type causes Zod (~50KB) to bloat the client bundle.
- **Why:** Merged keeps one source of truth (changes to schema propagate to types automatically). Splitting requires manual sync and adds friction. The split is real but situational, not universal.
- **Rejected alternatives:**
  - Always split: trades automatic sync for theoretical bundle savings on types that may never be client-imported
  - Always merged: ignores the real bundle cost of Zod when types ARE pulled into client components at scale
- **When to revisit:** When `bun run build` reports a Client Component pulling Zod through a `types.ts` import, split that specific module's types out.

### 10. No DI container, no explicit CQRS

- **Date:** 2026-05-07
- **Decision:** The starter forbids dependency-injection containers (tsyringe, awilix) and explicit CQRS (Command/Query bus separation). Services export plain functions; tests inject mocks via constructor parameters. Read/write separation is achieved through Cache Components (`"use cache"` on service reads, `updateTag()` on action writes).
- **Why:** DI containers add ~100KB runtime overhead, opaque indirection, and decorator metadata that the team must learn for zero return at this scale (under 50 services per MVP). Explicit CQRS adds a Command bus and Query bus that nobody on a 4-week MVP needs. The Cache Components pattern delivers soft CQRS for free: cache aggressively at the service read path, invalidate via `updateTag` on writes.
- **Rejected alternatives:**
  - tsyringe / awilix: solve a problem we do not have at this scale
  - Explicit CQRS: appropriate for read-heavy systems with denormalized projections, not for B2C MVPs
  - Hand-rolled DI helpers: sneak DI complexity in through the back door
- **When to revisit:** If a project legitimately grows past 50 services with complex lifecycle needs, evaluate awilix at that point. If a project requires event-sourcing-grade read/write separation, evaluate full CQRS at that point. The starter does not prepay this cost.

### 11. Neon Postgres as default DB, no docker-compose in core

- **Date:** 2026-05-07
- **Decision:** The starter defaults to Neon Postgres (provisioned via Vercel Marketplace free tier) for both dev and prod environments. No `docker-compose.yml` ships in the core. Self-hosted Postgres is supported as `_modules/db-self-hosted-postgres/` opt-in module.
- **Why:** The Vercel + Neon Marketplace integration provides 10 free projects per team, each with dev + prod branches and automatic preview branches per PR. Folpe's profile (~24 MVPs/year, ~8 active) fits the free tier. Zero environment drift between dev and prod (same Neon, just different branches). Auto-provisioned env vars via Vercel. For B2C MVPs hosted on Vercel with 4-week kill criteria, self-hosted Postgres ops overhead (backups, security patches, monitoring, scaling) is not justified.
- **Rejected alternatives:**
  - Docker dev + Neon prod: real environment drift (connection pooling, extensions, connection limits); requires careful documentation and CI integration tests against Neon to catch the drift
  - Supabase dev + prod: Supabase's RLS-by-default conflicts with the application-level authorization in `requireRole()`; Better-Auth + Supabase is awkward
  - Self-hosted Postgres on VPS for everything: ops overhead does not fit the venture builder velocity model
- **When to revisit:** If Vercel + Neon integration changes terms (price tier shift, free tier reduction); if a specific MVP requires Postgres extensions Neon does not support; if data sovereignty becomes a hard requirement on a per-MVP basis (in which case activate the self-hosted module for that project only).

### 12. Lazy globalThis-cached Drizzle singleton

- **Date:** 2026-05-08
- **Decision:** `@repo/db/client` exposes a single `getDb(): Database` function. The postgres-js pool and Drizzle instance are constructed on first call, memoized in a module-local slot for the lifetime of the process, and additionally stashed on `globalThis` in non-production so Next.js HMR-reloaded modules reuse the same pool. No `{ max }` is set on postgres-js.
- **Why:** Eager pool construction at module load leaks a fresh connection on every Next.js dev hot-reload and forces every importer (knip, tsc, biome, build-time scripts) to have `DATABASE_URL` set just to load the module. Lazy + memoized + globalThis-cached avoids both, while keeping a single per-process pool in production. The Neon pooled endpoint manages connection limits server-side, so a hand-tuned `{ max }` is cargo-culted noise.
- **Rejected alternatives:**
  - Eager pool construction at module load: leaks connections on Next.js hot reload and forces env validation at import time, breaking type-check / knip / biome on any package that transitively imports `@repo/db/client`.
  - Eager env validation + lazy pool: would catch `DATABASE_URL` typos at module load. Rejected because static analyzers (knip, tsc, biome) import `@repo/db/client` without `DATABASE_URL` set, and Zod URL validation at module load would break those workflows the same way eager pool construction did.
  - `Proxy`-wrapped `db: Database` const: the Proxy hop fires on every property read, breaks `instanceof` / type narrowing / devtools display, and adds zero capability over a function call. No 2026 reference (Vercel, Drizzle docs, Neon docs, next-forge, t3-stack) prescribes it.
  - Replacing `createAppEnv` with `required()` inside the client: loses Zod URL validation that catches `localhost` typos and missing `postgres://` schemes.
- **When to revisit:** If we ship a non-Vercel deploy target without a Neon-style server-side pooler, reconsider postgres-js options (explicit `{ max }`, `idle_timeout`). If a future Drizzle release ships a first-party request-scoped client, evaluate replacing the Node singleton with it.

### 13. `required()` env helper + drizzle-kit `dbCredentials.url` getter

- **Date:** 2026-05-08
- **Decision:** `@repo/core/env` exports a small `required(name: string): string` that throws `Missing required env var: <NAME>` on absent or empty values. `packages/db/drizzle.config.ts` consumes it through a `dbCredentials.url` getter, so the env read fires at command-time rather than at config-load time.
- **Why:** Config files consumed by CLIs (drizzle-kit) need a one-line, loud presence check; the full `createAppEnv` schema is overkill there. The getter is the load-bearing trick: knip's drizzle plugin only reads the `schema` key and loads the config without `DATABASE_URL`, while `drizzle-kit migrate`/`studio`/`push` still fail loud the moment they reach for the URL. `drizzle-kit generate` does not need a URL by design.
- **Rejected alternatives:**
  - Empty-string fallback in `drizzle.config.ts` to please knip: silent failure mode on `drizzle-kit migrate`. Loud failure beats silent default.
  - Inline `process.env['DATABASE_URL'] ?? throw ...` at the top of `drizzle.config.ts`: same behaviour at the cost of repeating the error message everywhere; centralising in `required()` keeps the contract uniform across packages.
  - Reusing `createAppEnv` in `drizzle.config.ts`: pulls Zod and the t3-env runtime into a config file that only needs a presence check, and would still need the getter trick to defer the read.
- **When to revisit:** If knip exposes a directive to skip a single config file from plugin-driven evaluation, the getter can be replaced by a plain expression with `required()`. If `required()` grows beyond presence checks (validation, defaults, transforms), promote those use cases to `createAppEnv` rather than expanding the helper.

### 14. Centralized vitest base config with `passWithNoTests`

- **Date:** 2026-05-08
- **Decision:** `packages/config/vitest.base.ts` owns the shared vitest defaults for the monorepo, including `passWithNoTests: true`. Each package's `vitest.config.ts` re-exports the base config and only diverges when a package has package-specific needs (custom setup files, environment, coverage thresholds).
- **Why:** Skeleton packages without tests yet (typical mid-phase state) would otherwise fail `bun run test` and break the Turborepo pipeline. Setting `passWithNoTests` once at the source means every future package skeleton inherits it instead of replicating a `--passWithNoTests` plaster in each `package.json`. Aligns with how the monorepo already centralizes biome (`biome.base.json`) and tsconfig (`tsconfig.lib.json`). The file stays `.ts` to match the rest of the workspace (no exception for config files); cross-package loading works natively because the workspace runs Node 24 LTS everywhere (CI + dev + `engines.node >= 24`) and Node 23.6+ ships `--experimental-strip-types` on by default. No flag is needed.
- **Rejected alternatives:**
  - `--passWithNoTests` flag per-package: replicates across every future skeleton, drifts over time, and hides the convention from contributors.
  - Inline duplication of the full base config in every `vitest.config.ts`: same drift problem, and changes to the base require touching every package.
  - Skipping the test step entirely on empty packages via Turborepo task filters: hides genuinely missing test files behind a config quirk and is harder to debug than a one-liner config.
  - Renaming the file to `.mjs` to dodge Node's `.ts` loading limitation: works without flags on every Node version but breaks the workspace's "everything is `.ts`" invariant. As soon as the base config grows typed helpers (generic test utilities, type-safe matchers, branded test fixtures), `.mjs` becomes a migration tax. The flag-based path keeps the door open at zero ongoing cost.
- **When to revisit:** If a package legitimately wants to fail-on-empty (e.g. a contracts package where missing tests are a regression), override `passWithNoTests` locally in that package's `vitest.config.ts`. If Node ever stabilizes `.ts` loading in a way that subsumes `--experimental-strip-types` (i.e., the flag becomes the default no-op), no doc change required; the runtime contract just absorbs it.
- **Last revised:** 2026-05-09 (Phase D CI workflow initially failed on cross-package `.ts` loading because the runner shipped an older Node by default; resolved by pinning Node 24 LTS in CI and bumping `engines.node` rather than reformatting the source file or relying on a flag).

### 15. `@repo/auth` opts out of `.d.ts` declaration emit (TS2883 better-auth internals)

- **Date:** 2026-05-09
- **Decision:** `packages/auth/tsconfig.json` overrides the `tsconfig.lib.json` defaults with `declaration: false` and `declarationMap: false`. Type-checking still runs via `tsc --noEmit`; only declaration emit is disabled, scoped to this one package.
- **Why:** The inferred return type of `betterAuth(...)` (and `createAuthClient(...)` on the client side) references better-auth's internal type aliases (`InferSignUpEmailCtx`, `InferUserUpdateCtx`, ...) defined in `node_modules/better-auth/dist/client/path-to-object.mjs`. TypeScript refuses to synthesize that path into a portable `.d.ts` (TS2883, previously TS2742 under TS 5.6). Workspace consumers of `@repo/auth` resolve types straight from TypeScript source via `package.json#exports` (the entire monorepo uses `./src/*.ts` exports, never built outputs), so the declaration files were never consumed downstream — the declaration emit was pure overhead AND a blocker. Disabling it lets `betterAuth(...)` keep its full plugin-augmented inferred type at every call site.
- **Rejected alternatives:**
  - `as Auth<typeof options>` annotation: `Auth` from `better-auth` defaulted to base options drops plugin-injected fields (admin's `banned`, `role`, etc.); annotating shifts the same diagnostic onto the inferred `options` const because the magicLink callback parameter type also traverses better-auth internals. Both regress consumer ergonomics.
  - `// @ts-expect-error` / `// @ts-ignore` directives: TS2883 is a declaration-emit diagnostic, not a typechecker diagnostic — suppression directives are reported as unused and do not affect emit-time errors.
  - Disabling `declaration` at the `tsconfig.lib.json` root: bleeds the workaround into every package whether or not it has the same problem; loses declaration emit for packages that may legitimately want it (e.g., future external publication).
- **When to revisit:** When better-auth re-exports its `Auth<TOptions>` shape with portable internal type aliases (no `path-to-object.mjs` references in the emitted client/server types), drop this override and re-enable `declaration: true`. Verify with `cd packages/auth && bunx tsc --noEmit --declaration` returning zero errors.
- **Last revised:** 2026-05-25 (Phase D zod 3→4 migration). With zod 4 now hoisted across every `@repo/*` package, the original dual-zod TS2742 root cause is gone — TypeScript still refuses declaration emit, but the surviving diagnostic (TS2883) now points at better-auth's `path-to-object.mjs` internal aliases rather than at a `zod/v4/core` path. The workaround stays; the revisit trigger now depends on better-auth, not on a project-internal zod migration.

### 16. `@repo/ui` RSC boundary: `'use client'` only on interactive primitives

- **Date:** 2026-05-09
- **Decision:** Components in `@repo/ui` declare `'use client'` only when they own behavior that requires client-side React (DOM event handlers via props that React must serialize through the boundary, refs forwarded to interactive elements, or hooks). Layout primitives that only render markup based on props remain pure server components with no directive. Initial inventory:
  - `'use client'`: `Button`, `Input`, `Label`, `Avatar` (all accept event handlers and/or wrap a Radix primitive that uses hooks internally — see ADR 18).
  - Server (no directive): `Card` (+ `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`).
- **Why:** Next.js 16 with React 19 RSC means every directive choice has runtime cost. A blanket `'use client'` on every UI primitive forfeits server rendering for the entire subtree, ships unnecessary JavaScript, and defeats the point of using App Router. Conversely, omitting `'use client'` on a component that consumers want to attach `onClick` to surfaces a confusing `Functions cannot be passed directly to Client Components` error at the wrong layer (the `apps/web` page boundary) instead of at the primitive itself. The convention "interactive primitive = client, layout primitive = server" gives consumers a predictable mental model: if you can imagine a `useState` inside it, it's a client component; otherwise server.
- **Ref forwarding idiom:** Interactive primitives accept `ref` as a regular prop (typed as `Ref<HTMLElement>`) rather than wrapping the component in `forwardRef`. React 19 dropped the requirement: refs are now forwarded automatically when declared as a prop, and `forwardRef` is on the deprecation runway. This keeps the component a plain function (cleaner stack traces, no `displayName` boilerplate) while preserving full ref support for consumers who need it.
- **Rejected alternatives:**
  - Mark all `@repo/ui` components `'use client'`: simpler rule, but eliminates server-rendering benefits for the bulk of layout markup (cards, avatars, future `Stack`, `Container`, `Divider`, etc.). Doesn't scale.
  - Mark none and let consumers wrap interactive uses in their own client components: shifts boilerplate to every consumer call site and makes `<Button onClick={...}>` impossible to use directly in a server component, which is the primary ergonomic win of shared primitives.
  - Split into two packages (`@repo/ui-server` + `@repo/ui-client`): premature, doubles the import surface, and the boundary is already enforced per-file by the directive — no need to encode it in package layout.
  - Keeping `forwardRef` for ecosystem inertia — rejected because React 19 deprecated the requirement; the project's quality bar is 2026 idiomatic, not lowest-common-denominator.
- **Convention going forward:** When adding a new `@repo/ui` component, the first question is "does this component receive function props or hold state?" If yes, file starts with `'use client';`. If no, no directive. If the component composes children that may be interactive (e.g., a `Modal` that wraps arbitrary content), the wrapper itself decides based on whether IT needs interactivity, not based on what children might pass through.
- **When to revisit:** If a layout primitive (e.g., `Card`) ever grows interactive behavior (collapsible state, hover-controlled animations driven from JS), promote it to `'use client'` in the same commit that adds the behavior — never speculatively.

### 17. CVA for typed variant primitives in `@repo/ui`

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` uses `class-variance-authority` (CVA) to declare variant-driven components (`Button`, future complex primitives). Variant types are derived via `VariantProps<typeof X>` rather than hand-written.
- **Why:** CVA is the de-facto 2026 standard (used by shadcn/ui v3), gives type inference for free, supports compound variants, and weighs ~2KB. Manual `Record<Variant, string>` helpers re-invent this with worse ergonomics — no inference, no compound variants, more code to maintain across N components.
- **Rejected alternatives:**
  - Hand-rolled `getButtonClasses(variant, size)` helper: works for one component but rots into duplication as soon as a second variant component lands. No type inference; types like `ButtonVariant` / `ButtonSize` must be hand-written and kept in sync.
  - tailwind-variants (tw-variants): newer, supports slots/composition, but adds a layer of API surface `@repo/ui` doesn't need yet. Revisit if multi-slot components become common.
  - Stitches / vanilla-extract: full CSS-in-JS solutions; out of scope for a Tailwind-first design system.
- **When to revisit:** When `@repo/ui` needs multi-slot composition primitives (e.g., a Card with named regions), evaluate tailwind-variants as a successor. Until then, CVA is sufficient and lighter.

### 18. Radix UI primitives as the substrate for `@repo/ui` interactive components

- **Date:** 2026-05-09
- **Decision:** Interactive primitives in `@repo/ui` are built on `@radix-ui/react-*` packages rather than from-scratch DOM. Initial substrate: `@radix-ui/react-avatar` (Avatar), `@radix-ui/react-slot` (Button `asChild`), `@radix-ui/react-label` (Label). Future interactive primitives (Dialog, Popover, DropdownMenu, Toast, Tooltip, Select, Switch, Checkbox, RadioGroup, etc.) follow the same rule: pull the matching `@radix-ui/react-*` and wrap it with our CVA + Tailwind theming layer. Variant typing remains ours via CVA; behavior, accessibility, and DOM correctness come from Radix.
- **Why:** Radix is the de-facto 2026 substrate for accessible, unstyled React primitives (used by shadcn/ui, every major Vercel sample, and most production design systems). Building from scratch means re-implementing focus traps, escape handling, ARIA wiring, keyboard nav, RTL support, controlled/uncontrolled state, and SSR safety — work that takes weeks per primitive and is incident-prone (subtle regressions on every React/browser update). The cost we avoid is far greater than the ~2-5KB per primitive Radix adds; bundle weight is dominated by app code, not by primitives. The replacement of the raw `<img>` Avatar (no loading state, broken-image flash) with Radix Avatar (tri-state machine: idle → loading → loaded/error, fallback on both error AND not-yet-loaded) is the canonical example of why we don't roll our own. Radix also keeps the `@repo/ui` surface aligned with shadcn/ui v3 vocabulary, which lowers AI-assistant friction (every modern LLM has shadcn snippets in training data).
- **Rejected alternatives:**
  - **Headless UI (`@headlessui/react`):** good quality but narrower catalogue (no Avatar, no Toast, no Slot), tighter coupling to Tailwind, and slower release cadence. Loses the shadcn/ui ecosystem alignment.
  - **Ariakit:** technically excellent and arguably more rigorous than Radix, but smaller mindshare in 2026, fewer LLM-trained snippets, and the project has explicitly identified itself as the lower-traffic alternative. No upside that justifies leaving the ecosystem standard.
  - **Build everything from scratch:** rejected outright. Folpe's quality bar ("ultra moderne, exceptionnel") is incompatible with hand-rolled a11y; the venture builder cadence (~24 MVPs/year) makes the per-primitive amortization horrible (we'd reinvent Dialog ~24 times); and the failure mode (a primitive that ships an a11y bug into 24 MVPs at once) is a brand-integrity disaster. The earlier from-scratch Avatar already shipped the broken-image-flash regression — proof that even our trivial primitives benefit from delegation.
  - **Adopt shadcn/ui directly via the CLI (copy components into the repo):** considered. Rejected because shadcn's distribution model assumes a single Next.js app with components living in `app/components/ui/`; in a monorepo with `@repo/ui` as a shared workspace package, copying snippets per-app fragments the source of truth and prevents cross-app upgrades. We use shadcn as a *reference* (vocabulary, copy-pastable structure) but vendor our own thin wrappers in `@repo/ui` so the workspace contract holds.
- **Conventions going forward:**
  - One Radix primitive per `@repo/ui` component file. No re-exporting `RadixDialog.Trigger` etc. directly — always wrap so the public surface is `<Dialog>`, `<DialogTrigger>`, etc., styled with our tokens and CVA variants.
  - `'use client'` on every Radix-backed primitive (they all use hooks/context) — consistent with ADR 16 ("interactive primitive = client").
  - Renovate handles minor/patch upgrades automatically. Major bumps go through `docs/DECISIONS.md` only if a public API breaks for our wrappers.
- **When to revisit:** If the React ecosystem shifts to a successor primitive library with broader adoption than Radix (signals: shadcn/ui swaps substrate, Vercel templates swap, the React team blesses an alternative), evaluate migration. If Radix abandons React 19+ support for an extended window without a clear successor, evaluate Ariakit at that point.

### 19. Dark mode via next-themes + Tailwind v4 class strategy

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` ships `<ThemeProvider>` (wrapping `next-themes`) + a `.dark { --color-*: ... }` block in `globals.css`. Consumers mount `<ThemeProvider attribute="class">` once in their root layout; toggling `class="dark"` on `<html>` re-binds the design tokens automatically via the CSS cascade.
- **Why:** next-themes is the de-facto 2026 React dark-mode lib (used by shadcn/ui v3, next-forge, t3-stack). It handles system-preference detection, localStorage persistence, FOUC avoidance, and SSR safely. Tailwind v4's `@custom-variant dark` + class selector is the v4-idiomatic way to gate dark variants without v3's `tailwind.config.js`.
- **Rejected alternatives:**
  - CSS-only `[data-theme]` toggle without next-themes: requires hand-rolling system-preference + persistence + FOUC + SSR safety. ~80 lines of brittle client code.
  - `@media (prefers-color-scheme: dark)` only: no manual toggle, no per-user preference. Bad UX.
  - Stitches / vanilla-extract: full CSS-in-JS; out of scope for a Tailwind-first design system.
- **When to revisit:** When Tailwind v5 lands or if next-themes' SSR story drifts from Next.js 16+ Cache Components. Until then, this is stable.

### 20. Form primitive on react-hook-form + zod resolver, full shadcn composition

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` ships a 7-component Form composition (Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage + `useFormField` hook) wrapping `react-hook-form` (RHF) and Zod via `@hookform/resolvers`. Consumers compose slot-by-slot.
- **Why:** RHF + Zod is the de-facto 2026 React form stack: type-safe end-to-end (schema → form values → field errors), tree-shakeable, no Provider boilerplate, integrates cleanly with React 19 `useActionState` + Server Actions for progressive enhancement. The 7-slot composition is shadcn/ui v3's pattern: it auto-wires `htmlFor` / `id` / `aria-describedby` / `aria-invalid` so a11y is correct without per-form boilerplate. A leaner API (e.g., a single `<Field name="x" />`) hides the slot architecture and rots within 2 MVPs once a form needs description text or asymmetric layouts.
- **Rejected alternatives:**
  - Native HTML5 forms + custom hook: works for trivial cases, fails on async validation + cross-field rules + focus management.
  - Formik: less type-safe inference, larger bundle, lower velocity since maintenance has slowed.
  - TanStack Form: excellent type ergonomics, but adoption is still trailing RHF and the integration with shadcn-style composition is less established. Revisit when next-forge / shadcn v4 commit to it.
  - Server-only validation via `defineAction` schema: necessary but insufficient. Without client-side validation, every typo in an email costs a network roundtrip and breaks the optimistic UI story.
- **When to revisit:** When TanStack Form ships a stable shadcn-style integration and outperforms RHF in real benchmarks, OR when React's experimental `<form action={...}>` + `useFormState` ergonomics make RHF redundant for simple forms.

### 21. defineFormAction for Next.js 16 + React 19 useActionState

- **Date:** 2026-05-09
- **Decision:** `@repo/core/server-action` ships TWO Server Action factories: `defineAction` (typed RPC, current behaviour) and `defineFormAction` (FormData parsing + structured `ActionState` return + `useActionState` compatibility). Both share the same Zod schema, the same auth resolver, and the same `AppError` mapping. `@repo/auth` re-exports `defineFormAction` with auth-aware resolution, identical to how it already wraps the RPC `defineAction`.
- **Why:** Next.js 16 invokes Server Actions in two distinct modes. RPC: `await action(values)` — used by react-hook-form's `handleSubmit`, returns the handler value, throws on failure. Form-driven: `<form action={action}>` — payload is a `FormData`, used by progressive-enhancement flows and React 19's `useActionState`, which expects a `(prevState, formData) => Promise<state>` signature and a serializable return shape. A single overloaded factory serving both modes either branches at the entry on input shape (less type-safe, harder to read) or forces consumers to pick a mode at call time anyway. Two named factories keep each call site explicit, types tight, and the function name self-documents intent.
- **Canonical shape:**

  ```ts
  type ActionState<TData = unknown> =
    | { ok: true; data: TData }
    | { ok: false; fieldErrors: Record<string, string[]>; formError?: { code: string; message: string } };
  ```

  Schema failure surfaces as `fieldErrors`. Domain `AppError` (incl. `UnauthorizedError`, `ForbiddenError`, custom subclasses) surfaces as `formError`. Next.js redirect / notFound errors (digest `NEXT_REDIRECT` / `NEXT_HTTP_ERROR_FALLBACK`) are re-thrown so the framework can swallow them. Anything else is re-thrown so the route's `error.tsx` boundary renders — form mode is for *expected* failures only.
- **Rejected alternatives:**
  - Single overloaded `defineAction` that detects FormData vs object: matches next-safe-action's API but requires runtime branching at the entry point and a return type that switches between throw-on-error (RPC) and return-state (form). Less type-safe, harder to read at the call site.
  - Drop in `next-safe-action` 8.x and remove our wrappers entirely: ADR 5 explicitly chose to keep the wrapper for control over error serialization. Re-evaluating that decision is bigger than this lot. Shipping `defineFormAction` inside our wrapper is faster AND keeps the surface area we control.
  - Use React's `useActionState` directly without a wrapper: requires every consumer to write `Object.fromEntries(formData)` + `safeParse` + AppError mapping inline. Same code, copy-pasted N times.
  - Importing the redirect-error type from `next/dist/client/components/redirect-error`: that path is internal and has shifted between Next minor versions. The duck-typed `digest` check is stable since Next 14 and is what the Next docs recommend for any try/catch around `redirect()`.
- **When to revisit:** When `next-safe-action`'s API stabilizes a clear advantage AND we accept its dependency. Or when React's experimental form actions land non-experimentally with a richer API that subsumes both modes. Or when the wrapper grows past 200 lines (ADR 5's stated revisit trigger).

### 22. pino as the structured logger for `@repo/core`

- **Date:** 2026-05-09
- **Decision:** `@repo/core/logger` ships `pino` (Node) plus `pino-pretty` as a dev-only transport. The same `logger` is used across all server-side code: Server Actions, route handlers, the Better-Auth `sendMagicLink` stub, and Drizzle query logs (when enabled). Production emits raw JSON; dev emits colorized lines via `pino-pretty`.
- **Why:** pino is the industry-standard JSON-first server logger for Node — fastest in benchmarks, mature transport ecosystem (Datadog, Loki, ELK), structured-by-default with first-class `child()` loggers for per-request context. Vercel Functions' log pipeline ingests pino's JSON natively. The `pino-pretty` transport stays gated behind `NODE_ENV !== 'production'`, so production deploys never load the worker_threads-based transport.
- **Rejected alternatives:**
  - **consola (Nuxt):** excellent DX in dev, smaller bundle, but weaker integration with prod log pipelines (not JSON-first; field shapes vary). Better suited for CLIs and Nitro apps; we run on Vercel Functions where structured JSON is the gold standard. Worth re-evaluating only if we ever ship a CLI inside this monorepo.
  - **winston:** older, more configurable, slower. No clear advantage in 2026; pino has overtaken it on every dimension that matters here.
  - **OpenTelemetry directly:** complementary, not a replacement. We can layer OTel exporters on top of pino transports later (Phase D candidate); choosing pino does not foreclose adding OTel.
  - **`console.log`:** zero structure, no log levels, no fields, no transports. Useless at scale and noisy in test output.
- **When to revisit:** When deploying to Edge runtimes that lack `worker_threads` (`pino-pretty`'s transport requires it). The fix is to drop `pino-pretty` even in dev and stay on raw JSON, or swap to consola for the dev-only path. Already mitigated because `pino-pretty` only loads when `NODE_ENV !== 'production'`, but adding an Edge-targeted route would force the issue.

### 23. TypeScript 7 native compiler with a separate Next build type gate

- **Date:** 2026-05-09; revised 2026-07-24
- **Decision:** Resident baseline workspaces use TypeScript 7.0.2. `apps/web/tsconfig.json` keeps only `paths` for the `@/*` alias; the removed `baseUrl` and `ignoreDeprecations` options are not supported by TypeScript 7. The web app also declares `@typescript/native-preview` as an npm alias of the same stable TypeScript 7 package because Next 16.2.11 recognizes the native compiler under that legacy package name. `next.config.ts` sets `typescript.ignoreBuildErrors: true`, and CI runs the required `bun run type-check` gate before `bun run build`. A factory-generated Expo SDK 57 workspace pins the upstream-supported TypeScript `~6.0.3` locally; that exception moves with the Expo template rather than forcing the web compiler onto the mobile toolchain.
- **Why:** TypeScript 7 is a native compiler and no longer ships the legacy `typescript/lib/typescript.js` programmatic API that Next 16 probes during `next build`. Without the alias, Next misclassifies TypeScript 7 as missing and attempts to install TypeScript with another package manager, which cannot resolve this Bun workspace. Next 16 already has a native-compiler branch keyed by `@typescript/native-preview`; aliasing the stable package activates that branch without installing a second compiler. The explicit CI type gate preserves strict type safety while the Next build handles compilation, route type generation, and rendering.
- **Rejected alternatives:**
  - Keep TypeScript 6 in the web app: avoids the compatibility path but leaves one workspace on the previous compiler and keeps the monorepo split across compiler generations.
  - Install the actual `@typescript/native-preview` daily build: duplicates the compiler and replaces a stable release with a moving development snapshot.
  - Let Next auto-install TypeScript: invokes a different package manager from `apps/web`, fails to resolve `workspace:*` packages, and mutates `node_modules`.
  - Patch `node_modules/typescript` with a fake `typescript.js`: fragile, not represented by the lockfile, and lost on every install.
- **When to revisit:** When Next resolves stable TypeScript 7 directly and no longer requires the legacy programmatic API, remove the alias and `ignoreBuildErrors`, then keep `bun run type-check` as the explicit CI gate unless Next's native check offers equivalent coverage.

### 24. Routing Middleware as `proxy.ts` (Next 16 rename)

- **Date:** 2026-05-09
- **Decision:** `apps/web` uses `src/proxy.ts` exporting a `proxy` function (not `src/middleware.ts` exporting `middleware`). Knip's `apps/*` entry list points at `src/proxy.ts`. The `runtime` config option is intentionally NOT declared because Next 16 explicitly throws when it appears in proxy files.
- **Why:** Next.js 16.0.0 deprecated the `middleware` file convention and renamed it to `proxy` (https://nextjs.org/docs/app/api-reference/file-conventions/proxy, version history: "v16.0.0 — Middleware is deprecated and renamed to Proxy"). The Next team's stated motivation is to disambiguate from Express-style middleware, signal the network-boundary semantics (proxy runs at the edge / before render), and discourage overuse. The starter ships on Next 16; using the deprecated convention would emit a build-time warning and rot at the next minor.
- **Rejected alternatives:**
  - Keep `middleware.ts` and silence the deprecation warning: works today, breaks on a future Next minor that removes the alias. The codemod (`npx @next/codemod@canary middleware-to-proxy .`) is a one-shot anyway.
  - Drop the proxy file entirely (no session refresh slot): closes off the Phase D plug point for `_modules/rate-limit-upstash` and locale detection. Future modules would have to add the file from scratch.
- **Knip config:** `apps/*` entry list MUST list `src/proxy.ts`, NOT `src/middleware.ts`. Already updated in `knip.json` alongside this ADR.
- **Phase C plan note:** the plan snippet for Task C7 was drafted before the Next 16 rename and uses `src/middleware.ts` / `export function middleware`. The implementer correctly verified docs and adapted. Future plan revisions should reflect the new naming.
- **When to revisit:** Only if Next reverts the rename (very unlikely) or introduces a successor convention that subsumes proxy.

### 25. `@repo/auth` client/server import boundary via 'server-only' + subpath split

- **Date:** 2026-05-09
- **Decision:** Server-only modules in `@repo/auth` (`auth.service`, `auth.repository`, `auth-action`) and `@repo/db/client` each carry `import 'server-only'` at the top. Client components (auth pages, UserMenu) import `authClient` from the `@repo/auth/client` subpath. Server components and actions continue to import from `@repo/auth` (barrel) or its named subpaths.
- **Why:** The `@repo/auth` index barrel mixed browser-safe exports (`authClient`, errors, helpers, types) with server-only exports (`getCurrentUser`, `requireAuth`, `requireRole`, `signOut`, `defineAction`, `defineFormAction`). Any client component importing a single symbol from the barrel transitively pulled in `auth.service` → `next/headers`, and `auth.repository` → `@repo/db/client` → `postgres` (Node-only built-ins: `fs`, `crypto`, `stream`, `perf_hooks`). Next.js / Turbopack correctly refused to bundle these into the client, causing a hard build failure. The `server-only` directive makes the boundary explicit and loud at build time — it throws an actionable error instead of silently including server internals. The `@repo/auth/client` subpath gives auth pages an unambiguous browser-safe entry point.
- **Rejected alternatives:**
  - Split `@repo/auth` into separate packages (e.g. `@repo/auth-client`, `@repo/auth-server`): too heavy — adds monorepo overhead, extra `package.json` files, and forces every consumer to track two package names for a single domain.
  - Add `'use client'` at the top of server-side files: wrong primitive — `'use client'` is a React component boundary directive, not a build-time bundling constraint. It would mark the service as a client module, not prevent its server-only dependencies from leaking.
  - Leave the barrel as-is and rely on tree-shaking: Next.js / Turbopack does not statically tree-shake across package boundaries at the module-init level. Side-effecting imports (like `next/headers` and `postgres`) are always evaluated even if no exported symbol is used by the client.
- **When to revisit:** If Next.js / RSC bundling gains reliable cross-package server-only tree-shaking that makes the `server-only` package redundant (unlikely in the short term). Until then, every new server-only file added to `@repo/auth` or `@repo/db` must carry the directive.

### 26. postgres-js as the Drizzle Postgres driver

- **Date:** 2026-05-09
- **Decision:** `@repo/db` ships `postgres@^3.4.0` (postgres-js by Porsager) as the underlying Postgres driver, consumed by Drizzle's `drizzle-orm/postgres-js` adapter. node-postgres (`pg`) is not installed.
- **Why:** postgres-js is the recommended driver for Drizzle + Neon serverless setups in 2026. It is ESM-native (no CJS interop quirks under Next 16), has zero runtime deps, and exposes a tagged-template API that maps cleanly to Drizzle's prepared-statement pipeline. node-postgres (`pg`) requires `pg-types` plus a connection pool wrapper, drags two CJS packages into the bundle, and offers no advantage on the Neon pooled endpoint where pool sizing is server-side. Folpe's "fewer deps when quality is not at stake" principle (see ADR 05) tips the balance to postgres-js.
- **Rejected alternatives:**
  - **node-postgres (`pg`):** mature, ubiquitous, but CJS-first and pulls `pg-types` plus a separate pool wrapper. No tangible benefit over postgres-js on Neon, more dependencies, weaker ESM story under Turbopack.
  - **`@neondatabase/serverless`:** Neon's HTTP driver. Faster cold starts on Neon Edge Functions but ties the starter to Neon's HTTP wire format; if `_modules/db-self-hosted-postgres` activates (per ADR 11), the driver swap becomes a code change rather than a connection-string change. Keep the Postgres-wire driver so the migration path stays connection-string-only.
  - **Bun's native `Bun.sql`:** experimental in 2026, no Drizzle adapter parity yet. Revisit when stable and Drizzle ships a first-class adapter.
- **When to revisit:** When Drizzle officially recommends a different driver as the default for Neon, or when Bun's native SQL driver matures and Drizzle ships a `drizzle-orm/bun-sql` adapter. The migration path is a one-line dep swap plus a one-line adapter import.

### 27. Sentry wiring: dynamic-import client init, always-applied withSentryConfig, app-level @sentry/nextjs dep

- **Date:** 2026-05-09
- **Decision:** Sentry integrates into `apps/web` through three deliberate non-default choices, all interlocking:
  1. **`instrumentation-client.ts` uses a dynamic `import('@repo/sentry/client')` gated on `process.env['NEXT_PUBLIC_SENTRY_DSN']`** rather than a static top-of-file import. The dynamic import resolves only when the public DSN is set at build time.
  2. **`withSentryConfig(config, ...)` is applied unconditionally in `next.config.ts`** with no env-var gate around the wrapper itself. The Sentry runtime still short-circuits at module-init when the DSN is unset; only source-map upload (gated server-side by `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`) varies with env presence.
  3. **`apps/web/package.json` lists `@sentry/nextjs` as a direct dependency**, not just as a transitive of `@repo/sentry`. Both `next.config.ts` (`withSentryConfig` import) and `app/global-error.tsx` (`Sentry.captureException` import) bypass the wrapper.
- **Why:**
  1. *Dynamic import.* Turbopack does not statically tree-shake `process.env['NEXT_PUBLIC_*']` branches across module boundaries; a static `import '@repo/sentry/client'` would always pull the SDK into the eager bundle, ~80KB before activation. The dynamic gate keeps the SDK chunks unreachable from the eagerly loaded entry when the DSN is unset, which is what we actually pay for. Trade-off: the chunks still ship on disk under `.next/static/chunks/` but are never fetched by the user. Documented in `_modules/observability-sentry/README.md` so the contract is explicit.
  2. *Always-applied wrapper.* Gating `withSentryConfig` on env presence creates two divergent build outputs (with and without source-map plugin instrumentation), which is harder to reason about than a single output where the runtime chooses to short-circuit. The wrapper is itself a no-op when its bundler plugin can't find an auth token. Single code path, single mental model.
  3. *Direct app dep.* `next.config.ts` runs in a pre-Next environment where workspace transpilation hasn't kicked in yet, so it cannot import via `@repo/sentry`. Likewise `global-error.tsx` calls `Sentry.captureException` directly to keep the failure path simple. Pinning `@sentry/nextjs` at the app level reflects the actual import graph; relying on a transitive resolution would silently break on a `@repo/sentry` major bump that drops the SDK.
- **Rejected alternatives:**
  - Static client import + runtime `if (key) Sentry.init()`: ships the entire SDK into the eager bundle every build. Defeats the opt-in promise.
  - Conditional `withSentryConfig` (`if (DSN) withSentryConfig(...)`): two build shapes, harder to debug, wrapper is already idempotent.
  - Rely on transitive `@sentry/nextjs` via `@repo/sentry`: hides the actual import graph, breaks if the wrapper drops or major-bumps the SDK.
- **When to revisit:** When Turbopack ships reliable cross-package DCE for `process.env['NEXT_PUBLIC_*']` branches (the dynamic-import workaround can collapse to a static import). When Next or Sentry ship a build-time DSN gate that produces a single output regardless of env (the always-applied wrapper convention can be revisited). When the failure paths in `global-error.tsx` move into `@repo/sentry` (the app-level direct dep can drop).

### 28. PostHog EU reverse proxy under /ingest and skipTrailingSlashRedirect

- **Date:** 2026-05-09
- **Decision:** `apps/web/next.config.ts` ships three `rewrites()` rules under `/ingest/static/*`, `/ingest/array/*`, and `/ingest/*` that reverse-proxy PostHog's EU endpoints, plus `skipTrailingSlashRedirect: true` at the config level. PostHog's `NEXT_PUBLIC_POSTHOG_HOST` defaults to `/ingest` so the SDK posts to the deploy origin.
- **Why:** Three problems collapse into one solution: ad-blockers (uBlock, Brave, AdGuard) drop direct requests to `*.posthog.com`; CSP `connect-src` rules in tight policies must whitelist every third-party origin; and ePrivacy / RGPD positioning is cleaner when analytics traffic never leaves the deploy origin. Reverse-proxying through `/ingest` solves all three at once and matches PostHog's official 2026 recommendation. The `skipTrailingSlashRedirect: true` flag is mandatory: without it, Next.js 16 issues a 308 redirect from `/ingest/...` to `/ingest/.../` BEFORE the rewrite fires, which breaks the proxy. The flag has app-wide effect (no trailing-slash redirects on any route), which is acceptable because the starter never relies on Next.js's default trailing-slash normalization.
- **Rejected alternatives:**
  - Direct PostHog endpoint (`https://eu.i.posthog.com`): blocked by ad-blockers, requires CSP `connect-src` whitelist, leaks third-party traffic.
  - Cloudflare-style external proxy: extra moving piece, doesn't solve CSP automatically, adds a hop.
  - Rewrites without `skipTrailingSlashRedirect`: 308 hijack breaks the JS array endpoint and the capture endpoint silently. Took half a debug cycle the first time; the flag must be set, and the trade-off (no trailing-slash redirects) is documented here so future contributors don't drop it.
  - Disable trailing-slash handling per route: not supported by Next.js — it's a global config flag.
- **When to revisit:** If the app starts relying on Next.js's default trailing-slash redirect for SEO or canonical-URL reasons (it currently doesn't). If PostHog ships an official Next.js plugin that handles the proxy without the trailing-slash quirk. If a different analytics vendor replaces PostHog and the proxy convention no longer applies.

### 29. Placeholder modules are README-only and stay out of the workspace graph

- **Date:** 2026-05-09
- **Decision:** `_modules/*` placeholders (Stripe, Resend, Payload CMS, Audit-log, Cookie-consent, Upstash rate-limit, i18n, self-hosted Postgres) ship a README.md only. No `package.json`, no `src/`, no `tsconfig.json`. They do not appear in `bun install`'s workspace resolution, in Turborepo's task graph, in knip's project map, or in the type-checker's program. Real workspace packages (`@repo/sentry`, `@repo/posthog`, `@repo/auth-clerk`) ship the full structure and are part of the graph.
- **Why:** A placeholder with an empty `package.json` would pollute every cross-cutting tool: knip would report unused workspace deps, Turborepo would schedule no-op `lint` / `type-check` / `test` / `build` tasks for each, Renovate would open dependency PRs against scaffolds nobody is using yet, and `bun install` would link 8+ phantom packages. The cost is real and recurring; the benefit (the package "exists" in `bun pm ls`) is illusory because the integration code lives only as a README recipe. Pattern B (per `_modules/README.md`) is "the recipe IS the artifact": when an MVP needs the capability, a developer or AI agent runs the README against the consuming app and creates whatever workspace structure is appropriate AT THAT POINT. Until then, the placeholder costs nothing.
- **Rejected alternatives:**
  - Empty `package.json` per placeholder (workspace graph member, no code): pollutes every cross-cutting tool, generates no-op CI tasks, opens phantom Renovate PRs.
  - Single `_modules/_placeholders/` README aggregating all of them: loses the per-module URL anchor (`_modules/<name>/README.md`) that the catalogue cross-links to. Worse navigation for AI assistants.
  - Promote every placeholder to a real workspace package up front: spends Phase D budget on packages that may never ship in any MVP. Premature.
- **When to revisit:** When a placeholder is consumed by a real MVP. The promotion path (per ADR 07) is: scaffold the workspace package under `_modules/<name>/`, add `package.json` + `src/` + `tsconfig.json`, follow the Pattern A activation rules (env var presence, transpilePackages, instrumentation hook). The README stays as the activation guide.

### 30. Pin Node 24 LTS in CI for Node-shebang tooling

- **Date:** 2026-05-09; revised 2026-07-24
- **Decision:** Both jobs in `.github/workflows/ci.yml` declare `actions/setup-node@v6` with `node-version: '24'` immediately after `oven-sh/setup-bun@v2`. The root `package.json#engines.node` declares `>=24` to make the workspace contract explicit, and every direct `@types/node` dependency stays on major 24 to match that runtime. No `NODE_OPTIONS` flag is set: Node 23.6+ ships `--experimental-strip-types` on by default, so cross-package `.ts` config loading works natively. Bun stays pinned at `1.3.14` in both CI and `packageManager`.
- **Why:** Bun is the workspace runtime, but several tools we depend on (Vitest, Drizzle Kit, Playwright, Sentry's webpack plugin) ship binaries with a `#!/usr/bin/env node` shebang. When `bun run test` invokes those binaries, they execute under Node, not Bun. Two consequences follow: (1) without explicit `setup-node`, the runner uses whatever Node version `ubuntu-latest` happens to ship (historically 18 or 20), producing non-deterministic CI behaviour. (2) Without modern Node, the loader refuses to load `.ts` files reached through cross-package `package.json#exports` (the case for `@repo/config/vitest.base`). Pinning Node 24 LTS gives us: (a) reproducible CI builds, (b) `.ts` consistency across the entire workspace including shared cross-package configs WITHOUT any flag, (c) parity with the local dev runtime (Folpe runs Node 24.x), (d) automatic version pickup for contributors via `nvm`/`fnm`/Volta reading `engines.node`. The flag-free path is the cleaner architectural choice: nothing experimental in the build contract, no `NODE_OPTIONS` to maintain.
- **Rejected alternatives:**
  - Skip `setup-node` and use whatever the runner ships: non-deterministic; CI breaks every time the runner image rotates Node versions.
  - Pin Node 22 LTS + set `NODE_OPTIONS=--experimental-strip-types`: works, but the flag's name carries the word "experimental" and adds a workflow-level moving part that exists purely to dodge a runtime version. Strictly less clean than upgrading to a Node version where the feature is default-on. Initially considered to "match Vercel Functions LTS" but CI does not deploy to Vercel; the runtime alignment argument was weak.
  - Pin Node 18 or 20: predates `--experimental-strip-types` entirely (added in 22.6). Strict downgrade; blocks `.ts` cross-package loading.
  - Reformat `packages/config/vitest.base.ts` as `.mjs` to dodge the version requirement: works without any Node version pin but breaks the "everything is `.ts`" invariant for a cosmetic Node-tooling concern. Rejected per ADR 14's revision.
  - Replace Vitest with Bun's native test runner: removes the Node dependency entirely, but Vitest's ecosystem (jsdom, @testing-library/react integration, coverage reporters, vite transformer pipeline) is non-trivial to replace. Bigger lift than is warranted; revisit if Bun test ships first-class jsdom + RTL parity.
  - Invoke Vitest under Bun explicitly via `bunx --bun vitest run`: changes every package's `test` script and adds friction for contributors who run vitest from their IDE. The Node pin is the smaller, more reversible change.
- **When to revisit:** When Bun test reaches feature parity with Vitest for our use cases (jsdom, coverage, RTL), at which point we can drop the Node dependency entirely and remove this pin. Move both the runtime and `@types/node` together when Node 26 reaches LTS and the deploy target supports it. If Vercel Functions ever lags Node 24 (currently supports 18, 20, 22, 24 as of 2026-05), the deploy runtime is a separate concern from CI testing and is configured per-project; no change to this ADR.

### 31. Social providers are opt-in; magic-link fails loud in production

- **Date:** 2026-06-18
- **Decision:** Google OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are validated as `.optional()` and the Google provider is registered only when BOTH are present, via the pure `resolveGoogleProvider(env)` helper spread conditionally into the Better-Auth config. The magic-link `sendMagicLink` dev stub throws `AppError('MAGIC_LINK_NOT_CONFIGURED', 500)` when `NODE_ENV === 'production'`, and logs only `{ email, url }` (never the raw token) in dev.
- **Why:** The README and `docs/AUTH.md` promise that email/password and magic link work without Google. The previous code validated the Google vars as required (`z.string().min(1)`) and registered the provider unconditionally, so `getAuth()` threw on its first call whenever Google was unset -- which broke email/password and magic link too, contradicting the docs and breaking a no-Google onboarding at the first auth request. Making the provider opt-in aligns code with the documented contract. Separately, the dev magic-link stub only logs the link; if a production deploy enabled magic link without wiring a real email sender, logins would silently never arrive. Throwing in production turns a silent, hard-to-diagnose failure into a loud, actionable one at the moment of misconfiguration.
- **Rejected alternatives:**
  - *Document Google as required* (the other way to make code and docs agree): regresses the "minimal-config onboarding" property the venture-builder cadence depends on; a fresh MVP should boot with just `BETTER_AUTH_SECRET` + DB.
  - *Keep the dev stub silent in production*: silent failure -- the exact anti-pattern the in-memory rate limiter's INTENT doc warns against. Loud beats silent.
  - *Gate the production guard on a `RESEND_API_KEY` presence check instead of `NODE_ENV`*: ties the auth package to a specific email vendor's env var before that module exists. The `NODE_ENV` check is vendor-neutral; the email module replaces the callback body entirely when activated.
- **When to revisit:** When `_modules/email-resend` is wired, the `sendMagicLink` body is replaced by the Resend call and the production-guard throw goes away with it. If a provider other than Google becomes the default, generalize `resolveGoogleProvider` into a provider-map builder.

### 32. PostHog client loads via dynamic import gated on the key

- **Date:** 2026-06-18
- **Decision:** `AnalyticsProvider` initializes the global `posthog-js` singleton through a dynamic `import('posthog-js')` inside a `useEffect`, gated on `NEXT_PUBLIC_POSTHOG_KEY`. The static `import posthog from 'posthog-js'` and the `posthog-js/react` `<PostHogProvider>` wrapper are removed; the component now always renders its children unchanged and only side-effects the singleton init when the key is present.
- **Why:** The previous implementation used a top-level static `import posthog from 'posthog-js'` plus `<PostHogProvider>` and claimed the SDK dead-code-eliminated when the key was unset. It did not: a static import is unconditionally bundled, so every build shipped the ~190KB SDK into the eager client chunk even with no PostHog key — directly contradicting the module's "zero bundle when disabled" promise. ADR 27 already established that Turbopack does not reliably DCE `NEXT_PUBLIC_*` branches across module boundaries and solved the identical problem for Sentry with a dynamic-import gate. Applying the same pattern to PostHog makes the two observability modules consistent and makes the zero-bundle claim actually true (the SDK lands in an async chunk that is never fetched when the key is absent).
- **Rejected alternatives:**
  - *Keep the static import, rely on DCE*: the original bug. Static imports are not DCE'd on a runtime env check across module boundaries.
  - *Unwire `AnalyticsProvider` from the root layout entirely*: would also drop `@repo/posthog` from the app import graph, but breaks the "wired by default, zero weight until activated" symmetry with Sentry (ADR 27) and forces every PostHog-enabling MVP to re-wire the layout.
  - *Keep `<PostHogProvider>` via `next/dynamic`*: preserves the `usePostHog()` hook but pulls `next` into `@repo/posthog`'s dependency set (it has none today) and adds a lazy-boundary for a context most MVPs do not use. The global singleton (`import posthog from 'posthog-js'`) is the standard 2026 access pattern and keeps the package `next`-free.
- **When to revisit:** If an MVP needs the React `usePostHog()` context broadly, reintroduce `<PostHogProvider>` behind `next/dynamic` and add `next` as a peer dependency of `@repo/posthog` at that point. If PostHog ships an official zero-bundle Next.js entry that handles the gate, adopt it.

### 33. Auth endpoints rate-limited via Better-Auth's native limiter with database storage

- **Date:** 2026-06-18
- **Decision:** Brute-force protection for the auth flow is configured on Better-Auth itself, not on `@repo/core/createMemoryRateLimit`. `auth.repository.ts` sets `rateLimit: { storage: 'database', modelName: 'rateLimit', customRules: { ... } }`, backed by a `rate_limits` Postgres table (the `rateLimits` Drizzle schema + migration `0002`). `customRules` tighten the brute-force-prone endpoints (`/sign-in/email`, `/sign-in/magic-link`, `/forget-password`, `/reset-password` to 5/60s; `/sign-up/email` to 10/60s) below Better-Auth's 100/60s global default.
- **Why:** Sign-in, sign-up, magic-link request and password reset are Better-Auth's own HTTP endpoints (`/api/auth/[...all]`), not custom Server Actions, so the natural enforcement point is Better-Auth's built-in limiter, which already wraps every auth route. `@repo/core/createMemoryRateLimit` is the wrong tool here on two counts: it is documented dev/test-only (its `Map` is per-invocation on serverless, so it silently grants every request its own bucket -- no real limit), and it sits at the Server Action layer, which the auth endpoints never traverse. Choosing `storage: 'database'` over Better-Auth's default in-memory store is the same correctness fix: counters must persist across serverless invocations to hold. The starter already ships Postgres, so database storage adds one small table and no new infrastructure -- strictly better than wiring Upstash before an MVP needs it.
- **Rejected alternatives:**
  - *Better-Auth limiter with default in-memory storage*: zero migration, but per-invocation counters on Vercel make it cosmetic -- the exact silent-failure mode the in-memory `@repo/core` limiter warns against.
  - *`@repo/core/createMemoryRateLimit` on a custom action*: teaches the primitive but does not protect the real auth endpoints (they are not custom actions) and inherits the serverless caveat. The memory limiter stays the right tool for genuinely single-process or test paths and for custom actions once Upstash backs it.
  - *`_modules/rate-limit-upstash` from day one*: adds an Upstash dependency and env surface before any MVP has the traffic to need Redis-grade limiting. Database storage on the Postgres the starter already provisions is the lower-cost correct default; swap to Upstash when an MVP's volume justifies it.
- **When to revisit:** If an MVP's auth traffic outgrows Postgres-backed counters (lock contention on the `rate_limits` table under heavy load), move Better-Auth's rate-limit storage to `secondary-storage` backed by Upstash/Redis. If Better-Auth changes its rate-limit model schema, regenerate the migration to match the documented fields (`id`, `key`, `count`, `lastRequest`).

### 34. `@repo/notes` is the first domain package and the canonical Cache Components example

- **Date:** 2026-06-18
- **Decision:** Ship a minimal `notes` domain as a workspace package `@repo/notes` (layered: `notes.types.ts` / `notes.repository.ts` / `notes.service.ts` / `index.ts`) plus a `notes` table in `@repo/db`, a `createNoteAction` in `apps/web/src/actions/`, and a `/notes` page. The service read `listNotes(userId)` carries `'use cache'` + `cacheTag(\`notes:list:user:\${userId}\`)` + `cacheLife('minutes')`; the action invalidates that exact tag with `updateTag` after a write. This is the repo's first real read/write use of Cache Components, referenced as the worked example in `docs/CACHING.md`.
- **Why:** `docs/CACHING.md` documented the read-caches-at-service / write-invalidates-at-action pattern only as pseudocode, because no domain service existed yet (auth deliberately does not cache, CACHING.md section 7). A starter whose flagship Next 16 feature (`cacheComponents: true`) has zero call sites teaches the pattern by assertion, not by example. `notes` is the smallest domain that exercises the full loop (user-scoped cached read, tagged invalidation on write, progressive-enhancement form via `useActionState`). A package -- not an app-level use-case -- because services live in packages by the layering rules (ARCHITECTURE/PATTERNS), and `notes` has a clear domain scope, which is exactly the bar ADR 07 sets for a package to exist. The tag is user-scoped (`notes:list:user:<id>`) to honor the cross-tenant rule (CACHING.md section 6): a global `notes` tag would serve one user's list to another and would over-invalidate.
- **Rejected alternatives:**
  - *Cache the admin user-list / retrofit auth instead*: contradicts CACHING.md section 7 (auth does not cache; session reads should not be tagged like a record) and would cache PII-adjacent auth data as the teaching example. A neutral domain is clearer.
  - *Put the service in `apps/web` as a use-case*: violates the layering (services live in packages, only actions live in apps) and would not demonstrate the package-level convention future domains follow.
  - *Doc-only example*: leaves `cacheComponents: true` with no real call site; the pattern stays unproven against the actual toolchain (Turbopack, the TS 7 setup, the build).
- **When to revisit:** `notes` is intentionally minimal (no update/delete, no pagination). If MVPs never grow a second domain that caches, that is fine -- this one stays as the reference. When a richer domain lands (posts, projects, billing), it follows this shape from day one; if a cross-cutting caching helper emerges across three or more such domains, extract it then (not before).

### 35. Page guards redirect to sign-in; pathname carried via a proxy header

- **Date:** 2026-06-18
- **Decision:** `requireAuth()` (and `requireRole()` for the no-session case) `redirect('/sign-in?callbackURL=<path>')` instead of throwing `UnauthorizedError` when there is no session. The requested path reaches the Server Component through an `x-pathname` request header set in `apps/web/src/proxy.ts` (Next does not expose the pathname in RSC). The pure `buildSignInRedirect(pathname)` helper builds the target and refuses to append an auth route as the callback (no loop). The sign-in page reads `callbackURL` from the URL at submit time and runs it through `safeInternalPath` (`@repo/core/sanitize`) before using it, blocking open-redirect. An authenticated user who lacks a required role still gets `ForbiddenError` (403) -- a real authorization failure, not a "please sign in".
- **Why:** An anonymous visitor hitting a protected page (`/dashboard`) previously threw `UnauthorizedError`, which the generic `error.tsx` boundary rendered as "Something went wrong" -- the wrong UX for "you need to sign in", and it dropped the user's intended destination. Redirecting to sign-in with a `callbackURL` is the state-of-the-art App Router pattern (Clerk's `auth.protect()`, Auth.js, Better-Auth examples all do it) and matches the intent already written in the `isAuthConfigured` docstring. The proxy header is the idiomatic way to surface the pathname to RSC, and `proxy.ts` is already the documented request-boundary plug point (ADR 24). Reading `callbackURL` from `window.location.search` (not `useSearchParams`) keeps the sign-in page free of a forced Suspense boundary under cacheComponents. `safeInternalPath` is non-negotiable: a raw `?callbackURL` flowing into `router.push` / Better-Auth `callbackURL` is a textbook open-redirect.
- **Rejected alternatives:**
  - *Keep throwing `UnauthorizedError` and special-case it in `error.tsx`*: the boundary would have to parse the error and call `redirect()` from a Client Component error boundary -- a rustine; redirects belong at the guard, server-side, before render.
  - *`forbidden()` / `unauthorized()` (Next `authInterrupts`)*: still experimental; enabling the flag for this is more surface than the redirect needs. Revisit if it stabilizes.
  - *Redirect on wrong-role too*: silently bouncing an authenticated user hides a genuine 403. Throwing keeps the authorization failure visible and distinct from the unauthenticated case.
  - *Read the pathname with `useSearchParams`/headers without the proxy*: RSC has no pathname API; the proxy header is the supported mechanism.
- **When to revisit:** When Next ships a stable RSC pathname API, drop the `x-pathname` header. When `forbidden()`/`unauthorized()` stabilize, reconsider rendering a dedicated 403/401 segment instead of the error boundary for the wrong-role case.

### 36. Security overrides are centralized and enforced by `bun audit`

- **Date:** 2026-07-24
- **Decision:** The root `package.json#overrides` is the single place for temporary transitive security pins. It currently fixes `brace-expansion`, `dompurify`, `esbuild`, `fast-uri`, `js-yaml`, `postcss`, `sharp`, `undici`, and `vite`. The root `audit` script runs `bun audit`, and the `quality` CI job executes it immediately after the frozen install.
- **Why:** All direct dependencies were already on their latest release, but their resolved trees still produced 28 advisories. Updating owners removed most findings; the remaining packages were held behind stale exact or pre-1.0 ranges in current Next, Drizzle Kit, Sentry, PostHog, and Vitest releases. Centralized overrides moved every affected transitive package to a patched release and reduced the audit to zero without pretending the packages are direct project dependencies. The range-crossing overrides for PostCSS, sharp, and esbuild were accepted only after the production Next build, all type checks, 123 unit tests, Knip, and Drizzle schema generation passed.
- **Rejected alternatives:**
  - Add transitive packages as root dependencies: does not reliably replace nested versions and falsely expands the application's direct API surface.
  - Ignore or severity-filter advisories: makes the report quieter without removing vulnerable code.
  - Leave current direct packages pinned until upstream ranges catch up: keeps known vulnerable artifacts in the lockfile even though patched releases pass the project pipeline.
  - Patch files inside `node_modules`: not reproducible and disappears on install.
- **When to revisit:** On every dependency update. Remove an override as soon as all owners resolve a patched version themselves, regenerate `bun.lock`, and require both the full validation pipeline and `bun audit` to remain green.

### 37. Evolve the starter into a manifest-driven project factory

- **Date:** 2026-07-24
- **Decision:** Preserve the current Next.js monorepo as the proven web baseline, then add a
  manifest-driven factory that composes only the surfaces and capabilities a project selects.
  Forge produces product intent and a versioned build manifest. Void Starter plans, provisions,
  configures, migrates, deploys and returns a receipt. Void Harness governs the implementation
  that follows while remaining external development tooling: no Harness files, hooks, skills,
  configuration or package dependencies are copied into generated repositories. Expo is an
  optional surface in the same factory, not a permanent dependency of every generated repository.
  Provider routing is workload-aware and Vercel-first, not Vercel-only. The full target contract
  lives in `docs/FACTORY.md`.
- **Why:** The current quickstart still requires manual GitHub, Vercel, Neon, environment,
  migration, email and administrator work before product development starts. Copying every
  possible surface or module into every repository would replace manual wiring with permanent
  complexity. A typed manifest plus idempotent `plan/apply/resume/doctor` lifecycle automates the
  setup while keeping generated outputs minimal and auditable.
- **Rejected alternatives:**
  - Keep the repo as a clone-only template and improve the README: documents the work but does
    not remove it or make it resumable.
  - Always include Expo, workers and every integration: maximizes unused dependencies, CI time
    and upgrade surface.
  - Embed Void Harness in the template or generated output: couples application source to
    development governance and makes every generated project carry tooling it did not select.
  - Make tRPC mandatory to unify web and mobile: protocol choice should follow the surface and
    workload; REST/OpenAPI, Server Actions, SSE and WebRTC have distinct jobs.
  - Move all workloads away from Vercel: loses the best Next.js integration without solving a
    universal problem. Persistent and realtime workloads can route elsewhere selectively.
- **When to revisit:** If fixture-generated projects become harder to maintain than the baseline,
  if provider APIs make reliable idempotence impossible, or if Forge cannot express project
  requirements without leaking provider implementation details.

### 38. Render only into fresh targets and verify generation receipts

- **Date:** 2026-07-24
- **Decision:** Local factory generation copies the tested baseline only into a non-existing
  directory outside the source repository. It rejects source symlinks, removes unselected
  surfaces, applies deterministic overlays, excludes secrets and development-governance
  artifacts, and emits a canonical manifest plus receipt under `.void-starter/`. `doctor`
  recalculates the plan and generated-file SHA-256 digests and scans dependencies for Void
  Harness. The source `bun.lock` is not copied; a newly installed lockfile is allowed and checked.
- **Why:** A generator that mutates its own baseline or overwrites an existing project makes
  recovery ambiguous. Fresh-target rendering is easy to retry and inspect. The receipt makes the
  generated portion tamper-evident without pretending that copied baseline files are immutable.
- **Rejected alternatives:**
  - Render in place: risks mixing partial output with the factory source and user changes.
  - Overwrite an existing target: makes ownership and rollback unclear.
  - Copy the source lockfile: retains the development-only `@repo/factory` workspace after factory
    source is excluded.
  - Copy symlinks: could make generated writes or removals escape the target boundary.
- **When to revisit:** Add an explicit upgrade/migration workflow only after it has a transactional
  plan, conflict reporting, backups, and a separate authorization path from fresh generation.

### 39. Prune unselected capabilities and materialize Clerk directly

- **Date:** 2026-07-24
- **Decision:** Local generation composes the application dependency graph as well as its
  surfaces. A public minimal web output removes Better Auth, Neon/Drizzle, the notes reference
  domain, PostHog, Sentry and every corresponding app import. Better Auth retains the proven
  database-backed baseline. Clerk generates direct Next.js v7 provider, middleware, route and UI
  overlays while removing both `packages/auth` and the `_modules/auth-clerk` documentation
  scaffold. Mobile-only output removes all Next.js-only packages. Generated `.env.example`,
  `package.json`, `next.config.ts`, layout and entry pages are deterministic receipt-tracked
  overlays. `doctor` verifies that local packages and dependencies match the manifest.
- **Why:** Removing a workspace directory without removing its imports produces a repo that looks
  smaller but cannot install, type-check or build. Keeping every optional module avoids that
  failure but defeats the factory's purpose. Treating the package graph, app call sites and config
  as one composition unit makes absence real and testable. The Clerk scaffold explicitly was not
  a runtime drop-in, so copying it would misrepresent support; generating the complete direct
  integration is the honest boundary.
- **Rejected alternatives:**
  - Only remove package dependencies: leaves broken TypeScript imports and routes.
  - Keep all `_modules` directories as examples: generated projects carry unselected catalogue
    code and Knip/build surface.
  - Copy the Clerk repository scaffold over Better Auth: the scaffold does not include provider,
    middleware, UI and session-model changes and documents itself as incomplete.
  - Allow web-only adapters on mobile manifests: implies a native integration that is not
    implemented.
- **When to revisit:** Add native-specific auth, analytics and error adapters behind separate
  manifest adapter names. Move R2, Resend and DNS from planned bindings to materialized
  capabilities only when their idempotent provider `apply` adapters and smoke tests exist.

### 40. Prove resumable provisioning locally before enabling provider mutations

- **Date:** 2026-07-24
- **Decision:** Add a strict, non-secret provisioning context for explicit GitHub owner, Vercel
  team and Neon organization coordinates. Derive a deterministic first-tranche action plan for
  repository, web project, database project and database environment binding. Every action has a
  content-derived idempotency key, dependencies and required permission intent. Implement
  `apply --dry-run` as the write-free default and `apply --simulate` / `resume --simulate` as a
  local-only execution engine. Persist canonical state atomically after each transition, prevent
  concurrent applies with a process lock, recover dead-process locks, preserve safe structured
  failures, reject manifest or plan drift, and skip already successful actions on resume.
  `doctor` validates optional provisioning state. No live execution flag exists in this tranche.
- **Why:** The retry contract must be correct before API credentials or billable resources enter
  the loop. Neon explicitly warns that retrying an ambiguous create-project `POST` may create a
  duplicate, so a live adapter must reconcile stable ownership metadata and persist returned
  opaque IDs instead of treating a POST retry as idempotent. GitHub organization repository
  creation requires repository-administration write permission, and Vercel team-scoped API calls
  require an explicit team identifier. Separating product intent from account coordinates makes
  those permissions visible without putting credentials in the manifest. Provider references:
  [Neon create project](https://api-docs.neon.tech/reference/createproject),
  [GitHub repositories API](https://docs.github.com/en/rest/repos/repos),
  [Vercel REST API](https://vercel.com/docs/rest-api), and
  [Vercel regions](https://vercel.com/docs/regions).
- **Rejected alternatives:**
  - Add real provider calls directly to `generate`: couples deterministic local rendering to
    credentials, network availability and partial remote side effects.
  - Accept tokens in the manifest or provisioning context: turns reproducible intent files and
    receipts into secret-bearing artifacts.
  - Retry create endpoints blindly: can duplicate resources after ambiguous timeouts.
  - Infer owner, team, organization or returned resource IDs: risks mutating the wrong account
    and makes resume unreliable.
  - Keep state only in memory: loses the last confirmed provider action on interruption.
- **When to revisit:** Enable a separately explicit live mode only after GitHub, Vercel and Neon
  adapters implement lookup-before-create reconciliation, authenticated account preflight,
  permission checks, redacted transport logging, provider-mocked contract tests and manual
  sandbox-account validation. Add encrypted secret transport as a distinct reviewed tranche.

### 41. Isolate live provisioning behind account preflight and exact confirmation

- **Date:** 2026-07-24
- **Decision:** Implement the first authenticated adapter for GitHub repository, Vercel project,
  Neon project and Vercel database binding without changing the safe `apply` default. Expose
  authenticated reads through `preflight:live`; expose mutations only through the separate
  `apply:live` and `resume:live` commands with an exact project-name confirmation. Credentials
  come only from `GITHUB_TOKEN`, `VERCEL_TOKEN` and `NEON_API_KEY` in process memory. Every action
  uses lookup-before-create, validates matching resources before adoption and reconciles after a
  create. An ambiguous create becomes lookup-only on resume. The Neon connection URI is sent
  directly to write-only Vercel variables and never persisted: `sensitive` for Preview/Production
  and `encrypted` for Development, where Vercel does not support the sensitive type. A non-secret
  binding marker enables safe adoption. Generated web projects pin Functions to `fra1` in
  `apps/web/vercel.json`; the current Neon contract is `aws-eu-central-1`.
- **Why:** A valid token is insufficient proof that the factory is targeting the intended owner,
  team or organization. A successful or failed create response is also insufficient proof of
  remote state after transport ambiguity. Provider identity preflight and post-create
  reconciliation make the mutation target and retry behavior explicit. For organization-owned
  repositories, the exact GitHub membership endpoint requires `Members: read`; the broader
  no-permission membership listing returned an empty list during the sandbox canary, making it
  unreliable for exact owner validation. Vercel defaults Functions to `iad1` unless configured,
  while its documentation recommends locating Functions near the database. Neon documents POST
  as non-idempotent and exposes a safe project search endpoint.
  Sensitive Vercel environment variables are write-only for the factory, and regular encrypted
  values are not read back, so a separate non-secret marker is required for recovery. References:
  [GitHub repository API](https://docs.github.com/en/rest/repos/repos),
  [Vercel REST API](https://vercel.com/docs/rest-api),
  [Vercel Function regions](https://vercel.com/docs/functions/configuring-functions/region),
  [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables),
  [Neon list projects](https://api-docs.neon.tech/reference/listprojects), and
  [Neon connection URI](https://api-docs.neon.tech/reference/getconnectionuri).
- **Rejected alternatives:**
  - Reuse `apply --simulate` with a live flag: makes a typo capable of crossing the local/remote
    boundary.
  - Store tokens or `DATABASE_URL` in context or apply state: leaks credentials into durable
    project metadata.
  - Adopt a same-name resource without validating owner, visibility, framework, root directory or
    region: can attach the generated project to unrelated infrastructure.
  - Retry an ambiguous create after lookup misses once: eventual consistency can still turn that
    retry into a duplicate.
  - Read back Vercel's sensitive value to prove the binding: defeats the write-only secret
    boundary and is unsupported for sensitive variables.
- **When to revisit:** After a disposable sandbox-account run proves the current HTTP contracts.
  Then add repository push, migrations, deployment and smoke checks as new receipt-tracked actions
  rather than widening these resource-creation actions.

### 42. Inject Forge foundations through a receipt-gated adapter

- **Date:** 2026-07-24
- **Decision:** Consume `forge/project-pack-v1` through a dedicated `foundation
  preview|apply|check` lifecycle, separate from fresh generation and provider provisioning.
  Preview and check are non-mutating. Apply requires the exact Forge project id, validates all 14
  source hashes and path boundaries, takes a local lock, recomputes the plan under that lock, and
  writes a canonical per-file receipt at `.void-starter/project-pack-receipt.json`. Initial writes
  are create-only. A later write is allowed only when the destination hash matches the previous
  receipt. Any unmanaged, missing, locally modified, or symlinked destination blocks the complete
  transaction without overwriting. The adapter stages writes and rolls committed files back if a
  later commit step fails.
- **Why:** Forge foundations must survive into design and code without making `.forge` compete with
  hand-maintained project documentation. Blind copying loses ownership, silently destroys local
  decisions, and makes two linked repositories drift. A receipt gives every destination an
  explicit provenance and expected hash while keeping the source contract owned by Forge.
- **Rejected alternatives:**
  - Copy the pack with overwrite enabled: destroys local edits and provides no merge evidence.
  - Put foundation injection inside `generate`: excludes existing repositories and couples product
    memory to baseline rendering.
  - Put foundation injection inside provisioning `apply`: mixes local documents with credentialed,
    billable remote mutations.
  - Adopt an existing destination on first apply when contents happen to match: provenance is still
    unknown, so later replacement would be unsafe.
  - Extract a shared contract package now: there is one producer and one executable consumer. The
    consumer compatibility boundary plus real-output dogfood is smaller until Forge's extraction
    thresholds are reached.
- **When to revisit:** When Project Pack gains a second executable consumer, a second producer, or
  frequent breaking changes. At that point extract a single owned schema package and migrate both
  repositories instead of maintaining another mirror.

### 43. Validate first-tranche provisioning through creation, resume and stateless adoption

- **Date:** 2026-07-25
- **Decision:** Accept the GitHub repository, Vercel project, Neon project and Vercel database
  binding tranche after a live isolated-account canary created all four resources in one attempt,
  a completed-state resume preserved every ID and attempt counter, and a fresh generated project
  without local apply state adopted every resource with the same opaque IDs. Keep the sandbox
  resources for the next source, migration and deployment tranche.
- **Why:** Provider-mocked tests prove request contracts but cannot prove current provider API
  behavior, app installation access, environment-variable semantics or lookup compatibility.
  Creation alone also cannot prove that recovery avoids duplicates. The three canary perspectives
  jointly cover first execution, durable no-op resume and lookup-based adoption.
- **Rejected alternatives:**
  - Treat the first successful creation as sufficient: leaves adoption and duplicate prevention
    unproven.
  - Delete the resources immediately: prevents the next tranche from exercising a realistic
    existing project.
  - Persist provider credentials or the Neon connection URI as evidence: violates the
    process-memory-only secret boundary.
- **When to revisit:** Re-run the same three canaries after a provider API contract change, and add
  remote smoke checks once source push, migration and deployment actions exist.

### 44. Publish initial source through a separate digest-gated lifecycle

- **Date:** 2026-07-25
- **Decision:** Keep initial Git source publication separate from infrastructure provisioning.
  Require a successful live provisioning receipt and generated `bun.lock`; compute a SHA-256 plan
  over the exact publishable files; exclude operation state, secrets, caches and build output; and
  publish one root commit to `main` through Git HTTPS. Attribute the commit to the authenticated
  GitHub user's noreply identity. Pass the fine-grained token only through a temporary askpass
  environment with credential helpers disabled. Persist a separate atomic
  `.void-starter/source-state.json`. Adopt an existing branch only when both its factory source
  marker and exact Git tree match; otherwise fail closed.
- **Why:** Adding source to the already completed provider action plan would invalidate valid live
  state. A separate plan can include the post-install lockfile and exact source digest, neither of
  which exists when the infrastructure plan is derived from the build manifest. Git remotes that
  embed a token and ordinary credential helpers can persist secrets. Vercel Pro also checks commit
  authors on connected private organization repositories, so a made-up factory identity can block
  automatic deployment.
- **Rejected alternatives:**
  - Widen the first provisioning plan: breaks resume for the already validated provider receipt
    and still cannot derive the post-install lockfile digest from manifest intent.
  - Store a token in the remote URL: leaks it through `.git/config`, diagnostics and process
    inspection.
  - Force-push or adopt same-name content: can destroy or silently claim unrelated work.
  - Push without a lockfile: makes CI and Vercel dependency resolution non-reproducible.
- **When to revisit:** Replace the personal token with a short-lived GitHub App installation token
  for long-lived automation. Extend delivery with separate migration, deployment observation and
  smoke-test receipts after the source canary passes.

### 45. Keep EAS CLI on demand and recognize publication-owned Git metadata

- **Date:** 2026-07-25
- **Decision:** Keep the Expo SDK and EAS profiles in generated projects, but execute the pinned
  EAS CLI on demand through `bunx eas-cli@21.2.0` instead of installing it in every mobile
  workspace. Override `uuid` to the first non-vulnerable compatible release required by the
  current Expo graph. Let `doctor` accept a local `.git` directory only when a structurally valid
  source-publication receipt exists and matches the current source snapshot.
- **Why:** The first source canary reached GitHub, then CI failed exclusively because the latest
  EAS CLI pinned seven vulnerable transitive packages into the application lockfile even though
  CI, local Expo development and static export never invoke EAS. Removing that operational CLI
  reduced the generated graph from 1,200 to 930 packages while the complete Next.js and Expo
  builds remained green. The same canary also showed that the source lifecycle creates legitimate
  Git metadata after `doctor` has already proved generation isolation; continuing to classify
  that receipt-owned `.git` as copied development governance is a false positive.
- **Rejected alternatives:**
  - Disable or weaken `bun audit`: hides actionable application dependency findings.
  - Force all vulnerable transitive packages through global breaking-major overrides: can silently
    break unrelated Expo and build-tool consumers.
  - Always permit `.git`: loses the guarantee that generation never copied source-repository
    metadata.
- **When to revisit:** Install EAS CLI in the workspace again only if Expo publishes a
  vulnerability-clean graph and local reproducibility materially benefits. Replace the `uuid`
  override when the supported Expo SDK resolves a fixed release natively.

### 46. Publish Factory revisions only as guarded fast-forwards

- **Date:** 2026-07-25
- **Decision:** Add a separate `source:update:preflight|live|resume` lifecycle for refreshing a
  Factory-owned repository from a fresh generated target. Require that target to adopt the
  existing infrastructure first. Treat the current remote `main` commit SHA, tree SHA and source
  marker as the immutable update base. Fetch and verify that exact base, create one child commit,
  recheck the remote immediately before mutation, and push only as a normal fast-forward.
  Treat an immediate post-push read of that same old base as a retryable unconfirmed mutation;
  `resume` reconciles the new exact child once GitHub exposes it.
- **Why:** Initial publication intentionally rejects different remote content, but the first live
  canary exposed fixes that must be delivered without bypassing the receipt and credential
  boundaries. A remote source marker alone is insufficient if another commit lands between
  preflight and push. Binding the plan to the complete HEAD identity and retaining Git's
  fast-forward check protects both provenance and concurrency.
- **Rejected alternatives:**
  - Force-push the corrected generated tree: can erase user work or concurrent automation.
  - Relax initial-source adoption to accept any marked history: conflates bootstrap and updates,
    weakening the simpler empty/exact contract.
  - Copy files and run an ad-hoc authenticated push for the canary: proves neither a reusable
    product path nor safe resume behavior.
- **When to revisit:** Add a merge-aware upgrade workflow only when real generated repositories
  need to preserve user changes while accepting template revisions. Keep that separate from this
  exact-snapshot fast-forward lane.

### 47. Resolve the web tsconfig base by workspace-relative path

- **Date:** 2026-07-25
- **Decision:** Let `apps/web/tsconfig.json` extend
  `../../packages/config/tsconfig.next.json` directly. Keep package exports for runtime/tool
  imports, but do not depend on package-subpath resolution for TypeScript configuration
  inheritance.
- **Why:** The live canary's complete quality job passed, then Playwright 1.61 failed before test
  discovery because its internal tsconfig loader could not resolve
  `@repo/config/tsconfig.next.json` on Linux. TypeScript and Bun resolved the same path, making the
  problem invisible to lint, type-check, unit tests and builds. The relative path expresses the
  stable monorepo topology and works without a package-manager-specific resolver.
- **Rejected alternatives:**
  - Skip E2E in CI: removes the only browser-level gate.
  - Patch Playwright's loader or pin a platform-dependent workaround: couples the starter to an
    implementation detail that the local TypeScript compiler does not need.
  - Duplicate the shared config into `apps/web`: creates configuration drift.
- **When to revisit:** Reconsider package-specifier inheritance only when every supported
  TypeScript consumer, including Playwright's loader, resolves it consistently on Linux.

### 48. Keep Factory discovery and implementation history out of generated repositories

- **Date:** 2026-07-25
- **Decision:** Exclude `docs/discovery` and `docs/superpowers` from every generated repository,
  record both paths in the generation receipt, and make `doctor` reject them as development
  artifacts if they reappear. Keep reusable product documentation such as architecture, auth,
  security, CI and decisions in the generated project.
- **Why:** The live canary correctly excluded Harness, Factory code and agent governance, but a
  final output inspection found sandbox handoffs and historical implementation plans in the
  published application repository. They contained no secrets, yet exposed control-plane IDs and
  irrelevant development history. Template isolation includes operational context, not only
  executable dependencies.
- **Rejected alternatives:**
  - Leave the documents because they are harmless Markdown: generated repositories should not
    inherit Factory-specific history or sandbox identifiers.
  - Remove all documentation: discards useful product contracts that belong in the application.
  - Rewrite individual handoffs during generation: brittle content filtering is weaker than a
    path-level ownership boundary.
- **When to revisit:** Promote a document into the generated set only after rewriting it as
  reusable project documentation without Factory- or sandbox-specific state.

### 49. Bind delivery evidence to the exact source and keep protection bypass in memory

- **Date:** 2026-07-26
- **Decision:** Observe Vercel delivery through a separate `delivery:plan|preflight|live|resume`
  lifecycle. Bind its plan to the successful source-publication commit and source digest plus the
  provisioned Vercel team/project IDs and Production target. Poll only a deployment carrying that
  exact Git commit, require `READY`, then smoke the immutable deployment URL with manual redirects,
  HTTP 200, HTML content and project-identity checks. When Deployment Protection is active, send
  `VERCEL_AUTOMATION_BYPASS_SECRET` only through the `x-vercel-protection-bypass` request header.
  Persist non-secret deployment and smoke evidence in `.void-starter/delivery-state.json`.
- **Why:** A successful CI job or generic latest deployment does not prove that the published
  source snapshot is the application being exercised. Vercel SSO also makes an anonymous 302 a
  protection result rather than an application health result. Exact commit binding closes the
  provenance gap, while a memory-only bypass permits real HTTP validation without turning an
  access credential into source or receipt data. This follows Vercel's
  [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
  and [REST API](https://vercel.com/docs/rest-api) contracts.
- **Rejected alternatives:**
  - Accept the newest successful project deployment: can attest the wrong source revision.
  - Treat the SSO redirect as a passing smoke: proves protection configuration, not application
    availability.
  - Put the bypass in the URL, manifest, context or receipt: expands its exposure into logs,
    history and durable artifacts.
  - Disable Deployment Protection for the canary: weakens the sandbox instead of testing the
    intended production boundary.
- **When to revisit:** Prefer Vercel Trusted Sources/OIDC when the Factory runs inside an eligible
  workload with short-lived identity. Extend the receipt with migrations, authenticated health
  checks and canonical-domain evidence when those lifecycle stages exist.

### 50. Accept protected delivery only after an exact-commit live smoke

- **Date:** 2026-07-26
- **Decision:** Accept the first delivery-observation tranche after an isolated Vercel canary found
  the Production deployment for the exact published commit, observed `READY`, crossed Vercel
  Authentication with a process-memory-only automation bypass, and received HTTP 200 HTML
  containing the project identity. Require the resulting receipt to pass `doctor`, remain mode
  `0600`, and leave the publishable source SHA-256 unchanged. Keep provider IDs and canary-specific
  digests only in the excluded operational handoff, not in reusable generated documentation.
- **Why:** HTTP mocks prove request shape and failure semantics but cannot prove Vercel's current
  deployment metadata, team routing, protection redirect or bypass behavior. The canary connects
  the full evidence chain from the guarded Git source commit to the response body actually served
  by its immutable deployment URL, while the postchecks prove the operational receipt neither
  leaks into source nor weakens generated-project isolation.
- **Rejected alternatives:**
  - Accept `READY` without HTTP validation: proves Vercel's build state, not application delivery.
  - Accept the anonymous SSO 302: proves protection, not the application behind it.
  - Disable protection for the test: avoids the production boundary the lifecycle must support.
  - Persist the bypass as evidence: turns a successful security check into credential exposure.
- **When to revisit:** Re-run this canary after Vercel deployment/protection API changes. Add
  migration, authenticated-route and canonical-domain evidence as those lifecycle stages become
  available.

### 51. Migrate exact published Drizzle history before defining product seed

- **Date:** 2026-07-26
- **Decision:** Add a separate `migration:plan|preflight|live|resume` lifecycle. Bind its plan to
  the successful source-publication commit/digest, provisioned Neon identity, and the exact ordered
  Drizzle journal with each SQL SHA-256 and timestamp. Retrieve a direct Neon connection URI only
  into process memory. Require the remote migration log to be an exact prefix, hold a PostgreSQL
  advisory lock, apply pending entries through Drizzle's transaction, re-read the full history and
  persist only non-secret evidence in `.void-starter/migration-state.json`. Keep administrator
  bootstrap/seed separate until Better Auth onboarding supplies an explicit identity.
- **Why:** Running an unbound `drizzle-kit migrate` proves neither which published source supplied
  the SQL nor whether a remote database has divergent history. Local and database locks plus
  Drizzle's migration transaction make an interrupted attempt safely inspectable and resumable.
  Conversely, the current manifest contains no administrator email or invitation identity; a
  nominal seed would have to guess credentials or create misleading sample production data. The
  API and history contracts follow Neon's
  [connection URI endpoint](https://api-docs.neon.tech/reference/getconnectionuri) and Drizzle's
  [migration log](https://orm.drizzle.team/docs/drizzle-kit-migrate).
- **Rejected alternatives:**
  - Run `drizzle-kit migrate` manually with an exported URI: lacks plan binding, safe receipt and
    history-conflict diagnostics.
  - Read `DATABASE_URL` back from Vercel: sensitive Production variables are intentionally
    write-only to the Factory.
  - Use the pooled application URI: migrations and advisory locking belong on a direct database
    session, not the runtime pooler.
  - Seed a placeholder admin or demo note: creates privileged or misleading production records
    without product intent.
- **When to revisit:** Add a separate bootstrap receipt when the auth contract defines the exact
  administrator/invitation identity and real Resend delivery. Revisit the lock/migrator only if
  Drizzle changes its PostgreSQL transactional migration semantics.

### 52. Accept Neon migration only after empty-to-current history attestation

- **Date:** 2026-07-26
- **Decision:** Accept the first migration lifecycle after an isolated Neon canary authenticated
  the exact provisioned project, observed an empty Drizzle history, applied every published SQL
  entry in one attempt, and re-read the complete ordered history with the planned latest tag,
  SHA-256 and timestamp. Require the receipt to pass `doctor`, remain mode `0600`, and leave the
  publishable source digest unchanged. Keep provider IDs and canary-specific hashes in the excluded
  operational handoff only.
- **Why:** Mock databases prove plan and recovery logic but cannot prove current Neon connection
  URI behavior, direct endpoint compatibility, PostgreSQL advisory locking, Drizzle transactions,
  or durable migration-log writes. The live transition from zero to the exact planned count covers
  the mutation path and its immediate reconciliation, while local postchecks protect receipt and
  source-isolation invariants.
- **Rejected alternatives:**
  - Accept a successful Neon connection only: proves credentials, not schema mutation.
  - Inspect application tables without migration history: loses the binding between database state
    and the exact published SQL sequence.
  - Store the connection URI for later verification: creates a durable database credential leak.
  - Treat CI's ephemeral PostgreSQL migration as the production canary: does not exercise Neon or
    the provisioned project boundary.
- **When to revisit:** Re-run after Neon connection-URI or Drizzle migrator contract changes, and
  whenever migration strategy moves away from ordered SQL files and the Drizzle history table.

### 53. Materialize Resend as the required Better Auth production email adapter

- **Date:** 2026-07-26
- **Decision:** Promote `_modules/email-resend` from a README placeholder to a real server-only
  workspace selected by `operations.email: resend`. Route Better Auth verification, password reset
  and magic links through its direct Resend HTTPS adapter. Require Resend whenever Better Auth is
  selected, but retain local console links only when both sender variables are absent. Partial
  configuration and every unconfigured production send fail closed. Use text plus escaped HTML,
  bounded requests and deterministic Resend idempotency keys; never surface provider bodies or
  credentials in errors.
- **Why:** A production authentication profile that throws for every email is not turnkey, and
  implementing only magic links would leave verification and the existing reset UI broken. A
  direct HTTPS adapter keeps the dependency and browser bundle at zero while covering Resend's
  stable send-email contract. Requiring the adapter at manifest validation makes the declared
  production baseline truthful.
- **Rejected alternatives:**
  - Keep the placeholder and configure email manually per project: recreates drift and cannot be
    verified by generated-project tests.
  - Add only the Resend SDK: adds a supply-chain dependency for one stable HTTP endpoint without
    improving the local contract.
  - Fall back to URL logging in production: leaks bearer-style authentication links and masks a
    broken product flow.
  - Await a React Email design system: blocks functional delivery on presentation work; the
    adapter already has accessible HTML and text bodies and can adopt richer templates later.
- **When to revisit:** Adopt React Email when multiple branded transactional templates justify the
  dependency. Replace Resend only through the same three-purpose server port and manifest adapter.

### 54. Bind production auth through an exact, secret-free bootstrap plan

- **Date:** 2026-07-26
- **Decision:** Add a separate `auth:plan|preflight|live|resume` lifecycle after source publication
  and database migration. Keep canonical URL, verified Resend sender and exact bootstrap
  administrator in a strict non-secret context; read `VERCEL_TOKEN`, `BETTER_AUTH_SECRET` and
  `RESEND_API_KEY` only from process memory. Bind the two runtime secrets as Production-only
  Vercel Sensitive variables and the remaining runtime configuration as encrypted variables. Use
  a plain plan-digest ownership marker for reconciliation, send one idempotent configuration email
  to validate the sending boundary, and persist only opaque IDs and non-secret evidence. Grant
  `admin` through Better Auth's user-create hook only when the normalized new-user email exactly
  matches the planned identity. Require a new Production deployment before testing auth.
- **Why:** Authentication cannot be production-ready while its canonical origin, email provider
  and first administrator depend on dashboard folklore. At the same time, a seed with an invented
  password or placeholder user creates a durable privileged credential the product never asked
  for. Exact identity intent lets the real person establish their own Better Auth account while
  the hook atomically assigns the initial role. Vercel Sensitive values are write-only, so an
  explicit non-secret marker is the only safe way to distinguish adoption from foreign or partial
  configuration. Production-only targeting prevents previews from sharing the production
  database and authentication secrets.
- **Rejected alternatives:**
  - Store API keys or `BETTER_AUTH_SECRET` in the auth context or receipt: makes reproducible intent
    and operational evidence secret-bearing.
  - Seed an admin with a generated/default password: creates an unmanaged privileged credential.
  - Promote the first arbitrary signup: makes a deployment race determine production ownership.
  - Read Sensitive values back to compare them: Vercel deliberately makes them unreadable and the
    comparison would widen secret exposure.
  - Bind the production database/auth keys into Preview: couples untrusted preview code and branch
    authors to production identity and data.
  - Treat successful variable creation as a deployed configuration: Vercel injects environment
    changes only into subsequent deployments.
- **When to revisit:** Replace static API tokens with workload identity where providers support it.
  Add a guarded redeployment and authenticated-route observation receipt after the isolated live
  auth canary establishes the current Vercel and Resend contracts.

### 55. Accept production authentication after real identity bootstrap

- **Date:** 2026-07-26
- **Decision:** Accept the Better Auth production tranche after an isolated canary bound all eight
  planned Vercel Production variables, delivered the idempotent Resend configuration message from
  a verified subdomain, redeployed the exact source commit, passed the protected HTTP smoke and
  completed a real magic-link session for the exact bootstrap identity. Require `/admin` to report
  that identity with role `admin`, the auth/delivery/migration receipts to pass `doctor`, every
  receipt to remain mode `0600`, and the publishable source digest to remain unchanged.
- **Why:** Provider-mocked environment writes and email responses cannot prove Resend domain/key
  alignment, Vercel's post-binding deployment semantics, Better Auth callback URLs, cookie/session
  creation, database user hooks or the final authorization policy. The complete browser flow proves
  that the configured human identity, rather than an invented seed credential, receives the first
  administrator role across the real provider chain.
- **Rejected alternatives:**
  - Stop after the configuration email: proves Resend sending, not Better Auth's callback or role
    hook.
  - Inspect the database role directly without signing in: proves stored data, not session and
    route authorization.
  - Reuse the pre-binding deployment: Vercel does not inject changed variables retroactively.
  - Persist the magic link, provider tokens or secret values as evidence: turns authentication
    validation into credential disclosure.
- **When to revisit:** Add an automated authenticated-route receipt only if a short-lived canary
  identity can be exercised without persisting bearer links or session credentials. Re-run the
  live canary after Better Auth, Resend or Vercel environment contracts change.

### 56. Provision EAS identity through a receipt-owned source overlay

- **Date:** 2026-07-26
- **Decision:** Add a separate `eas:plan|preflight|live|resume` lifecycle for Expo projects. Keep
  only the Expo account in a strict non-secret context and read `EXPO_TOKEN` from process memory.
  Execute pinned `eas-cli@21.2.0` in an isolated temporary static config to create or adopt the
  exact `@account/slug`, verify its UUID through `project:info`, then write a public non-secret
  `apps/mobile/eas-project.json`. Have a stable generated `app.config.ts` consume that file while
  leaving generation-owned `app.json` byte-for-byte unchanged. Persist the operational plan and
  link digest in ignored mode-`0600` state, and make `doctor` reject unowned links. Do not start a
  native build or create signing/store credentials in this lifecycle.
- **Why:** EAS requires `extra.eas.projectId` in evaluated app configuration, but the ID exists only
  after a remote project is created. Letting the provider CLI rewrite `app.json` would invalidate
  the generation receipt and blur the boundary between deterministic template output and remote
  identity. The small checked-in overlay is non-secret, reproducible on fresh renders, and can be
  included in the next guarded source update. EAS uniqueness by account and slug also lets resume
  adopt an ambiguously created project rather than duplicate it. This follows Expo's
  [programmatic token](https://docs.expo.dev/accounts/programmatic-access/) and
  [EAS CLI project initialization](https://github.com/expo/eas-cli#eas-init) contracts.
- **Rejected alternatives:**
  - Run `eas init` directly in the generated mobile directory: allows an external CLI to mutate a
    receipt-owned file and potentially leave partial local changes.
  - Put the project ID or account into manifest v1 before creation: the UUID does not exist at
    intent time, and provider coordinates do not belong in product capability intent.
  - Pass the project ID only through an environment variable: makes every local, CI and remote EAS
    command depend on undeclared ambient configuration for a non-secret identity.
  - Install EAS CLI in the generated workspace: reintroduces the dependency and vulnerability
    graph already removed by decision 45.
  - Combine project creation with `eas build`: mixes a free identity mutation with signing,
    platform membership, build cost and store credentials that require separate approval.
- **When to revisit:** Accept the lifecycle only after an isolated live create/adopt/resume canary
  and a guarded source update prove current Expo behavior. Add EAS environment bindings and native
  build receipts only when the first mobile product defines its runtime secrets, platform target
  and signing ownership.

### 57. Accept EAS project provisioning after guarded publication

- **Date:** 2026-07-26
- **Decision:** Accept the Expo/EAS identity tranche after an isolated organization canary created
  and verified the exact `@account/slug`, wrote only the public UUID link, adopted the existing
  GitHub/Vercel/Neon resources from a fresh generated target, published that link as one guarded
  fast-forward, passed the complete quality and E2E workflow, and smoked the deployment for the
  exact source commit through Vercel protection. Require EAS initialization to run from a
  provider-owned temporary project containing a minimal `package.json` and an identity-only static
  Expo config. Surface redacted provider diagnostics only in process memory; keep receipts generic,
  mode `0600` and secret-free.
- **Why:** Contract mocks proved idempotence but could not prove EAS CLI's project-root discovery,
  config evaluation, robot-role behavior or the final Git/CI/deployment chain. The first two live
  attempts exposed two boundary assumptions: EAS requires a package root, and the isolated config
  must not carry runtime-only plugins into a dependency-free provider directory. The third attempt
  created and read back the UUID, while guarded source resume reconciled GitHub's temporarily stale
  post-push read without a second commit. The resulting CI build proves the checked-in overlay is
  consumable by the real Expo application rather than only by Factory tests.
- **Rejected alternatives:**
  - Run initialization directly in `apps/mobile`: lets EAS mutate receipt-owned generation output.
  - Copy the complete mobile dependency graph into the provider directory: couples identity
    creation to runtime install state and makes the isolated boundary misleading.
  - Treat project creation alone as acceptance: does not prove the UUID overlay survives source
    publication, CI config evaluation or a fresh Production deployment.
  - Persist raw EAS stderr for debugging: provider output is not a safe long-term receipt format.
- **When to revisit:** Add a separate guarded EAS environment/build lifecycle only when a real
  mobile product supplies runtime-secret requirements, target platforms, signing ownership, store
  memberships and explicit cost approval. Re-run this canary after material EAS CLI project-init or
  Expo configuration changes.

### 58. Provision private EU R2 storage inside the guarded provider lifecycle

- **Date:** 2026-07-26
- **Decision:** Extend the deterministic provider plan with `cloudflare.r2-bucket` and, for a
  Vercel web surface, `vercel.r2-binding`. Keep only the 32-character Cloudflare account ID in the
  strict non-secret provisioning context. Read `CLOUDFLARE_API_TOKEN` and, when available,
  `R2_ACCESS_KEY_ID` plus `R2_SECRET_ACCESS_KEY` from process memory. Derive the bucket name from
  the exact project slug, require jurisdiction `eu` and storage class `Standard`, and send the
  jurisdiction header on every R2 request. Before adoption, reject enabled managed or custom
  public domains. Run one deterministic upload/read/delete object canary. If the runtime pair is
  absent, persist a retryable binding failure so the operator can issue credentials scoped to that
  exact bucket and finish with `resume:live`; otherwise bind the account, bucket, EU endpoint and
  runtime keys to Vercel with a plain idempotency-key ownership marker. Persist only the bucket ID,
  name, account ID, EU/private attestation, canary digest, binding marker ID and bound-key names.
- **Why:** The manifest already selects `cloudflare-r2-eu` for durable private documents, but an
  environment-variable scaffold does not prove that storage exists, remains in the EU, is private,
  accepts object I/O or reaches the deployed runtime. Cloudflare's
  [bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
  exposes an explicit `eu` jurisdiction, and its
  [public-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/list/)
  makes privacy observable before adoption. The object canary proves byte-level storage without
  leaving test data. Existing Vercel Sensitive/Development binding semantics and the generic
  atomic apply receipt preserve the same recovery and secret-handling boundary as Neon.
- **Rejected alternatives:**
  - Treat a location hint as EU residency: hints influence placement but do not provide the
    jurisdictional guarantee required by the manifest.
  - Trust default bucket privacy without reading domain state: a previously created bucket may
    have acquired a managed or custom public domain outside this plan.
  - Put Cloudflare or R2 credentials in the manifest/context/receipt: turns reproducible product
    intent and operational evidence into secret-bearing artifacts.
  - Generate a new R2 API token inside every apply: the secret value is shown only at creation,
    cannot be recovered during stateless adoption, and requires a broader token-management
    permission than bucket provisioning.
  - Repeat a timed-out bucket create on resume: risks duplicating or conflicting with a mutation
    whose outcome is unknown; resume must only reconcile after an ambiguous create.
- **Acceptance evidence:** The isolated canary passed on 2026-07-27 with plan
  `7a7be8babbdb8240ca34e7855bff008cf7f4302b85b0dbfd6797cd771afb0770`. It created the EU/private
  bucket `void-starter-canary-20260725` (`f520e89b2e934d96a7b4275140e122b7`), proved the exact object
  round trip and deletion, then paused until exact-bucket runtime credentials were available and
  adopted Vercel binding `ERMGEG72S7cCdvST`. A completed-state resume changed no attempt counter;
  a fresh secret-free local state adopted the same six provider IDs with one attempt each. The
  first real upload also exposed that Cloudflare's object endpoint requires a raw octet-stream
  body rather than multipart form data; the corrected contract is now enforced by the HTTP mock.
- **When to revisit:** Revisit credential generation when a recoverable workload-identity or
  short-lived credential flow can replace static R2 keys, or when the Cloudflare object API,
  jurisdiction guarantees or Vercel secret semantics materially change.

### 59. Separate Sentry control-plane provisioning from release-upload credentials

- **Date:** 2026-07-27
- **Decision:** Extend the deterministic provider plan with `sentry.project` and
  `vercel.sentry-binding` whenever a Next.js project selects the Sentry error adapter. Keep only
  the exact organization slug, team slug and literal `de` region in the strict non-secret
  provisioning context. Use `SENTRY_API_TOKEN` for authenticated organization/team preflight,
  lookup-before-create and project/client-key reads against `de.sentry.io`. Fix the project
  platform to `javascript-nextjs`, require one exact active client key, and persist only opaque
  project/key IDs plus a SHA-256 of the public DSN. Use the separate optional
  `SENTRY_BUILD_AUTH_TOKEN` only when binding `SENTRY_AUTH_TOKEN` to Vercel. If it is absent,
  record retryable `SENTRY_BUILD_AUTH_TOKEN_MISSING` and finish through `resume:live`. Bind both
  DSN names, organization and project alongside the build token, protected by a plain
  idempotency-key ownership marker. Never persist or read back any token or DSN value.
- **Why:** Runtime event ingestion needs a public DSN, while private source-map/release uploads
  need a credential with materially different authority. Treating those as one ambient token
  widens application access and makes rotation ambiguous. Sentry's
  [regional API contract](https://docs.sentry.io/api/) identifies `de.sentry.io` as the Germany
  region; its [project creation endpoint](https://docs.sentry.io/api/projects/create-a-new-project/)
  and [client-key listing endpoint](https://docs.sentry.io/api/projects/list-a-projects-client-keys/)
  provide the reads and mutation needed for deterministic reconciliation. The two-phase boundary
  lets the project exist before a narrowly purposed build credential is supplied, while the
  generic atomic apply receipt preserves safe resume semantics.
- **Rejected alternatives:**
  - Reuse `SENTRY_API_TOKEN` as `SENTRY_AUTH_TOKEN`: couples provider administration to every
    application build and gives a leaked build secret broader authority than source-map upload
    requires.
  - Persist the public DSN in apply state because it is not an account secret: receipts are
    durable provenance, not runtime configuration; an opaque key ID and digest are sufficient to
    detect drift before rebinding.
  - Select the first client key returned by the API: list order is not an ownership contract and
    could silently bind a stale or additional key.
  - Accept a US organization through the global API hostname: violates the manifest's EU-primary
    operational intent and makes the region claim unobservable.
  - Repeat an ambiguous project create on resume: risks duplicating a mutation whose result is
    unknown; resume must reconcile only after an ambiguous create.
- **Acceptance evidence:** Provider-mocked contracts cover active-DE identity preflight, project
  creation and adoption, exact client-key selection, separate-token two-phase resume, Vercel
  ownership-marker reconciliation, ambiguous-create suppression, wrong-region rejection and
  absence of credentials/DSN values from persisted state. The isolated canary passed on 2026-07-27
  with plan `7cacd9647fd4dd1188fadb68ee783d0a144753589cedcbafa4e27622b59577e0`. It adopted the six
  existing provider resources, created DE project `4511807245516880`, paused before binding until
  the separate build token was available, then adopted Vercel marker `hHSyb6KDUXFU6K7I` on resume.
  Completed-state resume kept attempts `1,1,1,1,1,1,1,2`; fresh secret-free state adopted all eight
  IDs with one attempt each. Both receipts passed `doctor`, remained mode `0600`, and a dynamic
  comparison found none of the eight keyring credentials or the public DSN in either state file.
- **When to revisit:** Revisit the static build token when Sentry and Vercel expose a recoverable
  workload-identity or short-lived release-upload flow, when multi-key rotation becomes a product
  requirement, or when Sentry's regional API and Vercel secret semantics materially change.

### 60. Reconcile PostHog EU projects without persisting their public project key

- **Date:** 2026-07-27
- **Decision:** Extend the deterministic provider plan with `posthog.project` and
  `vercel.posthog-binding` whenever a Next.js surface selects PostHog analytics. Keep only the
  exact organization ID and literal `eu` region in the strict non-secret context. Use a
  process-memory `POSTHOG_PERSONAL_API_KEY` limited to `organization:read`, `project:read` and
  `project:write` against `eu.posthog.com`. Perform paginated exact-name lookup before create,
  reconcile after create, and suppress every repeated mutation after an ambiguous response.
  Persist only project/organization identity, the EU attestation and a SHA-256 of `api_token`.
  Re-read the exact project and verify that digest before binding encrypted
  `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST=/ingest` values to every Vercel target.
  Protect the binding with a plain `VOID_STARTER_POSTHOG_BINDING_ID` ownership marker. Validate
  provider IDs as exact UUID-shaped lowercase hexadecimal strings, without imposing RFC
  version/variant bits that PostHog Cloud does not consistently emit.
- **Why:** PostHog's
  [official EU OpenAPI contract](https://eu.posthog.com/api/schema/swagger-ui/) exposes
  organization reads and organization-scoped project list/create/retrieve endpoints with the
  three selected scopes. The project `api_token` is intended for client ingestion, but a receipt
  still needs only enough evidence to detect drift; its digest plus the recoverable provider ID is
  sufficient. Reusing the existing first-party `/ingest` proxy preserves ADR 28's EU upstream,
  CSP and blocker-resistance contract without adding a direct third-party browser origin. The
  same atomic receipt and lookup-only ambiguity boundary already proven for Neon, R2 and Sentry
  makes both completed-state resume and secret-free stateless adoption deterministic.
- **Rejected alternatives:**
  - Persist `api_token` because it is public: receipts are provenance, not runtime configuration,
    and storing the raw key adds no reconciliation capability beyond its digest.
  - Bind `https://eu.i.posthog.com` directly: bypasses the selected `/ingest` first-party proxy and
    weakens the runtime privacy/CSP contract.
  - Trust the OpenAPI `format: uuid` constraint literally: the live EU organization ID
    `019d9316-714e-0000-01c7-e9a08d38242b` is UUID-shaped but has neither RFC version nor variant
    bits; rejecting the provider's own ID prevents safe preflight and adoption.
  - Select the first search result or ignore pagination: either can adopt a similarly named or
    hidden later-page project instead of the one exact resource.
  - Repeat a timed-out project or binding create: risks duplicate projects or unowned Vercel
    variables when the provider accepted the first mutation.
- **Acceptance evidence:** Provider-mocked contracts cover EU organization preflight, project
  creation/adoption, paginated exact matching, key-digest verification, Vercel ownership
  conflicts, project and binding ambiguity suppression, and absence of credentials/project keys
  from state. The isolated canary passed on 2026-07-27 with plan
  `9d7a61823147d36f96447c98243cf0a8cab052f00b4e2b9b4e516b6c0a691617`. It adopted the eight
  historical provider resources, created PostHog project `233588`, exposed the UUID-format
  mismatch during reconciliation, then resumed by adopting that exact project without a second
  create and bound Vercel marker `KHP1Sghuyxh0KK7M`. Completed-state resume kept attempts
  `1,1,1,1,1,1,1,1,2,1`; a fresh state adopted all ten IDs with one attempt each. Both receipts
  passed `doctor`, remained mode `0600`, and a dynamic comparison found none of nine provider
  credentials, the Sentry DSN or the PostHog project key.
- **When to revisit:** Revisit the static personal key when PostHog offers recoverable short-lived
  workload identity for project administration, when the provider normalizes its organization IDs
  to RFC UUIDs, or when its project and environment API model changes materially.

### 61. Materialize DNS as an owned subdomain mutation with propagation-gated success

- **Date:** 2026-07-27
- **Decision:** Resolve manifest `auto-detect` DNS intent only when the strict non-secret
  provisioning context supplies one exact Cloudflare account, zone ID/name and strict subdomain.
  Add `vercel.project-domain` before `cloudflare.dns-record`. Attach the hostname to the exact
  Vercel project, read Vercel's current rank-1 recommended CNAME, and create a DNS-only Cloudflare
  CNAME with TTL 60 and the action idempotency key in the record comment. Materialize any Vercel
  TXT ownership challenge with its own derived comment. Succeed only after Cloudflare readback,
  Vercel project-domain verification and `misconfigured=false`. Treat propagation as retryable,
  suppress repeated ambiguous creates, reject unmarked/drifted records, fix nameserver changes to
  false and estimated monthly cost to zero, and stop on a known paid-upgrade response. Do not
  automate rollback; document the safe manual order as owned DNS records first and Vercel
  project-domain attachment second.
- **Why:** Cloudflare exposes explicit record comments on every plan through its
  [DNS record API](https://developers.cloudflare.com/api/resources/dns/subresources/records/), so
  ownership can be proven without a companion secret or paid tag feature. Its
  [zone API](https://developers.cloudflare.com/api/resources/zones/methods/list/) makes account,
  zone name and active authoritative status observable during read-only preflight. Vercel now
  returns project-specific recommended CNAME values through domain configuration; using that
  value avoids freezing the legacy shared target. Vercel's
  [custom-domain guidance](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
  supports subdomains through CNAME, while a propagation-gated receipt prevents an accepted API
  mutation from being confused with a working public domain.
- **Rejected alternatives:**
  - Hard-code `cname.vercel-dns.com`: Vercel supplies ranked project-specific targets and can
    change the preferred value independently of Factory releases.
  - Support zone apex in this tranche: apex records require A/flattening choices and introduce a
    wider cutover/rollback blast radius than an isolated project subdomain.
  - Enable the Cloudflare proxy: double-CDN/TLS semantics are outside the selected Vercel origin
    contract; the first adapter is deliberately DNS-only.
  - Adopt an identical unmarked record: content equality does not establish ownership and would
    let Factory mutate or later remove another operator's record.
  - Change nameservers automatically: registrar delegation affects the whole zone and requires a
    separate explicit approval and rollback plan.
  - Delete the project domain or DNS record after a later failure: rollback can destroy a
    previously adopted public route; recovery is safer through reconciliation and an explicit
    operator decision.
- **Acceptance evidence:** Provider-mocked contracts cover exact-zone read-only preflight,
  deterministic domain/CNAME creation, TXT verification, comment ownership, stateless adoption,
  propagation-only resume, foreign-record rejection, ambiguous Vercel/Cloudflare mutation
  suppression, paid-upgrade refusal and absence of nameserver calls. The live isolated-zone
  canary remains the final acceptance gate.
- **When to revisit:** Add apex, Cloudflare proxy, Gandi LiveDNS or Vercel DNS only with equivalent
  ownership evidence, propagation checks and rollback boundaries. Revisit automatic rollback when
  provider APIs expose transactional or compare-and-delete guarantees tied to the exact ownership
  marker.
