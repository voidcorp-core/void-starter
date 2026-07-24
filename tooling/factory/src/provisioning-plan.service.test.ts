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
    org_id: 'org_example',
    region_id: 'aws-eu-central-1',
  },
} as const;

describe('createProvisioningPlan', () => {
  it('plans GitHub, Vercel, Neon, and their database binding deterministically', () => {
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
    ]);
    expect(
      first.actions.every((action) => action.idempotency_key.startsWith('void-starter:v1:')),
    ).toBe(true);
    expect(first.actions[3]?.depends_on).toEqual(['vercel.project', 'neon.project']);
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
  });

  it('requires provider coordinates without accepting tokens or inventing opaque IDs', () => {
    const manifest = parseBuildManifest(canonicalManifest);
    const contextWithoutVercel = parseProvisioningContext({
      schema_version: 1,
      github: fullContext.github,
      neon: fullContext.neon,
    });
    expect(() => createProvisioningPlan(manifest, contextWithoutVercel)).toThrow(/Vercel/);

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
  });
});
