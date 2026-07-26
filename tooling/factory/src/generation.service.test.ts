import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  clerkManifest,
  expoManifest,
  minimalManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { createDeliveryPlan, deliveryPlanDigest } from './delivery.service';
import { deliveryStateSchema } from './delivery.types';
import { doctorProject } from './doctor.service';
import { parseBuildManifest } from './factory.service';
import { renderProject } from './generation.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import { applyProvisioning, SimulatedProvisioningAdapter } from './provisioning-apply.service';
import { createProvisioningPlan, parseProvisioningContext } from './provisioning-plan.service';
import { createSourcePublicationPlan } from './source-publication.service';

const temporaryRoots: string[] = [];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createBaseline() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'void-starter-generation-test-'));
  temporaryRoots.push(temporaryRoot);

  const sourceRoot = join(temporaryRoot, 'source');
  const targetRoot = join(temporaryRoot, 'generated');
  await mkdir(join(sourceRoot, 'apps/web'), { recursive: true });
  await mkdir(join(sourceRoot, 'tooling/factory'), { recursive: true });
  await mkdir(join(sourceRoot, 'docs'), { recursive: true });
  await mkdir(join(sourceRoot, 'docs/discovery'), { recursive: true });
  await mkdir(join(sourceRoot, 'docs/superpowers/plans'), { recursive: true });
  await mkdir(join(sourceRoot, '.agents'), { recursive: true });
  await mkdir(join(sourceRoot, '.git'), { recursive: true });
  await mkdir(join(sourceRoot, '.void'), { recursive: true });

  await writeJson(join(sourceRoot, 'package.json'), {
    name: 'void-starter',
    private: true,
    workspaces: ['apps/*', 'packages/*', '_modules/*', 'tooling/*'],
  });
  await writeJson(join(sourceRoot, 'knip.json'), {
    workspaces: {
      'packages/config': {
        ignoreDependencies: ['next'],
      },
      'packages/*': {
        project: 'src/**/*.ts',
      },
      'packages/core': {
        ignoreDependencies: ['pino-pretty'],
      },
      'packages/ui': {
        project: 'src/**/*.{ts,tsx,css}',
      },
      'apps/*': {
        entry: ['src/app/**/page.tsx', 'src/app/**/layout.tsx', 'tests/e2e/**/*.spec.ts'],
        project: ['src/**/*.{ts,tsx,css}', 'tests/e2e/**/*.ts'],
      },
      'tooling/*': {
        project: 'src/**/*.ts',
      },
    },
  });
  await writeFile(
    join(sourceRoot, 'biome.json'),
    '{\n  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",\n  "extends": ["./packages/config/biome.base.json"]\n}\n',
    'utf8',
  );
  await writeJson(join(sourceRoot, 'apps/web/package.json'), {
    name: '@repo/web',
    private: true,
  });
  for (const [path, name] of [
    ['packages/auth', '@repo/auth'],
    ['packages/core', '@repo/core'],
    ['packages/db', '@repo/db'],
    ['packages/notes', '@repo/notes'],
    ['packages/ui', '@repo/ui'],
    ['_modules/analytics-posthog', '@repo/posthog'],
    ['_modules/observability-sentry', '@repo/sentry'],
  ]) {
    await mkdir(join(sourceRoot, path), { recursive: true });
    await writeJson(join(sourceRoot, path, 'package.json'), {
      name,
      private: true,
    });
  }
  await writeFile(
    join(sourceRoot, 'packages/core/index.ts'),
    'export const core = true;\n',
    'utf8',
  );
  await mkdir(join(sourceRoot, 'apps/web/src'), { recursive: true });
  await writeFile(
    join(sourceRoot, 'apps/web/src/instrumentation.ts'),
    'export async function register() {}\n',
    'utf8',
  );
  await writeFile(
    join(sourceRoot, 'apps/web/src/instrumentation-client.ts'),
    'export {};\n',
    'utf8',
  );
  await writeFile(
    join(sourceRoot, 'tooling/factory/package.json'),
    '{"name":"forbidden"}\n',
    'utf8',
  );
  await writeFile(join(sourceRoot, 'docs/FACTORY.md'), '# Factory control plane\n', 'utf8');
  await writeFile(
    join(sourceRoot, 'docs/discovery/internal-handoff.md'),
    '# Internal handoff\n',
    'utf8',
  );
  await writeFile(
    join(sourceRoot, 'docs/superpowers/plans/legacy-plan.md'),
    '# Internal implementation plan\n',
    'utf8',
  );
  await writeFile(join(sourceRoot, '.agents/skill.md'), '# External governance\n', 'utf8');
  await writeFile(join(sourceRoot, '.git/config'), '[core]\nrepositoryformatversion = 0\n', 'utf8');
  await writeFile(join(sourceRoot, '.void/usage.log'), 'external usage\n', 'utf8');
  await writeFile(join(sourceRoot, '.env.local'), 'SECRET=must-not-copy\n', 'utf8');
  await writeFile(join(sourceRoot, '.env.example'), 'PUBLIC_VALUE=\n', 'utf8');
  await writeFile(
    join(sourceRoot, '.gitignore'),
    '.void-starter/apply-state.json\n.void-starter/source-state.json\n.void-starter/delivery-state.json\n',
    'utf8',
  );
  await writeFile(join(sourceRoot, 'bun.lock'), '"@repo/factory"\n', 'utf8');
  await writeFile(
    join(sourceRoot, 'README.md'),
    '# Void Factory Starter\n\n`-- tooling/\n    `-- factory/ # control plane\n\n- [`docs/FACTORY.md`](./docs/FACTORY.md)\n',
    'utf8',
  );

  return {
    sourceRoot,
    targetRoot,
    temporaryRoot,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('renderProject', () => {
  it('renders a web + Expo repository without factory, Harness, secrets, or stale lock data', async () => {
    const { sourceRoot, targetRoot } = await createBaseline();
    const manifest = parseBuildManifest(expoManifest);

    const receipt = await renderProject({
      manifest,
      sourceRoot,
      targetRoot,
    });

    expect(receipt.project).toEqual(manifest.project);
    expect(receipt.generated_files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        '.env.example',
        'apps/mobile/app.json',
        'apps/mobile/package.json',
        'apps/web/next.config.ts',
        'apps/web/package.json',
        'apps/web/src/app/layout.tsx',
        'apps/web/src/app/page.tsx',
        'apps/web/vercel.json',
      ]),
    );
    expect(receipt.removed_paths).toContain('apps/worker');

    await expect(readFile(join(targetRoot, 'apps/web/package.json'), 'utf8')).resolves.toContain(
      '@repo/web',
    );
    await expect(readFile(join(targetRoot, 'apps/mobile/app.json'), 'utf8')).resolves.toContain(
      'com.example.examplesaas',
    );
    await expect(
      readFile(join(targetRoot, 'apps/mobile/app/index.tsx'), 'utf8'),
    ).resolves.toContain("const projectName = 'example-saas';");
    await expect(readFile(join(targetRoot, '.env.example'), 'utf8')).resolves.toContain(
      'DATABASE_URL',
    );

    const rootPackage = JSON.parse(await readFile(join(targetRoot, 'package.json'), 'utf8'));
    expect(rootPackage.name).toBe('example-saas');
    expect(rootPackage.workspaces).not.toContain('tooling/*');
    expect(rootPackage.scripts['hooks:install']).toBe('lefthook install');

    const rootGitignore = await readFile(join(targetRoot, '.gitignore'), 'utf8');
    expect(rootGitignore).toContain('.void-starter/apply-state.json');
    expect(rootGitignore).toContain('.void-starter/source-state.json');
    expect(rootGitignore).toContain('.void-starter/delivery-state.json');

    const rootKnip = JSON.parse(await readFile(join(targetRoot, 'knip.json'), 'utf8'));
    expect(rootKnip.workspaces).not.toHaveProperty('tooling/*');
    expect(rootKnip.workspaces['apps/mobile']).toEqual({
      entry: ['app/**/*.tsx'],
      project: ['app/**/*.{ts,tsx}', '*.ts'],
      ignoreDependencies: ['expo-updates'],
    });

    const rootBiome = JSON.parse(await readFile(join(targetRoot, 'biome.json'), 'utf8'));
    expect(rootBiome.overrides).toContainEqual({
      includes: ['.void-starter/**/*.json', 'apps/mobile/*.json', 'knip.json'],
      formatter: {
        enabled: false,
      },
    });

    for (const forbiddenPath of [
      'tooling/factory/package.json',
      'docs/FACTORY.md',
      'docs/discovery/internal-handoff.md',
      'docs/superpowers/plans/legacy-plan.md',
      '.agents/skill.md',
      '.git/config',
      '.void/usage.log',
      '.env.local',
      'bun.lock',
    ]) {
      await expect(readFile(join(targetRoot, forbiddenPath), 'utf8')).rejects.toThrow();
    }
  });

  it('renders minimal public and Clerk repositories with only their selected capability graph', async () => {
    const minimal = await createBaseline();
    const clerk = await createBaseline();

    await renderProject({
      manifest: parseBuildManifest(minimalManifest),
      sourceRoot: minimal.sourceRoot,
      targetRoot: minimal.targetRoot,
    });
    await renderProject({
      manifest: parseBuildManifest(clerkManifest),
      sourceRoot: clerk.sourceRoot,
      targetRoot: clerk.targetRoot,
    });

    const minimalPackage = JSON.parse(
      await readFile(join(minimal.targetRoot, 'apps/web/package.json'), 'utf8'),
    );
    expect(minimalPackage.dependencies).toEqual({
      '@repo/core': 'workspace:*',
      '@repo/ui': 'workspace:*',
      next: '^16.2.11',
      react: '^19.2.8',
      'react-dom': '^19.2.8',
    });
    await expect(
      readFile(join(minimal.targetRoot, 'packages/auth/package.json'), 'utf8'),
    ).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(minimal.targetRoot, 'package.json'), 'utf8')).workspaces,
    ).not.toContain('_modules/*');
    expect(
      JSON.parse(await readFile(join(minimal.targetRoot, 'knip.json'), 'utf8')).workspaces['apps/*']
        .entry,
    ).toEqual(['src/app/**/page.tsx', 'src/app/**/layout.tsx']);

    const clerkPackage = JSON.parse(
      await readFile(join(clerk.targetRoot, 'apps/web/package.json'), 'utf8'),
    );
    expect(clerkPackage.dependencies).toHaveProperty('@clerk/nextjs');
    expect(clerkPackage.dependencies).not.toHaveProperty('@repo/auth');
    await expect(
      readFile(join(clerk.targetRoot, 'apps/web/src/app/sign-in/[[...sign-in]]/page.tsx'), 'utf8'),
    ).resolves.toContain('<SignIn />');
    expect((await doctorProject(minimal.targetRoot)).ok).toBe(true);
    expect((await doctorProject(clerk.targetRoot)).ok).toBe(true);
  });

  it('removes unselected surfaces and emits byte-for-byte deterministic metadata', async () => {
    const first = await createBaseline();
    const second = await createBaseline();
    const manifest = parseBuildManifest(mobileOnlyManifest);

    const firstReceipt = await renderProject({
      manifest,
      sourceRoot: first.sourceRoot,
      targetRoot: first.targetRoot,
    });
    const secondReceipt = await renderProject({
      manifest,
      sourceRoot: second.sourceRoot,
      targetRoot: second.targetRoot,
    });

    expect(secondReceipt).toEqual(firstReceipt);
    await expect(
      readFile(join(first.targetRoot, 'apps/web/package.json'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(first.targetRoot, 'apps/mobile/package.json'), 'utf8'),
    ).resolves.toContain('mobile-only-mobile');
    expect(await readFile(join(first.targetRoot, '.void-starter/receipt.json'), 'utf8')).toBe(
      await readFile(join(second.targetRoot, '.void-starter/receipt.json'), 'utf8'),
    );
  });

  it('refuses existing, nested, and symlinked targets without leaving partial output', async () => {
    const existing = await createBaseline();
    await mkdir(existing.targetRoot);

    await expect(
      renderProject({
        manifest: parseBuildManifest(canonicalManifest),
        sourceRoot: existing.sourceRoot,
        targetRoot: existing.targetRoot,
      }),
    ).rejects.toThrow(/exist/i);

    const nested = await createBaseline();
    await expect(
      renderProject({
        manifest: parseBuildManifest(canonicalManifest),
        sourceRoot: nested.sourceRoot,
        targetRoot: join(nested.sourceRoot, 'generated'),
      }),
    ).rejects.toThrow(/inside|source/i);

    const linked = await createBaseline();
    await symlink(linked.temporaryRoot, join(linked.sourceRoot, 'external-link'));
    await expect(
      renderProject({
        manifest: parseBuildManifest(canonicalManifest),
        sourceRoot: linked.sourceRoot,
        targetRoot: linked.targetRoot,
      }),
    ).rejects.toThrow(/symbolic link/i);
    await expect(readFile(join(linked.targetRoot, 'package.json'), 'utf8')).rejects.toThrow();
  });

  it('rejects an invalid baseline and supports optional repository metadata', async () => {
    const invalid = await createBaseline();
    await writeJson(join(invalid.sourceRoot, 'package.json'), {
      name: 'invalid-baseline',
    });
    await expect(
      renderProject({
        manifest: parseBuildManifest(canonicalManifest),
        sourceRoot: invalid.sourceRoot,
        targetRoot: invalid.targetRoot,
      }),
    ).rejects.toThrow(/workspaces/i);
    await expect(readFile(join(invalid.targetRoot, 'package.json'), 'utf8')).rejects.toThrow();

    const minimal = await createBaseline();
    await rm(join(minimal.sourceRoot, 'knip.json'));
    await rm(join(minimal.sourceRoot, 'biome.json'));
    await rm(join(minimal.sourceRoot, 'README.md'));
    const receipt = await renderProject({
      manifest: parseBuildManifest(canonicalManifest),
      sourceRoot: minimal.sourceRoot,
      targetRoot: minimal.targetRoot,
    });

    expect(receipt.generated_files.map((file) => file.path)).toEqual([
      '.env.example',
      'apps/web/next.config.ts',
      'apps/web/package.json',
      'apps/web/src/app/layout.tsx',
      'apps/web/src/app/page.tsx',
      'apps/web/vercel.json',
    ]);
    await expect(
      readFile(join(minimal.targetRoot, '.void-starter/receipt.json'), 'utf8'),
    ).resolves.toContain('"schema_version": 1');
  });
});

