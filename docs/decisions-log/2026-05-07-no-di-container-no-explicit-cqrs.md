---
date: 2026-05-07
title: "No DI container, no explicit CQRS"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: No DI container, no explicit CQRS

- **Date:** 2026-05-07
- **Decision:** The starter forbids dependency-injection containers (tsyringe, awilix) and explicit CQRS (Command/Query bus separation). Services export plain functions; tests inject mocks via constructor parameters. Read/write separation is achieved through Cache Components (`"use cache"` on service reads, `updateTag()` on action writes).
- **Why:** DI containers add ~100KB runtime overhead, opaque indirection, and decorator metadata that the team must learn for zero return at this scale (under 50 services per MVP). Explicit CQRS adds a Command bus and Query bus that nobody on a 4-week MVP needs. The Cache Components pattern delivers soft CQRS for free: cache aggressively at the service read path, invalidate via `updateTag` on writes.
- **Rejected alternatives:**
  - tsyringe / awilix: solve a problem we do not have at this scale
  - Explicit CQRS: appropriate for read-heavy systems with denormalized projections, not for B2C MVPs
  - Hand-rolled DI helpers: sneak DI complexity in through the back door
- **When to revisit:** If a project legitimately grows past 50 services with complex lifecycle needs, evaluate awilix at that point. If a project requires event-sourcing-grade read/write separation, evaluate full CQRS at that point. The starter does not prepay this cost.
