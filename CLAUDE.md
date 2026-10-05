# Project Conventions for AI Assistants

<!-- void-machine:begin -->

## Void Machine (managed by `void-machine init`)

Claude Code doctrine active in this project:

- `void` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)
- `harness-monorepo` — Turborepo monorepo conventions
- `harness-react` — React 19 + shadcn/Radix + accessibility
- `harness-nextjs` — Next.js 16 App Router conventions
- `harness-server` — Server Actions, webhooks, Drizzle, Zod boundaries

### Doctrine — loaded into every session

@.void/installed/PHILOSOPHY.md
@.void/PROJECT-DOCTRINE.md

`PHILOSOPHY.md` is the universal Void Machine doctrine (managed — overwritten on init). `PROJECT-DOCTRINE.md` holds project-specific rules: context, ADRs, in-flight decisions (yours; init never overwrites what you have written in it).

To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The `void-learn` skill auto-invokes, classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.

Every skill is invoked by its name: `/void-implement`, `/void-tdd`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.

### Program — when present

If `.void/program.md` exists with `status: executing`, read it and its linked plan/spec before choosing implementation work. The programme holds global context; the local checkpoint holds session residue, and `ResumeBundle` composes both with Git. On a continue/start/resume request without a named work unit, use the declared progress provider: recover the scoped unit if exactly one is started; if several are started, stop and surface the competing claims; otherwise select the first ready unit from the declared order and native blocker relations. Fetch the complete unit before running `void-implement`. The declared progress provider owns mutable execution state; the program and checkpoint never store a current or next unit. If the provider or a required capability is unavailable, do not infer remote progress; stop the action that needs it. If no progress provider is declared, require a specific unit instead of selecting one. A specific user request overrides selection; human gates and merges remain human. The file's `autopilot` block carries consent to autonomous execution and is never inferred: `enabled: false`, an absent block, or an unreadable one forbids autonomous selection entirely.

An authorized merge includes routine local synchronization by the coordinator without asking for confirmation again. Verify the branch, remote, and verified merged commit, then fetch and advance the clean local target branch with `git merge --ff-only` to that commit. Stop on local changes, divergence, or an unexpected remote tip; preserve the work. This does not authorize another remote merge, deployment, history rewrite, or changes to shared Git state by commit-only workers. Runtime sandbox and approval controls still apply; never bypass them.

Run `void-machine doctor` to verify the install.

<!-- void-machine:end -->

This is the void-starter repo. Read these files in order before writing code:

1. `docs/DECISIONS.md` -- non-obvious choices, alternatives rejected, do NOT re-litigate
2. `docs/PATTERNS.md` -- KISS / DRY / SoC + file naming + service layout
3. `docs/ARCHITECTURE.md` -- package boundaries + dependency direction

For specific tasks:

- Touching auth: read `docs/AUTH.md` + the canonical service `packages/auth/`
- Touching cache: read `docs/CACHING.md`
- Touching security: read `docs/SECURITY.md`
- Adding a module: read `docs/MODULES.md` + `_modules/README.md`
- Writing a component: read `apps/web/src/components/_examples/`
- Writing a service: read `packages/auth/` (canonical example)

## Hard rules

- Match file naming exactly (`Name.tsx`, `Name.helper.ts`, `Name.test.ts`, etc.)
- Service layer NEVER touches DB directly -- always through repository
- Component layer NEVER touches DB -- always through service
- Helpers are PURE: no I/O, no side effects
- Use `@repo/core/logger`, never `console.log` in committed code
- Use `@repo/core/env`, never `process.env` directly in business code
- Use typed errors from `@repo/core/errors`, never throw strings
- Use `defineAction` or `defineFormAction` from `@repo/auth` for all Server Actions
- Server Actions live in `apps/<app>/src/actions/`, NEVER in packages
- No em dashes anywhere; no emojis in code/docs/commits
- Read official documentation of any third-party tool BEFORE writing its config

## Meta-rules

- Any new convention MUST be added to the matching `docs/*.md` in the same commit
- Any non-obvious decision (where a credible alternative exists) MUST be logged in `docs/DECISIONS.md`
- Removed concepts must be removed from the docs at the same time
- Unit tests run through `bun run test` from the root (Turborepo fans out to each workspace's own vitest config); `bunx vitest run` only works from inside a package, never from the root, where it would collect the Playwright specs and the jsdom suites with no environment
- E2E tests run through `bun run test:e2e` from `apps/web`; do not skip TDD when adding business logic

## gstack note

If gstack is installed at the user level (`~/.claude/skills/gstack/`), prefer its slash commands for design (`/design-shotgun`, `/design-consultation`, `/design-html`), QA (`/qa`, `/qa-only`), and shipping (`/ship`, `/land-and-deploy`) over reinventing those workflows.
