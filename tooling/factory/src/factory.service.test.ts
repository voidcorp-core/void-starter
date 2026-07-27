import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  expoManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { createCompositionPlan, parseBuildManifest } from './factory.service';

describe('parseBuildManifest', () => {
  it('accepts the canonical schema v1 manifest', () => {
    const manifest = parseBuildManifest(canonicalManifest);

    expect(manifest).toEqual(canonicalManifest);
  });

  it('rejects unknown fields so misspelled intent cannot be ignored', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        secrets: {
          database_url: 'must-never-enter-the-manifest',
        },
      }),
    ).toThrow(/unrecognized/i);
  });

  it('rejects a manifest with no selected surface', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        surfaces: {
          web: 'none',
          mobile: {
            adapter: 'none',
          },
          worker: 'none',
        },
      }),
    ).toThrow(/surface/i);
  });

  it('rejects Drizzle when no database is selected', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        data: {
          ...canonicalManifest.data,
          database: 'none',
        },
      }),
    ).toThrow(/database/i);
  });

  it('rejects Better Auth when both database and ORM are disabled', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        data: {
          ...canonicalManifest.data,
          database: 'none',
          orm: 'none',
        },
      }),
    ).toThrow(/better auth/i);
  });

  it('rejects Better Auth without its production email adapter', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        operations: {
          ...canonicalManifest.operations,
          email: 'none',
        },
      }),
    ).toThrow(/resend/i);
  });

  it('rejects auth options when no auth provider is selected', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        auth: {
          ...canonicalManifest.auth,
          provider: 'none',
        },
      }),
    ).toThrow(/auth options/i);
  });

  it('requires explicit native identifiers for an Expo surface', () => {
    expect(() =>
      parseBuildManifest({
        ...canonicalManifest,
        surfaces: {
          ...canonicalManifest.surfaces,
          mobile: {
            adapter: 'expo-eas',
          },
        },
      }),
    ).toThrow(/bundle|package/i);
  });

  it('rejects malformed native application identifiers', () => {
    expect(() =>
      parseBuildManifest({
        ...expoManifest,
        surfaces: {
          ...expoManifest.surfaces,
          mobile: {
            ...expoManifest.surfaces.mobile,
            android_package: 'invalid-package',
          },
        },
      }),
    ).toThrow(/android package/i);
  });
});

describe('createCompositionPlan', () => {
  it('contains only active selections in a stable topology order', () => {
    const plan = createCompositionPlan(parseBuildManifest(canonicalManifest));

    expect(plan).toEqual({
      schemaVersion: 1,
      project: {
        name: 'example-saas',
        profile: 'saas',
      },
      units: [
        { kind: 'surface', id: 'web', adapter: 'next-vercel' },
        { kind: 'workload', id: 'http', adapter: 'vercel-functions' },
        { kind: 'capability', id: 'database', adapter: 'neon-eu' },
        { kind: 'capability', id: 'orm', adapter: 'drizzle' },
        { kind: 'capability', id: 'auth', adapter: 'better-auth' },
        { kind: 'capability', id: 'files', adapter: 'cloudflare-r2-eu' },
        { kind: 'capability', id: 'errors', adapter: 'sentry' },
        { kind: 'capability', id: 'analytics', adapter: 'posthog' },
        { kind: 'capability', id: 'email', adapter: 'resend' },
        { kind: 'capability', id: 'dns', adapter: 'auto-detect' },
      ],
      policies: {
        authentication: {
          accessMode: 'public_verified',
          passkeys: 'optional',
          mfa: 'optional',
        },
        dataResidency: canonicalManifest.data_residency,
        cost: canonicalManifest.cost_policy,
      },
    });
  });

  it('includes Expo only when the mobile surface is selected', () => {
    const plan = createCompositionPlan(parseBuildManifest(expoManifest));

    expect(plan.units).toContainEqual({
      kind: 'surface',
      id: 'mobile',
      adapter: 'expo-eas',
    });
  });

  it('supports a mobile-only composition without adding the web surface', () => {
    const plan = createCompositionPlan(parseBuildManifest(mobileOnlyManifest));

    expect(plan.units).not.toContainEqual({
      kind: 'surface',
      id: 'web',
      adapter: 'next-vercel',
    });
    expect(plan.units).toContainEqual({
      kind: 'surface',
      id: 'mobile',
      adapter: 'expo-eas',
    });
  });

  it('rejects web-only capability adapters on a mobile-only project', () => {
    for (const override of [
      {
        auth: canonicalManifest.auth,
      },
      {
        operations: {
          ...mobileOnlyManifest.operations,
          analytics: 'posthog',
        },
      },
      {
        operations: {
          ...mobileOnlyManifest.operations,
          errors: 'sentry',
        },
      },
      {
        dns: { provider: 'cloudflare' },
      },
    ]) {
      expect(() =>
        parseBuildManifest({
          ...mobileOnlyManifest,
          ...override,
        }),
      ).toThrow(/web surface/i);
    }
  });

  it('omits every disabled optional unit', () => {
    const plan = createCompositionPlan(
      parseBuildManifest({
        ...canonicalManifest,
        surfaces: {
          web: 'next-vercel',
          mobile: {
            adapter: 'none',
          },
          worker: 'none',
        },
        workloads: {
          http: 'none',
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
      }),
    );

    expect(plan.units).toEqual([{ kind: 'surface', id: 'web', adapter: 'next-vercel' }]);
  });

  it('orders every supported unit independently of manifest key order', () => {
    const plan = createCompositionPlan(
      parseBuildManifest({
        cost_policy: canonicalManifest.cost_policy,
        dns: {
          provider: 'cloudflare',
        },
        data_residency: canonicalManifest.data_residency,
        operations: canonicalManifest.operations,
        data: {
          files: 'aws-s3-eu-worm',
          orm: 'drizzle',
          database: 'neon-eu',
        },
        auth: {
          mfa: 'optional',
          passkeys: 'optional',
          access_mode: 'invite_only',
          provider: 'clerk',
        },
        workloads: {
          persistent_service: 'fly',
          realtime_audio: 'provider-webrtc',
          durable_jobs: 'vercel-workflows',
          http: 'vercel-functions',
        },
        surfaces: {
          worker: 'persistent-node',
          mobile: expoManifest.surfaces.mobile,
          web: 'next-vercel',
        },
        project: {
          profile: 'internal-tool',
          name: 'all-surfaces',
        },
        schema_version: 1,
      }),
    );

    expect(plan.units.map((unit) => `${unit.kind}:${unit.id}`)).toEqual([
      'surface:web',
      'surface:mobile',
      'surface:worker',
      'workload:http',
      'workload:durable_jobs',
      'workload:realtime_audio',
      'workload:persistent_service',
      'capability:database',
      'capability:orm',
      'capability:auth',
      'capability:files',
      'capability:errors',
      'capability:analytics',
      'capability:email',
      'capability:dns',
    ]);
  });
});
