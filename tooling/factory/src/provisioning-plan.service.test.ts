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
  dns: {
    provider: 'cloudflare',
    account_id: '0123456789abcdef0123456789abcdef',
    zone_id: 'fedcba9876543210fedcba9876543210',
    zone_name: 'example.com',
    hostname: 'example-saas.example.com',
  },
} as const;

describe('createProvisioningPlan browser access', () => {
  it('plans no CORS rule when the context names no browser origin', () => {
    // The default is deliberate: a bucket whose objects are only read
    // server-side needs no rule, and the alternative to naming origins is a
    // wildcard that opens it to every site the browser visits.
    const plan = createProvisioningPlan(
      parseBuildManifest(canonicalManifest),
      parseProvisioningContext(fullContext),
    );

    expect(plan.actions.map((action) => action.id)).not.toContain('cloudflare.r2-cors');
  });

  it('plans the CORS rule right after the bucket when origins are named', () => {
    const plan = createProvisioningPlan(
      parseBuildManifest(canonicalManifest),
      parseProvisioningContext({
        ...fullContext,
        cloudflare: {
          ...fullContext.cloudflare,
          browser_origins: ['https://app.example.com', 'http://localhost:3000'],
        },
      }),
    );
    const cors = plan.actions.find((action) => action.id === 'cloudflare.r2-cors');

    expect(cors).toMatchObject({
      provider: 'cloudflare',
      depends_on: ['cloudflare.r2-bucket'],
      input: {
        jurisdiction: 'eu',
        allowed_origins: ['https://app.example.com', 'http://localhost:3000'],
        // Exactly what the documents surface performs. DELETE is absent on
        // purpose: erasure goes through the server, which is what makes it
        // auditable.
        allowed_methods: ['GET', 'HEAD', 'PUT'],
        allowed_headers: ['content-type'],
      },
    });
  });

  it('rejects an origin carrying a path, which never matches an Origin header', () => {
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        cloudflare: {
          ...fullContext.cloudflare,
          browser_origins: ['https://app.example.com/documents'],
        },
      }),
    ).toThrow();
  });
});

describe('createProvisioningPlan', () => {
  it('plans provider resources, bindings, and owned DNS deterministically', () => {
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
      'vercel.project-domain',
      'cloudflare.dns-record',
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
    expect(first.actions[10]).toMatchObject({
      provider: 'vercel',
      input: {
        name: 'example-saas.example.com',
        nameserver_change: false,
        estimated_monthly_cost_eur: 0,
      },
    });
    expect(first.actions[11]).toMatchObject({
      provider: 'cloudflare',
      depends_on: ['vercel.project-domain'],
      input: {
        record_type: 'CNAME',
        ttl: 60,
        proxied: false,
        ownership_marker: 'comment',
      },
    });
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
      createProvisioningPlan(
        parseBuildManifest({ ...canonicalManifest, dns: { provider: 'cloudflare' } }),
        parseProvisioningContext({ ...fullContext, dns: undefined }),
      ),
    ).toThrow(/DNS zone/);

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
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        dns: { ...fullContext.dns, hostname: 'example.com' },
      }),
    ).toThrow(/strict subdomain/);
    expect(() =>
      parseProvisioningContext({
        ...fullContext,
        dns: {
          ...fullContext.dns,
          account_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).toThrow(/same explicit Cloudflare account/);
  });
});
