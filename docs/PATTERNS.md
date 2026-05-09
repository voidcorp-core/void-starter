# Patterns

This document captures the implementation conventions every contributor (human or AI) must follow when writing code in this starter. The architectural rationale lives in `docs/DECISIONS.md`. The boundary table and topology live in `docs/ARCHITECTURE.md`. This file is the day-to-day cookbook.

Every convention here reflects code that already exists in the repo. If you find code that disagrees with this doc, the doc is the source of truth -- fix the code, or open an ADR to change the convention.

---

## 1. Principles

### KISS

Keep interfaces small, dependencies few, abstractions earned. The starter forbids dependency injection containers (tsyringe, awilix), explicit CQRS buses, micro-packages (`@void/utils`, `@void/hooks`, `@void/types`), and runtime feature flag services. Each of those carries weight (~100KB runtime, ~hours of contributor onboarding, multi-package upgrade churn) and earns nothing at the venture-builder scale of ~24 MVPs/year. See `docs/DECISIONS.md` entry 07 (no micro-packages) and entry 10 (no DI, no CQRS).

### DRY

Share what is shared. Once two services need the same domain logic, promote it into a `helper.ts` (pure) or a domain package (cross-cutting). But do not pre-share: avoid the abstract "utility" package that collects unrelated functions. Reuse comes from clear domain ownership, not from a junk drawer.

### SoC (Separation of Concerns)

Every file owns one concern. The 5+5 service layout (section 3) is the canonical expression of SoC: a service file does domain logic, a repository file does I/O, a helper file is pure, types and policies live in their own modules. Components do not touch the DB. Repositories do not call other services. Cross-service flows live in app-level use-cases, never inside a single service.

### Quality bar: "ultra moderne, exceptionnel"

The Folpe standard, applied to every change:

- **No hand-rolled accessibility.** Interactive primitives wrap Radix (see ADR 18). Focus management, keyboard nav, ARIA wiring come from a library that has been audited, not from us.
- **Latest stable libs.** React 19, Next.js 16, TypeScript 6, Tailwind 4, Drizzle. We track the modern stack and accept the migration cost. We do not pin to old versions to avoid breakage.
- **No half-built features.** A feature ships with its tests, types, error states, loading states, and dark mode. If it cannot ship complete, it does not ship.
- **No fonctionnel-but-not-exceptionnel.** "It works" is not the bar. Visual polish, motion, copy, and DX are part of the deliverable.

A change that violates the bar gets pushed back even if its diff is technically correct.

---

## 2. File naming conventions

Naming is mechanical so contributors and AI assistants can predict file paths without grep.

### Service files

A domain package (e.g., `@void/auth`) lays out its source as:

```
packages/auth/src/
  auth.service.ts          # domain logic (always present)
  auth.repository.ts       # DB / external I/O (always present)
  auth.helper.ts           # pure functions (always present)
  auth.types.ts            # Zod schemas + inferred TS types (always present)
  index.ts                 # public barrel (always present)

  auth.policy.ts           # authorization (optional)
  auth.errors.ts           # typed domain errors (optional)
  auth.mapper.ts           # DB-to-domain shape adapter (optional)
  auth.events.ts           # async workflow events (optional)
  auth.integration.test.ts # cross-table / transaction tests (optional)

  auth.service.test.ts     # unit tests, colocated
  auth.helper.test.ts
  auth.policy.test.ts
  auth.errors.test.ts
```

Pattern: `<domain>.<layer>.ts`. The `<domain>` repeats so files sort together in the editor and grep is unambiguous (`grep auth.service` finds one file, never twelve).

The canonical example is `packages/auth/src/`. It uses 8 of the 10 layers. It omits `mapper.ts` (DB shape matches domain shape) and `events.ts` (no async workflows yet). Both are added the first time a real need surfaces, never speculatively.

### Components

```
ComponentName/
  ComponentName.tsx           # default export, the component itself
  ComponentName.test.tsx      # colocated unit / render test (Vitest + jsdom)
  ComponentName.types.ts      # prop and variant types
  ComponentName.helper.ts     # pure functions used by the component
  ComponentName.helper.test.ts
  index.ts                    # barrel: re-exports the component + types
```

