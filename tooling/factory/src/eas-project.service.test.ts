import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expoManifest, minimalManifest } from './__fixtures__/manifest.fixture';
import { createProjectFilePlan } from './capability-composition.service';
import {
  applyEasProject,
  createEasProjectPlan,
  type EasCliRunner,
  EasProjectApplyError,
  parseEasProjectContext,
  preflightEasProject,
  readEasProjectState,
  validateEasProjectState,
} from './eas-project.service';
import type { EasProjectContext } from './eas-project.types';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';

const projectId = '123e4567-e89b-42d3-a456-426614174000';
const token = 'expo-secret-token-that-must-never-be-persisted';
const context: EasProjectContext = parseEasProjectContext({
  schema_version: 1,
  account: 'void-sandbox',
});
const temporaryRoots: string[] = [];

async function createProject(manifestSource: unknown = expoManifest): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-eas-test-'));
  temporaryRoots.push(root);
  const manifest = parseBuildManifest(manifestSource);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  await writeFile(
    join(root, '.void-starter/manifest.json'),
    serializeCanonicalJson(manifest),
    'utf8',
  );
  for (const file of createProjectFilePlan(manifest).writes.filter((file) =>
    ['apps/mobile/app.json', 'apps/mobile/app.config.ts'].includes(file.path),
  )) {
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
  return root;
}

type RunnerCall = {
  arguments: string[];
  cwd: string;
  token: string | undefined;
};

class MockEasRunner implements EasCliRunner {
  readonly calls: RunnerCall[] = [];
  remoteExists = false;
  remoteCreates = 0;
  initFailuresRemaining = 0;
  accountOutput = `factory-user (authenticated using EXPO_TOKEN)\n\nAccounts:\n• void-sandbox (Role: Admin)\n`;

