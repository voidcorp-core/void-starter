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
- **Decision:** `@void/auth` ships Better-Auth (self-hosted, open source) wired with email/password + Google OAuth + magic link + roles. Clerk is available as an alternative via `_modules/auth-clerk/`.
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
  - Single `@void/actions` package: doesn't change the Next coupling, just centralizes the problem
- **When to revisit:** If the project decides to ship only Next.js apps forever and accepts the coupling. Currently no plan to do so.

### 04. Build-time module activation via env vars, not runtime

- **Date:** 2026-05-07
- **Decision:** Optional packages (Sentry, PostHog, etc.) are activated by env var presence at build time. Server-side via conditional dynamic imports in `instrumentation.ts`. Client-side via `NEXT_PUBLIC_*` vars enabling DCE. No runtime feature flag service.
- **Why:** This is the Next.js native pattern (`instrumentation.ts` was designed for it). It minimizes bundle size, reduces attack surface, and aligns with the Vercel deploy model where env changes trigger a 30-second redeploy. Runtime toggling has no real use case for Void Factory's profile (4-week MVPs that commit to a vendor at start).
- **Rejected alternatives:**
  - LaunchDarkly / GrowthBook / custom flag service: latency, vendor lock-in, complexity, real flagging not needed
  - Conditional package install (no `@void/sentry` in package.json if unused): more friction than env var, requires `bun add` to enable
  - Always-on imports with empty implementations: wastes bundle size
- **When to revisit:** If a project legitimately needs runtime feature flags for A/B testing or multi-tenant feature gating. Then add a feature flag module, do not migrate the activation pattern.

### 05. Custom `defineAction()` wrapper instead of `next-safe-action`

- **Date:** 2026-05-07
- **Decision:** `@void/core/server-action` ships a ~60-line custom wrapper exposing `defineAction({ schema, auth, handler })` covering Zod parse, auth check via `@void/auth`, error normalization, and structured logging.
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
- **Decision:** A workspace package exists if and only if (a) it has a clear domain scope (auth, db, ui, core, config), OR (b) it will be consumed by 2+ apps. Forbidden: `@void/utils`, `@void/constants`, `@void/hooks`, `@void/types`, `@void/helpers`.
- **Why:** Each package costs a `package.json`, a `tsconfig.json`, a build step, cross-package imports, Renovate entries, and CI overhead. Micro-packages multiply this cost without delivering domain value. KISS prevails.
- **Rejected alternatives:**
  - Atomic-style decomposition (`@void/types`, `@void/utils`, etc.): premature abstraction, slow iteration, unclear ownership
  - Single mega-package (`@void/lib`): defeats the purpose of monorepo isolation
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
- **Decision:** `@void/db/client` exposes a single `getDb(): Database` function. The postgres-js pool and Drizzle instance are constructed on first call, memoized in a module-local slot for the lifetime of the process, and additionally stashed on `globalThis` in non-production so Next.js HMR-reloaded modules reuse the same pool. No `{ max }` is set on postgres-js.
- **Why:** Eager pool construction at module load leaks a fresh connection on every Next.js dev hot-reload and forces every importer (knip, tsc, biome, build-time scripts) to have `DATABASE_URL` set just to load the module. Lazy + memoized + globalThis-cached avoids both, while keeping a single per-process pool in production. The Neon pooled endpoint manages connection limits server-side, so a hand-tuned `{ max }` is cargo-culted noise.
- **Rejected alternatives:**
  - Eager pool construction at module load: leaks connections on Next.js hot reload and forces env validation at import time, breaking type-check / knip / biome on any package that transitively imports `@void/db/client`.
  - Eager env validation + lazy pool: would catch `DATABASE_URL` typos at module load. Rejected because static analyzers (knip, tsc, biome) import `@void/db/client` without `DATABASE_URL` set, and Zod URL validation at module load would break those workflows the same way eager pool construction did.
  - `Proxy`-wrapped `db: Database` const: the Proxy hop fires on every property read, breaks `instanceof` / type narrowing / devtools display, and adds zero capability over a function call. No 2026 reference (Vercel, Drizzle docs, Neon docs, next-forge, t3-stack) prescribes it.
  - Replacing `createAppEnv` with `required()` inside the client: loses Zod URL validation that catches `localhost` typos and missing `postgres://` schemes.
