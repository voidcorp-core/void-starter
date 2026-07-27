import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const httpsOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}, 'Canonical URL must be a credential-free HTTPS origin');
const senderSchema = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .refine((value) => !/[\r\n]/.test(value), 'Sender must not contain line breaks');

export const authProductionContextSchema = z.strictObject({
  schema_version: z.literal(1),
  canonical_url: httpsOriginSchema,
  email: z.strictObject({
    from: senderSchema,
    reply_to: z.email().max(320).optional(),
  }),
  bootstrap: z.strictObject({
    administrator_email: z.email().max(320),
  }),
});

export type AuthProductionContext = z.infer<typeof authProductionContextSchema>;

const bindingSchema = z.strictObject({
  key: z.enum([
    'AUTH_BOOTSTRAP_ADMIN_EMAIL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'EMAIL_APP_NAME',
    'EMAIL_FROM',
    'EMAIL_REPLY_TO',
    'NEXT_PUBLIC_APP_URL',
    'RESEND_API_KEY',
  ]),
  type: z.enum(['encrypted', 'sensitive']),
  targets: z.tuple([z.literal('production')]),
});

export const authProductionPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  provider_context_sha256: sha256Schema,
  auth_context_sha256: sha256Schema,
  source: z.strictObject({
    commit_sha: gitShaSchema,
    source_sha256: sha256Schema,
  }),
  application: z.strictObject({
    provider: z.literal('vercel'),
    team_id: z.string().trim().min(1),
    project_id: z.string().trim().min(1),
    project_name: z.string().trim().min(1),
    canonical_url: httpsOriginSchema,
  }),
  email: z.strictObject({
    provider: z.literal('resend'),
    from: senderSchema,
    reply_to: z.email().max(320).nullable(),
    sender_domain: z.string().trim().min(1),
  }),
  bootstrap: z.strictObject({
    administrator_email: z.email().max(320),
    role: z.literal('admin'),
    strategy: z.literal('exact-email-on-user-create'),
  }),
  bindings: z.array(bindingSchema).min(7).max(8),
  permissions: z.tuple([
    z.literal('project:read'),
    z.literal('project-environment:read'),
    z.literal('project-environment:write'),
    z.literal('email:send'),
  ]),
});

export type AuthProductionPlan = z.infer<typeof authProductionPlanSchema>;

const authProductionErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

const authProductionObservationSchema = z.strictObject({
  project_id: z.string().trim().min(1),
  binding_marker_id: z.string().trim().min(1),
  bound_keys: z.array(bindingSchema.shape.key).min(7).max(8),
  email_id: z.string().trim().min(1),
  sender_domain: z.string().trim().min(1),
  administrator_email: z.email().max(320),
  bootstrap_strategy: z.literal('exact-email-on-user-create'),
  requires_redeployment: z.literal(true),
  configured_at: z.iso.datetime(),
});

export const authProductionStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: authProductionPlanSchema,
  attempts: z.number().int().nonnegative(),
  observation: authProductionObservationSchema.nullable(),
  error: authProductionErrorSchema.nullable(),
});

export type AuthProductionObservation = z.infer<typeof authProductionObservationSchema>;
export type AuthProductionState = z.infer<typeof authProductionStateSchema>;