describe('doctorProject', () => {
  it('passes a fresh render and detects generated-file tampering and forbidden artifacts', async () => {
    const { sourceRoot, targetRoot } = await createBaseline();
    await renderProject({
      manifest: parseBuildManifest(expoManifest),
      sourceRoot,
      targetRoot,
    });
    await writeFile(join(targetRoot, 'bun.lock'), '"next"\n', 'utf8');

    const healthyReport = await doctorProject(targetRoot);
    expect(healthyReport.ok).toBe(true);

    await writeFile(join(targetRoot, 'apps/mobile/app/index.tsx'), '\n// tampered\n', {
      encoding: 'utf8',
      flag: 'a',
    });
    await mkdir(join(targetRoot, '.codex'));
    const rootPackagePath = join(targetRoot, 'package.json');
    const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
    rootPackage.devDependencies = {
      voidharness: '2.0.2',
    };
    await writeJson(rootPackagePath, rootPackage);

    const unhealthyReport = await doctorProject(targetRoot);
    expect(unhealthyReport.ok).toBe(false);
    expect(unhealthyReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'generated-files',
        status: 'fail',
      }),
    );
    expect(unhealthyReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'development-artifacts',
        status: 'fail',
      }),
    );
    expect(unhealthyReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'dependencies',
        status: 'fail',
      }),
    );
  });

  it('fails closed for missing metadata and receipt paths that escape the project root', async () => {
    const missingMetadata = await mkdtemp(join(tmpdir(), 'void-starter-doctor-test-'));
    temporaryRoots.push(missingMetadata);
    const metadataReport = await doctorProject(missingMetadata);
    expect(metadataReport).toEqual({
      ok: false,
      checks: [
        expect.objectContaining({
          id: 'metadata',
          status: 'fail',
        }),
      ],
    });

    const { sourceRoot, targetRoot, temporaryRoot } = await createBaseline();
    await renderProject({
      manifest: parseBuildManifest(expoManifest),
      sourceRoot,
      targetRoot,
    });

    const outsideContent = 'outside project\n';
    await writeFile(join(temporaryRoot, 'outside.txt'), outsideContent, 'utf8');
    const receiptPath = join(targetRoot, '.void-starter/receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.generated_files[0] = {
      path: '../outside.txt',
      sha256: sha256(outsideContent),
    };
    await writeJson(receiptPath, receipt);

    const traversalReport = await doctorProject(targetRoot);
    expect(traversalReport.ok).toBe(false);
    expect(traversalReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'receipt-plan',
        status: 'fail',
      }),
    );
    expect(traversalReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'generated-files',
        status: 'fail',
      }),
    );
  });

  it('accepts completed simulated provisioning state and fails closed on state corruption', async () => {
    const { sourceRoot, targetRoot } = await createBaseline();
    const manifest = parseBuildManifest(expoManifest);
    await renderProject({
      manifest,
      sourceRoot,
      targetRoot,
    });
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
    });
    await applyProvisioning({
      projectRoot: targetRoot,
      plan: createProvisioningPlan(manifest, context),
      adapter: new SimulatedProvisioningAdapter(),
    });
    const applyStatePath = join(targetRoot, '.void-starter/apply-state.json');
    const applyState = JSON.parse(await readFile(applyStatePath, 'utf8'));
    applyState.mode = 'live';
    await writeJson(applyStatePath, applyState);
    await writeFile(join(targetRoot, 'bun.lock'), 'lockfileVersion = 1\n', 'utf8');
    const sourcePlan = await createSourcePublicationPlan(targetRoot, context);
    await writeJson(join(targetRoot, '.void-starter/source-state.json'), {
      schema_version: 1,
      mode: 'live',
      status: 'succeeded',
      plan_sha256: sha256(serializeCanonicalJson(sourcePlan)),
      plan: sourcePlan,
      attempts: 1,
      commit_sha: 'a'.repeat(40),
      error: null,
    });
    const deliveryPlan = await createDeliveryPlan(targetRoot, context);
    const deliveryState = deliveryStateSchema.parse({
      schema_version: 1,
      mode: 'live',
      status: 'succeeded',
      plan_sha256: deliveryPlanDigest(deliveryPlan),
      plan: deliveryPlan,
      attempts: 1,
      observation: {
        deployment_id: 'dpl_example',
        url: 'https://example-saas-abc.vercel.app',
        ready_state: 'READY',
        target: 'production',
        source_commit_sha: 'a'.repeat(40),
        created_at: 1_760_000_000_000,
        ready_at: 1_760_000_005_000,
        observed_at: '2026-07-26T08:00:00.000Z',
        smoke: {
          status: 200,
          content_type: 'text/html; charset=utf-8',
          body_sha256: 'b'.repeat(64),
          body_bytes: 128,
          bypass_used: true,
          final_url: 'https://example-saas-abc.vercel.app/',
          checked_at: '2026-07-26T08:00:01.000Z',
        },
      },
      error: null,
    });
    const deliveryStatePath = join(targetRoot, '.void-starter/delivery-state.json');
    await writeJson(deliveryStatePath, deliveryState);
    await mkdir(join(targetRoot, '.git'));

    const healthyReport = await doctorProject(targetRoot);
    expect(healthyReport.checks).toContainEqual({
      id: 'provisioning-state',
      status: 'pass',
      message: 'Provisioning state is structurally valid and succeeded',
    });
    expect(healthyReport.checks).toContainEqual({
      id: 'development-artifacts',
      status: 'pass',
      message: 'Factory and external development-governance artifacts are absent',
    });
    expect(healthyReport.checks).toContainEqual({
      id: 'source-publication-state',
      status: 'pass',
      message: 'Source publication state is structurally valid and succeeded',
    });
    expect(healthyReport.checks).toContainEqual({
      id: 'delivery-state',
      status: 'pass',
      message: 'Delivery state is structurally valid and succeeded',
    });

    await writeFile(deliveryStatePath, '{}\n', 'utf8');
    const corruptDeliveryReport = await doctorProject(targetRoot);
    expect(corruptDeliveryReport.ok).toBe(false);
    expect(corruptDeliveryReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'delivery-state',
        status: 'fail',
      }),
    );
    await writeJson(deliveryStatePath, deliveryState);

    await writeFile(applyStatePath, '{}\n', 'utf8');
    const corruptReport = await doctorProject(targetRoot);
    expect(corruptReport.ok).toBe(false);
    expect(corruptReport.checks).toContainEqual(
      expect.objectContaining({
        id: 'provisioning-state',
        status: 'fail',
      }),
    );
  });
});
