import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import {
  applyProvisioning,
  ProvisioningApplyError,
  readProvisioningState,
  SimulatedProvisioningAdapter,
  validateProvisioningState,
} from './provisioning-apply.service';
import { createProvisioningPlan, parseProvisioningContext } from './provisioning-plan.service';

const temporaryRoots: string[] = [];

const context = parseProvisioningContext({
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
});

async function createGeneratedProject() {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-apply-test-'));
  temporaryRoots.push(root);
  const manifest = parseBuildManifest(canonicalManifest);
  await mkdir(join(root, '.void-starter'));
  await writeFile(
    join(root, '.void-starter/manifest.json'),
    serializeCanonicalJson(manifest),
    'utf8',
  );
  return {
    root,
    manifest,
    plan: createProvisioningPlan(manifest, context),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('applyProvisioning', () => {
  it('persists a completed simulated apply with deterministic opaque resources', async () => {
    const project = await createGeneratedProject();

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new SimulatedProvisioningAdapter(),
    });

    expect(state.status).toBe('succeeded');
    expect(state.actions.every((action) => action.status === 'succeeded')).toBe(true);
    expect(state.actions.every((action) => action.attempts === 1)).toBe(true);
    expect(state.actions.every((action) => action.resource?.resource_id.startsWith('sim_'))).toBe(
      true,
    );
    expect(await readProvisioningState(project.root)).toEqual(state);
    await expect(
      readFile(join(project.root, '.void-starter/apply.lock'), 'utf8'),
    ).rejects.toThrow();
  });

  it('records a safe failure and resumes without repeating succeeded actions', async () => {
    const project = await createGeneratedProject();

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new SimulatedProvisioningAdapter({
          failActionId: 'neon.project',
        }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const failedState = await readProvisioningState(project.root);
    expect(failedState?.status).toBe('failed');
    expect(
      failedState?.actions.map((action) => [action.action_id, action.status, action.attempts]),
    ).toEqual([
      ['github.repository', 'succeeded', 1],
      ['vercel.project', 'succeeded', 1],
      ['neon.project', 'failed', 1],
      ['vercel.database-binding', 'pending', 0],
      ['cloudflare.r2-bucket', 'pending', 0],
      ['vercel.r2-binding', 'pending', 0],
      ['sentry.project', 'pending', 0],
      ['vercel.sentry-binding', 'pending', 0],
    ]);
    expect(serializeCanonicalJson(failedState)).not.toContain('Simulated failure for');

    const resumedState = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new SimulatedProvisioningAdapter(),
      requireExistingState: true,
    });
    expect(resumedState.status).toBe('succeeded');
    expect(resumedState.actions.map((action) => action.attempts)).toEqual([1, 1, 2, 1, 1, 1, 1, 1]);
  });

  it('refuses a mismatched plan, concurrent apply, and resume without state', async () => {
    const project = await createGeneratedProject();
    await writeFile(
      join(project.root, '.void-starter/apply.lock'),
      serializeCanonicalJson({
        schema_version: 1,
        pid: process.pid,
        owner_token: 'active-test-lock',
      }),
      'utf8',
    );
    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new SimulatedProvisioningAdapter(),
      }),
    ).rejects.toThrow(/active|lock/);
    await rm(join(project.root, '.void-starter/apply.lock'));

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new SimulatedProvisioningAdapter(),
        requireExistingState: true,
      }),
    ).rejects.toThrow(/No provisioning state/);

    await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new SimulatedProvisioningAdapter(),
    });
    const changedPlan = structuredClone(project.plan);
    changedPlan.context_sha256 = '0'.repeat(64);
    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: changedPlan,
        adapter: new SimulatedProvisioningAdapter(),
      }),
    ).rejects.toThrow(/different|modified/);
  });

  it('recovers a stale process lock and detects semantically tampered state', async () => {
    const project = await createGeneratedProject();
    await writeFile(
      join(project.root, '.void-starter/apply.lock'),
      serializeCanonicalJson({
        schema_version: 1,
        pid: 999_999_999,
        owner_token: 'stale-test-lock',
      }),
      'utf8',
    );

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new SimulatedProvisioningAdapter(),
    });
    expect(state.status).toBe('succeeded');

    const tampered = structuredClone(state);
    const firstAction = tampered.actions[0];
    if (!firstAction) {
      throw new Error('Expected a provisioning action');
    }
    firstAction.status = 'pending';
    expect(() => validateProvisioningState(tampered, project.plan.manifest_sha256)).toThrow(
      /incomplete/i,
    );

    const tamperedR2 = structuredClone(state);
    const r2Action = tamperedR2.actions.find(
      (action) => action.action_id === 'cloudflare.r2-bucket',
    );
    if (r2Action?.resource?.provider !== 'cloudflare') {
      throw new Error('Expected a simulated R2 resource');
    }
    r2Action.resource.display_name = 'foreign-bucket';
    expect(() => validateProvisioningState(tamperedR2, project.plan.manifest_sha256)).toThrow(
      /exact private EU bucket/i,
    );
  });
});
