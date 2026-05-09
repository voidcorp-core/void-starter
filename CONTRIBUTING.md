# Contributing to void-starter

Thanks for considering a contribution. This is a starter repo: the goal is a small, fast, opinionated foundation. Changes that grow surface area need a clear justification.

## Quick start

1. Fork and clone.
2. Install dependencies: `bun install`
3. Run the full local pipeline before opening a PR:

   ```bash
   bun run lint
   bun run type-check
   bun run test
   bun run build
   bunx knip --no-progress
   ```

## Conventions

This repo enforces a few non-negotiables:

- **Commit format:** Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`). Subject in the imperative mood. Lefthook validates each commit; do not bypass with `--no-verify`.
- **Code style:** No em dashes, no emojis, no `console.log` in committed code (use `@void/core/logger`).
- **Architecture:** Follow `docs/PATTERNS.md` and `docs/ARCHITECTURE.md`. Service layer never touches the DB directly. Components never touch the DB.
- **Decisions:** Any non-obvious choice (where a credible alternative exists) MUST be appended to `docs/DECISIONS.md` in the same PR.

## For AI assistants

Read `CLAUDE.md` first. It enumerates the hard rules and meta-rules.

## For human contributors

Read `docs/PATTERNS.md` first.

## Testing

- Unit tests next to the source: `*.test.ts` / `*.test.tsx`
- Integration tests next to the source: `*.integration.test.ts`
- E2E tests in `apps/web/tests/e2e/`

If you change business logic, write a test that fails before your change.

## Modules

Adding a new module? See `docs/MODULES.md` for the patterns and `_modules/observability-sentry/` for the canonical example.

## Questions

Open a Discussion or an Issue. We respond on a best-effort basis.
