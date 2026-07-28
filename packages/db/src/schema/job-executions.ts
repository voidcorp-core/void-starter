import { integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Job executions table -- the durable-jobs ledger written by the Vercel
 * Workflow adapter (`workloads.durable_jobs: vercel-workflows`, see
 * docs/FACTORY.md and ADR 47).
 *
 * `idempotencyKey` carries the Workflow SDK `stepId`, which is stable across
 * step retries and globally unique per step invocation. The unique index is
 * what makes the ledger idempotent: a retried step upserts its own row and
 * increments `attempts` instead of inserting a duplicate. Reading `attempts`
 * therefore tells you how often a step was replayed without ever producing a
 * second side effect.
 *
 * `reference` is deliberately an opaque application identifier, never personal
 * data: workflow payloads leave the EU (the Vercel World stores run data in
 * `iad1`), so the job contract keeps personal data in Neon EU and passes only
 * references that a step re-reads from the database.
 */
export const jobExecutions = pgTable(
  'job_executions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reference: text('reference').notNull(),
    attempts: integer('attempts').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('job_executions_idempotency_key_idx').on(table.idempotencyKey)],
);

export type JobExecution = typeof jobExecutions.$inferSelect;
export type NewJobExecution = typeof jobExecutions.$inferInsert;
