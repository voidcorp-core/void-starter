import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const accountSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Expo account must be a lowercase safe account name');
const projectIdSchema = z.uuid();

export const easProjectContextSchema = z.strictObject({
  schema_version: z.literal(1),
  account: accountSchema,
});

export type EasProjectContext = z.infer<typeof easProjectContextSchema>;

export const easProjectLinkSchema = z.strictObject({
  schema_version: z.literal(1),
  owner: accountSchema,
  slug: z.string().trim().min(1).max(100),
  project_id: projectIdSchema,
});

export type EasProjectLink = z.infer<typeof easProjectLinkSchema>;

export const easProjectPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  application: z.strictObject({
    provider: z.literal('expo-eas'),
    owner: accountSchema,
    slug: z.string().trim().min(1).max(100),
    full_name: z.string().trim().min(3).max(203),
    ios_bundle_identifier: z.string().trim().min(3),
    android_package: z.string().trim().min(3),
    static_config_path: z.literal('apps/mobile/app.json'),
    static_config_sha256: sha256Schema,
    dynamic_config_path: z.literal('apps/mobile/app.config.ts'),
    dynamic_config_sha256: sha256Schema,
    link_path: z.literal('apps/mobile/eas-project.json'),
  }),
  permissions: z.tuple([
    z.literal('account:read'),
    z.literal('project:read'),
    z.literal('project:create'),
  ]),
});

export type EasProjectPlan = z.infer<typeof easProjectPlanSchema>;

const easProjectErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

export const easProjectObservationSchema = z.strictObject({
  project_id: projectIdSchema,
  owner: accountSchema,
  slug: z.string().trim().min(1).max(100),
  full_name: z.string().trim().min(3).max(203),
  link_sha256: sha256Schema,
  linked_at: z.iso.datetime(),
});

export type EasProjectObservation = z.infer<typeof easProjectObservationSchema>;

export const easProjectStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: easProjectPlanSchema,
  attempts: z.number().int().nonnegative(),
  observation: easProjectObservationSchema.nullable(),
  error: easProjectErrorSchema.nullable(),
});

export type EasProjectState = z.infer<typeof easProjectStateSchema>;
