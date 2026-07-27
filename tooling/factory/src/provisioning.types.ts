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

const cloudflareContextSchema = z.strictObject({
  account_id: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/),
});

const sentrySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const sentryContextSchema = z.strictObject({
  organization_slug: sentrySlugSchema,
  team_slug: sentrySlugSchema,
  region: z.literal('de'),
});

export const provisioningContextSchema = z.strictObject({
  schema_version: z.literal(1),
  github: githubContextSchema,
  vercel: vercelContextSchema.optional(),
  neon: neonContextSchema.optional(),
  cloudflare: cloudflareContextSchema.optional(),
  sentry: sentryContextSchema.optional(),
});

export type ProvisioningContext = z.infer<typeof provisioningContextSchema>;

const githubRepositoryActionSchema = z.strictObject({
  id: z.literal('github.repository'),
  provider: z.literal('github'),
  kind: z.literal('ensure-repository'),
  depends_on: z.tuple([]),
  permissions: z.union([
    z.tuple([z.literal('repository:administration:write')]),
    z.tuple([z.literal('organization:members:read'), z.literal('repository:administration:write')]),
  ]),
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

const cloudflareR2BucketActionSchema = z.strictObject({
  id: z.literal('cloudflare.r2-bucket'),
  provider: z.literal('cloudflare'),
  kind: z.literal('ensure-r2-bucket'),
  depends_on: z.tuple([]),
  permissions: z.tuple([
    z.literal('r2-bucket:read'),
    z.literal('r2-bucket:write'),
    z.literal('r2-object:read'),
    z.literal('r2-object:write'),
  ]),
  input: z.strictObject({
    account_id: z.string().regex(/^[a-f0-9]{32}$/),
    name: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    jurisdiction: z.literal('eu'),
    storage_class: z.literal('Standard'),
  }),
  idempotency_key: idempotencyKeySchema,
});

const vercelR2BindingActionSchema = z.strictObject({
  id: z.literal('vercel.r2-binding'),
  provider: z.literal('vercel'),
  kind: z.literal('ensure-r2-binding'),
  depends_on: z.tuple([z.literal('vercel.project'), z.literal('cloudflare.r2-bucket')]),
  permissions: z.tuple([z.literal('project-environment:write')]),
  input: z.strictObject({
    project_action_id: z.literal('vercel.project'),
    bucket_action_id: z.literal('cloudflare.r2-bucket'),
    bindings: z.tuple([
      z.literal('CLOUDFLARE_ACCOUNT_ID'),
      z.literal('R2_ACCESS_KEY_ID'),
      z.literal('R2_BUCKET_NAME'),
      z.literal('R2_ENDPOINT'),
      z.literal('R2_SECRET_ACCESS_KEY'),
    ]),
    targets: z.tuple([z.literal('development'), z.literal('preview'), z.literal('production')]),
  }),
  idempotency_key: idempotencyKeySchema,
});

const sentryProjectActionSchema = z.strictObject({
  id: z.literal('sentry.project'),
  provider: z.literal('sentry'),
  kind: z.literal('ensure-project'),
  depends_on: z.tuple([]),
  permissions: z.tuple([
    z.literal('organization:read'),
    z.literal('team:read'),
    z.literal('project:read'),
    z.literal('project:write'),
  ]),
  input: z.strictObject({
    organization_slug: sentrySlugSchema,
    team_slug: sentrySlugSchema,
    name: z.string().trim().min(1),
    slug: sentrySlugSchema,
    region: z.literal('de'),
    platform: z.literal('javascript-nextjs'),
    default_rules: z.literal(true),
  }),
  idempotency_key: idempotencyKeySchema,
});

const vercelSentryBindingActionSchema = z.strictObject({
  id: z.literal('vercel.sentry-binding'),
  provider: z.literal('vercel'),
  kind: z.literal('ensure-sentry-binding'),
  depends_on: z.tuple([z.literal('vercel.project'), z.literal('sentry.project')]),
  permissions: z.tuple([z.literal('project-environment:write')]),
  input: z.strictObject({
    project_action_id: z.literal('vercel.project'),
    sentry_action_id: z.literal('sentry.project'),
    bindings: z.tuple([
      z.literal('SENTRY_DSN'),
      z.literal('NEXT_PUBLIC_SENTRY_DSN'),
      z.literal('SENTRY_AUTH_TOKEN'),
      z.literal('SENTRY_ORG'),
      z.literal('SENTRY_PROJECT'),
    ]),
    targets: z.tuple([z.literal('development'), z.literal('preview'), z.literal('production')]),
  }),
  idempotency_key: idempotencyKeySchema,
});

const provisioningActionSchema = z.discriminatedUnion('id', [
  githubRepositoryActionSchema,
  vercelProjectActionSchema,
  neonProjectActionSchema,
  vercelDatabaseBindingActionSchema,
  cloudflareR2BucketActionSchema,
  vercelR2BindingActionSchema,
  sentryProjectActionSchema,
  vercelSentryBindingActionSchema,
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
  z.strictObject({
    provider: z.literal('cloudflare'),
    resource_kind: z.literal('r2-bucket'),
    ...resourceIdentitySchema,
    account_id: z.string().regex(/^[a-f0-9]{32}$/),
    jurisdiction: z.literal('eu'),
    public_access: z.literal(false),
    canary_sha256: sha256Schema,
  }),
  z.strictObject({
    provider: z.literal('vercel'),
    resource_kind: z.literal('r2-binding'),
    ...resourceIdentitySchema,
    bound_keys: z.tuple([
      z.literal('CLOUDFLARE_ACCOUNT_ID'),
      z.literal('R2_ACCESS_KEY_ID'),
      z.literal('R2_BUCKET_NAME'),
      z.literal('R2_ENDPOINT'),
      z.literal('R2_SECRET_ACCESS_KEY'),
    ]),
  }),
  z.strictObject({
    provider: z.literal('sentry'),
    resource_kind: z.literal('project'),
    ...resourceIdentitySchema,
    organization_slug: sentrySlugSchema,
    team_slug: sentrySlugSchema,
    region: z.literal('de'),
    platform: z.literal('javascript-nextjs'),
    client_key_id: z.string().trim().min(1),
    dsn_sha256: sha256Schema,
  }),
  z.strictObject({
    provider: z.literal('vercel'),
    resource_kind: z.literal('sentry-binding'),
    ...resourceIdentitySchema,
    bound_keys: z.tuple([
      z.literal('SENTRY_DSN'),
      z.literal('NEXT_PUBLIC_SENTRY_DSN'),
      z.literal('SENTRY_AUTH_TOKEN'),
      z.literal('SENTRY_ORG'),
      z.literal('SENTRY_PROJECT'),
    ]),
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
    'cloudflare.r2-bucket',
    'vercel.r2-binding',
    'sentry.project',
    'vercel.sentry-binding',
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
