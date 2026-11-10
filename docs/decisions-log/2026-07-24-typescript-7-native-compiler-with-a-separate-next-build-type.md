---
date: 2026-07-24
title: "TypeScript 7 native compiler with a separate Next build type gate"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-24: TypeScript 7 native compiler with a separate Next build type gate

- **Date:** 2026-05-09; revised 2026-07-24
- **Decision:** Resident baseline workspaces use TypeScript 7.0.2. `apps/web/tsconfig.json` keeps only `paths` for the `@/*` alias; the removed `baseUrl` and `ignoreDeprecations` options are not supported by TypeScript 7. The web app also declares `@typescript/native-preview` as an npm alias of the same stable TypeScript 7 package because Next 16.2.11 recognizes the native compiler under that legacy package name. `next.config.ts` sets `typescript.ignoreBuildErrors: true`, and CI runs the required `bun run type-check` gate before `bun run build`. A factory-generated Expo SDK 57 workspace pins the upstream-supported TypeScript `~6.0.3` locally; that exception moves with the Expo template rather than forcing the web compiler onto the mobile toolchain.
- **Why:** TypeScript 7 is a native compiler and no longer ships the legacy `typescript/lib/typescript.js` programmatic API that Next 16 probes during `next build`. Without the alias, Next misclassifies TypeScript 7 as missing and attempts to install TypeScript with another package manager, which cannot resolve this Bun workspace. Next 16 already has a native-compiler branch keyed by `@typescript/native-preview`; aliasing the stable package activates that branch without installing a second compiler. The explicit CI type gate preserves strict type safety while the Next build handles compilation, route type generation, and rendering.
- **Rejected alternatives:**
  - Keep TypeScript 6 in the web app: avoids the compatibility path but leaves one workspace on the previous compiler and keeps the monorepo split across compiler generations.
  - Install the actual `@typescript/native-preview` daily build: duplicates the compiler and replaces a stable release with a moving development snapshot.
  - Let Next auto-install TypeScript: invokes a different package manager from `apps/web`, fails to resolve `workspace:*` packages, and mutates `node_modules`.
  - Patch `node_modules/typescript` with a fake `typescript.js`: fragile, not represented by the lockfile, and lost on every install.
- **When to revisit:** When Next resolves stable TypeScript 7 directly and no longer requires the legacy programmatic API, remove the alias and `ignoreBuildErrors`, then keep `bun run type-check` as the explicit CI gate unless Next's native check offers equivalent coverage.