Interactive components that own a Server Action add:

```
  ComponentName.actions.ts    # 'use server', defineAction / defineFormAction
  ComponentName.client.tsx    # 'use client' boundary if the wrapper is server
```

See `apps/web/src/components/_examples/SimpleButton/` (5-file presentational) and `UserProfileCard/` (7-file interactive with Server Action) for the canonical layouts.

### Server Actions

Action files inside an app live in `apps/<app>/src/actions/<name>.actions.ts` (top-level) or colocated with their component as `<Component>.actions.ts`. The wrapper is always `defineAction` (RPC) or `defineFormAction` (FormData + `useActionState`). Raw `'use server'` functions are forbidden. See ADR 21.

### Index barrels

`index.ts` re-exports the public surface only. It never re-exports internal helpers, repository symbols, or test fixtures. A type that is only used by the package's own internals does not appear in the barrel.

---

## 3. Service file layout (5 standard layers + 5 optional)

Per ADR 08, every domain service ships these 5 files:

1. **`<name>.service.ts`** -- domain logic. Pure functions over typed inputs. Reads via `<name>.repository.ts`. Writes via `<name>.repository.ts`. Calls `<name>.policy.ts` for authorization (or inlines the check if trivial). Throws typed errors from `<name>.errors.ts` (or generic `AppError` from `@void/core/errors`).

2. **`<name>.repository.ts`** -- the only file allowed to call `getDb()` from `@void/db` or to make external HTTP requests. Carries `import 'server-only'` (per ADR 25). Returns plain TS objects. If DB shape ≠ domain shape, the conversion happens in `<name>.mapper.ts`.

3. **`<name>.helper.ts`** -- pure utilities. No I/O, no global state, no `Date.now()` baked in (inject as parameter for testability). Importable from anywhere, including Client Components.

4. **`<name>.types.ts`** -- Zod schemas + their `z.infer` aliases. Merged by default per ADR 09. Split into `schema.ts` + `types.ts` only when client bundle pressure justifies it.

5. **`<name>/index.ts`** -- barrel exposing the public surface.

The 5 optional layers are added when warranted:

- **`<name>.mapper.ts`** -- when DB shape differs from domain shape (snake_case columns, computed fields like `displayName`, joined relations flattened, etc.). Don't bake mapping into the repository -- that mixes I/O with shape concerns.

- **`<name>.events.ts`** -- when async workflows (Inngest, queue workers, audit log writers) consume events emitted by this service. Declare event names + payload schemas here.

- **`<name>.policy.ts`** -- when authorization needs more than a single `if (user.role !== 'admin')` check, or when the same check is needed in 2+ services. The policy is a pure function that returns a boolean or throws `ForbiddenError`.

- **`<name>.errors.ts`** -- when 3+ domain-specific errors warrant typing (e.g., `EmailAlreadyTakenError`, `InvalidCredentialsError`, `MagicLinkExpiredError`). Below 3, generic `AppError` is enough.

- **`<name>.integration.test.ts`** -- whenever the service touches more than one table OR uses transactions. Mocks miss cascade bugs, foreign-key violations, and isolation-level surprises. The integration test runs against a real DB (skipped when `DATABASE_URL` is unset, see `docs/ARCHITECTURE.md` section 8).

### Dependency arrow

```
component (apps/web/src/components/<Feature>/Feature.tsx, server component or client)
  -> action (apps/web/src/actions/<feature>.actions.ts, defineAction / defineFormAction)
    -> service (packages/<domain>/src/<name>.service.ts, optionally <name>.policy.ts)
      -> repository (packages/<domain>/src/<name>.repository.ts)
        -> getDb() from @void/db, OR external HTTP / SDK
```

Imports flow one direction. Never the reverse.

---

## 4. When to extract a helper, mapper, policy

Three triggers, two questions, four signals.

### Helper

Extract when a pure function is reused across 2+ files, OR when a service function has more than 2 levels of nested logic that obscures intent. A helper does not have to be reused yet to be extracted -- complexity reduction inside the service alone justifies it.