- **When to revisit:** If we ship a non-Vercel deploy target without a Neon-style server-side pooler, reconsider postgres-js options (explicit `{ max }`, `idle_timeout`). If a future Drizzle release ships a first-party request-scoped client, evaluate replacing the Node singleton with it.

### 13. `required()` env helper + drizzle-kit `dbCredentials.url` getter

- **Date:** 2026-05-08
- **Decision:** `@void/core/env` exports a small `required(name: string): string` that throws `Missing required env var: <NAME>` on absent or empty values. `packages/db/drizzle.config.ts` consumes it through a `dbCredentials.url` getter, so the env read fires at command-time rather than at config-load time.
- **Why:** Config files consumed by CLIs (drizzle-kit) need a one-line, loud presence check; the full `createAppEnv` schema is overkill there. The getter is the load-bearing trick: knip's drizzle plugin only reads the `schema` key and loads the config without `DATABASE_URL`, while `drizzle-kit migrate`/`studio`/`push` still fail loud the moment they reach for the URL. `drizzle-kit generate` does not need a URL by design.
- **Rejected alternatives:**
  - Empty-string fallback in `drizzle.config.ts` to please knip: silent failure mode on `drizzle-kit migrate`. Loud failure beats silent default.
  - Inline `process.env['DATABASE_URL'] ?? throw ...` at the top of `drizzle.config.ts`: same behaviour at the cost of repeating the error message everywhere; centralising in `required()` keeps the contract uniform across packages.
  - Reusing `createAppEnv` in `drizzle.config.ts`: pulls Zod and the t3-env runtime into a config file that only needs a presence check, and would still need the getter trick to defer the read.
- **When to revisit:** If knip exposes a directive to skip a single config file from plugin-driven evaluation, the getter can be replaced by a plain expression with `required()`. If `required()` grows beyond presence checks (validation, defaults, transforms), promote those use cases to `createAppEnv` rather than expanding the helper.

### 14. Centralized vitest base config with `passWithNoTests`

- **Date:** 2026-05-08
- **Decision:** `packages/config/vitest.base.ts` owns the shared vitest defaults for the monorepo, including `passWithNoTests: true`. Each package's `vitest.config.ts` re-exports the base config and only diverges when a package has package-specific needs (custom setup files, environment, coverage thresholds).
- **Why:** Skeleton packages without tests yet (typical mid-phase state) would otherwise fail `bun run test` and break the Turborepo pipeline. Setting `passWithNoTests` once at the source means every future package skeleton inherits it instead of replicating a `--passWithNoTests` plaster in each `package.json`. Aligns with how the monorepo already centralizes biome (`biome.base.json`) and tsconfig (`tsconfig.lib.json`).
- **Rejected alternatives:**
  - `--passWithNoTests` flag per-package: replicates across every future skeleton, drifts over time, and hides the convention from contributors.
  - Inline duplication of the full base config in every `vitest.config.ts`: same drift problem, and changes to the base require touching every package.
  - Skipping the test step entirely on empty packages via Turborepo task filters: hides genuinely missing test files behind a config quirk and is harder to debug than a one-liner config.
- **When to revisit:** If a package legitimately wants to fail-on-empty (e.g. a contracts package where missing tests are a regression), override `passWithNoTests` locally in that package's `vitest.config.ts`.

### 15. `@void/auth` opts out of `.d.ts` declaration emit (TS2742 dual-zod workaround)

