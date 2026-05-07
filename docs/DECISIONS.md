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
