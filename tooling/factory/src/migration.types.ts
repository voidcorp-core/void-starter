import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const migrationTagSchema = z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/);

export const migrationEntrySchema = z.strictObject({
  index: z.number().int().nonnegative(),
  tag: migrationTagSchema,
  created_at: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export const migrationPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  source: z.strictObject({
    commit_sha: gitShaSchema,
    source_sha256: sha256Schema,
  }),
  database: z.strictObject({
    provider: z.literal('neon'),
    org_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,60}$/),
    project_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,60}$/),
    project_name: z.string().trim().min(1),
    region_id: z.literal('aws-eu-central-1'),
    database_name: z.string().trim().min(1),
    role_name: z.string().trim().min(1),
  }),
  migrations: z.strictObject({
    directory: z.literal('packages/db/migrations'),
    schema: z.literal('drizzle'),
    table: z.literal('__drizzle_migrations'),
    sha256: sha256Schema,
    entries: z.array(migrationEntrySchema).min(1),
  }),
  permissions: z.tuple([
    z.literal('project:read'),
    z.literal('connection-uri:read'),
    z.literal('database:schema:write'),
  ]),
});

export type MigrationEntry = z.infer<typeof migrationEntrySchema>;
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;

const migrationErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

const migrationObservationSchema = z.strictObject({
  database_project_id: z.string().trim().min(1),
  database_name: z.string().trim().min(1),
  migration_schema: z.literal('drizzle'),
  migration_table: z.literal('__drizzle_migrations'),
  applied_before: z.number().int().nonnegative(),
  applied_during_attempt: z.number().int().nonnegative(),
  applied_migrations: z.number().int().positive(),
  latest_migration_tag: migrationTagSchema,
  latest_migration_sha256: sha256Schema,
  latest_migration_created_at: z.number().int().nonnegative(),
  verified_at: z.iso.datetime(),
});

export const migrationStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: migrationPlanSchema,
  attempts: z.number().int().nonnegative(),
  observation: migrationObservationSchema.nullable(),
  error: migrationErrorSchema.nullable(),
});

export type MigrationObservation = z.infer<typeof migrationObservationSchema>;
export type MigrationState = z.infer<typeof migrationStateSchema>;
