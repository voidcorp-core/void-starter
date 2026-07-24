import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKeySchema = z.string().regex(/^void-starter:v1:[a-f0-9]{64}$/);

const githubContextSchema = z.strictObject({
  owner: z.string().trim().min(1),
  owner_kind: z.enum(['organization', 'user']),
  visibility: z.enum(['private', 'public']),
});

const vercelContextSchema = z.strictObject({
  team_id: z.string().trim().min(1),
  region: z.literal('fra1'),
});

const neonContextSchema = z.strictObject({
  org_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,60}$/),
  region_id: z.enum(['aws-eu-central-1']),
});

export const provisioningContextSchema = z.strictObject({
  schema_version: z.literal(1),
  github: githubContextSchema,
  vercel: vercelContextSchema.optional(),
  neon: neonContextSchema.optional(),
});

export type ProvisioningContext = z.infer<typeof provisioningContextSchema>;

const githubRepositoryActionSchema = z.strictObject({
  id: z.literal('github.repository'),
  provider: z.literal('github'),
  kind: z.literal('ensure-repository'),
  depends_on: z.tuple([]),
  permissions: z.tuple([z.literal('repository:administration:write')]),
  input: z.strictObject({
    owner: z.string().trim().min(1),
    owner_kind: z.enum(['organization', 'user']),
    name: z.string().trim().min(1),
    visibility: z.enum(['private', 'public']),
  }),
  idempotency_key: idempotencyKeySchema,
});

const vercelProjectActionSchema = z.strictObject({
  id: z.literal('vercel.project'),
  provider: z.literal('vercel'),
  kind: z.literal('ensure-project'),
  depends_on: z.tuple([z.literal('github.repository')]),
  permissions: z.tuple([z.literal('project:write')]),
  input: z.strictObject({
    team_id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    framework: z.literal('nextjs'),
    region: z.literal('fra1'),
    root_directory: z.literal('apps/web'),
    repository_action_id: z.literal('github.repository'),
  }),
  idempotency_key: idempotencyKeySchema,
});

const neonProjectActionSchema = z.strictObject({
  id: z.literal('neon.project'),
  provider: z.literal('neon'),
  kind: z.literal('ensure-project'),
  depends_on: z.tuple([z.literal('github.repository')]),
  permissions: z.tuple([z.literal('project:create')]),
  input: z.strictObject({
    org_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,60}$/),
    name: z.string().trim().min(1),
    region_id: z.literal('aws-eu-central-1'),
  }),
  idempotency_key: idempotencyKeySchema,
});

const vercelDatabaseBindingActionSchema = z.strictObject({
  id: z.literal('vercel.database-binding'),
  provider: z.literal('vercel'),
  kind: z.literal('ensure-database-binding'),
  depends_on: z.tuple([z.literal('vercel.project'), z.literal('neon.project')]),
  permissions: z.tuple([z.literal('project-environment:write')]),
  input: z.strictObject({
    project_action_id: z.literal('vercel.project'),
    database_action_id: z.literal('neon.project'),
    environment_variable: z.literal('DATABASE_URL'),
    targets: z.tuple([z.literal('development'), z.literal('preview'), z.literal('production')]),
  }),
  idempotency_key: idempotencyKeySchema,
});

const provisioningActionSchema = z.discriminatedUnion('id', [
  githubRepositoryActionSchema,
  vercelProjectActionSchema,
  neonProjectActionSchema,
  vercelDatabaseBindingActionSchema,
]);

export type ProvisioningAction = z.infer<typeof provisioningActionSchema>;

export const provisioningPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  cost_policy: z.strictObject({
    automatic_monthly_limit_eur: z.number().nonnegative(),
    paid_upgrade_requires_approval: z.literal(true),
  }),
  actions: z.array(provisioningActionSchema).min(1),
});

export type ProvisioningPlan = z.infer<typeof provisioningPlanSchema>;

const resourceIdentitySchema = {
  resource_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
};

export const provisionedResourceSchema = z.union([
  z.strictObject({
    provider: z.literal('github'),
    resource_kind: z.literal('repository'),
    ...resourceIdentitySchema,
  }),
  z.strictObject({
    provider: z.literal('vercel'),
    resource_kind: z.literal('project'),
    ...resourceIdentitySchema,
  }),
  z.strictObject({
    provider: z.literal('neon'),
    resource_kind: z.literal('project'),
    ...resourceIdentitySchema,
    database_name: z.string().trim().min(1),
    role_name: z.string().trim().min(1),
  }),
  z.strictObject({
    provider: z.literal('vercel'),
    resource_kind: z.literal('database-binding'),
    ...resourceIdentitySchema,
  }),
]);

export type ProvisionedResource = z.infer<typeof provisionedResourceSchema>;

const provisioningErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

const provisioningActionStateSchema = z.strictObject({
  action_id: z.enum([
    'github.repository',
    'vercel.project',
    'neon.project',
    'vercel.database-binding',
  ]),
  idempotency_key: idempotencyKeySchema,
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  attempts: z.number().int().nonnegative(),
  resource: provisionedResourceSchema.nullable(),
  error: provisioningErrorSchema.nullable(),
});

export type ProvisioningActionState = z.infer<typeof provisioningActionStateSchema>;

export const provisioningApplyStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.enum(['simulate', 'live']),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: provisioningPlanSchema,
  actions: z.array(provisioningActionStateSchema).min(1),
});

export type ProvisioningApplyState = z.infer<typeof provisioningApplyStateSchema>;
