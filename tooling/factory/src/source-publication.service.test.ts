import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import {
  type ProvisionedResource,
  type ProvisioningContext,
  provisioningApplyStateSchema,
} from './provisioning.types';
import { createProvisioningPlan, provisioningPlanDigest } from './provisioning-plan.service';
import { runSourceApplyCli } from './source-publication.cli';
import {
  applySourcePublication,
  applySourceUpdate,
  createSourcePublicationPlan,
  GitSourceControl,
  preflightSourcePublication,
  preflightSourceUpdate,
  readSourcePublicationState,
  type SourceControl,
  SourcePublicationError,
  validateSourcePublicationState,
} from './source-publication.service';

const temporaryRoots: string[] = [];
const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const token = 'github-secret-value';

const context: ProvisioningContext = {
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
};

type RemoteSource = {
  commitSha: string;
  treeSha: string;
  sourceSha256: string;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

class MockGitHubSourceApi {
  remote: RemoteSource | null = null;
  staleRemote: RemoteSource | null = null;
  staleLookupsRemaining = 0;
  lastObservedRemote: RemoteSource | null = null;
  readonly requests: Array<{ method: string; path: string; authorization: string | null }> = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    this.requests.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      authorization: headers.get('authorization'),
    });
    if (url.pathname === '/user') {
      return jsonResponse({ login: 'factory-owner', id: 12345 });
    }
    if (url.pathname === '/user/memberships/orgs/voidcorp-core') {
      return jsonResponse({
        state: 'active',
        organization: {
          login: 'voidcorp-core',
        },
      });
    }
    if (url.pathname === '/repos/voidcorp-core/example-saas') {
      return jsonResponse({
        node_id: 'R_example',
        full_name: 'voidcorp-core/example-saas',
        private: true,
        default_branch: 'main',
      });
    }
    if (url.pathname === '/repos/voidcorp-core/example-saas/git/ref/heads/main') {
      const observedRemote = this.staleLookupsRemaining > 0 ? this.staleRemote : this.remote;
      if (this.staleLookupsRemaining > 0) this.staleLookupsRemaining -= 1;
      this.lastObservedRemote = observedRemote;
      return observedRemote
        ? jsonResponse({
            object: {
              sha: observedRemote.commitSha,
            },
          })
        : jsonResponse({}, 409);
    }
    if (
      this.lastObservedRemote &&
      url.pathname ===
        `/repos/voidcorp-core/example-saas/git/commits/${this.lastObservedRemote.commitSha}`
    ) {
      return jsonResponse({
        sha: this.lastObservedRemote.commitSha,
        message: `chore: initialize example-saas\n\nVoid-Starter-Source-SHA256: ${this.lastObservedRemote.sourceSha256}`,
        tree: {
          sha: this.lastObservedRemote.treeSha,
        },
      });
    }
    throw new Error(`Unexpected GitHub source request: ${url.toString()}`);
  };
}

class MockSourceControl implements SourceControl {
  prepareCalls = 0;
  pushCalls = 0;
  preparedBase: Parameters<SourceControl['prepare']>[0]['base'];
  failPushAfterRemoteUpdate = false;
  failPushBeforeRemoteUpdate = false;
  staleLookupAfterRemoteUpdate = false;
  readonly api: MockGitHubSourceApi;
  readonly sourceSha256: string;

  constructor(api: MockGitHubSourceApi, sourceSha256: string) {
    this.api = api;
    this.sourceSha256 = sourceSha256;
  }

  async prepare(
    input: Parameters<SourceControl['prepare']>[0],
  ): Promise<{ commitSha: string; treeSha: string }> {
    this.prepareCalls += 1;
    this.preparedBase = input.base;
    return { commitSha, treeSha };
  }

  async push(): Promise<void> {
    this.pushCalls += 1;
    if (this.failPushBeforeRemoteUpdate) {
      throw new SourcePublicationError({
        code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
        message: 'simulated transport failure',
        retryable: true,
      });
    }
    const previousRemote = this.api.remote;
    this.api.remote = {
      commitSha,
      treeSha,
      sourceSha256: this.sourceSha256,
    };
    if (this.staleLookupAfterRemoteUpdate) {
      this.api.staleRemote = previousRemote;
      this.api.staleLookupsRemaining = 1;
    }
    if (this.failPushAfterRemoteUpdate) {
      throw new SourcePublicationError({
        code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
        message: 'simulated ambiguous transport failure',
        retryable: true,
      });
    }
  }
}

