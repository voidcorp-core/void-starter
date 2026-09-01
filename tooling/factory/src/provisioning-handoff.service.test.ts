import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mobileOnlyManifest } from './__fixtures__/manifest.fixture';
import { parseManifestSource } from './factory-preview.service';
import {
  createProvisioningHandoff,
  parseProvisioningHandoffContext,
  parseProvisioningHandoffContextSource,
  parseProvisioningHandoffPlan,
  validateProvisioningHandoffPlan,
} from './provisioning-handoff.service';

const manifestFixtureUrl = new URL('../fixtures/manifests/web-minimal.yaml', import.meta.url);
const contextFixtureUrl = new URL('../fixtures/provisioning/eu.yaml', import.meta.url);

async function loadMinimalHandoff() {
  const [manifestSource, contextSource] = await Promise.all([
    readFile(manifestFixtureUrl, 'utf8'),
    readFile(contextFixtureUrl, 'utf8'),
  ]);
  const manifest = parseManifestSource(manifestSource, fileURLToPath(manifestFixtureUrl));
  const context = parseProvisioningHandoffContextSource(
    contextSource,
    fileURLToPath(contextFixtureUrl),
  );
  return createProvisioningHandoff(manifest, context);
}

describe('createProvisioningHandoff', () => {
  it('describes the minimal GitHub and Vercel intent in stable dependency order', async () => {
    const handoff = await loadMinimalHandoff();

    expect(handoff.plan).toMatchObject({
      schema_version: 2,
      execution_owner: 'external',
      actions: [
        {
          id: 'github.repository',
          provider: 'github',
          resource_kind: 'repository',
          depends_on: [],
          desired_state: {
            owner: 'voidcorp-core',
            owner_kind: 'organization',
            name: 'web-minimal',
            visibility: 'private',
          },
        },
        {
          id: 'vercel.project',
          provider: 'vercel',
          resource_kind: 'project',
          depends_on: ['github.repository'],
          desired_state: {
            team_id: 'team_example',
            name: 'web-minimal',
            framework: 'nextjs',
            region: 'fra1',
            root_directory: 'apps/web',
            repository_action_id: 'github.repository',
          },
        },
      ],
    });
    expect(handoff.plan.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(handoff.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(handoff.plan.actions.map((action) => action.purpose)).toEqual([
      'Own the canonical source repository for the generated project',
      'Host the selected Next.js web surface outside the Factory',
    ]);
    expect(handoff.runbookSource.indexOf('`github.repository`')).toBeLessThan(
      handoff.runbookSource.indexOf('`vercel.project`'),
    );
    expect(handoff.runbookSource).toContain(
      '### Why\n\nOwn the canonical source repository for the generated project',
    );
  });

  it('emits byte-identical artifacts for identical normalized inputs', async () => {
    const first = await loadMinimalHandoff();
    const second = await loadMinimalHandoff();

    expect(second.planSource).toBe(first.planSource);
    expect(second.runbookSource).toBe(first.runbookSource);
    expect(second.planSha256).toBe(first.planSha256);
  });

  it('names required credentials without accepting values or executable state', async () => {
    const handoff = await loadMinimalHandoff();
    const serialized = `${handoff.planSource}\n${handoff.runbookSource}`;

    expect(handoff.plan.actions.flatMap((action) => action.required_credentials)).toEqual([
      {
        name: 'GITHUB_TOKEN',
        purpose: 'Authorize repository creation or configuration outside the Factory',
      },
      {
        name: 'VERCEL_TOKEN',
        purpose: 'Authorize project creation or configuration outside the Factory',
      },
    ]);
    for (const forbiddenField of [
      'adapter_mode',
      'credential_value',
      'endpoint',
      'idempotency_key',
      'request_payload',
      'response_schema',
      'success_state',
    ]) {
      expect(serialized).not.toContain(forbiddenField);
    }

    expect(() =>
      parseProvisioningHandoffContext({
        schema_version: 1,
        github: {
          owner: 'voidcorp-core',
          owner_kind: 'organization',
          visibility: 'private',
          token: 'sentinel-github-secret',
        },
      }),
    ).toThrow();

    expect(() =>
      parseProvisioningHandoffContext({
        schema_version: 1,
        github: {
          owner: 'github_pat_sentinelCredentialValue',
          owner_kind: 'organization',
          visibility: 'private',
        },
      }),
    ).toThrow();

    expect(() =>
      parseProvisioningHandoffContext({
        schema_version: 1,
        github: {
          owner: 'voidcorp-core',
          owner_kind: 'organization',
          visibility: 'private',
        },
        vercel: {
          team_id: 'sentinel-vercel-token',
          region: 'fra1',
        },
      }),
    ).toThrow();
  });

  it('fails explicitly when selected intent lacks non-secret account coordinates', async () => {
    const manifestSource = await readFile(manifestFixtureUrl, 'utf8');
    const manifest = parseManifestSource(manifestSource, fileURLToPath(manifestFixtureUrl));
    const context = parseProvisioningHandoffContext({
      schema_version: 1,
      github: {
        owner: 'voidcorp-core',
        owner_kind: 'organization',
        visibility: 'private',
      },
    });

    expect(() => createProvisioningHandoff(manifest, context)).toThrow(
      /Vercel settings.*selected web surface/i,
    );
  });

  it('parses JSON and YAML contexts and rejects unsupported formats', async () => {
    const contextSource = await readFile(contextFixtureUrl, 'utf8');
    const yamlContext = parseProvisioningHandoffContextSource(contextSource, 'context.yml');
    const jsonContext = parseProvisioningHandoffContextSource(
      JSON.stringify(yamlContext),
      'context.json',
    );

    expect(jsonContext).toEqual(yamlContext);
    expect(() => parseProvisioningHandoffContextSource('{}', 'context.toml')).toThrow(
      /Unsupported provisioning handoff context format: .toml/,
    );
    expect(() => parseProvisioningHandoffContextSource('{}', 'context')).toThrow(/missing/);
  });

  it('validates browser origins and cross-provider account coordinates strictly', () => {
    const base = {
      schema_version: 1,
      github: {
        owner: 'voidcorp-core',
        owner_kind: 'organization',
        visibility: 'private',
      },
      cloudflare: {
        account_id: '0123456789abcdef0123456789abcdef',
        browser_origins: ['https://app.example.com', 'http://localhost:3000'],
      },
    } as const;

    expect(parseProvisioningHandoffContext(base).cloudflare?.browser_origins).toEqual([
      'https://app.example.com',
      'http://localhost:3000',
    ]);
    expect(() =>
      parseProvisioningHandoffContext({
        ...base,
        cloudflare: {
          ...base.cloudflare,
          browser_origins: ['https://app.example.com/path'],
        },
      }),
    ).toThrow(/browser origin/i);
    expect(() =>
      parseProvisioningHandoffContext({
        ...base,
        dns: {
          provider: 'cloudflare',
          account_id: 'fedcba9876543210fedcba9876543210',
          zone_id: 'fedcba9876543210fedcba9876543210',
          zone_name: 'example.com',
          hostname: 'example.com',
        },
      }),
    ).toThrow(/strict subdomain|same explicit Cloudflare account/i);
  });

  it('rejects plans that drift from the normalized manifest', async () => {
    const handoff = await loadMinimalHandoff();
    const manifestSource = await readFile(manifestFixtureUrl, 'utf8');
    const manifest = parseManifestSource(manifestSource, fileURLToPath(manifestFixtureUrl));

    const wrongDigest = parseProvisioningHandoffPlan({
      ...handoff.plan,
      manifest_sha256: '0'.repeat(64),
    });
    expect(() => validateProvisioningHandoffPlan(manifest, wrongDigest)).toThrow(
      /manifest digest/i,
    );

    const missingAction = parseProvisioningHandoffPlan({
      ...handoff.plan,
      actions: [handoff.plan.actions[0]],
    });
    expect(() => validateProvisioningHandoffPlan(manifest, missingAction)).toThrow(
      /actions do not match/i,
    );

    const renamedProject = parseProvisioningHandoffPlan({
      ...handoff.plan,
      actions: handoff.plan.actions.map((action) => ({
        ...action,
        desired_state: {
          ...action.desired_state,
          name: 'different-project',
        },
      })),
    });
    expect(() => validateProvisioningHandoffPlan(manifest, renamedProject)).toThrow(
      /project names/i,
    );

    expect(() =>
      parseProvisioningHandoffPlan({
        ...handoff.plan,
        actions: [handoff.plan.actions[0], handoff.plan.actions[0]],
      }),
    ).toThrow();
    expect(() =>
      parseProvisioningHandoffPlan({
        ...handoff.plan,
        actions: [handoff.plan.actions[1]],
      }),
    ).toThrow();
    expect(() =>
      parseProvisioningHandoffPlan({
        ...handoff.plan,
        actions: [handoff.plan.actions[1], handoff.plan.actions[0]],
      }),
    ).toThrow();
    expect(() =>
      parseProvisioningHandoffPlan({
        ...handoff.plan,
        actions: handoff.plan.actions.map((action) => ({
          ...action,
          desired_state: {
            ...action.desired_state,
            name: 'github_pat_SENTINEL',
          },
        })),
      }),
    ).toThrow();
  });

  it('keeps non-web handoffs limited to repository intent', () => {
    const manifest = parseManifestSource(JSON.stringify(mobileOnlyManifest), 'mobile.json');
    const context = parseProvisioningHandoffContext({
      schema_version: 1,
      github: {
        owner: 'voidcorp-core',
        owner_kind: 'organization',
        visibility: 'private',
      },
    });

    const handoff = createProvisioningHandoff(manifest, context);

    expect(handoff.plan.actions.map((action) => action.id)).toEqual(['github.repository']);
    expect(() => validateProvisioningHandoffPlan(manifest, handoff.plan)).not.toThrow();
  });
});
