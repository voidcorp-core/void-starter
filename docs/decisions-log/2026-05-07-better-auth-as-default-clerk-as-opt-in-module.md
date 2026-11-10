---
date: 2026-05-07
title: "Better-Auth as default, Clerk as opt-in module"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: Better-Auth as default, Clerk as opt-in module

- **Date:** 2026-05-07
- **Decision:** `@repo/auth` ships Better-Auth (self-hosted, open source) wired with email/password + Google OAuth + magic link + roles. Clerk is available as an alternative via `_modules/auth-clerk/`.
- **Why:** Three non-negotiables for Folpe: data sovereignty (user data on his infrastructure), brand integrity (no vendor branding visible in MVPs), custom auth domain by default. The time cost (~60-80h/year of auth code maintenance over 24 MVPs) is accepted in exchange for control.
- **Rejected alternatives:**
  - Clerk default: best DX, free tier covers 10k MAU per project, but data lives at Clerk, branding visible in free tier, custom domain requires Pro plan
  - Auth.js (NextAuth v5): less feature-rich than Better-Auth, ergonomics issues with App Router
  - Lucia: deprecated in early 2025
  - WorkOS / Stytch: B2B-focused, overkill for B2C MVPs
- **When to revisit:** When an MVP requires SaaS B2B features at J1 (SSO, SCIM, advanced orgs) AND the data sovereignty trade-off is acceptable for that specific project. Switch to `_modules/auth-clerk` for that MVP only.
