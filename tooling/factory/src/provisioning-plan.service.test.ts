import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  minimalManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import {
  createProvisioningPlan,
  parseProvisioningContext,
  parseProvisioningContextSource,
} from './provisioning-plan.service';

const fullContext = {
  schema_version: 1,
  github: {
    owner: 'voidcorp-core',
    owner_kind: 'organization',
    visibility: 'private',
  },
  vercel: {
    team_id: 'team_example',
    region: 'fra1',
  },
  neon: {
    org_id: 'org-example',
    region_id: 'aws-eu-central-1',
  },
  cloudflare: {
    account_id: '0123456789abcdef0123456789abcdef',
  },
  sentry: {
    organization_slug: 'void-sandbox',
    team_slug: 'platform',
    region: 'de',
  },
  posthog: {
    organization_id: '123e4567-e89b-42d3-a456-426614174000',
    region: 'eu',
  },
} as const;

describe('createProvisioningPlan', () => {
  it('plans GitHub, Vercel, Neon, R2, Sentry, PostHog, and their bindings deterministically', () => {
    const manifest = parseBuildManifest(canonicalManifest);
    const context = parseProvisioningContext(fullContext);

    const first = createProvisioningPlan(manifest, context);
    const second = createProvisioningPlan(manifest, context);

    expect(second).toEqual(first);
    expect(first.actions.map((action) => action.id)).toEqual([
      'github.repository',
      'vercel.project',
      'neon.project',
      'vercel.database-binding',
      'cloudflare.r2-bucket',
      'vercel.r2-binding',
      'sentry.project',
      'vercel.sentry-binding',
      'posthog.project',
      'vercel.posthog-binding',
    ]);
    expect(
      first.actions.every((action) => action.idempotency_key.startsWith('void-starter:v1:')),
    ).toBe(true);
    expect(first.actions[0]?.permissions).toEqual([
      'organization:members:read',
      'repository:administration:write',
    ]);
    expect(first.actions[3]?.depends_on).toEqual(['vercel.project', 'neon.project']);
    expect(first.actions[4]).toMatchObject({
      provider: 'cloudflare',
      input: { jurisdiction: 'eu', storage_class: 'Standard' },
    });
    expect(first.actions[5]?.depends_on).toEqual(['vercel.project', 'cloudflare.r2-bucket']);
    expect(first.actions[6]).toMatchObject({
      provider: 'sentry',
      input: { region: 'de', platform: 'javascript-nextjs' },
    });
    expect(first.actions[7]?.depends_on).toEqual(['vercel.project', 'sentry.project']);
    expect(first.actions[8]).toMatchObject({
      provider: 'posthog',
      input: { region: 'eu', name: 'example-saas' },
    });
    expect(first.actions[9]?.depends_on).toEqual(['vercel.project', 'posthog.project']);
  });

  it('plans only resources selected by each surface and capability profile', () => {
    const minimal = createProvisioningPlan(
      parseBuildManifest(minimalManifest),
      parseProvisioningContext(fullContext),
    );
    const mobile = createProvisioningPlan(
      parseBuildManifest(mobileOnlyManifest),
      parseProvisioningContext({
        schema_version: 1,
        github: fullContext.github,
      }),
    );

    expect(minimal.actions.map((action) => action.id)).toEqual([
      'github.repository',
      'vercel.project',
    ]);
    expect(mobile.actions.map((action) => action.id)).toEqual(['github.repository']);

    const personal = createProvisioningPlan(
      parseBuildManifest(mobileOnlyManifest),
      parseProvisioningContext({
        schema_version: 1,
        github: {
          owner: 'factory-bot',
          owner_kind: 'user',
          visibility: 'private',
        },
      }),
    );
    expect(personal.actions[0]?.permissions).toEqual(['repository:administration:write']);
  });

  it('requires provider coordinates without accepting tokens or inventing opaque IDs', () => {
    const manifest = parseBuildManifest(canonicalManifest);
    const contextWithoutVercel = parseProvisioningContext({
      schema_version: 1,
      github: fullContext.github,
      neon: fullContext.neon,
    });
    expect(() => createProvisioningPlan(manifest, contextWithoutVercel)).toThrow(/Vercel/);

    const contextWithoutCloudflare = parseProvisioningContext({
      schema_version: 1,
      github: fullContext.github,
      vercel: fullContext.vercel,
      neon: fullContext.neon,
    });
    expect(() => createProvisioningPlan(manifest, contextWithoutCloudflare)).toThrow(/Cloudflare/);

    const contextWithoutSentry = parseProvisioningContext({
      schema_version: 1,
      github: fullContext.github,
      vercel: fullContext.vercel,
      neon: fullContext.neon,
      cloudflare: fullContext.cloudflare,
    });
    expect(() => createProvisioningPlan(manifest, contextWithoutSentry)).toThrow(/Sentry/);

    const contextWithoutPosthog = parseProvisioningContext({
      ...fullContext,
      posthog: undefined,
    });
    expect(() => createProvisioningPlan(manifest, contextWithoutPosthog)).toThrow(/PostHog/);

    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        github_token: 'must-never-be-accepted',
      }),
    ).toThrow();
  });

  it('parses YAML and rejects unsupported or non-EU provider regions', () => {
    const context = parseProvisioningContextSource(
      `schema_version: 1
github:
  owner: voidcorp-core
  owner_kind: organization
  visibility: private
vercel:
  team_id: team_example
  region: fra1
`,
      'context.yaml',
    );

    expect(context.vercel?.region).toBe('fra1');
    expect(() => parseProvisioningContextSource('{}', 'context.toml')).toThrow(/Unsupported/);
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        vercel: {
          ...fullContext.vercel,
          region: 'iad1',
        },
      }),
    ).toThrow();
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        sentry: { ...fullContext.sentry, region: 'us' },
      }),
    ).toThrow();
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        posthog: { ...fullContext.posthog, region: 'us' },
      }),
    ).toThrow();
    expect(
      parseProvisioningContext({
        ...fullContext,
        posthog: {
          organization_id: '019d9316-714e-0000-01c7-e9a08d38242b',
          region: 'eu',
        },
      }).posthog?.organization_id,
    ).toBe('019d9316-714e-0000-01c7-e9a08d38242b');
  });
});
