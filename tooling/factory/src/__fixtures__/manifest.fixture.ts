export const canonicalManifest = {
  schema_version: 1,
  project: {
    name: 'example-saas',
    profile: 'saas',
  },
  surfaces: {
    web: 'next-vercel',
    mobile: {
      adapter: 'none',
    },
    worker: 'none',
  },
  workloads: {
    http: 'vercel-functions',
    durable_jobs: 'none',
    realtime_audio: 'none',
    persistent_service: 'none',
  },
  data: {
    database: 'neon-eu',
    orm: 'drizzle',
    files: 'cloudflare-r2-eu',
  },
  auth: {
    provider: 'better-auth',
    access_mode: 'public_verified',
    passkeys: 'optional',
    mfa: 'optional',
  },
  operations: {
    errors: 'sentry',
    analytics: 'posthog',
    email: 'resend',
  },
  data_residency: {
    policy: 'eu_primary',
    personal_data: 'eu_required',
    public_assets: 'global_allowed',
    non_eu_processor: {
      requires_approval: true,
      requires_dpa: true,
      requires_transfer_assessment: true,
    },
  },
  dns: {
    provider: 'auto-detect',
  },
  cost_policy: {
    automatic_monthly_limit_eur: 10,
    paid_upgrade_requires_approval: true,
  },
} as const;

export const expoManifest = {
  ...canonicalManifest,
  surfaces: {
    ...canonicalManifest.surfaces,
    mobile: {
      adapter: 'expo-eas',
      ios_bundle_identifier: 'com.example.examplesaas',
      android_package: 'com.example.examplesaas',
    },
  },
} as const;

// Durable jobs run on the Vercel World, which stores run data in iad1, so the
// manifest must carry the explicit non-EU processor approval (ADR 47).
export const durableJobsManifest = {
  ...canonicalManifest,
  project: {
    name: 'durable-jobs',
    profile: 'saas',
  },
  workloads: {
    ...canonicalManifest.workloads,
    durable_jobs: 'vercel-workflows',
  },
  data_residency: {
    ...canonicalManifest.data_residency,
    approved_non_eu_processors: ['vercel-workflows'],
  },
} as const;

export const documentsManifest = {
  ...canonicalManifest,
  project: {
    name: 'eu-documents',
    profile: 'saas',
  },
  data: {
    ...canonicalManifest.data,
    files: 'cloudflare-r2-eu',
  },
} as const;

export const minimalManifest = {
  ...canonicalManifest,
  project: {
    name: 'minimal-web',
    profile: 'saas',
  },
  workloads: {
    http: 'vercel-functions',
    durable_jobs: 'none',
    realtime_audio: 'none',
    persistent_service: 'none',
  },
  data: {
    database: 'none',
    orm: 'none',
    files: 'none',
  },
  auth: {
    provider: 'none',
    access_mode: 'none',
    passkeys: 'disabled',
    mfa: 'disabled',
  },
  operations: {
    errors: 'none',
    analytics: 'none',
    email: 'none',
  },
  dns: {
    provider: 'none',
  },
  cost_policy: {
    automatic_monthly_limit_eur: 0,
    paid_upgrade_requires_approval: true,
  },
} as const;

export const mobileOnlyManifest = {
  ...minimalManifest,
  project: {
    name: 'mobile-only',
    profile: 'internal-tool',
  },
  surfaces: {
    web: 'none',
    mobile: {
      adapter: 'expo-eas',
      ios_bundle_identifier: 'com.example.mobileonly',
      android_package: 'com.example.mobileonly',
    },
    worker: 'none',
  },
  workloads: {
    http: 'none',
    durable_jobs: 'none',
    realtime_audio: 'none',
    persistent_service: 'none',
  },
} as const;

export const clerkManifest = {
  ...minimalManifest,
  project: {
    name: 'clerk-web',
    profile: 'saas',
  },
  auth: {
    provider: 'clerk',
    access_mode: 'public_verified',
    passkeys: 'optional',
    mfa: 'optional',
  },
} as const;