Example: `auth.helper.ts` exports `computeInitials(displayName)` and `displayName(user)`. Both are pure, both are reused (server-side and in components), and both have variant edge cases (null name, empty email, multi-word names) that warrant their own tests.

### Mapper

Extract when DB row shape differs from domain shape. Common triggers: snake_case columns (`user_email` -> `userEmail`), computed fields (`displayName` derived from `firstName + lastName`), or relations flattened from joins. Do not bake the mapping into the repository -- that mixes I/O with shape concerns and makes the repository harder to test.

If the DB shape and domain shape are identical, you do not need a mapper. The Drizzle row IS the domain object. `@void/auth` lives in this state today.

### Policy

Extract when authorization logic involves more than a single role comparison, OR when the same check is needed in 2+ services. A typical inline check (`if (user.role !== 'admin') throw new ForbiddenError()`) does not warrant its own file. A policy that reasons about resource ownership, soft-delete state, role hierarchy, and tenant scoping does.

`packages/auth/src/auth.policy.ts` exports `canAccessAdminPanel(user)` -- the surface today is simple, but the file exists so future policies have a home from day 1.

### Errors module

Extract when 3+ domain-specific errors benefit from being a typed sum. The `auth.errors.ts` module exports `EmailAlreadyTakenError`, `InvalidCredentialsError`, and `MagicLinkExpiredError`. Each subclasses `AppError` with a stable `code` so the action layer can map them to fieldErrors / formError without instanceof chains.

### Integration test

Write `<name>.integration.test.ts` whenever:

- The service writes to multiple tables in one logical operation.
- The service uses `db.transaction(...)`.
- The service depends on a database constraint, trigger, or cascade behavior.

Mocks pass while the real DB rejects. The integration test catches the divergence.

---

## 5. App-level use-cases and the promotion rule

A use-case is a cross-service business flow. Examples: "sign up a user, create their default workspace, send a welcome email" or "process a checkout: charge the card, mark the order paid, dispatch a fulfillment event."

Use-cases live in `apps/<app>/src/use-cases/` initially. They:

- Compose calls across multiple services.
- May orchestrate side effects (email, events) the individual services do not own.
- Are consumed by Server Actions in the same app.

They do NOT live inside a single service folder. By definition they cross multiple services -- putting one inside `auth.service.ts` would couple auth to billing or email.

### Promotion to a domain package

Promote a use-case to a domain package only when 2+ apps need it. Do not pre-promote. The cost of a premature promotion is real: a shared package adds upgrade churn, version coordination, and cross-app contracts that may diverge.

When promoting, place the use-case in `packages/<existing-domain>/src/<usecase>.ts` if it fits an existing domain. Create a new package only if the use-case spans multiple existing domains AND no current package is the right home.

---

## 6. Examples

Two canonical examples are checked into the repo. Read them before writing similar code.

### Service example: `@void/auth`

`packages/auth/src/` uses 8 of the 10 service layers. It is the canonical reference for any new service. It demonstrates:

- Service / repository / helper / types / index split.
- Policy module (`auth.policy.ts`) for authorization.
- Errors module (`auth.errors.ts`) with three typed domain errors.
- Integration test (`auth.integration.test.ts`) covering DB-backed flows.
- `'server-only'` directive on service and repository (ADR 25).
- Subpath exports for client-safe and server-only entry points.

It omits `mapper.ts` (Drizzle row matches domain shape) and `events.ts` (no async workflow consumers yet). Both are added the day a real need surfaces.

### Component examples: `apps/web/src/components/_examples/`

- **`SimpleButton/`** -- 5-file presentational component. Pure helper, isolated tests, no Server Action, no client boundary. The minimum layout for a shared component.

- **`UserProfileCard/`** -- 7-file interactive component with a Server Action. Demonstrates the React 19 progressive-enhancement pattern: Server Component reads auth, passes data to a `'use client'` child that uses `useActionState` + `useOptimistic` to bind the action to a `<form>`. Auth is enforced at the action via `defineFormAction({ auth: 'required' })`, not at the page.

A fresh contributor or AI assistant should be able to answer three questions from memory after reading these examples:

