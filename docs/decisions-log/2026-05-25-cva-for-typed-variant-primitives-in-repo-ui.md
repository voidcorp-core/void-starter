---
date: 2026-05-25
title: "CVA for typed variant primitives in `@repo/ui`"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-25: CVA for typed variant primitives in `@repo/ui`

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` uses `class-variance-authority` (CVA) to declare variant-driven components (`Button`, future complex primitives). Variant types are derived via `VariantProps<typeof X>` rather than hand-written.
- **Why:** CVA is the de-facto 2026 standard (used by shadcn/ui v3), gives type inference for free, supports compound variants, and weighs ~2KB. Manual `Record<Variant, string>` helpers re-invent this with worse ergonomics — no inference, no compound variants, more code to maintain across N components.
- **Rejected alternatives:**
  - Hand-rolled `getButtonClasses(variant, size)` helper: works for one component but rots into duplication as soon as a second variant component lands. No type inference; types like `ButtonVariant` / `ButtonSize` must be hand-written and kept in sync.
  - tailwind-variants (tw-variants): newer, supports slots/composition, but adds a layer of API surface `@repo/ui` doesn't need yet. Revisit if multi-slot components become common.
  - Stitches / vanilla-extract: full CSS-in-JS solutions; out of scope for a Tailwind-first design system.
- **When to revisit:** When `@repo/ui` needs multi-slot composition primitives (e.g., a Card with named regions), evaluate tailwind-variants as a successor. Until then, CVA is sufficient and lighter.
