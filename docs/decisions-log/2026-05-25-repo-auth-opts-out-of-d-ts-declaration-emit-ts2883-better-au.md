---
date: 2026-05-25
title: "`@repo/auth` opts out of `.d.ts` declaration emit (TS2883 better-auth internals)"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: `@repo/auth` opts out of `.d.ts` declaration emit (TS2883 better-auth internals)

- **Date:** 2026-05-09
- **Decision:** `packages/auth/tsconfig.json` overrides the `tsconfig.lib.json` defaults with `declaration: false` and `declarationMap: false`. Type-checking still runs via `tsc --noEmit`; only declaration emit is disabled, scoped to this one package.
- **Why:** The inferred return type of `betterAuth(...)` (and `createAuthClient(...)` on the client side) references better-auth's internal type aliases (`InferSignUpEmailCtx`, `InferUserUpdateCtx`, ...) defined in `node_modules/better-auth/dist/client/path-to-object.mjs`. TypeScript refuses to synthesize that path into a portable `.d.ts` (TS2883, previously TS2742 under TS 5.6). Workspace consumers of `@repo/auth` resolve types straight from TypeScript source via `package.json#exports` (the entire monorepo uses `./src/*.ts` exports, never built outputs), so the declaration files were never consumed downstream — the declaration emit was pure overhead AND a blocker. Disabling it lets `betterAuth(...)` keep its full plugin-augmented inferred type at every call site.
- **Rejected alternatives:**
  - `as Auth<typeof options>` annotation: `Auth` from `better-auth` defaulted to base options drops plugin-injected fields (admin's `banned`, `role`, etc.); annotating shifts the same diagnostic onto the inferred `options` const because the magicLink callback parameter type also traverses better-auth internals. Both regress consumer ergonomics.
  - `// @ts-expect-error` / `// @ts-ignore` directives: TS2883 is a declaration-emit diagnostic, not a typechecker diagnostic — suppression directives are reported as unused and do not affect emit-time errors.
  - Disabling `declaration` at the `tsconfig.lib.json` root: bleeds the workaround into every package whether or not it has the same problem; loses declaration emit for packages that may legitimately want it (e.g., future external publication).
- **When to revisit:** When better-auth re-exports its `Auth<TOptions>` shape with portable internal type aliases (no `path-to-object.mjs` references in the emitted client/server types), drop this override and re-enable `declaration: true`. Verify with `cd packages/auth && bunx tsc --noEmit --declaration` returning zero errors.
- **Last revised:** 2026-05-25 (Phase D zod 3→4 migration). With zod 4 now hoisted across every `@repo/*` package, the original dual-zod TS2742 root cause is gone — TypeScript still refuses declaration emit, but the surviving diagnostic (TS2883) now points at better-auth's `path-to-object.mjs` internal aliases rather than at a `zod/v4/core` path. The workaround stays; the revisit trigger now depends on better-auth, not on a project-internal zod migration.
