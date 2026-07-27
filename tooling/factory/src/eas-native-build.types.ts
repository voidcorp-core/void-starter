import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const accountSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const platformSchema = z.enum(['android', 'ios']);
const buildStatusSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

const platformsSchema = z
  .array(platformSchema)
  .min(1)
  .max(2)
  .refine((platforms) => new Set(platforms).size === platforms.length, {
    message: 'EAS build platforms must be unique',
  });

const environmentVariableSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^[A-Z_][A-Z0-9_]*$/),
  visibility: z.enum(['plaintext', 'sensitive', 'secret']),
  type: z.enum(['string', 'file']),
});

const signingSchema = z.strictObject({
  owner: accountSchema,
  credentials_source: z.literal('remote'),
  credentials_ready: z.boolean(),
});

const membershipStatusSchema = z.enum(['active', 'missing', 'not-required']);

const signingConfigurationSchema = z.strictObject({
  android: signingSchema,
  ios: signingSchema.extend({
    apple_team_id: z.string().trim().min(1).max(64).nullable(),
  }),
});

const storeMembershipsSchema = z.strictObject({
  apple: z.strictObject({
    status: membershipStatusSchema,
    team_id: z.string().trim().min(1).max(64).nullable(),
    role: z.enum(['account-holder', 'admin', 'app-manager', 'developer', 'none']),
  }),
  google_play: z.strictObject({
    status: membershipStatusSchema,
    role: z.enum(['owner', 'admin', 'release-manager', 'none']),
  }),
});

export const easNativeBuildContextSchema = z
  .strictObject({
    schema_version: z.literal(1),
    profile: z.enum(['development', 'preview', 'production']),
    platforms: platformsSchema,
    environment: z.strictObject({
      required: z.array(environmentVariableSchema).max(100),
    }),
    signing: signingConfigurationSchema,
    store_memberships: storeMembershipsSchema,
    cost: z.strictObject({
      maximum_builds: z.number().int().min(1).max(2),
      maximum_provider_charge_usd: z.number().finite().nonnegative().max(10_000),
      paid_builds: z.literal('explicit-approval-required'),
    }),
  })
  .superRefine((context, refinement) => {
    if (context.cost.maximum_builds !== context.platforms.length) {
      refinement.addIssue({
        code: 'custom',
        path: ['cost', 'maximum_builds'],
        message: 'maximum_builds must equal the number of selected platforms',
      });
    }
    const names = context.environment.required.map((variable) => variable.name);
    if (new Set(names).size !== names.length) {
      refinement.addIssue({
        code: 'custom',
        path: ['environment', 'required'],
        message: 'Required EAS environment variable names must be unique',
      });
    }
  });

export type EasNativeBuildContext = z.infer<typeof easNativeBuildContextSchema>;

export const easNativeBuildPlanSchema = z.strictObject({
  schema_version: z.literal(1),
  manifest_sha256: sha256Schema,
  context_sha256: sha256Schema,
  eas_project: z.strictObject({
    state_plan_sha256: sha256Schema,
    project_id: z.uuid(),
    owner: accountSchema,
    slug: z.string().trim().min(1).max(100),
    full_name: z.string().trim().min(3).max(203),
  }),
  source: z.strictObject({
    state_plan_sha256: sha256Schema,
    commit_sha: gitShaSchema,
    sha256: sha256Schema,
  }),
  configuration: z.strictObject({
    path: z.literal('apps/mobile/eas.json'),
    sha256: sha256Schema,
    profile: z.enum(['development', 'preview', 'production']),
    environment: z.enum(['development', 'preview', 'production']),
    distribution: z.enum(['internal', 'store']),
    credentials_source: z.literal('remote'),
    platforms: platformsSchema,
  }),
  environment: z.strictObject({
    required: z.array(environmentVariableSchema).max(100),
  }),
  signing: signingConfigurationSchema,
  store_memberships: storeMembershipsSchema,
  safeguards: z.strictObject({
    freeze_credentials: z.literal(true),
    auto_submit: z.literal(false),
    non_interactive: z.literal(true),
    no_wait: z.literal(true),
    maximum_builds: z.number().int().min(1).max(2),
    maximum_provider_charge_usd: z.number().finite().nonnegative().max(10_000),
    paid_builds: z.literal('explicit-approval-required'),
  }),
  permissions: z.tuple([
    z.literal('account:read'),
    z.literal('project:read'),
    z.literal('environment:read'),
    z.literal('build:read'),
    z.literal('build:create'),
  ]),
});

export type EasNativeBuildPlan = z.infer<typeof easNativeBuildPlanSchema>;

const easNativeBuildObservationSchema = z.strictObject({
  build_id: z.string().trim().min(1).max(100),
  platform: platformSchema,
  status: buildStatusSchema,
  message: z.string().trim().min(1).max(200),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  completed_at: z.iso.datetime().nullable(),
});

export type EasNativeBuildObservation = z.infer<typeof easNativeBuildObservationSchema>;

const easNativeBuildErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

export const easNativeBuildStateSchema = z.strictObject({
  schema_version: z.literal(1),
  mode: z.literal('live'),
  status: z.enum(['pending', 'running', 'failed', 'succeeded']),
  plan_sha256: sha256Schema,
  plan: easNativeBuildPlanSchema,
  attempts: z.number().int().nonnegative(),
  builds: z.array(easNativeBuildObservationSchema).max(2),
  error: easNativeBuildErrorSchema.nullable(),
});

export type EasNativeBuildState = z.infer<typeof easNativeBuildStateSchema>;
