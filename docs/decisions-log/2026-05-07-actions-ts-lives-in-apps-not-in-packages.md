---
date: 2026-05-07
title: "`.actions.ts` lives in apps, not in packages"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: `.actions.ts` lives in apps, not in packages

- **Date:** 2026-05-07
- **Decision:** Server Actions ("use server" files) live in `apps/web/src/actions/`. They consume services from packages. They never live inside `packages/*`.
- **Why:** Server Actions carry Next.js-specific semantics (`"use server"`, `revalidatePath`, `redirect`, FormData handling). Putting them in shared packages would couple the package to Next.js, breaking reusability for future targets like Expo or Astro.
- **Rejected alternatives:**
  - Co-locate actions with services in packages: simpler import paths, but locks the package to Next.js
  - Single `@repo/actions` package: doesn't change the Next coupling, just centralizes the problem
- **When to revisit:** If the project decides to ship only Next.js apps forever and accepts the coupling. Currently no plan to do so.
