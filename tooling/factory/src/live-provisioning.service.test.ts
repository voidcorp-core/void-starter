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
  r2Jurisdiction: string | null;
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
  r2BucketExists = false;
  r2BindingMarker: string | null = null;
  r2CanaryPayload: string | null = null;
  r2PublicDomainEnabled = false;
  r2CustomPublicDomainEnabled = false;
  githubMembershipPermissionDenied = false;
  neonOrganizationAccessible = true;
  failNeonCreateWithNetwork = false;
  failR2CreateWithNetwork = false;
  readonly requests: RecordedRequest[] = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const contentType = headers.get('content-type');
    const body =
      typeof init?.body === 'string'
        ? contentType === 'application/json'
          ? JSON.parse(init.body)
          : init.body
        : null;
    this.requests.push({
      method,
      url,
      authorization: headers.get('authorization'),
      r2Jurisdiction: headers.get('cf-r2-jurisdiction'),
      body,
    });

    if (url.hostname === 'api.github.com' && url.pathname === '/user') {
      return jsonResponse({ login: 'factory-bot' });
    }
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/user/memberships/orgs/voidcorp-core'
    ) {
      return this.githubMembershipPermissionDenied
        ? jsonResponse({}, 403)
        : jsonResponse({
            state: 'active',
            organization: {
              login: 'voidcorp-core',
            },
          });
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
      const envs = [
        ...(this.bindingMarker
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
          : []),
        ...(this.r2BindingMarker
          ? [
              ...['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ENDPOINT'].map((key) => ({
                id: `env_${key.toLowerCase()}`,
                key,
                type: 'encrypted',
                target: ['development', 'preview', 'production'],
              })),
              ...['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].flatMap((key) => [
                {
                  id: `env_${key.toLowerCase()}_sensitive`,
                  key,
                  type: 'sensitive',
                  target: ['preview', 'production'],
                },
                {
                  id: `env_${key.toLowerCase()}_development`,
                  key,
                  type: 'encrypted',
                  target: ['development'],
                },
              ]),
              {
                id: 'env_r2_marker',
                key: 'VOID_STARTER_R2_BINDING_ID',
                type: 'plain',
                value: this.r2BindingMarker,
                target: ['development', 'preview', 'production'],
              },
            ]
          : []),
      ];
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
        this.bindingMarker;
      this.r2BindingMarker =
        variables.find((variable) => variable.key === 'VOID_STARTER_R2_BINDING_ID')?.value ??
        this.r2BindingMarker;
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

    const r2Base = '/client/v4/accounts/0123456789abcdef0123456789abcdef/r2/buckets';
    const r2Bucket = `${r2Base}/example-saas`;
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Base && method === 'GET') {
      return jsonResponse({
        success: true,
        result: {
          buckets: this.r2BucketExists
            ? [
                {
                  name: 'example-saas',
                  jurisdiction: 'eu',
                  storage_class: 'Standard',
                },
              ]
            : [],
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Bucket && method === 'GET') {
      return this.r2BucketExists
        ? jsonResponse({
            success: true,
            result: {
              name: 'example-saas',
              jurisdiction: 'eu',
              storage_class: 'Standard',
            },
          })
        : jsonResponse({}, 404);
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === r2Base && method === 'POST') {
      if (this.failR2CreateWithNetwork) {
        throw new Error('mocked ambiguous R2 network failure');
      }
      this.r2BucketExists = true;
      return jsonResponse({
        success: true,
        result: {
          name: 'example-saas',
          jurisdiction: 'eu',
          storage_class: 'Standard',
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === `${r2Bucket}/domains/managed`) {
      return jsonResponse({
        success: true,
        result: {
          bucketId: 'r2_bucket_example',
          domain: 'pub-example.r2.dev',
          enabled: this.r2PublicDomainEnabled,
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname === `${r2Bucket}/domains/custom`) {
      return jsonResponse({
        success: true,
        result: {
          domains: this.r2CustomPublicDomainEnabled
            ? [{ domain: 'documents.example.com', enabled: true }]
            : [],
        },
      });
    }
    if (url.hostname === 'api.cloudflare.com' && url.pathname.startsWith(`${r2Bucket}/objects/`)) {
      const objectKey = decodeURIComponent(url.pathname.slice(`${r2Bucket}/objects/`.length));
      if (method === 'PUT') {
        if (contentType !== 'application/octet-stream') {
          throw new Error('Expected R2 canary octet-stream content type');
        }
        if (typeof body !== 'string') throw new Error('Expected raw R2 canary payload');
        this.r2CanaryPayload = body;
        return jsonResponse({
          success: true,
          result: { key: objectKey, etag: 'canary-etag' },
        });
      }
      if (method === 'GET') {
        return new Response(this.r2CanaryPayload, { status: 200 });
      }
      if (method === 'DELETE') {
        this.r2CanaryPayload = null;
        return jsonResponse({ success: true, result: { key: objectKey } });
      }
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
  cloudflare: {
    account_id: '0123456789abcdef0123456789abcdef',
  },
});

const credentials = {
  githubToken: 'github-provider-secret',
  vercelToken: 'vercel-provider-secret',
  neonApiKey: 'neon-provider-secret',
  cloudflareApiToken: 'cloudflare-provider-secret',
  r2AccessKeyId: 'r2-access-provider-secret',
  r2SecretAccessKey: 'r2-secret-provider-secret',
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
      'r2_bucket_example',
      'env_r2_marker',
    ]);
    expect(provider.requests.filter((request) => request.method === 'POST')).toHaveLength(6);
    expect(provider.requests.every((request) => request.authorization?.startsWith('Bearer '))).toBe(
      true,
    );
    for (const request of provider.requests) {
      const expectedAuthorization =
        request.url.hostname === 'api.github.com'
          ? `Bearer ${credentials.githubToken}`
          : request.url.hostname === 'api.vercel.com'
            ? `Bearer ${credentials.vercelToken}`
            : request.url.hostname === 'console.neon.tech'
              ? `Bearer ${credentials.neonApiKey}`
              : `Bearer ${credentials.cloudflareApiToken}`;
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

    const r2CreateRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url.hostname === 'api.cloudflare.com' &&
        request.url.pathname.endsWith('/r2/buckets'),
    );
    expect(r2CreateRequest).toMatchObject({
      r2Jurisdiction: 'eu',
      body: { name: 'example-saas', storageClass: 'Standard' },
    });
    expect(provider.r2CanaryPayload).toBeNull();

    const r2EnvironmentRequest = provider.requests.find(
      (request) =>
        request.method === 'POST' &&
        Array.isArray(request.body) &&
        request.body.some(
          (variable: { key?: string }) => variable.key === 'VOID_STARTER_R2_BINDING_ID',
        ),
    );
    expect(r2EnvironmentRequest?.body).toEqual(
      expect.arrayContaining([
        {
          key: 'R2_ACCESS_KEY_ID',
          type: 'sensitive',
          target: ['preview', 'production'],
          value: credentials.r2AccessKeyId,
        },
        {
          key: 'R2_SECRET_ACCESS_KEY',
          type: 'sensitive',
          target: ['preview', 'production'],
          value: credentials.r2SecretAccessKey,
        },
        {
          key: 'R2_ENDPOINT',
          type: 'encrypted',
          target: ['development', 'preview', 'production'],
          value: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
        },
      ]),
    );

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
    provider.r2BucketExists = true;
    const r2BindingAction = project.plan.actions.find(
      (action) => action.id === 'vercel.r2-binding',
    );
    if (!r2BindingAction) throw new Error('Expected R2 binding action');
    provider.r2BindingMarker = r2BindingAction.idempotency_key;

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

  it('resumes the R2 binding with bucket-scoped runtime credentials without recreating the bucket', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    const controlCredentials = {
      githubToken: credentials.githubToken,
      vercelToken: credentials.vercelToken,
      neonApiKey: credentials.neonApiKey,
      cloudflareApiToken: credentials.cloudflareApiToken,
    };

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials: controlCredentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);

    const partialState = await readProvisioningState(project.root);
    expect(
      partialState?.actions.find((action) => action.action_id === 'cloudflare.r2-bucket'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      partialState?.actions.find((action) => action.action_id === 'vercel.r2-binding'),
    ).toMatchObject({
      attempts: 1,
      error: { code: 'CLOUDFLARE_R2_RUNTIME_CREDENTIAL_MISSING', retryable: true },
      status: 'failed',
    });

    const resumedState = await applyProvisioning({
      projectRoot: project.root,
      plan: project.plan,
      adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      requireExistingState: true,
    });

    expect(resumedState.status).toBe('succeeded');
    expect(
      resumedState.actions.find((action) => action.action_id === 'cloudflare.r2-bucket'),
    ).toMatchObject({ attempts: 1, status: 'succeeded' });
    expect(
      resumedState.actions.find((action) => action.action_id === 'vercel.r2-binding'),
    ).toMatchObject({ attempts: 2, status: 'succeeded' });
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'api.cloudflare.com' &&
          request.url.pathname.endsWith('/r2/buckets'),
      ),
    ).toHaveLength(1);
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

  it('never repeats an ambiguous R2 create while resume can only reconcile it', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.failR2CreateWithNetwork = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.r2-bucket',
      )?.error?.code,
    ).toBe('CLOUDFLARE_R2_CREATE_AMBIGUOUS');

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
        requireExistingState: true,
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      provider.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.hostname === 'api.cloudflare.com' &&
          request.url.pathname.endsWith('/r2/buckets'),
      ),
    ).toHaveLength(1);
  });

  it('rejects an R2 bucket exposed through a public domain before the object canary or binding', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.r2BucketExists = true;
    provider.r2PublicDomainEnabled = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({ credentials, fetch: provider.fetch }),
      }),
    ).rejects.toBeInstanceOf(ProvisioningApplyError);
    expect(
      (await readProvisioningState(project.root))?.actions.find(
        (action) => action.action_id === 'cloudflare.r2-bucket',
      )?.error?.code,
    ).toBe('CLOUDFLARE_R2_PUBLIC_ACCESS_CONFLICT');
    expect(provider.requests.some((request) => request.method === 'PUT')).toBe(false);
    expect(provider.r2BindingMarker).toBeNull();
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

  it('explains the GitHub organization membership permission required by preflight', async () => {
    const project = await createGeneratedProject();
    const provider = new MockProviderApi();
    provider.githubMembershipPermissionDenied = true;

    await expect(
      applyProvisioning({
        projectRoot: project.root,
        plan: project.plan,
        adapter: new LiveProvisioningAdapter({
          credentials,
          fetch: provider.fetch,
        }),
      }),
    ).rejects.toThrow(/Members: read/);
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

    const canonicalPlan = createProvisioningPlan(parseBuildManifest(canonicalManifest), context);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
        },
        canonicalPlan,
      ),
    ).toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
        },
        canonicalPlan,
      ),
    ).not.toThrow();
    expect(() =>
      loadLiveProvisioningCredentials(
        {
          GITHUB_TOKEN: 'github',
          VERCEL_TOKEN: 'vercel',
          NEON_API_KEY: 'neon',
          CLOUDFLARE_API_TOKEN: 'cloudflare',
          R2_ACCESS_KEY_ID: 'partial-r2-credential',
        },
        canonicalPlan,
      ),
    ).toThrow(/R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY together/);
  });
});
