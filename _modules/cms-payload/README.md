# @void/cms-payload

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for Payload CMS as a separate `apps/cms` Next.js application sharing the same Postgres database as `apps/web`. Activate when an MVP needs editorial content (marketing copy, blog posts, landing pages, structured product data) managed outside the codebase.

## Why this module

Code-as-content rots on marketing-heavy MVPs: every copy tweak becomes a PR, ships through CI, and gates on dev availability. Payload CMS is the 2026 default headless CMS for Next.js shops because it ships as a Next.js app (no separate Node server), supports Postgres natively, and emits typed schemas consumable by the sibling `apps/web` via Drizzle. Keeping it opt-in respects ADR 07 (no premature packages) -- most MVPs never need a CMS, and the ones that do can spin one up in a few hours.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `PAYLOAD_SECRET` | secret | Payload encryption key for sessions and admin auth. Independent from `BETTER_AUTH_SECRET`. |
| `PAYLOAD_DATABASE_URI` | secret | Postgres connection string for the Payload instance. Reuse `DATABASE_URL` to share the Neon project with `apps/web`, or point at a separate Neon branch for editor-vs-prod isolation. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAYLOAD_PUBLIC_SERVER_URL` | inferred | Override the public URL of the CMS admin (e.g. `https://cms.your-domain.com`). |
| `PAYLOAD_CONFIG_PATH` | `payload.config.ts` | Override the path to the Payload config file. |

## Install (when implementing)

The module follows the "separate app in the monorepo" pattern (per ADR 01: monorepo from day 0). The CMS lives at `apps/cms/` and consumes the same Postgres database as `apps/web/`.

1. Scaffold the CMS app with the Payload Next.js template:

   ```bash
   bunx create-payload-app@latest apps/cms --template website --use-bun
   ```

   Or use `apps/cms/` as a manual Next.js app and add `payload` plus `@payloadcms/db-postgres` as deps.

2. Configure `apps/cms/payload.config.ts` to use the Postgres adapter pointing at the same Neon database as `apps/web`:

   ```ts
   import { postgresAdapter } from '@payloadcms/db-postgres';
   import { buildConfig } from 'payload';

   export default buildConfig({
     secret: process.env.PAYLOAD_SECRET!,
     db: postgresAdapter({
       pool: { connectionString: process.env.PAYLOAD_DATABASE_URI! },
     }),
     collections: [/* Pages, Posts, Media, etc. */],
   });
   ```

3. Add `apps/cms` to the Turborepo `apps/*` workspace. The root `package.json` already declares `apps/*` so the workspace picks it up automatically. Add per-task overrides in `turbo.json` if the CMS build differs from the web build.

4. Document the schema-sharing strategy: Payload owns its own tables and prefixes them (e.g. `payload_pages`, `payload_posts`, `payload_media`, `payload_users`). `apps/web` reads them via Drizzle by introspecting the Payload schema with `bunx drizzle-kit introspect:pg --connectionString=$DATABASE_URL` and committing the result under `packages/db/src/schema/cms.ts`. Treat the introspected schema as read-only from `apps/web`'s perspective: writes flow through the Payload admin only.

5. Add a deploy target for `apps/cms` (separate Vercel project recommended) so CMS edits don't redeploy the public site. Use Payload's "publish" hooks plus `revalidateTag` to invalidate the relevant `apps/web` caches per ADR 10 (Cache Components for read/write separation).

## Integration points

- `apps/cms/` -- new Next.js app scaffolded by Payload template
- `apps/cms/payload.config.ts` -- Payload collections, fields, access control
- `packages/db/src/schema/cms.ts` -- Drizzle schema introspected from Payload tables (read-only from `apps/web`)
- `apps/web/src/use-cases/cms/` -- typed read helpers using Drizzle against the introspected schema
- `apps/cms/payload.config.ts` `afterChange` hooks -- call `revalidateTag` on the public app after editorial changes
- `turbo.json` -- per-task pipeline overrides if `apps/cms` build differs

## Upstream docs

- https://payloadcms.com/docs
- https://payloadcms.com/docs/getting-started/installation
- https://payloadcms.com/docs/database/postgres
- https://payloadcms.com/docs/configuration/overview

## Removal (after implementing)

The inverse of install:

1. Drop the Vercel project for `apps/cms`.
2. Delete `apps/cms/` from the monorepo.
3. Drop the introspected `packages/db/src/schema/cms.ts` and any `apps/web` use-cases that read CMS tables.
4. Drop the `payload_*` tables from Postgres (irreversible -- export content first if there's any to keep).
5. Unset `PAYLOAD_SECRET` and `PAYLOAD_DATABASE_URI` in Vercel.
6. Run `bun install` to drop the lockfile entries.