async function createProvisionedProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-source-test-'));
  temporaryRoots.push(root);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  await mkdir(join(root, '.next'), { recursive: true });
  const manifest = parseBuildManifest(canonicalManifest);
  const plan = createProvisioningPlan(manifest, context);
  const resources = new Map<string, ProvisionedResource>([
    [
      'github.repository',
      {
        provider: 'github',
        resource_kind: 'repository',
        resource_id: 'R_example',
        display_name: 'voidcorp-core/example-saas',
      },
    ],
    [
      'vercel.project',
      {
        provider: 'vercel',
        resource_kind: 'project',
        resource_id: 'prj_example',
        display_name: 'example-saas',
      },
    ],
    [
      'neon.project',
      {
        provider: 'neon',
        resource_kind: 'project',
        resource_id: 'neon-example',
        display_name: 'example-saas',
        database_name: 'neondb',
        role_name: 'neondb_owner',
      },
    ],
    [
      'vercel.database-binding',
      {
        provider: 'vercel',
        resource_kind: 'database-binding',
        resource_id: 'env_example',
        display_name: 'DATABASE_URL',
      },
    ],
    [
      'cloudflare.r2-bucket',
      {
        provider: 'cloudflare',
        resource_kind: 'r2-bucket',
        resource_id: 'r2_bucket_example',
        display_name: 'example-saas',
        account_id: '0123456789abcdef0123456789abcdef',
        jurisdiction: 'eu',
        public_access: false,
        canary_sha256: 'a'.repeat(64),
      },
    ],
    [
      'vercel.r2-binding',
      {
        provider: 'vercel',
        resource_kind: 'r2-binding',
        resource_id: 'env_r2',
        display_name: 'Cloudflare R2 runtime binding',
        bound_keys: [
          'CLOUDFLARE_ACCOUNT_ID',
          'R2_ACCESS_KEY_ID',
          'R2_BUCKET_NAME',
          'R2_ENDPOINT',
          'R2_SECRET_ACCESS_KEY',
        ],
      },
    ],
    [
      'sentry.project',
      {
        provider: 'sentry',
        resource_kind: 'project',
        resource_id: 'sentry_project_example',
        display_name: 'example-saas',
        organization_slug: 'void-sandbox',
        team_slug: 'platform',
        region: 'de',
        platform: 'javascript-nextjs',
        client_key_id: 'sentry_key_example',
        dsn_sha256: 'b'.repeat(64),
      },
    ],
    [
      'vercel.sentry-binding',
      {
        provider: 'vercel',
        resource_kind: 'sentry-binding',
        resource_id: 'env_sentry',
        display_name: 'Sentry runtime binding',
        bound_keys: [
          'SENTRY_DSN',
          'NEXT_PUBLIC_SENTRY_DSN',
          'SENTRY_AUTH_TOKEN',
          'SENTRY_ORG',
          'SENTRY_PROJECT',
        ],
      },
    ],
    [
      'posthog.project',
      {
        provider: 'posthog',
        resource_kind: 'project',
        resource_id: '42',
        display_name: 'example-saas',
        organization_id: '123e4567-e89b-42d3-a456-426614174000',
        region: 'eu',
        project_api_key_sha256: 'c'.repeat(64),
      },
    ],
    [
      'vercel.posthog-binding',
      {
        provider: 'vercel',
        resource_kind: 'posthog-binding',
        resource_id: 'env_posthog',
        display_name: 'PostHog runtime binding',
        bound_keys: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'],
      },
    ],
  ]);
  const applyState = provisioningApplyStateSchema.parse({
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: provisioningPlanDigest(plan),
    plan,
    actions: plan.actions.map((action) => ({
      action_id: action.id,
      idempotency_key: action.idempotency_key,
      status: 'succeeded',
      attempts: 1,
      resource: resources.get(action.id),
      error: null,
    })),
  });

  await writeFile(
    join(root, '.void-starter/manifest.json'),
    serializeCanonicalJson(manifest),
    'utf8',
  );
  await writeFile(
    join(root, '.void-starter/apply-state.json'),
    serializeCanonicalJson(applyState),
    'utf8',
  );
  await writeFile(join(root, 'bun.lock'), 'lockfileVersion = 1\n', 'utf8');
  await writeFile(join(root, 'README.md'), '# Example\n', 'utf8');
  await writeFile(join(root, '.github/workflows/ci.yml'), 'name: CI\n', 'utf8');
  await writeFile(join(root, '.env.local'), 'SECRET=must-not-publish\n', 'utf8');
  await writeFile(join(root, '.next/output.txt'), 'ignored build output\n', 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('source publication', () => {
  it('builds a stable plan that excludes local state, secrets, and build output', async () => {
    const root = await createProvisionedProject();
    const first = await createSourcePublicationPlan(root, context);

    await writeFile(join(root, '.env.local'), 'SECRET=changed-but-still-ignored\n', 'utf8');
    await writeFile(join(root, '.next/output.txt'), 'changed build output\n', 'utf8');
    await writeFile(join(root, '.void-starter/delivery-state.json'), '{"local":"state"}\n', 'utf8');
    await writeFile(join(root, '.void-starter/delivery.lock'), '{"local":"lock"}\n', 'utf8');
    await writeFile(join(root, '.void-starter/auth-state.json'), '{"local":"state"}\n', 'utf8');
    await writeFile(join(root, '.void-starter/auth.lock'), '{"local":"lock"}\n', 'utf8');
    await writeFile(join(root, '.void-starter/eas-state.json'), '{"local":"state"}\n', 'utf8');
    await writeFile(join(root, '.void-starter/eas.lock'), '{"local":"lock"}\n', 'utf8');
    await writeFile(
      join(root, '.void-starter/migration-state.json'),
      '{"local":"state"}\n',
      'utf8',
    );
    await writeFile(join(root, '.void-starter/migration.lock'), '{"local":"lock"}\n', 'utf8');
    const second = await createSourcePublicationPlan(root, context);
    expect(second).toEqual(first);
    expect(first.source.file_count).toBe(4);

    await mkdir(join(root, 'apps/mobile'), { recursive: true });
    await writeFile(
      join(root, 'apps/mobile/eas-project.json'),
      '{"schema_version":1,"owner":"void-sandbox","slug":"factory-project","project_id":"123e4567-e89b-42d3-a456-426614174000"}\n',
      'utf8',
    );
    const linked = await createSourcePublicationPlan(root, context);
    expect(linked.source.file_count).toBe(5);
    expect(linked.source.sha256).not.toBe(first.source.sha256);
    await rm(join(root, 'apps/mobile'), { force: true, recursive: true });

    await writeFile(join(root, 'README.md'), '# Changed\n', 'utf8');
    const changed = await createSourcePublicationPlan(root, context);
    expect(changed.source.sha256).not.toBe(first.source.sha256);
  });

  it('requires a generated lockfile before any authenticated request', async () => {
    const root = await createProvisionedProject();
    await rm(join(root, 'bun.lock'));
    let fetchCalled = false;
    await expect(
      preflightSourcePublication({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        fetch: async () => {
          fetchCalled = true;
          return jsonResponse({});
        },
      }),
    ).rejects.toThrow(/bun\.lock/);
    expect(fetchCalled).toBe(false);
  });

  it('preflights an empty repository using authenticated reads only', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const result = await preflightSourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      fetch: api.fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'source-live-preflight',
      remote: 'empty',
    });
    expect(api.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(api.requests.every((request) => request.authorization === `Bearer ${token}`)).toBe(true);
    expect(await readSourcePublicationState(root)).toBeNull();
  });

  it('publishes once, stores no credential, and makes completed resume a no-op', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const plan = await createSourcePublicationPlan(root, context);
    const sourceControl = new MockSourceControl(api, plan.source.sha256);

    const state = await applySourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      options: {
        fetch: api.fetch,
        sourceControl,
      },
    });
    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      commit_sha: commitSha,
    });
    expect(sourceControl.prepareCalls).toBe(1);
    expect(sourceControl.pushCalls).toBe(1);
    expect(await readFile(join(root, '.void-starter/source-state.json'), 'utf8')).not.toContain(
      token,
    );

    const requestCount = api.requests.length;
    const resumed = await applySourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      requireExistingState: true,
      options: {
        fetch: api.fetch,
        sourceControl,
      },
    });
    expect(resumed).toEqual(state);
    expect(sourceControl.prepareCalls).toBe(1);
    expect(sourceControl.pushCalls).toBe(1);
    expect(api.requests).toHaveLength(requestCount);

    await expect(
      validateSourcePublicationState(state, state.plan.manifest_sha256, root),
    ).resolves.toBeUndefined();
    await writeFile(join(root, 'README.md'), '# Locally changed after publication\n', 'utf8');
    await expect(
      validateSourcePublicationState(state, state.plan.manifest_sha256, root),
    ).rejects.toThrow(/do not match/);
  });

  it('adopts the exact remote tree from a fresh local state without pushing', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const plan = await createSourcePublicationPlan(root, context);
    api.remote = {
      commitSha,
      treeSha,
      sourceSha256: plan.source.sha256,
    };
    const sourceControl = new MockSourceControl(api, plan.source.sha256);

    const state = await applySourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      options: {
        fetch: api.fetch,
        sourceControl,
      },
    });
    expect(state.commit_sha).toBe(commitSha);
    expect(sourceControl.prepareCalls).toBe(1);
    expect(sourceControl.pushCalls).toBe(0);
  });

  it('prepares an exact local commit without staging receipts, secrets, or token-bearing config', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const plan = await createSourcePublicationPlan(root, context);
    const git = new GitSourceControl();
    let preparedTreeSha = '';
    const sourceControl: SourceControl = {
      prepare: async (input) => {
        const prepared = await git.prepare(input);
        preparedTreeSha = prepared.treeSha;
        return prepared;
      },
      push: async (input) => {
        api.remote = {
          commitSha: input.commitSha,
          treeSha: preparedTreeSha,
          sourceSha256: plan.source.sha256,
        };
      },
    };

    const state = await applySourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      options: {
        fetch: api.fetch,
        sourceControl,
      },
    });
    expect(state.status).toBe('succeeded');

    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
    expect(tracked).toContain('bun.lock');
    expect(tracked).toContain('.github/workflows/ci.yml');
    expect(tracked).not.toContain('.void-starter/apply-state.json');
    expect(tracked).not.toContain('.void-starter/source-state.json');
    expect(tracked).not.toContain('.void-starter/auth-state.json');
    expect(tracked).not.toContain('.void-starter/auth.lock');
    expect(tracked).not.toContain('.void-starter/eas-state.json');
    expect(tracked).not.toContain('.void-starter/eas.lock');
    expect(tracked).not.toContain('.env.local');
    expect(tracked).not.toContain('.next/output.txt');

    const authorEmail = execFileSync('git', ['show', '--quiet', '--format=%ae', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    expect(authorEmail).toBe('12345+factory-owner@users.noreply.github.com');
    expect(await readFile(join(root, '.git/config'), 'utf8')).not.toContain(token);
  });

  it('reconciles an ambiguous push and refuses a different remote source', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const plan = await createSourcePublicationPlan(root, context);
    const sourceControl = new MockSourceControl(api, plan.source.sha256);
    sourceControl.failPushAfterRemoteUpdate = true;

    await expect(
      applySourcePublication({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        options: {
          fetch: api.fetch,
          sourceControl,
        },
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      commit_sha: commitSha,
    });

    const conflictRoot = await createProvisionedProject();
    const conflictApi = new MockGitHubSourceApi();
    conflictApi.remote = {
      commitSha: 'c'.repeat(40),
      treeSha: 'd'.repeat(40),
      sourceSha256: 'e'.repeat(64),
    };
    await expect(
      preflightSourcePublication({
        projectRoot: conflictRoot,
        context,
        environment: { GITHUB_TOKEN: token },
        fetch: conflictApi.fetch,
      }),
    ).rejects.toThrow(/not owned/);
  });

  it('records a retryable failure and resumes the same plan', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const plan = await createSourcePublicationPlan(root, context);
    const failingControl = new MockSourceControl(api, plan.source.sha256);
    failingControl.failPushBeforeRemoteUpdate = true;

    await expect(
      applySourcePublication({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        options: {
          fetch: api.fetch,
          sourceControl: failingControl,
        },
      }),
    ).rejects.toThrow(/GITHUB_SOURCE_PUSH_UNCONFIRMED/);
    expect(await readSourcePublicationState(root)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: {
        code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
        retryable: true,
      },
    });

    const succeedingControl = new MockSourceControl(api, plan.source.sha256);
    const resumed = await applySourcePublication({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      requireExistingState: true,
      options: {
        fetch: api.fetch,
        sourceControl: succeedingControl,
      },
    });
    expect(resumed).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      commit_sha: commitSha,
    });
    expect(succeedingControl.pushCalls).toBe(1);
  });

  it('preflights and applies a fast-forward update from the exact managed remote head', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const localPlan = await createSourcePublicationPlan(root, context);
    const baseCommitSha = 'c'.repeat(40);
    const baseTreeSha = 'd'.repeat(40);
    const baseSourceSha256 = 'e'.repeat(64);
    api.remote = {
      commitSha: baseCommitSha,
      treeSha: baseTreeSha,
      sourceSha256: baseSourceSha256,
    };

    await expect(
      preflightSourceUpdate({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        fetch: api.fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mode: 'source-update-preflight',
      source_sha256: localPlan.source.sha256,
      base_commit_sha: baseCommitSha,
      base_source_sha256: baseSourceSha256,
    });
    expect(api.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(await readSourcePublicationState(root)).toBeNull();

    const sourceControl = new MockSourceControl(api, localPlan.source.sha256);
    const state = await applySourceUpdate({
      projectRoot: root,
      context,
      environment: { GITHUB_TOKEN: token },
      options: {
        fetch: api.fetch,
        sourceControl,
      },
    });
    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      commit_sha: commitSha,
      plan: {
        base: {
          commit_sha: baseCommitSha,
          tree_sha: baseTreeSha,
          source_sha256: baseSourceSha256,
        },
      },
    });
    expect(sourceControl.preparedBase).toMatchObject({
      commitSha: baseCommitSha,
      treeSha: baseTreeSha,
      sourceSha256: baseSourceSha256,
    });
    expect(sourceControl.pushCalls).toBe(1);
    expect(await readFile(join(root, '.void-starter/source-state.json'), 'utf8')).not.toContain(
      token,
    );

    const requestCount = api.requests.length;
    await expect(
      applySourceUpdate({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        requireExistingState: true,
        options: {
          fetch: api.fetch,
          sourceControl,
        },
      }),
    ).resolves.toEqual(state);
    expect(api.requests).toHaveLength(requestCount);
    expect(sourceControl.pushCalls).toBe(1);
  });

  it('records a retryable ambiguity when GitHub briefly returns the stale base after push', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const localPlan = await createSourcePublicationPlan(root, context);
    api.remote = {
      commitSha: 'c'.repeat(40),
      treeSha: 'd'.repeat(40),
      sourceSha256: 'e'.repeat(64),
    };
    const sourceControl = new MockSourceControl(api, localPlan.source.sha256);
    sourceControl.staleLookupAfterRemoteUpdate = true;

    await expect(
      applySourceUpdate({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        options: { fetch: api.fetch, sourceControl },
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED' });
    expect(await readSourcePublicationState(root)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED', retryable: true },
    });
    expect(sourceControl.pushCalls).toBe(1);

    await expect(
      applySourceUpdate({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        requireExistingState: true,
        options: { fetch: api.fetch, sourceControl },
      }),
    ).resolves.toMatchObject({ status: 'succeeded', attempts: 2, commit_sha: commitSha });
    expect(sourceControl.pushCalls).toBe(1);
  });

  it('refuses source updates from empty, unmarked, or already-current remote heads', async () => {
    const root = await createProvisionedProject();
    const api = new MockGitHubSourceApi();
    const localPlan = await createSourcePublicationPlan(root, context);
    const preflight = () =>
      preflightSourceUpdate({
        projectRoot: root,
        context,
        environment: { GITHUB_TOKEN: token },
        fetch: api.fetch,
      });

    await expect(preflight()).rejects.toMatchObject({
      code: 'GITHUB_SOURCE_UPDATE_BASE_MISSING',
    });

    api.remote = {
      commitSha,
      treeSha,
      sourceSha256: null,
    };
    await expect(preflight()).rejects.toMatchObject({
      code: 'GITHUB_SOURCE_UPDATE_BASE_UNMANAGED',
    });

    api.remote.sourceSha256 = localPlan.source.sha256;
    await expect(preflight()).rejects.toMatchObject({
      code: 'GITHUB_SOURCE_UPDATE_UNCHANGED',
    });
  });

  it('requires exact project confirmation before source mutation', async () => {
    const root = await createProvisionedProject();
    const contextPath = join(root, 'provisioning.yaml');
    await writeFile(
      contextPath,
      `schema_version: 1
github:
  owner: voidcorp-core
  owner_kind: organization
  visibility: private
vercel:
  team_id: team_example
  region: fra1
neon:
  org_id: org-example
  region_id: aws-eu-central-1
cloudflare:
  account_id: 0123456789abcdef0123456789abcdef
sentry:
  organization_slug: void-sandbox
  team_slug: platform
  region: de
posthog:
  organization_id: 123e4567-e89b-42d3-a456-426614174000
  region: eu
`,
      'utf8',
    );
    let fetchCalled = false;
    await expect(
      runSourceApplyCli({
        arguments: [root, contextPath, '--confirm-project', 'wrong-project'],
        environment: { GITHUB_TOKEN: token },
        requireExistingState: false,
        options: {
          fetch: async () => {
            fetchCalled = true;
            return jsonResponse({});
          },
        },
      }),
    ).rejects.toThrow(/exactly match/);
    expect(fetchCalled).toBe(false);
    expect(await readSourcePublicationState(root)).toBeNull();
  });
});
