# @void/audit-log

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for an audit trail of all writes (insert, update, delete) across the application, with a typed event consumer pattern and an admin viewer page. Activate when an MVP has compliance, debug, or trust-and-safety needs that require "who did what, when, and to which row".

## Why this module

`@void/core/logger` (pino) captures structured logs but it is the wrong substrate for an audit trail: logs rotate, logs are not transactional with the write, and querying them requires a log pipeline. An audit trail belongs in Postgres next to the data it audits. The starter does not ship this by default because most early-stage MVPs over-index on it (premature governance) and an `audit_logs` table without a viewer is just write-only ballast. Activate when:

- a regulated industry asks "who changed this customer's email";
- a B2B contract requires SOC 2 audit evidence;
- the team hits a debug case where structured logs aren't enough;
- a feature flag toggle needs traceability beyond commit history.

## Required env vars

None at the module level. The audit consumer is always-on once mounted. If feature-gating is desired (e.g. disable in dev), use a runtime check on `process.env.NODE_ENV` inside the consumer rather than introducing a dedicated flag.

## Install (when implementing)

The module mirrors ADR 08's `events.ts` pattern: services emit typed events after a write, an audit consumer subscribes, the consumer inserts a row in `audit_logs`. This keeps the audit concern out of the service body and makes it trivially toggleable.

1. Add the Drizzle table to `packages/db/src/schema/audit.ts`:

   ```ts
   import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

   export const auditLogs = pgTable('audit_logs', {
     id: uuid('id').defaultRandom().primaryKey(),
     userId: text('user_id'),
     action: text('action').notNull(),
     targetTable: text('target_table').notNull(),
     targetId: text('target_id'),
     payload: jsonb('payload'),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
   });
   ```

   Generate the migration with `bun run --cwd packages/db db:generate`.

2. Define the audit event surface in each domain service per ADR 08. Example for a hypothetical `posts` service:

   ```ts
   // packages/posts/src/posts.events.ts
   import { z } from 'zod';

   export const PostCreatedEvent = z.object({
     name: z.literal('post.created'),
     userId: z.string(),
     postId: z.string(),
     payload: z.record(z.unknown()),
   });
   ```

3. Implement the consumer at `_modules/audit-log/src/audit.consumer.ts`. It receives a typed event and inserts a row in `audit_logs`. Mark it `import 'server-only'` per ADR 25.

4. Wire the consumer into the event dispatch path. Two acceptable shapes:
   - Synchronous in-process call inside the service after the write commits (simplest, in the same Server Action transaction)
   - Asynchronous via a job queue (Inngest, BullMQ) when audit insert latency must not couple to the user request

5. Add the admin viewer page at `apps/web/src/app/admin/audit-log/page.tsx`. Use `requireRole('admin')` from `@void/auth` to gate it. Render a paginated table reading `audit_logs` via Drizzle, filterable by `userId`, `targetTable`, and date range.

6. Document the retention policy. Audit logs grow forever by default. Decide on an explicit cutoff (typical: 13 months for GDPR overlap, 7 years for SOX-like contexts) and ship a Vercel cron job that deletes rows older than the cutoff.

## Components

- Drizzle table `audit_logs` (id, user_id, action, target_table, target_id, payload jsonb, created_at)
- Audit consumer subscribing to typed events from each domain service per ADR 08
- Admin viewer at `apps/web/src/app/admin/audit-log/page.tsx`
- Optional: Vercel cron that prunes rows past the retention horizon

## Integration points

- `packages/db/src/schema/audit.ts` -- new Drizzle table
- `packages/<domain>/src/<domain>.events.ts` -- typed event schemas per service (ADR 08)
- `_modules/audit-log/src/audit.consumer.ts` -- the consumer that inserts audit rows
- `apps/web/src/app/admin/audit-log/page.tsx` -- admin viewer
- `apps/web/src/app/api/cron/audit-prune/route.ts` -- optional retention cron
- `packages/auth/src/auth.policy.ts` -- `canViewAuditLog` policy (admin role per Better-Auth `admin` plugin)

## Upstream docs

- https://www.better-auth.com/docs/plugins/admin -- Better-Auth admin plugin (role gating reference)
- https://owasp.org/www-community/Logging_Cheat_Sheet -- OWASP guidance on what to capture
- https://gdpr-info.eu/art-30-gdpr/ -- GDPR Article 30 (records of processing activities)

A formal design doc is TBD; reference Better-Auth's session events and Postgres trigger-based audit patterns as starting points before settling on the events-vs-triggers trade-off.

## Removal (after implementing)

The inverse of install:

1. Detach the audit consumer from event dispatch in each service.
2. Delete `_modules/audit-log/src/`.
3. Delete the admin viewer page.
4. Drop the `audit_logs` table (irreversible -- export to long-term storage first if compliance requires).
5. Delete the retention cron route.
6. Run `bun install` if any dependencies were added (none expected since this module reuses Drizzle).
