---
date: 2026-05-07
title: "Build-time module activation via env vars, not runtime"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: Build-time module activation via env vars, not runtime

- **Date:** 2026-05-07
- **Decision:** Optional packages (Sentry, PostHog, etc.) are activated by env var presence at build time. Server-side via conditional dynamic imports in `instrumentation.ts`. Client-side via `NEXT_PUBLIC_*` vars enabling DCE. No runtime feature flag service.
- **Why:** This is the Next.js native pattern (`instrumentation.ts` was designed for it). It minimizes bundle size, reduces attack surface, and aligns with the Vercel deploy model where env changes trigger a 30-second redeploy. Runtime toggling has no real use case for Void Factory's profile (4-week MVPs that commit to a vendor at start).
- **Rejected alternatives:**
  - LaunchDarkly / GrowthBook / custom flag service: latency, vendor lock-in, complexity, real flagging not needed
  - Conditional package install (no `@repo/sentry` in package.json if unused): more friction than env var, requires `bun add` to enable
  - Always-on imports with empty implementations: wastes bundle size
- **When to revisit:** If a project legitimately needs runtime feature flags for A/B testing or multi-tenant feature gating. Then add a feature flag module, do not migrate the activation pattern.
