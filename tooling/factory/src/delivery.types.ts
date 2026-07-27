import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'Delivery URLs must use HTTPS',
});

export const deliveryPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  source: z.strictObject({
    commit_sha: gitShaSchema,
    source_sha256: sha256Schema,
  }),
  deployment: z.strictObject({
    provider: z.literal('vercel'),
    team_id: z.string().trim().min(1),
    project_id: z.string().trim().min(1),
    project_name: z.string().trim().min(1),
    target: z.literal('production'),
  }),
  smoke: z.strictObject({
    method: z.literal('GET'),
    path: z.literal('/'),
    expected_status: z.literal(200),
    expected_content_type_prefix: z.literal('text/html'),
    expected_body_contains: z.string().min(1),
    max_body_bytes: z.literal(1_048_576),
  }),
  permissions: z.tuple([z.literal('deployment:read')]),
});

export type DeliveryPlan = z.infer<typeof deliveryPlanSchema>;

const deliveryErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

const smokeReceiptSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  content_type: z.string().min(1),
  body_sha256: sha256Schema,
  body_bytes: z.number().int().nonnegative(),
  bypass_used: z.boolean(),
  final_url: httpsUrlSchema,
  checked_at: z.iso.datetime(),
});

const deploymentObservationSchema = z.strictObject({
  deployment_id: z.string().trim().min(1),
  url: httpsUrlSchema,
  ready_state: z.literal('READY'),
  target: z.literal('production'),
  source_commit_sha: gitShaSchema,
  created_at: z.number().int().nonnegative(),
  ready_at: z.number().int().nonnegative().nullable(),
  observed_at: z.iso.datetime(),
  smoke: smokeReceiptSchema.nullable(),
});

export const deliveryStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: deliveryPlanSchema,
  attempts: z.number().int().nonnegative(),
  observation: deploymentObservationSchema.nullable(),
  error: deliveryErrorSchema.nullable(),
});

export type DeliveryState = z.infer<typeof deliveryStateSchema>;
export type DeploymentObservation = z.infer<typeof deploymentObservationSchema>;
export type SmokeReceipt = z.infer<typeof smokeReceiptSchema>;
