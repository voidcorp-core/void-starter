# Project Conventions for AI Assistants

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
- Use `@void/core/logger`, never `console.log` in committed code
- Use `@void/core/env`, never `process.env` directly in business code
- Use typed errors from `@void/core/errors`, never throw strings
- Use `defineAction` or `defineFormAction` from `@void/auth` for all Server Actions
- Server Actions live in `apps/<app>/src/actions/`, NEVER in packages
- No em dashes anywhere; no emojis in code/docs/commits
- Read official documentation of any third-party tool BEFORE writing its config

## Meta-rules

- Any new convention MUST be added to the matching `docs/*.md` in the same commit
- Any non-obvious decision (where a credible alternative exists) MUST be logged in `docs/DECISIONS.md`
- Removed concepts must be removed from the docs at the same time
- Tests use `bunx vitest run` (unit) and `bunx playwright test` (E2E); do not skip TDD when adding business logic

## gstack note

If gstack is installed at the user level (`~/.claude/skills/gstack/`), prefer its slash commands for design (`/design-shotgun`, `/design-consultation`, `/design-html`), QA (`/qa`, `/qa-only`), and shipping (`/ship`, `/land-and-deploy`) over reinventing those workflows.
