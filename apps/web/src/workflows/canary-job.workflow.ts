import { logger } from '@repo/core/logger';
import { countRunExecutions, getJobExecution, recordJobStep } from '@repo/jobs-vercel-workflow';
import { FatalError, getStepMetadata, getWorkflowMetadata, sleep } from 'workflow';

/**
 * Durable-jobs reference workflow (`workloads.durable_jobs: vercel-workflows`).
 *
 * It is deliberately the smallest job that still proves the three properties a
 * durable-jobs profile has to guarantee (ADR 47):
 *
 * 1. Durability -- `sleep()` suspends the run across invocations. The run
 *    resumes on a later request without holding a function open, and finishes
 *    even though nothing kept the original request alive.
 * 2. Idempotence -- the step writes the ledger keyed by its own `stepId`, which
 *    is stable across retries. A replayed step increments `attempts` instead of
 *    inserting a second row, so the side effect happens exactly once.
 * 3. Recovery -- `verifyLedger` re-reads what `recordExecution` wrote. If a
 *    replay had duplicated the side effect, the run fails loudly with a
 *    `FatalError` rather than reporting a success nobody checked.
 *
 * Business logic lives in steps, never in the workflow body: `"use workflow"`
 * runs in a sandboxed VM with no Node.js access, while `"use step"` functions
 * have full access and are the unit the runtime retries and persists.
 */
export async function runCanaryJob(reference: string) {
  'use workflow';

  const recorded = await recordExecution(reference);
  // Suspends without consuming resources. Crossing this boundary is what makes
  // the run durable rather than a long-lived request.
  await sleep('5s');
  const verified = await verifyLedger(recorded.idempotencyKey, reference);

  return {
    reference,
    runId: recorded.runId,
    idempotencyKey: recorded.idempotencyKey,
    attempts: verified.attempts,
    ledgerRows: verified.ledgerRows,
    status: 'completed' as const,
  };
}

/**
 * Write the ledger entry for this run. `stepId` is the idempotency key: stable
 * across retries of this step and globally unique per step invocation, exactly
 * the contract an idempotency key needs. Keys must stay deterministic, so
 * nothing here derives from a timestamp or an attempt counter.
 */
async function recordExecution(reference: string) {
  'use step';

  const { stepId } = getStepMetadata();
  const { workflowRunId: runId } = getWorkflowMetadata();

  const execution = await recordJobStep({ runId, idempotencyKey: stepId, reference });

  logger.info(
    { runId, idempotencyKey: stepId, attempts: execution.attempts },
    'durable job: step recorded',
  );

  return { runId, idempotencyKey: stepId, attempts: execution.attempts };
}

/**
 * Re-read the ledger after the suspension to prove the recorded side effect
 * survived and stayed unique. A missing row, a mismatched reference or a second
 * row for the same run means the durability or idempotence contract broke,
 * which is never a transient condition -- `FatalError` stops the retry loop
 * instead of hiding it behind attempts that cannot succeed.
 */
async function verifyLedger(idempotencyKey: string, reference: string) {
  'use step';

  const execution = await getJobExecution(idempotencyKey);
  if (!execution) {
    throw new FatalError(`Durable job lost its ledger entry for step ${idempotencyKey}`);
  }
  if (execution.reference !== reference) {
    throw new FatalError(`Durable job ledger entry does not match reference ${reference}`);
  }

  const ledgerRows = await countRunExecutions(execution.runId);
  if (ledgerRows !== 1) {
    throw new FatalError(
      `Durable job wrote ${ledgerRows} ledger rows for run ${execution.runId}; expected exactly 1`,
    );
  }

  return { attempts: execution.attempts, ledgerRows };
}
