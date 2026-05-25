/**
 * `@repo/auth-clerk` is a SCAFFOLD, not a runtime drop-in. It exists to show
 * the conceptual mapping a future user follows when swapping `@repo/auth`'s
 * Better-Auth repository for a Clerk-backed one. The package is never wired
 * into `apps/web` automatically — `apps/web` continues to consume `@repo/auth`.
 *
 * The barrel intentionally re-exports nothing. The replacement entry point is
 * the `/repository` subpath, which mirrors the shape of
 * `@repo/auth/repository`. See README.md for the step-by-step swap procedure
 * and `docs/DECISIONS.md` entry 02 for the decision rationale.
 */
export {};
