import 'server-only';

import { AppError } from '@repo/core/errors';
import { getDb } from '@repo/db';
import { jobExecutions } from '@repo/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { JobExecution, RecordJobExecutionInput } from './jobs.types';

/**
 * Durable-jobs repository -- pure I/O against the `job_executions` ledger.
 * Repositories NEVER cache (docs/CACHING.md section 3).
 */

/**
 * Record one step execution, idempotently. The unique index on
 * `idempotency_key` turns a replayed step into an UPDATE of its own row rather
 * than a second insert, so the side effect happens exactly once while
 * `attempts` still counts how often the step ran. This is the database-level
 * proof that a retried durable job does not duplicate work.
 */
export async function recordJobExecution(input: RecordJobExecutionInput): Promise<JobExecution> {
  const db = getDb();
  const [row] = await db
    .insert(jobExecutions)
    .values({
      id: crypto.randomUUID(),
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      reference: input.reference,
    })
    .onConflictDoUpdate({
      target: jobExecutions.idempotencyKey,
      set: {
        attempts: sql`${jobExecutions.attempts} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new AppError({ message: 'Job execution upsert returned no row', code: 'DB_NO_ROW' });
  }
  return row;
}

export async function findJobExecutionByIdempotencyKey(
  idempotencyKey: string,
): Promise<JobExecution | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.idempotencyKey, idempotencyKey))
    .limit(1);

  return row;
}

export async function countJobExecutionsByRun(runId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(jobExecutions).where(eq(jobExecutions.runId, runId));

  return rows.length;
}
