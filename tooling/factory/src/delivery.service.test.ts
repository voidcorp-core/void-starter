import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import {
  createDeliveryPlan,
  type DeliveryApplyError,
  deliveryPlanDigest,
  observeDelivery,
  preflightDelivery,
  readDeliveryState,
  validateDeliveryState,
} from './delivery.service';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type ProvisionedResource,
  type ProvisioningContext,
  provisioningApplyStateSchema,
} from './provisioning.types';
import { createProvisioningPlan, provisioningPlanDigest } from './provisioning-plan.service';
import {
  createSourcePublicationPlan,
  readSourcePublicationState,
} from './source-publication.service';
import { sourcePublicationStateSchema } from './source-publication.types';

const temporaryRoots: string[] = [];
const vercelToken = 'vercel-secret-value';
const bypassSecret = 'bypass-secret-value';
const commitSha = 'a'.repeat(40);
const fixedNow = 1_760_000_000_000;

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

type RecordedRequest = {
  url: URL;
  authorization: string | null;
  bypass: string | null;
  redirect: RequestRedirect | undefined;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class MockVercelDeliveryApi {
  includeDeployment = true;
  deploymentCommitSha = commitSha;
  deploymentUrl = 'example-saas-abc.vercel.app';
  deploymentState: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' = 'READY';
  readyAfterLookups = 0;
  protected = false;
  smokeBody = '<!doctype html><html><body><h1>example-saas</h1></body></html>';
  lookupCount = 0;
  readonly requests: RecordedRequest[] = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    this.requests.push({
      url,
      authorization: headers.get('authorization'),
      bypass: headers.get('x-vercel-protection-bypass'),
      redirect: init?.redirect,
    });

    if (url.hostname === 'api.vercel.com' && url.pathname === '/v2/teams/team_example') {
      return jsonResponse({ id: 'team_example' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/prj_example') {
      return jsonResponse({ id: 'prj_example', name: 'example-saas' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v6/deployments') {
      this.lookupCount += 1;
      const state = this.lookupCount <= this.readyAfterLookups ? 'BUILDING' : this.deploymentState;
      return jsonResponse({
        deployments: this.includeDeployment
          ? [
              {
                uid: 'dpl_example',
                name: 'example-saas',
                url: this.deploymentUrl,
                projectId: 'prj_example',
                readyState: state,
                target: 'production',
                created: fixedNow - 10_000,
                ready: state === 'READY' ? fixedNow - 5_000 : undefined,
                meta: { githubCommitSha: this.deploymentCommitSha },
              },
            ]
          : [],
      });
    }
    if (url.hostname === 'example-saas-abc.vercel.app' && url.pathname === '/') {
      if (this.protected && headers.get('x-vercel-protection-bypass') !== bypassSecret) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: 'https://vercel.com/sso-api?url=https%3A%2F%2Fexample-saas-abc.vercel.app%2F',
          },
        });
      }
      return new Response(this.smokeBody, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    throw new Error(`Unexpected delivery request: ${url.toString()}`);
  };
}

async function createPublishedProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-delivery-test-'));
  temporaryRoots.push(root);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  const manifest = parseBuildManifest(canonicalManifest);
  const provisioningPlan = createProvisioningPlan(manifest, context);
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
  const provisioningState = provisioningApplyStateSchema.parse({
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: provisioningPlanDigest(provisioningPlan),
    plan: provisioningPlan,
    actions: provisioningPlan.actions.map((action) => ({
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
    serializeCanonicalJson(provisioningState),
    'utf8',
  );
  await writeFile(join(root, 'bun.lock'), 'lockfileVersion = 1\n', 'utf8');
  await writeFile(join(root, 'README.md'), '# example-saas\n', 'utf8');

  const sourcePlan = await createSourcePublicationPlan(root, context);
  const sourceState = sourcePublicationStateSchema.parse({
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: sha256(serializeCanonicalJson(sourcePlan)),
    plan: sourcePlan,
    attempts: 1,
    commit_sha: commitSha,
    error: null,
  });
  await writeFile(
    join(root, '.void-starter/source-state.json'),
    serializeCanonicalJson(sourceState),
    'utf8',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('delivery observation', () => {
  it('builds a stable plan bound to the exact published commit and Vercel resource', async () => {
    const root = await createPublishedProject();
    const plan = await createDeliveryPlan(root, context);

    expect(plan).toMatchObject({
      source: { commit_sha: commitSha },
      deployment: {
        provider: 'vercel',
        team_id: 'team_example',
        project_id: 'prj_example',
        project_name: 'example-saas',
        target: 'production',
      },
      smoke: {
        path: '/',
        expected_status: 200,
        expected_body_contains: 'example-saas',
      },
    });
    expect(deliveryPlanDigest(plan)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preflights through authenticated Vercel reads without writing state', async () => {
    const root = await createPublishedProject();
    const api = new MockVercelDeliveryApi();
    const result = await preflightDelivery({
      projectRoot: root,
      context,
      environment: { VERCEL_TOKEN: vercelToken },
      options: { fetch: api.fetch },
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'delivery-live-preflight',
      source_commit_sha: commitSha,
      deployment: 'ready',
      deployment_id: 'dpl_example',
      ready_state: 'READY',
      bypass: 'absent',
    });
    expect(api.requests).toHaveLength(3);
    expect(api.requests.every((request) => request.authorization === `Bearer ${vercelToken}`)).toBe(
      true,
    );
    expect(await readDeliveryState(root)).toBeNull();
  });

  it('observes and smokes once, stores no credential, and makes resume a no-op', async () => {
    const root = await createPublishedProject();
    const api = new MockVercelDeliveryApi();
    api.readyAfterLookups = 1;
    const options = {
      fetch: api.fetch,
      now: () => fixedNow,
      sleep: async () => {},
      pollIntervalMs: 1,
    };

    const state = await observeDelivery({
      projectRoot: root,
      context,
      environment: { VERCEL_TOKEN: vercelToken },
      options,
    });
    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      observation: {
        deployment_id: 'dpl_example',
        source_commit_sha: commitSha,
        ready_state: 'READY',
        smoke: {
          status: 200,
          bypass_used: false,
        },
      },
    });
    const persisted = await readFile(join(root, '.void-starter/delivery-state.json'), 'utf8');
    expect(persisted).not.toContain(vercelToken);
    expect(persisted).not.toContain(bypassSecret);
    const smokeRequest = api.requests.find(
      (request) => request.url.hostname === 'example-saas-abc.vercel.app',
    );
    expect(smokeRequest).toMatchObject({
      authorization: null,
      bypass: null,
      redirect: 'manual',
    });

    const requestCount = api.requests.length;
    const resumed = await observeDelivery({
      projectRoot: root,
      context,
      environment: { VERCEL_TOKEN: vercelToken },
      requireExistingState: true,
      options,
    });
    expect(resumed).toEqual(state);
    expect(api.requests).toHaveLength(requestCount);
    const sourceState = await readSourcePublicationState(root);
    expect(sourceState).not.toBeNull();
    if (!sourceState) throw new Error('Expected source state');
    await expect(
      validateDeliveryState(state, state.plan.manifest_sha256, sourceState),
    ).resolves.toBeUndefined();
  });

  it('fails safely on Vercel SSO, then resumes with a memory-only bypass secret', async () => {
    const root = await createPublishedProject();
    const api = new MockVercelDeliveryApi();
    api.protected = true;
    const options = { fetch: api.fetch, now: () => fixedNow };

    await expect(
      observeDelivery({
        projectRoot: root,
        context,
        environment: { VERCEL_TOKEN: vercelToken },
        options,
      }),
    ).rejects.toMatchObject<Partial<DeliveryApplyError>>({
      code: 'VERCEL_PROTECTION_BYPASS_REQUIRED',
    });
    expect(await readDeliveryState(root)).toMatchObject({
      status: 'failed',
      attempts: 1,
      observation: { deployment_id: 'dpl_example', smoke: null },
      error: { code: 'VERCEL_PROTECTION_BYPASS_REQUIRED', retryable: true },
    });

    const succeeded = await observeDelivery({
      projectRoot: root,
      context,
      environment: {
        VERCEL_TOKEN: vercelToken,
        VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret,
      },
      requireExistingState: true,
      options,
    });
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      observation: { smoke: { bypass_used: true } },
      error: null,
    });
    const persisted = await readFile(join(root, '.void-starter/delivery-state.json'), 'utf8');
    expect(persisted).not.toContain(vercelToken);
    expect(persisted).not.toContain(bypassSecret);
    expect(api.requests.at(-1)?.bypass).toBe(bypassSecret);
  });

  it('never adopts a deployment from a different commit', async () => {
    const root = await createPublishedProject();
    const api = new MockVercelDeliveryApi();
    api.deploymentCommitSha = 'c'.repeat(40);

    await expect(
      observeDelivery({
        projectRoot: root,
        context,
        environment: { VERCEL_TOKEN: vercelToken },
        options: {
          fetch: api.fetch,
          now: () => fixedNow,
          observationTimeoutMs: 0,
        },
      }),
    ).rejects.toMatchObject<Partial<DeliveryApplyError>>({
      code: 'VERCEL_DEPLOYMENT_NOT_FOUND',
    });
    expect(api.requests.some((request) => request.url.hostname !== 'api.vercel.com')).toBe(false);
  });

  it('refuses to smoke a non-Vercel deployment URL', async () => {
    const root = await createPublishedProject();
    const api = new MockVercelDeliveryApi();
    api.deploymentUrl = 'attacker.example';

    await expect(
      observeDelivery({
        projectRoot: root,
        context,
        environment: { VERCEL_TOKEN: vercelToken },
        options: { fetch: api.fetch, now: () => fixedNow },
      }),
    ).rejects.toMatchObject<Partial<DeliveryApplyError>>({
      code: 'VERCEL_INVALID_DEPLOYMENT_URL',
    });
    expect(api.requests.some((request) => request.url.hostname === 'attacker.example')).toBe(false);
  });
});
