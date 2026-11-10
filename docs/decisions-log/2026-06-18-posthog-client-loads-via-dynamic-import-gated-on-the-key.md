---
date: 2026-06-18
title: "PostHog client loads via dynamic import gated on the key"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-06-18: PostHog client loads via dynamic import gated on the key

- **Date:** 2026-06-18
- **Decision:** `AnalyticsProvider` initializes the global `posthog-js` singleton through a dynamic `import('posthog-js')` inside a `useEffect`, gated on `NEXT_PUBLIC_POSTHOG_KEY`. The static `import posthog from 'posthog-js'` and the `posthog-js/react` `<PostHogProvider>` wrapper are removed; the component now always renders its children unchanged and only side-effects the singleton init when the key is present.
- **Why:** The previous implementation used a top-level static `import posthog from 'posthog-js'` plus `<PostHogProvider>` and claimed the SDK dead-code-eliminated when the key was unset. It did not: a static import is unconditionally bundled, so every build shipped the ~190KB SDK into the eager client chunk even with no PostHog key — directly contradicting the module's "zero bundle when disabled" promise. ADR 27 already established that Turbopack does not reliably DCE `NEXT_PUBLIC_*` branches across module boundaries and solved the identical problem for Sentry with a dynamic-import gate. Applying the same pattern to PostHog makes the two observability modules consistent and makes the zero-bundle claim actually true (the SDK lands in an async chunk that is never fetched when the key is absent).
- **Rejected alternatives:**
  - _Keep the static import, rely on DCE_: the original bug. Static imports are not DCE'd on a runtime env check across module boundaries.
  - _Unwire `AnalyticsProvider` from the root layout entirely_: would also drop `@repo/posthog` from the app import graph, but breaks the "wired by default, zero weight until activated" symmetry with Sentry (ADR 27) and forces every PostHog-enabling MVP to re-wire the layout.
  - _Keep `<PostHogProvider>` via `next/dynamic`_: preserves the `usePostHog()` hook but pulls `next` into `@repo/posthog`'s dependency set (it has none today) and adds a lazy-boundary for a context most MVPs do not use. The global singleton (`import posthog from 'posthog-js'`) is the standard 2026 access pattern and keeps the package `next`-free.
- **When to revisit:** If an MVP needs the React `usePostHog()` context broadly, reintroduce `<PostHogProvider>` behind `next/dynamic` and add `next` as a peer dependency of `@repo/posthog` at that point. If PostHog ships an official zero-bundle Next.js entry that handles the gate, adopt it.
