import 'server-only';

import * as repository from './jobs.repository';
import {
  type JobExecution,
  type RecordJobExecutionInput,
  recordJobExecutionSchema,
} from './jobs.types';

/**
 * Durable-jobs service -- the trust boundary of the job payload.
 *
 * Workflow steps call this layer instead of the repository so every payload is
 * validated before it is persisted, and so the opaque-reference rule that keeps
 * personal data inside Neon EU (ADR 47) is enforced in exactly one place. There
 * is no caching here: a job ledger read must always reflect ground truth, which
 * is the point of asserting idempotency against it.
 */

export async function recordJobStep(input: RecordJobExecutionInput): Promise<JobExecution> {
  const payload = recordJobExecutionSchema.parse(input);
  return repository.recordJobExecution(payload);
}

export async function getJobExecution(idempotencyKey: string): Promise<JobExecution | undefined> {
  return repository.findJobExecutionByIdempotencyKey(idempotencyKey);
}

export async function countRunExecutions(runId: string): Promise<number> {
  return repository.countJobExecutionsByRun(runId);
}
