import { z } from 'zod';

const projectNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Project name must be a lowercase slug');

const iosBundleIdentifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/,
    'iOS bundle identifier must use reverse-DNS notation',
  );

const androidPackageSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    'Android package must use lowercase reverse-DNS notation',
  );

const mobileSurfaceSchema = z.discriminatedUnion('adapter', [
  z.strictObject({
    adapter: z.literal('none'),
  }),
  z.strictObject({
    adapter: z.literal('expo-eas'),
    ios_bundle_identifier: iosBundleIdentifierSchema,
    android_package: androidPackageSchema,
  }),
]);

const surfacesSchema = z.strictObject({
  web: z.enum(['next-vercel', 'none']),
  mobile: mobileSurfaceSchema,
  worker: z.enum(['persistent-node', 'none']),
});

const workloadsSchema = z.strictObject({
  http: z.enum(['vercel-functions', 'none']),
  durable_jobs: z.enum(['vercel-workflows', 'none']),
  realtime_audio: z.enum(['provider-webrtc', 'none']),
  persistent_service: z.enum(['render', 'fly', 'none']),
});

const dataSchema = z.strictObject({
  database: z.enum(['neon-eu', 'none']),
  orm: z.enum(['drizzle', 'none']),
  files: z.enum(['cloudflare-r2-eu', 'vercel-blob', 'aws-s3-eu-worm', 'none']),
});

const authSchema = z.strictObject({
  provider: z.enum(['better-auth', 'clerk', 'none']),
  access_mode: z.enum(['public_verified', 'invite_only', 'public_signup_gated_activation', 'none']),
  passkeys: z.enum(['optional', 'required', 'disabled']),
  mfa: z.enum(['optional', 'required', 'disabled']),
});

const operationsSchema = z.strictObject({
  errors: z.enum(['sentry', 'none']),
  analytics: z.enum(['posthog', 'none']),
  email: z.enum(['resend', 'none']),
});

const dataResidencySchema = z.strictObject({
  policy: z.literal('eu_primary'),
  personal_data: z.literal('eu_required'),
  public_assets: z.enum(['global_allowed', 'eu_required']),
  non_eu_processor: z.strictObject({
    requires_approval: z.literal(true),
    requires_dpa: z.literal(true),
    requires_transfer_assessment: z.literal(true),
  }),
});

// Zod 4 strict objects reject unknown keys instead of silently dropping intent.
// Ref: https://zod.dev/api#zstrictobject
export const buildManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    project: z.strictObject({
      name: projectNameSchema,
      profile: z.enum(['saas', 'internal-tool']),
    }),
    surfaces: surfacesSchema,
    workloads: workloadsSchema,
    data: dataSchema,
    auth: authSchema,
    operations: operationsSchema,
    data_residency: dataResidencySchema,
    dns: z.strictObject({
      provider: z.enum(['auto-detect', 'cloudflare', 'gandi', 'vercel', 'none']),
    }),
    cost_policy: z.strictObject({
      automatic_monthly_limit_eur: z.number().nonnegative(),
      paid_upgrade_requires_approval: z.literal(true),
    }),
  })
  .superRefine((manifest, context) => {
    const hasSurface =
      manifest.surfaces.web !== 'none' ||
      manifest.surfaces.mobile.adapter !== 'none' ||
      manifest.surfaces.worker !== 'none';
    if (!hasSurface) {
      context.addIssue({
        code: 'custom',
        path: ['surfaces'],
        message: 'At least one project surface must be selected',
      });
    }

    const hasDatabase = manifest.data.database !== 'none';
    const hasOrm = manifest.data.orm !== 'none';
    if (hasDatabase !== hasOrm) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'database'],
        message: 'Database and ORM must either both be selected or both be none',
      });
    }

    if (manifest.auth.provider === 'better-auth' && !hasDatabase) {
      context.addIssue({
        code: 'custom',
        path: ['auth', 'provider'],
        message: 'Better Auth requires a selected database',
      });
    }

    if (manifest.auth.provider === 'better-auth' && manifest.operations.email !== 'resend') {
      context.addIssue({
        code: 'custom',
        path: ['operations', 'email'],
        message: 'The production Better Auth profile requires the Resend email adapter',
      });
    }

    const hasAuthOptions =
      manifest.auth.access_mode !== 'none' ||
      manifest.auth.passkeys !== 'disabled' ||
      manifest.auth.mfa !== 'disabled';
    if (manifest.auth.provider === 'none' && hasAuthOptions) {
      context.addIssue({
        code: 'custom',
        path: ['auth'],
        message: 'Auth options require a selected auth provider',
      });
    }

    const hasWeb = manifest.surfaces.web !== 'none';
    if (!hasWeb && manifest.auth.provider !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['auth', 'provider'],
        message: 'The current auth adapters require the Next.js web surface',
      });
    }

    if (!hasWeb && manifest.operations.analytics !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['operations', 'analytics'],
        message: 'The current analytics adapter requires the Next.js web surface',
      });
    }

    if (!hasWeb && manifest.operations.errors !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['operations', 'errors'],
        message: 'The current error-reporting adapter requires the Next.js web surface',
      });
    }

    if (!hasWeb && manifest.dns.provider !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['dns', 'provider'],
        message: 'The current DNS adapter requires the Next.js web surface',
      });
    }
  });