  async run(input: Parameters<EasCliRunner['run']>[0]) {
    this.calls.push({
      arguments: input.arguments,
      cwd: input.cwd,
      token: input.environment['EXPO_TOKEN'],
    });
    const command = input.arguments[0];
    if (command === 'account:view') {
      return { stdout: this.accountOutput, stderr: '' };
    }
    if (command === 'project:init') {
      if (!this.remoteExists) {
        this.remoteExists = true;
        this.remoteCreates += 1;
      }
      const path = join(input.cwd, 'app.json');
      const app = JSON.parse(await readFile(path, 'utf8')) as {
        expo: { extra?: Record<string, unknown> };
      };
      app.expo.extra = {
        ...(app.expo.extra ?? {}),
        eas: { projectId },
      };
      await writeFile(path, `${JSON.stringify(app, null, 2)}\n`, 'utf8');
      if (this.initFailuresRemaining > 0) {
        this.initFailuresRemaining -= 1;
        throw new Error('simulated ambiguous post-create failure');
      }
      return { stdout: `Project successfully linked (ID: ${projectId})\n`, stderr: '' };
    }
    if (command === 'project:info') {
      return {
        stdout: `fullName  @void-sandbox/example-saas\nID        ${projectId}\n`,
        stderr: '',
      };
    }
    throw new Error(`Unexpected command: ${input.arguments.join(' ')}`);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('EAS project provisioning', () => {
  it('creates a deterministic local plan bound to provider-neutral generated config', async () => {
    const root = await createProject();
    const first = await createEasProjectPlan(root, context);
    const second = await createEasProjectPlan(root, context);

    expect(second).toEqual(first);
    expect(first.application).toMatchObject({
      provider: 'expo-eas',
      owner: 'void-sandbox',
      slug: 'example-saas',
      full_name: '@void-sandbox/example-saas',
      ios_bundle_identifier: 'com.example.examplesaas',
      android_package: 'com.example.examplesaas',
      link_path: 'apps/mobile/eas-project.json',
    });
    expect(await readFile(join(root, 'apps/mobile/app.json'), 'utf8')).not.toContain('projectId');
  });

  it('rejects projects without Expo and modified generated app configuration', async () => {
    const webRoot = await createProject(minimalManifest);
    await expect(createEasProjectPlan(webRoot, context)).rejects.toThrow(
      'requires the Expo/EAS mobile surface',
    );

    const expoRoot = await createProject();
    await writeFile(join(expoRoot, 'apps/mobile/app.json'), '{"expo":{}}\n', 'utf8');
    await expect(createEasProjectPlan(expoRoot, context)).rejects.toThrow(
      'refuses modified generated Expo configuration',
    );
  });

  it('performs an authenticated read-only preflight without materializing a link', async () => {
    const root = await createProject();
    const runner = new MockEasRunner();

    const result = await preflightEasProject({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      options: { runner },
    });

    expect(result).toMatchObject({
      mode: 'eas-project-live-preflight',
      ok: true,
      account: 'void-sandbox',
      account_role: 'Admin',
      project: 'absent-or-unlinked',
    });
    expect(runner.calls.map((call) => call.arguments)).toEqual([['account:view']]);
    await expect(readFile(join(root, 'apps/mobile/eas-project.json'), 'utf8')).rejects.toThrow();
  });

  it('fails preflight for a missing token or view-only account membership', async () => {
    const root = await createProject();
    const runner = new MockEasRunner();
    await expect(
      preflightEasProject({ projectRoot: root, context, environment: {}, options: { runner } }),
    ).rejects.toThrow('requires EXPO_TOKEN');
    expect(runner.calls).toHaveLength(0);

    runner.accountOutput = `factory-user (authenticated using EXPO_TOKEN)\n\nAccounts:\n• void-sandbox (Role: Viewer)\n`;
    await expect(
      preflightEasProject({
        projectRoot: root,
        context,
        environment: { EXPO_TOKEN: token },
        options: { runner },
      }),
    ).rejects.toMatchObject({ code: 'EAS_ACCOUNT_PERMISSION_REQUIRED' });
  });

  it('creates or adopts the project and persists only non-secret verifiable state', async () => {
    const root = await createProject();
    const runner = new MockEasRunner();

    const state = await applyEasProject({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      options: { runner, now: () => Date.parse('2026-07-26T12:00:00.000Z') },
    });

    expect(state.status).toBe('succeeded');
    expect(state.attempts).toBe(1);
    expect(state.observation).toMatchObject({
      project_id: projectId,
      full_name: '@void-sandbox/example-saas',
      linked_at: '2026-07-26T12:00:00.000Z',
    });
    expect(runner.remoteCreates).toBe(1);
    expect(runner.calls.map((call) => call.arguments)).toEqual([
      ['account:view'],
      ['project:init', '--force', '--non-interactive'],
      ['project:info'],
    ]);
    expect(runner.calls.every((call) => call.token === token)).toBe(true);

    const persistedState = await readFile(join(root, '.void-starter/eas-state.json'), 'utf8');
    const persistedLink = await readFile(join(root, 'apps/mobile/eas-project.json'), 'utf8');
    expect(persistedState).not.toContain(token);
    expect(persistedLink).not.toContain(token);
    expect(JSON.parse(persistedLink)).toEqual({
      schema_version: 1,
      owner: 'void-sandbox',
      slug: 'example-saas',
      project_id: projectId,
    });
    expect((await stat(join(root, '.void-starter/eas-state.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'apps/mobile/eas-project.json'))).mode & 0o777).toBe(0o644);
    await validateEasProjectState(state, state.plan.manifest_sha256, root);
  });

  it('resumes an ambiguous post-create failure by adopting without a duplicate project', async () => {
    const root = await createProject();
    const runner = new MockEasRunner();
    runner.initFailuresRemaining = 1;

    await expect(
      applyEasProject({
        projectRoot: root,
        context,
        environment: { EXPO_TOKEN: token },
        options: { runner },
      }),
    ).rejects.toEqual(new EasProjectApplyError('EAS_PROJECT_INIT_FAILED'));
    expect((await readEasProjectState(root))?.status).toBe('failed');
    expect(runner.remoteCreates).toBe(1);

    const resumed = await applyEasProject({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      requireExistingState: true,
      options: { runner },
    });
    expect(resumed.status).toBe('succeeded');
    expect(resumed.attempts).toBe(2);
    expect(runner.remoteCreates).toBe(1);
  });

  it('rejects an unowned link and detects linked-file corruption', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'apps/mobile/eas-project.json'),
      serializeCanonicalJson({
        schema_version: 1,
        owner: 'other-account',
        slug: 'example-saas',
        project_id: projectId,
      }),
      'utf8',
    );
    await expect(createEasProjectPlan(root, context)).rejects.toThrow(
      'belongs to a different owner or slug',
    );

    await rm(join(root, 'apps/mobile/eas-project.json'));
    const runner = new MockEasRunner();
    const state = await applyEasProject({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      options: { runner },
    });
    await writeFile(join(root, 'apps/mobile/eas-project.json'), '{}\n', 'utf8');
    await expect(
      validateEasProjectState(state, state.plan.manifest_sha256, root),
    ).rejects.toThrow();
  });
});