- **Date:** 2026-05-09
- **Decision:** `packages/auth/tsconfig.json` overrides the `tsconfig.lib.json` defaults with `declaration: false` and `declarationMap: false`. Type-checking still runs via `tsc --noEmit`; only declaration emit is disabled, scoped to this one package.
- **Why:** Better-Auth 1.6.x ships its own nested `zod@4` under `node_modules/better-auth/node_modules/zod`, while the monorepo standardizes on `zod@3.x` at the root. The inferred return type of `betterAuth(...)` therefore traverses `better-auth/node_modules/zod/v4/core`, a path TypeScript refuses to synthesize into a portable `.d.ts` (TS2742). Workspace consumers of `@void/auth` resolve types straight from TypeScript source via `package.json#exports` (the entire monorepo uses `./src/*.ts` exports, never built outputs), so the declaration files were never consumed downstream — the declaration emit was pure overhead AND a blocker. Disabling it lets `betterAuth(...)` keep its full plugin-augmented inferred type at every call site.
- **Rejected alternatives:**
  - `as Auth<typeof options>` annotation: `Auth` from `better-auth` defaulted to base options drops plugin-injected fields (admin's `banned`, `role`, etc.); annotating with `Auth<typeof options>` shifts the same TS2742 onto the inferred `options` const because the magicLink callback parameter type also traverses `zod/v4/core`. Both regress consumer ergonomics.
  - `// @ts-expect-error` / `// @ts-ignore` directives: TS2742 is a declaration-emit diagnostic, not a typechecker diagnostic — suppression directives are reported as unused and do not affect emit-time errors.
  - Adding a Bun `overrides` / `resolutions` for zod to force a single hoisted version: forces `zod@4` upstream on every `@void/*` package; that is a project-wide migration (Phase D backlog), not a Phase B local fix.
  - Disabling `declaration` at the `tsconfig.lib.json` root: bleeds the workaround into every package whether or not it has the dual-zod problem; loses declaration emit for packages that may legitimately want it (e.g., future external publication).
- **When to revisit:** When the project migrates to `zod@4` across all `@void/*` packages and the install dedupes to a single zod copy, drop this override and re-enable `declaration: true`. Verify with `cd packages/auth && bunx tsc --noEmit --declaration` returning zero errors.

### 16. `@void/ui` RSC boundary: `'use client'` only on interactive primitives

- **Date:** 2026-05-09
- **Decision:** Components in `@void/ui` declare `'use client'` only when they own behavior that requires client-side React (DOM event handlers via props that React must serialize through the boundary, refs forwarded to interactive elements, or hooks). Layout primitives that only render markup based on props remain pure server components with no directive. Initial inventory:
  - `'use client'`: `Button`, `Input`, `Label`, `Avatar` (all accept event handlers and/or wrap a Radix primitive that uses hooks internally — see ADR 18).
  - Server (no directive): `Card` (+ `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`).
- **Why:** Next.js 16 with React 19 RSC means every directive choice has runtime cost. A blanket `'use client'` on every UI primitive forfeits server rendering for the entire subtree, ships unnecessary JavaScript, and defeats the point of using App Router. Conversely, omitting `'use client'` on a component that consumers want to attach `onClick` to surfaces a confusing `Functions cannot be passed directly to Client Components` error at the wrong layer (the `apps/web` page boundary) instead of at the primitive itself. The convention "interactive primitive = client, layout primitive = server" gives consumers a predictable mental model: if you can imagine a `useState` inside it, it's a client component; otherwise server.
- **Ref forwarding idiom:** Interactive primitives accept `ref` as a regular prop (typed as `Ref<HTMLElement>`) rather than wrapping the component in `forwardRef`. React 19 dropped the requirement: refs are now forwarded automatically when declared as a prop, and `forwardRef` is on the deprecation runway. This keeps the component a plain function (cleaner stack traces, no `displayName` boilerplate) while preserving full ref support for consumers who need it.
- **Rejected alternatives:**
  - Mark all `@void/ui` components `'use client'`: simpler rule, but eliminates server-rendering benefits for the bulk of layout markup (cards, avatars, future `Stack`, `Container`, `Divider`, etc.). Doesn't scale.
  - Mark none and let consumers wrap interactive uses in their own client components: shifts boilerplate to every consumer call site and makes `<Button onClick={...}>` impossible to use directly in a server component, which is the primary ergonomic win of shared primitives.
  - Split into two packages (`@void/ui-server` + `@void/ui-client`): premature, doubles the import surface, and the boundary is already enforced per-file by the directive — no need to encode it in package layout.
  - Keeping `forwardRef` for ecosystem inertia — rejected because React 19 deprecated the requirement; the project's quality bar is 2026 idiomatic, not lowest-common-denominator.
- **Convention going forward:** When adding a new `@void/ui` component, the first question is "does this component receive function props or hold state?" If yes, file starts with `'use client';`. If no, no directive. If the component composes children that may be interactive (e.g., a `Modal` that wraps arbitrary content), the wrapper itself decides based on whether IT needs interactivity, not based on what children might pass through.
- **When to revisit:** If a layout primitive (e.g., `Card`) ever grows interactive behavior (collapsible state, hover-controlled animations driven from JS), promote it to `'use client'` in the same commit that adds the behavior — never speculatively.

### 17. CVA for typed variant primitives in `@void/ui`

- **Date:** 2026-05-09
- **Decision:** `@void/ui` uses `class-variance-authority` (CVA) to declare variant-driven components (`Button`, future complex primitives). Variant types are derived via `VariantProps<typeof X>` rather than hand-written.
- **Why:** CVA is the de-facto 2026 standard (used by shadcn/ui v3), gives type inference for free, supports compound variants, and weighs ~2KB. Manual `Record<Variant, string>` helpers re-invent this with worse ergonomics — no inference, no compound variants, more code to maintain across N components.
- **Rejected alternatives:**
  - Hand-rolled `getButtonClasses(variant, size)` helper: works for one component but rots into duplication as soon as a second variant component lands. No type inference; types like `ButtonVariant` / `ButtonSize` must be hand-written and kept in sync.
  - tailwind-variants (tw-variants): newer, supports slots/composition, but adds a layer of API surface `@void/ui` doesn't need yet. Revisit if multi-slot components become common.
  - Stitches / vanilla-extract: full CSS-in-JS solutions; out of scope for a Tailwind-first design system.
- **When to revisit:** When `@void/ui` needs multi-slot composition primitives (e.g., a Card with named regions), evaluate tailwind-variants as a successor. Until then, CVA is sufficient and lighter.

### 18. Radix UI primitives as the substrate for `@void/ui` interactive components

- **Date:** 2026-05-09
- **Decision:** Interactive primitives in `@void/ui` are built on `@radix-ui/react-*` packages rather than from-scratch DOM. Initial substrate: `@radix-ui/react-avatar` (Avatar), `@radix-ui/react-slot` (Button `asChild`), `@radix-ui/react-label` (Label). Future interactive primitives (Dialog, Popover, DropdownMenu, Toast, Tooltip, Select, Switch, Checkbox, RadioGroup, etc.) follow the same rule: pull the matching `@radix-ui/react-*` and wrap it with our CVA + Tailwind theming layer. Variant typing remains ours via CVA; behavior, accessibility, and DOM correctness come from Radix.
- **Why:** Radix is the de-facto 2026 substrate for accessible, unstyled React primitives (used by shadcn/ui, every major Vercel sample, and most production design systems). Building from scratch means re-implementing focus traps, escape handling, ARIA wiring, keyboard nav, RTL support, controlled/uncontrolled state, and SSR safety — work that takes weeks per primitive and is incident-prone (subtle regressions on every React/browser update). The cost we avoid is far greater than the ~2-5KB per primitive Radix adds; bundle weight is dominated by app code, not by primitives. The replacement of the raw `<img>` Avatar (no loading state, broken-image flash) with Radix Avatar (tri-state machine: idle → loading → loaded/error, fallback on both error AND not-yet-loaded) is the canonical example of why we don't roll our own. Radix also keeps the `@void/ui` surface aligned with shadcn/ui v3 vocabulary, which lowers AI-assistant friction (every modern LLM has shadcn snippets in training data).
- **Rejected alternatives:**
  - **Headless UI (`@headlessui/react`):** good quality but narrower catalogue (no Avatar, no Toast, no Slot), tighter coupling to Tailwind, and slower release cadence. Loses the shadcn/ui ecosystem alignment.
  - **Ariakit:** technically excellent and arguably more rigorous than Radix, but smaller mindshare in 2026, fewer LLM-trained snippets, and the project has explicitly identified itself as the lower-traffic alternative. No upside that justifies leaving the ecosystem standard.
  - **Build everything from scratch:** rejected outright. Folpe's quality bar ("ultra moderne, exceptionnel") is incompatible with hand-rolled a11y; the venture builder cadence (~24 MVPs/year) makes the per-primitive amortization horrible (we'd reinvent Dialog ~24 times); and the failure mode (a primitive that ships an a11y bug into 24 MVPs at once) is a brand-integrity disaster. The earlier from-scratch Avatar already shipped the broken-image-flash regression — proof that even our trivial primitives benefit from delegation.
  - **Adopt shadcn/ui directly via the CLI (copy components into the repo):** considered. Rejected because shadcn's distribution model assumes a single Next.js app with components living in `app/components/ui/`; in a monorepo with `@void/ui` as a shared workspace package, copying snippets per-app fragments the source of truth and prevents cross-app upgrades. We use shadcn as a *reference* (vocabulary, copy-pastable structure) but vendor our own thin wrappers in `@void/ui` so the workspace contract holds.