export type BuildManifest = z.infer<typeof buildManifestSchema>;

export type CompositionUnit =
  | { kind: 'surface'; id: 'web'; adapter: 'next-vercel' }
  | { kind: 'surface'; id: 'mobile'; adapter: 'expo-eas' }
  | { kind: 'surface'; id: 'worker'; adapter: 'persistent-node' }
  | { kind: 'workload'; id: 'http'; adapter: 'vercel-functions' }
  | { kind: 'workload'; id: 'durable_jobs'; adapter: 'vercel-workflows' }
  | { kind: 'workload'; id: 'realtime_audio'; adapter: 'provider-webrtc' }
  | { kind: 'workload'; id: 'persistent_service'; adapter: 'render' | 'fly' }
  | { kind: 'capability'; id: 'database'; adapter: 'neon-eu' }
  | { kind: 'capability'; id: 'orm'; adapter: 'drizzle' }
  | { kind: 'capability'; id: 'auth'; adapter: 'better-auth' | 'clerk' }
  | {
      kind: 'capability';
      id: 'files';
      adapter: 'cloudflare-r2-eu' | 'vercel-blob' | 'aws-s3-eu-worm';
    }
  | { kind: 'capability'; id: 'errors'; adapter: 'sentry' }
  | { kind: 'capability'; id: 'analytics'; adapter: 'posthog' }
  | { kind: 'capability'; id: 'email'; adapter: 'resend' }
  | {
      kind: 'capability';
      id: 'dns';
      adapter: 'auto-detect' | 'cloudflare' | 'gandi' | 'vercel';
    };

export type CompositionPlan = {
  schemaVersion: 1;
  project: BuildManifest['project'];
  units: CompositionUnit[];
  policies: {
    authentication: {
      accessMode: BuildManifest['auth']['access_mode'];
      passkeys: BuildManifest['auth']['passkeys'];
      mfa: BuildManifest['auth']['mfa'];
    };
    dataResidency: BuildManifest['data_residency'];
    cost: BuildManifest['cost_policy'];
  };
};

export type GeneratedFile = {
  path: string;
  content: string;
};

export type SurfaceFilePlan = {
  writes: GeneratedFile[];
  removals: string[];
};

export type CapabilityFilePlan = SurfaceFilePlan;

export type ProjectFilePlan = SurfaceFilePlan;

export type GenerationReceipt = {
  schema_version: 1;
  project: BuildManifest['project'];
  manifest_sha256: string;
  composition: CompositionPlan;
  generated_files: Array<{
    path: string;
    sha256: string;
  }>;
  removed_paths: string[];
  excluded_source_paths: string[];
  next_actions: string[];
};

export type DoctorCheck = {
  id: string;
  status: 'pass' | 'fail';
  message: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};
