import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expoManifest } from './__fixtures__/manifest.fixture';
import { createProjectFilePlan } from './capability-composition.service';
import {
  applyEasNativeBuild,
  createEasNativeBuildPlan,
  easNativeBuildMessage,
  parseEasEnvironmentMetadata,
  parseEasNativeBuildContext,
  preflightEasNativeBuild,
  readEasNativeBuildState,
} from './eas-native-build.service';
import type { EasNativeBuildContext } from './eas-native-build.types';
import {
  createEasProjectPlan,
  type EasCliRunner,
  easProjectPlanDigest,
} from './eas-project.service';
import type { EasProjectState } from './eas-project.types';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import type { SourcePublicationPlan, SourcePublicationState } from './source-publication.types';

const token = 'expo-token-that-must-stay-in-memory';
const projectId = '123e4567-e89b-42d3-a456-426614174000';
const sourceCommit = 'a'.repeat(40);
const temporaryRoots: string[] = [];
const excludedSourcePaths = new Set([
  '.void-starter/eas-build-state.json',
  '.void-starter/eas-build.lock',
  '.void-starter/eas-state.json',
  '.void-starter/eas.lock',
  '.void-starter/source-state.json',
  '.void-starter/source.lock',
]);

const context: EasNativeBuildContext = parseEasNativeBuildContext({
  schema_version: 1,
  profile: 'preview',
  platforms: ['android', 'ios'],
  environment: {
    required: [{ name: 'API_URL', visibility: 'plaintext', type: 'string' }],
  },
  signing: {
    android: {
      owner: 'void-sandbox',
      credentials_source: 'remote',
      credentials_ready: true,
    },
    ios: {
      owner: 'void-sandbox',
      credentials_source: 'remote',
      credentials_ready: true,
      apple_team_id: 'TEAM123',
    },
  },
  store_memberships: {
    apple: { status: 'not-required', team_id: null, role: 'none' },
    google_play: { status: 'not-required', role: 'none' },
  },
  cost: {
    maximum_builds: 2,
    maximum_provider_charge_usd: 25,
    paid_builds: 'explicit-approval-required',
  },
});

type SnapshotFile = {
  path: string;
  mode: '100644' | '100755';
  gitBlobSha1: string;
  sha256: string;
  size: number;
};

async function sourceSnapshot(root: string) {
  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isDirectory() && entry.name === '.git') continue;
      if (excludedSourcePaths.has(path)) continue;
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const content = await readFile(absolute);
        const metadata = await lstat(absolute);
        totalBytes += content.byteLength;
        files.push({
          path,
          mode: (metadata.mode & 0o111) === 0 ? '100644' : '100755',
          gitBlobSha1: createHash('sha1')
            .update(`blob ${content.byteLength}\0`)
            .update(content)
            .digest('hex'),
          sha256: createHash('sha256').update(content).digest('hex'),
          size: content.byteLength,
        });
      }
    }
  }
  await walk(root);
  const sorted = files.toSorted((left, right) => left.path.localeCompare(right.path));
  return {
    sha256: sha256(serializeCanonicalJson(sorted)),
    fileCount: sorted.length,
    totalBytes,
  };
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-eas-build-test-'));
  temporaryRoots.push(root);
  const manifest = parseBuildManifest(expoManifest);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  await writeFile(
    join(root, '.void-starter/manifest.json'),
    serializeCanonicalJson(manifest),
    'utf8',
  );
  await writeFile(join(root, 'bun.lock'), 'lockfileVersion = 1\n', 'utf8');
  for (const file of createProjectFilePlan(manifest).writes.filter((file) =>
    ['apps/mobile/app.json', 'apps/mobile/app.config.ts', 'apps/mobile/eas.json'].includes(
      file.path,
    ),
  )) {
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }

  const link = {
    schema_version: 1,
    owner: 'void-sandbox',
    slug: 'example-saas',
    project_id: projectId,
  } as const;
  await writeFile(join(root, 'apps/mobile/eas-project.json'), serializeCanonicalJson(link), 'utf8');
  const easPlan = await createEasProjectPlan(root, { schema_version: 1, account: 'void-sandbox' });
  const easState: EasProjectState = {
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: easProjectPlanDigest(easPlan),
    plan: easPlan,
    attempts: 1,
    observation: {
      project_id: projectId,
      owner: 'void-sandbox',
      slug: 'example-saas',
      full_name: '@void-sandbox/example-saas',
      link_sha256: sha256(serializeCanonicalJson(link)),
      linked_at: '2026-07-27T09:00:00.000Z',
    },
    error: null,
  };
  await writeFile(
    join(root, '.void-starter/eas-state.json'),
    serializeCanonicalJson(easState),
    'utf8',
  );
  await mkdir(join(root, '.git/refs/heads'), { recursive: true });
  await writeFile(join(root, '.git/HEAD'), 'ref: refs/heads/main\n', 'utf8');
  await writeFile(join(root, '.git/refs/heads/main'), `${sourceCommit}\n`, 'utf8');

  const snapshot = await sourceSnapshot(root);
  const sourcePlan: SourcePublicationPlan = {
    schema_version: 1,
    manifest_sha256: sha256(serializeCanonicalJson(manifest)),
    context_sha256: 'b'.repeat(64),
    repository: {
      owner: 'void-sandbox',
      owner_kind: 'organization',
      name: 'example-saas',
      node_id: 'R_test',
      visibility: 'private',
      branch: 'main',
    },
    source: {
      sha256: snapshot.sha256,
      file_count: snapshot.fileCount,
      total_bytes: snapshot.totalBytes,
      required_lockfile: 'bun.lock',
    },
    permissions: ['repository:contents:write', 'repository:workflows:write'],
  };
  const sourceState: SourcePublicationState = {
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: sha256(serializeCanonicalJson(sourcePlan)),
    plan: sourcePlan,
    attempts: 1,
    commit_sha: sourceCommit,
    error: null,
  };
  await writeFile(
    join(root, '.void-starter/source-state.json'),
    serializeCanonicalJson(sourceState),
    'utf8',
  );
  return root;
}

