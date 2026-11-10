---
date: 2026-05-07
title: "Neon Postgres as default DB, no docker-compose in core"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-05-07: Neon Postgres as default DB, no docker-compose in core

- **Date:** 2026-05-07
- **Decision:** The starter defaults to Neon Postgres (provisioned via Vercel Marketplace free tier) for both dev and prod environments. No `docker-compose.yml` ships in the core. Self-hosted Postgres is supported as `_modules/db-self-hosted-postgres/` opt-in module.
- **Why:** The Vercel + Neon Marketplace integration provides 10 free projects per team, each with dev + prod branches and automatic preview branches per PR. Folpe's profile (~24 MVPs/year, ~8 active) fits the free tier. Zero environment drift between dev and prod (same Neon, just different branches). Auto-provisioned env vars via Vercel. For B2C MVPs hosted on Vercel with 4-week kill criteria, self-hosted Postgres ops overhead (backups, security patches, monitoring, scaling) is not justified.
- **Rejected alternatives:**
  - Docker dev + Neon prod: real environment drift (connection pooling, extensions, connection limits); requires careful documentation and CI integration tests against Neon to catch the drift
  - Supabase dev + prod: Supabase's RLS-by-default conflicts with the application-level authorization in `requireRole()`; Better-Auth + Supabase is awkward
  - Self-hosted Postgres on VPS for everything: ops overhead does not fit the venture builder velocity model
- **When to revisit:** If Vercel + Neon integration changes terms (price tier shift, free tier reduction); if a specific MVP requires Postgres extensions Neon does not support; if data sovereignty becomes a hard requirement on a per-MVP basis (in which case activate the self-hosted module for that project only).