- **Conventions going forward:**
  - One Radix primitive per `@void/ui` component file. No re-exporting `RadixDialog.Trigger` etc. directly — always wrap so the public surface is `<Dialog>`, `<DialogTrigger>`, etc., styled with our tokens and CVA variants.
  - `'use client'` on every Radix-backed primitive (they all use hooks/context) — consistent with ADR 16 ("interactive primitive = client").
  - Renovate handles minor/patch upgrades automatically. Major bumps go through `docs/DECISIONS.md` only if a public API breaks for our wrappers.
- **When to revisit:** If the React ecosystem shifts to a successor primitive library with broader adoption than Radix (signals: shadcn/ui swaps substrate, Vercel templates swap, the React team blesses an alternative), evaluate migration. If Radix abandons React 19+ support for an extended window without a clear successor, evaluate Ariakit at that point.

### 19. Dark mode via next-themes + Tailwind v4 class strategy

- **Date:** 2026-05-09
- **Decision:** `@void/ui` ships `<ThemeProvider>` (wrapping `next-themes`) + a `.dark { --color-*: ... }` block in `globals.css`. Consumers mount `<ThemeProvider attribute="class">` once in their root layout; toggling `class="dark"` on `<html>` re-binds the design tokens automatically via the CSS cascade.
- **Why:** next-themes is the de-facto 2026 React dark-mode lib (used by shadcn/ui v3, next-forge, t3-stack). It handles system-preference detection, localStorage persistence, FOUC avoidance, and SSR safely. Tailwind v4's `@custom-variant dark` + class selector is the v4-idiomatic way to gate dark variants without v3's `tailwind.config.js`.
- **Rejected alternatives:**
  - CSS-only `[data-theme]` toggle without next-themes: requires hand-rolling system-preference + persistence + FOUC + SSR safety. ~80 lines of brittle client code.
  - `@media (prefers-color-scheme: dark)` only: no manual toggle, no per-user preference. Bad UX.
  - Stitches / vanilla-extract: full CSS-in-JS; out of scope for a Tailwind-first design system.
- **When to revisit:** When Tailwind v5 lands or if next-themes' SSR story drifts from Next.js 16+ Cache Components. Until then, this is stable.
