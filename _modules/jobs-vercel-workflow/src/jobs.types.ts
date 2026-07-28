import type { JobExecution } from '@repo/db/schema';
import { z } from 'zod';

/**
 * Durable-jobs domain schemas and types. Schema and type live together
 * (ADR 09): every type below is derived from its schema via `z.infer`.
 *
 * The payload contract is the data-residency boundary. The Vercel World stores
 * workflow run data in `iad1` whatever the deployment region (ADR 47), so a
 * job payload must never carry personal data. `jobReferenceSchema` enforces an
 * opaque identifier: the character class rejects the shapes personal data
 * actually takes in practice -- an email address (`@`), a human name (space),
 * a postal address (comma) or a free-text note. Steps re-read the real record
 * from Neon EU using this reference.
 */
export const jobReferenceSchema = z
  .string()
  .trim()
  .min(8, 'Job reference is too short to be opaque')
  .max(64, 'Job reference is too long')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'Job reference must be an opaque identifier: letters, digits, hyphen and underscore only',
  );

/**
 * The Workflow SDK `stepId`, used verbatim as the ledger idempotency key. It is
 * stable across retries of a step and globally unique per step invocation, which
 * is exactly the uniqueness an idempotency key requires.
 */
export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export const recordJobExecutionSchema = z.strictObject({
  runId: z.string().trim().min(1).max(255),
  idempotencyKey: idempotencyKeySchema,
  reference: jobReferenceSchema,
});

export type RecordJobExecutionInput = z.infer<typeof recordJobExecutionSchema>;

export type { JobExecution };