1. Where does pure logic live? (`.helper.ts`, tested without rendering.)
2. Where does auth live? (`.actions.ts` via `defineFormAction`, never inline.)
3. What does the barrel export? (Component + types only, no internals.)

---

## 7. Code style commitments

Mechanical rules. Biome enforces what it can; reviews catch the rest.

### Punctuation and prose

- **No em dashes.** Use `--`, "and", or commas. Em dashes are an LLM tell and break grep workflows.
- **No emojis.** In code, comments, commit messages, docs, error strings. Anywhere. Folpe's quality bar treats emojis as visual noise.
- **No exclamation marks in copy.** Period.

### Logging and config

- **No `console.log` / `console.error`.** Use the `@void/core/logger` (`pino`-backed). It supports structured fields, child loggers, and ships JSON in production. See ADR 22.
- **No raw `process.env` in business code.** Use `@void/core/env` (`createAppEnv` for full schema, `required(name)` for one-off presence checks). Centralizes type safety and missing-var error messages. See ADR 13.

### Errors

- **No raw `throw new Error('...')` in service / repository / action code.** Use typed errors from `@void/core/errors` (`AppError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`) or domain-specific errors from `<name>.errors.ts`.
- The reason: typed errors carry a stable `code` field that the action layer maps to `formError`. A raw `Error` becomes a generic 500 to the client and loses the actionable shape.

### Server Actions

- **Always use `defineAction` or `defineFormAction`.** Never write a bare `'use server'` function. The wrapper handles Zod parsing, auth resolution, error normalization, and structured logging in one place. See ADR 5 and ADR 21.
- **Choose by call-site mode.** `defineAction` for RPC (`await action(values)` from react-hook-form's `handleSubmit`). `defineFormAction` for `<form action={...}>` and React 19 `useActionState`.

### Imports and boundaries

- **`'server-only'` on every server-only file in shared packages.** Repositories, services that read `next/headers`, anything that pulls Node-only modules. Per ADR 25, this is the build-time guard against client-side leakage.
- **No deep imports across packages.** Use the public exports declared in `package.json#exports`. If you need a symbol that is not exported, ask whether it should be exported (and add it to the barrel) rather than reaching past the boundary.
- **No `'use client'` on server-only code.** `'use client'` is a React component boundary, not a build-time guard. They are not interchangeable.

### Tests

- **Colocate tests with source.** `auth.service.test.ts` next to `auth.service.ts`. Vitest, default node env unless the test renders React (then jsdom + `@testing-library/react`).
- **Integration tests get the `.integration.test.ts` suffix.** They skip gracefully when `DATABASE_URL` is unset (see `docs/ARCHITECTURE.md` section 8).
- **No mocking the DB at the service level.** If the service goes through a repository, mock the repository. If the test needs the real DB, write an integration test.

### Components

- **`'use client'` only on interactive primitives.** Per ADR 16: if the file uses hooks, refs, or accepts function props, it gets the directive. If it only renders markup based on props, it stays a server component.
- **No `forwardRef`.** React 19 dropped the requirement. Accept `ref` as a regular prop typed `Ref<HTMLElement>`.
- **CVA for variants.** Use `class-variance-authority` for any variant-driven component. Derive types via `VariantProps<typeof variants>`. See ADR 17.

### Commits

- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Subject in imperative mood ("add X", not "added X" or "adds X").
- **No hook bypasses.** `--no-verify`, `--no-gpg-sign`, `-n` are forbidden unless the user explicitly requests it. If a hook fails, fix the underlying issue and create a new commit.
- **No `--amend` after a hook failure.** The commit did not happen, so amending modifies the previous commit instead. Re-stage and commit fresh.

---

## Cross-references

- `docs/ARCHITECTURE.md` -- topology, package boundaries, layering rules.
- `docs/DECISIONS.md` -- the why behind every convention. Read before challenging.
- `docs/CACHING.md` -- read / write cache strategy with `'use cache'` and `updateTag()`.
- `docs/SECURITY.md` -- security boundary mappings.
- `docs/AUTH.md` -- auth-specific patterns for `@void/auth`.
- `docs/MODULES.md` -- catalogue of opt-in `_modules/*` and their activation rules.
