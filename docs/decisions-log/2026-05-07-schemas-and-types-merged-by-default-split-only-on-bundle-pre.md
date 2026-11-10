---
date: 2026-05-07
title: "Schemas and types merged by default (split only on bundle pressure)"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: Schemas and types merged by default (split only on bundle pressure)

- **Date:** 2026-05-07
- **Decision:** Zod schemas and TypeScript types live together in `serviceName.types.ts` using `z.infer`, by default. Split into separate `schema.ts` and `types.ts` only when a heavily client-imported type causes Zod (~50KB) to bloat the client bundle.
- **Why:** Merged keeps one source of truth (changes to schema propagate to types automatically). Splitting requires manual sync and adds friction. The split is real but situational, not universal.
- **Rejected alternatives:**
  - Always split: trades automatic sync for theoretical bundle savings on types that may never be client-imported
  - Always merged: ignores the real bundle cost of Zod when types ARE pulled into client components at scale
- **When to revisit:** When `bun run build` reports a Client Component pulling Zod through a `types.ts` import, split that specific module's types out.