type BuildRecord = {
  id: string;
  status: string;
  platform: 'ANDROID' | 'IOS';
  buildProfile: string;
  message: string;
  gitCommitHash: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

class MockBuildRunner implements EasCliRunner {
  readonly calls: string[][] = [];
  readonly builds: BuildRecord[] = [];
  envOutput = `Environment: preview
Variables for this project:
ID            env-1
Name          API_URL
Value         https://secret-in-plain-text.example
Scope         PROJECT
Visibility    PUBLIC
Environments  preview
type          string
Created at    Jul 27 09:00:00
Updated at    Jul 27 09:00:00
`;

  async run(input: Parameters<EasCliRunner['run']>[0]) {
    this.calls.push(input.arguments);
    expect(input.environment['EXPO_TOKEN']).toBe(token);
    expect(input.environment['EAS_NO_VCS']).toBeUndefined();
    const command = input.arguments[0];
    if (command === 'account:view') {
      return {
        stdout: 'factory-user\n\nAccounts:\n• void-sandbox (Role: Admin)\n',
        stderr: '',
      };
    }
    if (command === 'project:info') {
      return {
        stdout: `fullName  @void-sandbox/example-saas\nID        ${projectId}\n`,
        stderr: '',
      };
    }
    if (command === 'env:list') return { stdout: this.envOutput, stderr: '' };
    if (command === 'build:list') {
      const platform = input.arguments[input.arguments.indexOf('--platform') + 1]?.toUpperCase();
      return {
        stdout: JSON.stringify(this.builds.filter((build) => build.platform === platform)),
        stderr: '',
      };
    }
    if (command === 'build') {
      const platform = input.arguments[input.arguments.indexOf('--platform') + 1];
      const message = input.arguments[input.arguments.indexOf('--message') + 1];
      if (!platform || !message || (platform !== 'android' && platform !== 'ios')) {
        throw new Error('invalid mocked build invocation');
      }
      const timestamp = `2026-07-27T09:0${this.builds.length + 1}:00.000Z`;
      const build: BuildRecord = {
        id: `build-${platform}`,
        status: 'IN_QUEUE',
        platform: platform.toUpperCase() as 'ANDROID' | 'IOS',
        buildProfile: 'preview',
        message,
        gitCommitHash: sourceCommit,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      this.builds.push(build);
      return { stdout: JSON.stringify([build]), stderr: '' };
    }
    throw new Error(`Unexpected EAS CLI command: ${input.arguments.join(' ')}`);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('EAS native build lifecycle', () => {
  it('creates a deterministic plan bound to EAS, source, profile and safeguards', async () => {
    const root = await createProject();
    const first = await createEasNativeBuildPlan(root, context);
    const second = await createEasNativeBuildPlan(root, context);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      eas_project: {
        project_id: projectId,
        full_name: '@void-sandbox/example-saas',
      },
      source: { commit_sha: sourceCommit },
      configuration: {
        profile: 'preview',
        environment: 'preview',
        distribution: 'internal',
        credentials_source: 'remote',
        platforms: ['android', 'ios'],
      },
      safeguards: {
        freeze_credentials: true,
        auto_submit: false,
        maximum_builds: 2,
        maximum_provider_charge_usd: 25,
      },
    });
  });

  it('reads only metadata in preflight and reports readiness without starting builds', async () => {
    const root = await createProject();
    const runner = new MockBuildRunner();

    const result = await preflightEasNativeBuild({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      options: { runner },
    });

    expect(result).toMatchObject({
      ok: true,
      ready_to_build: true,
      missing_platforms: ['android', 'ios'],
      environment: {
        name: 'preview',
        observed: [{ name: 'API_URL', visibility: 'plaintext', type: 'string' }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-in-plain-text');
    expect(runner.calls.every((arguments_) => arguments_[0] !== 'build')).toBe(true);
  });

  it('starts each missing platform once, persists no secrets and resumes to completion', async () => {
    const root = await createProject();
    const runner = new MockBuildRunner();

    const state = await applyEasNativeBuild({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      confirmation: {
        project: 'example-saas',
        maximumBuilds: 2,
        maximumProviderChargeUsd: 25,
      },
      options: { runner },
    });

    expect(state.status).toBe('running');
    expect(state.builds).toHaveLength(2);
    expect(runner.calls.filter((arguments_) => arguments_[0] === 'build')).toHaveLength(2);
    for (const arguments_ of runner.calls.filter((arguments_) => arguments_[0] === 'build')) {
      expect(arguments_).toContain('--freeze-credentials');
      expect(arguments_).toContain('--no-wait');
      expect(arguments_).not.toContain('--auto-submit');
    }
    const receipt = await readFile(join(root, '.void-starter/eas-build-state.json'), 'utf8');
    expect(receipt).not.toContain(token);
    expect(receipt).not.toContain('secret-in-plain-text');

    for (const build of runner.builds) {
      build.status = 'FINISHED';
      build.completedAt = '2026-07-27T09:30:00.000Z';
      build.updatedAt = build.completedAt;
    }
    const resumed = await applyEasNativeBuild({
      projectRoot: root,
      context,
      environment: { EXPO_TOKEN: token },
      confirmation: {
        project: 'example-saas',
        maximumBuilds: 2,
        maximumProviderChargeUsd: 25,
      },
      requireExistingState: true,
      options: { runner },
    });
    expect(resumed.status).toBe('succeeded');
    expect(resumed.builds.every((build) => build.status === 'FINISHED')).toBe(true);
    expect(runner.calls.filter((arguments_) => arguments_[0] === 'build')).toHaveLength(2);
    await expect(readEasNativeBuildState(root)).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('blocks missing signing readiness and rejects an inexact cost confirmation', async () => {
    const root = await createProject();
    const runner = new MockBuildRunner();
    const blockedContext = parseEasNativeBuildContext({
      ...context,
      signing: {
        ...context.signing,
        ios: { ...context.signing.ios, credentials_ready: false },
      },
    });
    const preflight = await preflightEasNativeBuild({
      projectRoot: root,
      context: blockedContext,
      environment: { EXPO_TOKEN: token },
      options: { runner },
    });
    expect(preflight.ready_to_build).toBe(false);
    expect(preflight.blockers).toContainEqual(
      expect.objectContaining({ code: 'EAS_IOS_SIGNING_NOT_READY' }),
    );
    await expect(
      applyEasNativeBuild({
        projectRoot: root,
        context: blockedContext,
        environment: { EXPO_TOKEN: token },
        confirmation: {
          project: 'example-saas',
          maximumBuilds: 2,
          maximumProviderChargeUsd: 25,
        },
        options: { runner },
      }),
    ).rejects.toMatchObject({ code: 'EAS_NATIVE_BUILD_PREFLIGHT_BLOCKED' });
    await expect(readEasNativeBuildState(root)).resolves.toBeNull();

    await expect(
      applyEasNativeBuild({
        projectRoot: root,
        context,
        environment: { EXPO_TOKEN: token },
        confirmation: {
          project: 'example-saas',
          maximumBuilds: 2,
          maximumProviderChargeUsd: 24,
        },
        options: { runner },
      }),
    ).rejects.toThrow('exactly match');
    expect(runner.calls.every((arguments_) => arguments_[0] !== 'build')).toBe(true);
  });

  it('ignores environment values while parsing provider metadata', () => {
    const metadata = parseEasEnvironmentMetadata(new MockBuildRunner().envOutput);
    expect(metadata).toEqual([{ name: 'API_URL', visibility: 'plaintext', type: 'string' }]);
    expect(JSON.stringify(metadata)).not.toContain('secret-in-plain-text');
  });

  it('uses a plan-specific build marker', async () => {
    const root = await createProject();
    const plan = await createEasNativeBuildPlan(root, context);
    expect(easNativeBuildMessage(plan)).toMatch(/^void-starter:[a-f0-9]{64}$/);
  });
});
