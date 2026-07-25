import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

export const sourcePublicationPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  repository: z.strictObject({
    owner: z.string().trim().min(1),
    owner_kind: z.enum(['organization', 'user']),
    name: z.string().trim().min(1),
    node_id: z.string().trim().min(1),
    visibility: z.enum(['private', 'public']),
    branch: z.literal('main'),
  }),
  source: z.strictObject({
    sha256: sha256Schema,
    file_count: z.number().int().positive(),
    total_bytes: z.number().int().positive(),
    required_lockfile: z.literal('bun.lock'),
  }),
  permissions: z.tuple([
    z.literal('repository:contents:write'),
    z.literal('repository:workflows:write'),
  ]),
});

export type SourcePublicationPlan = z.infer<typeof sourcePublicationPlanSchema>;

const sourcePublicationErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

export const sourcePublicationStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: sourcePublicationPlanSchema,
  attempts: z.number().int().nonnegative(),
  commit_sha: gitShaSchema.nullable(),
  error: sourcePublicationErrorSchema.nullable(),
});

export type SourcePublicationState = z.infer<typeof sourcePublicationStateSchema>;
