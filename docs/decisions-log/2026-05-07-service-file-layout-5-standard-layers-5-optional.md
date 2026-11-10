---
date: 2026-05-07
title: "Service file layout: 5 standard layers + 5 optional"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: Service file layout: 5 standard layers + 5 optional

- **Date:** 2026-05-07
- **Decision:** A service folder ships 5 standard files (`service.ts`, `repository.ts`, `helper.ts`, `types.ts`, `index.ts`) plus 5 optional layers used when the domain warrants: `mapper.ts`, `events.ts`, `policy.ts`, `errors.ts`, `integration.test.ts`.
- **Why:** Each optional layer earns its place by addressing a specific failure mode of inline code. `mapper.ts` keeps DB shape out of the domain when they differ. `events.ts` declares event names and payload schemas for async workflows (Inngest-style modules consume them). `policy.ts` pulls authorization out of the service for testability. `errors.ts` types domain errors when generic `AppError` is too coarse. `integration.test.ts` catches cascade / constraint / transaction bugs that mocked unit tests miss. By marking them OPTIONAL, the starter teaches the pattern but does not impose it on trivial services.
- **Rejected alternatives:**
  - Always-required layers: bloats trivial services and slows iteration; engineers create empty files just to satisfy the convention
  - Free-form structure: AI assistants generate inconsistent code, harder to navigate across MVPs
  - `use-case.ts` as a service-level layer: rejected because use-cases by definition cross multiple services, so they don't belong inside one. They live in `apps/*/src/use-cases/` instead, with a documented promotion rule to a domain package on cross-app reuse
- **When to revisit:** If we find ourselves systematically using all 5 optional layers on every service, those should become standard. If we never use one across multiple MVPs, retire it from the catalogue.
