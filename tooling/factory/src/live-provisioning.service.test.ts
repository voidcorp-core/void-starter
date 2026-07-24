import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest, mobileOnlyManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import {
  LiveProvisioningAdapter,
  loadLiveProvisioningCredentials,
} from './live-provisioning.service';
import {
  applyProvisioning,
  ProvisioningApplyError,
  readProvisioningState,
} from './provisioning-apply.service';
import { createProvisioningPlan, parseProvisioningContext } from './provisioning-plan.service';

const temporaryRoots: string[] = [];
const connectionUri =
  'postgresql://neondb_owner:provider-secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

type RecordedRequest = {
  method: string;
  url: URL;
  authorization: string | null;
  body: unknown;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

class MockProviderApi {
  repositoryExists = false;
  vercelProjectExists = false;
  neonProjectExists = false;
  bindingMarker: string | null = null;
  neonOrganizationAccessible = true;
  failNeonCreateWithNetwork = false;
  readonly requests: RecordedRequest[] = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    this.requests.push({
      method,
      url,
      authorization: headers.get('authorization'),
      body,
    });

    if (url.hostname === 'api.github.com' && url.pathname === '/user') {
      return jsonResponse({ login: 'factory-bot' });
    }
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/user/memberships/orgs/voidcorp-core'
    ) {
      return jsonResponse({ state: 'active', role: 'admin' });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/voidcorp-core/example-saas') {
      return this.repositoryExists
        ? jsonResponse({
            node_id: 'R_example',
            full_name: 'voidcorp-core/example-saas',
            private: true,
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/orgs/voidcorp-core/repos' &&
      method === 'POST'
    ) {
      this.repositoryExists = true;
      return jsonResponse({}, 201);
    }

    if (url.hostname === 'api.vercel.com' && url.pathname === '/v2/teams/team_example') {
      return jsonResponse({ id: 'team_example', name: 'Example' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/example-saas') {
      return this.vercelProjectExists
        ? jsonResponse({
            id: 'prj_example',
            name: 'example-saas',
            framework: 'nextjs',
            rootDirectory: 'apps/web',
          })
        : jsonResponse({}, 404);
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects' &&
      method === 'POST'
    ) {
      this.vercelProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/prj_example/env') {
      const envs = this.bindingMarker
        ? [
            {
              id: 'env_database_sensitive',
              key: 'DATABASE_URL',
              type: 'sensitive',
              target: ['preview', 'production'],
            },
            {
              id: 'env_database_development',
              key: 'DATABASE_URL',
              type: 'encrypted',
              target: ['development'],
            },
            {
              id: 'env_marker',
              key: 'VOID_STARTER_DATABASE_BINDING_ID',
              type: 'plain',
              value: this.bindingMarker,
              target: ['development', 'preview', 'production'],
            },
          ]
        : [];
      return jsonResponse({ envs });
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects/prj_example/env' &&
      method === 'POST'
    ) {
      const variables = body as Array<{ key: string; value: string }>;
      this.bindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_DATABASE_BINDING_ID')?.value ??
        null;
      return jsonResponse({}, 201);
    }

    if (url.hostname === 'console.neon.tech' && url.pathname === '/api/v2/users/me/organizations') {
      return jsonResponse({
        organizations: this.neonOrganizationAccessible ? [{ id: 'org-example' }] : [],
      });
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects' &&
      method === 'GET'
    ) {
      return jsonResponse({
        projects: this.neonProjectExists
          ? [
              {
                id: 'neon-example',
                name: 'example-saas',
                region_id: 'aws-eu-central-1',
              },
            ]
          : [],
      });
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects' &&
      method === 'POST'
    ) {
      if (this.failNeonCreateWithNetwork) {
        throw new Error('mocked ambiguous network failure');
      }
      this.neonProjectExists = true;
      return jsonResponse({}, 201);
    }
    if (
      url.hostname === 'console.neon.tech' &&
      url.pathname === '/api/v2/projects/neon-example/connection_uri'
    ) {
      return jsonResponse({ uri: connectionUri });
    }

    throw new Error(`Unexpected provider request: ${method} ${url.toString()}`);
  };
}

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

const credentials = {
  githubToken: 'github-provider-secret',
  vercelToken: 'vercel-provider-secret',
  neonApiKey: 'neon-provider-secret',
};

async function createGeneratedProject() {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-live-apply-test-'));
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
    plan: createProvisioningPlan(manifest, context),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('LiveProvisioningAdapter', () => {
  it('preflights identities, creates the first provider tranche, and never persists secrets', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({
        credentials,
        fetch: provider.fetch,
      }),
    });

    expect(state.mode).toBe('live');
    expect(state.status).toBe('succeeded');
    expect(state.actions.map((action) => action.resource?.resource_id)).toEqual([
      'R_example',
      'prj_example',
      'neon-example',
      'env_marker',
    ]);
    expect(provider.requests.filter((request) => request.method === 'POST')).toHaveLength(4);
    expect(provider.requests.every((request) => request.authorization?.startsWith('Bearer '))).toBe(
      true,
    );
    for (const request of provider.requests) {
      const expectedAuthorization =
        request.url.hostname === 'api.github.com'
          ? `Bearer ${credentials.githubToken}`
          : request.url.hostname === 'api.vercel.com'
            ? `Bearer ${credentials.vercelToken}`
            : `Bearer ${credentials.neonApiKey}`;
      expect(request.authorization).toBe(expectedAuthorization);
    }

    expect(
      provider.requests.find(
        (request) => request.method === 'POST' && request.url.pathname === '/v10/projects',
      )?.body,
    ).toEqual({
      name: 'example-saas',
      framework: 'nextjs',
      rootDirectory: 'apps/web',
      gitRepository: {
        type: 'github',
        repo: 'voidcorp-core/example-saas',
      },
    });
    const neonCreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'console.neon.tech' &&
        request.url.pathname === '/api/v2/projects',
    );
    expect(neonCreateRequest?.url.searchParams.get('org_id')).toBe('org-example');
    expect(neonCreateRequest?.body).toEqual({
      project: {
        name: 'example-saas',
        region_id: 'aws-eu-central-1',
      },
    });

    const environmentRequest = provider.requests.find(
      (request) => request.url.pathname === '/v10/projects/prj_example/env',
    );
    expect(environmentRequest?.body).toEqual([
      {
        key: 'DATABASE_URL',
        type: 'sensitive',
        target: ['preview', 'production'],
        value: connectionUri,
      },
      {
        key: 'DATABASE_URL',
        type: 'encrypted',
        target: ['development'],
        value: connectionUri,
      },
      {
        key: 'VOID_STARTER_DATABASE_BINDING_ID',
        type: 'plain',
        target: ['development', 'preview', 'production'],
        value: expect.any(String),
      },
    ]);

    const persistedState = await readFile(
      join(project.root, '.void-starter/apply-state.json'),
      'utf8',
    );
    for (const secret of [...Object.values(credentials), 'provider-secret']) {
      expect(persistedState).not.toContain(secret);
    }
  });

  it('adopts matching resources and bindings without issuing create requests', async () => {
    const project = await createGeneratedProject();
    const bindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.database-binding',
    );
    if (!bindingAction) {
      throw new Error('Expected database binding action');
    }
    const provider = new MockProviderApi();
    provider.repositoryExists = true;
    provider.vercelProjectExists = true;
    provider.neonProjectExists = true;
    provider.bindingMarker = bindingAction.idempotency_key;

    const state = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({
        credentials,
        fetch: provider.fetch,
      }),
    });

    expect(state.status).toBe('succeeded');
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('never repeats an ambiguous Neon create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failNeonCreateWithNetwork = true;
    const adapter = new LiveProvisioningAdapter({
      credentials,
      fetch: provider.fetch,
    });

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect((await readProvisioningState(project.root))?.actions[2]?.error?.code).toBe(
      'NEON_CREATE_AMBIGUOUS',
    );

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'console.neon.tech' &&
          request.url.pathname === '/api/v2/projects',
      ),
    ).toHaveLength(1);
  });

  it('fails preflight before state or mutation when a provider identity is wrong', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.neonOrganizationAccessible = false;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toThrow(/organization/i);
    expect(await readProvisioningState(project.root)).toBeNull();
    expect(provider.requests.some((request) => request.method === 'POST')).toBe(false);
  });
});

describe('loadLiveProvisioningCredentials', () => {
  it('requires only credentials for providers selected by the plan', () => {
    const mobilePlan = createProvisioningPlan(
      parseBuildManifest(mobileOnlyManifest),
      parseProvisioningContext({
        schema_version: 1,
        github: context.github,
      }),
    );

    expect(
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github-only',
        },
        mobilePlan,
      ),
    ).toEqual({
      githubToken: 'github-only',
    });
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github-only',
        },
        createProvisioningPlan(parseBuildManifest(canonicalManifest), context),
      ),
    ).toThrow(/VERCEL_TOKEN/);
  });
});
