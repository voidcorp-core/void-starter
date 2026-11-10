---
date: 2026-05-09
title: "Dark mode via next-themes + Tailwind v4 class strategy"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-09: Dark mode via next-themes + Tailwind v4 class strategy

- **Date:** 2026-05-09
- **Decision:** `@repo/ui` ships `<ThemeProvider>` (wrapping `next-themes`) + a `.dark { --color-*: ... }` block in `globals.css`. Consumers mount `<ThemeProvider attribute="class">` once in their root layout; toggling `class="dark"` on `<html>` re-binds the design tokens automatically via the CSS cascade.
- **Why:** next-themes is the de-facto 2026 React dark-mode lib (used by shadcn/ui v3, next-forge, t3-stack). It handles system-preference detection, localStorage persistence, FOUC avoidance, and SSR safely. Tailwind v4's `@custom-variant dark` + class selector is the v4-idiomatic way to gate dark variants without v3's `tailwind.config.js`.
- **Rejected alternatives:**
  - CSS-only `[data-theme]` toggle without next-themes: requires hand-rolling system-preference + persistence + FOUC + SSR safety. ~80 lines of brittle client code.
  - `@media (prefers-color-scheme: dark)` only: no manual toggle, no per-user preference. Bad UX.
  - Stitches / vanilla-extract: full CSS-in-JS; out of scope for a Tailwind-first design system.
- **When to revisit:** When Tailwind v5 lands or if next-themes' SSR story drifts from Next.js 16+ Cache Components. Until then, this is stable.
