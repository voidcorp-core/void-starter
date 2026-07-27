import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { authProductionUsage, runAuthProductionApplyCli } from './auth-production.cli';
import {
  type AuthProductionApplyError,
  applyAuthProduction,
  authProductionPlanDigest,
  createAuthProductionPlan,
  parseAuthProductionContext,
  preflightAuthProduction,
  readAuthProductionState,
  senderDomain,
  validateAuthProductionState,
} from './auth-production.service';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import { createMigrationPlan, migrationPlanDigest } from './migration.service';
import { migrationStateSchema } from './migration.types';
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
const commitSha = 'a'.repeat(40);
const fixedNow = 1_760_000_000_000;
const secrets = {
  VERCEL_TOKEN: 'vercel-secret-value',
  BETTER_AUTH_SECRET: 'better-auth-secret-value-that-is-long-enough',
  RESEND_API_KEY: 're_resend-secret-value',
};

const providerContext: ProvisioningContext = {
  schema_version: 1,
  github: { owner: 'voidcorp-core', owner_kind: 'organization', visibility: 'private' },
  vercel: { team_id: 'team_example', region: 'fra1' },
  neon: { org_id: 'org-example', region_id: 'aws-eu-central-1' },
  cloudflare: { account_id: '0123456789abcdef0123456789abcdef' },
};

const authContext = parseAuthProductionContext({
  schema_version: 1,
  canonical_url: 'https://example-saas.example.com',
  email: {
    from: 'Example SaaS <auth@mail.example.com>',
    reply_to: 'support@example.com',
  },
  bootstrap: { administrator_email: 'Owner@Example.com' },
});

const migrations = [
  {
    idx: 0,
    when: 1_750_000_000_000,
    tag: '0000_initial_schema',
    sql: 'CREATE TABLE users (id text PRIMARY KEY);\n',
  },
] as const;

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

class MockAuthProviders {
  environment: Array<{
    id: string;
    key: string;
    value?: string;
    type: 'plain' | 'encrypted' | 'sensitive';
    target: string[];
  }> = [];
  vercelCreates = 0;
  resendSends = 0;
  failNextResend = false;
  readonly requests: Array<{
    url: URL;
    method: string;
    authorization: string | null;
    body: string;
  }> = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? '');
    this.requests.push({ url, method, authorization: headers.get('authorization'), body });

    if (url.hostname === 'api.vercel.com' && url.pathname === '/v2/teams/team_example') {
      return jsonResponse({ id: 'team_example' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/prj_example') {
      return jsonResponse({ id: 'prj_example', name: 'example-saas' });
    }
    if (url.hostname === 'api.vercel.com' && url.pathname === '/v9/projects/prj_example/env') {
      return jsonResponse({ envs: this.environment });
    }
    if (
      url.hostname === 'api.vercel.com' &&
      url.pathname === '/v10/projects/prj_example/env' &&
      method === 'POST'
    ) {
      this.vercelCreates += 1;
      const variables = JSON.parse(body) as Array<{
        key: string;
        value: string;
        type: 'plain' | 'encrypted' | 'sensitive';
        target: string[];
      }>;
      this.environment = variables.map((variable, index) => ({
        id: `env_${index}`,
        key: variable.key,
        ...(variable.type === 'sensitive' ? {} : { value: variable.value }),
        type: variable.type,
        target: variable.target,
      }));
      return jsonResponse({ created: this.environment.length }, 201);
    }
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails' && method === 'POST') {
      this.resendSends += 1;
      if (this.failNextResend) {
        this.failNextResend = false;
        return jsonResponse({ message: 'temporary' }, 500);
      }
      return jsonResponse({ id: 'email_example' });
    }
    throw new Error(`Unexpected auth provider request: ${method} ${url.toString()}`);
  };
}

async function createReadyProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-auth-production-test-'));
  temporaryRoots.push(root);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  await mkdir(join(root, 'packages/db/migrations/meta'), { recursive: true });
  const manifest = parseBuildManifest(canonicalManifest);
  const provisioningPlan = createProvisioningPlan(manifest, providerContext);
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
        resource_id: 'env_database',
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
  for (const migration of migrations) {
    await writeFile(
      join(root, `packages/db/migrations/${migration.tag}.sql`),
      migration.sql,
      'utf8',
    );
  }
  await writeFile(
    join(root, 'packages/db/migrations/meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: migrations.map((migration) => ({
        idx: migration.idx,
        version: '7',
        when: migration.when,
        tag: migration.tag,
        breakpoints: true,
      })),
    }),
    'utf8',
  );

  const sourcePlan = await createSourcePublicationPlan(root, providerContext);
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

  const migrationPlan = await createMigrationPlan(root, providerContext);
  const latest = migrationPlan.migrations.entries.at(-1);
  if (!latest) throw new Error('Expected migration');
  const migrationState = migrationStateSchema.parse({
    schema_version: 1,
    mode: 'live',
    status: 'succeeded',
    plan_sha256: migrationPlanDigest(migrationPlan),
    plan: migrationPlan,
    attempts: 1,
    observation: {
      database_project_id: migrationPlan.database.project_id,
      database_name: migrationPlan.database.database_name,
      migration_schema: 'drizzle',
      migration_table: '__drizzle_migrations',
      applied_before: 0,
      applied_during_attempt: migrationPlan.migrations.entries.length,
      applied_migrations: migrationPlan.migrations.entries.length,
      latest_migration_tag: latest.tag,
      latest_migration_sha256: latest.sha256,
      latest_migration_created_at: latest.created_at,
      verified_at: new Date(fixedNow).toISOString(),
    },
    error: null,
  });
  await writeFile(
    join(root, '.void-starter/migration-state.json'),
    serializeCanonicalJson(migrationState),
    'utf8',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('production authentication configuration', () => {
  it('requires complete arguments and exact project confirmation before mutation', async () => {
    await expect(
      runAuthProductionApplyCli({
        arguments: [],
        environment: secrets,
        requireExistingState: false,
      }),
    ).rejects.toThrow(authProductionUsage);

    const root = await createReadyProject();
    const contextsRoot = await mkdtemp(join(tmpdir(), 'void-starter-auth-context-test-'));
    temporaryRoots.push(contextsRoot);
    const providerContextPath = join(contextsRoot, 'provider-context.json');
    const authContextPath = join(contextsRoot, 'auth-context.json');
    await writeFile(providerContextPath, JSON.stringify(providerContext), 'utf8');
    await writeFile(authContextPath, JSON.stringify(authContext), 'utf8');

    await expect(
      runAuthProductionApplyCli({
        arguments: [
          root,
          providerContextPath,
          authContextPath,
          '--confirm-project',
          'wrong-project',
        ],
        environment: secrets,
        requireExistingState: false,
      }),
    ).rejects.toThrow(/exactly match/);
    expect(await readAuthProductionState(root)).toBeNull();
  });

  it('builds a secret-free plan bound to source, Vercel, sender and exact administrator', async () => {
    const root = await createReadyProject();
    const plan = await createAuthProductionPlan(root, providerContext, authContext);

    expect(plan).toMatchObject({
      source: { commit_sha: commitSha },
      application: {
        project_id: 'prj_example',
        canonical_url: 'https://example-saas.example.com',
      },
      email: { sender_domain: 'mail.example.com' },
      bootstrap: {
        administrator_email: 'owner@example.com',
        strategy: 'exact-email-on-user-create',
      },
    });
    expect(authProductionPlanDigest(plan)).toMatch(/^[a-f0-9]{64}$/);
    const serialized = serializeCanonicalJson(plan);
    expect(serialized).not.toContain(secrets.BETTER_AUTH_SECRET);
    expect(serialized).not.toContain(secrets.RESEND_API_KEY);
    expect(senderDomain('Example <hello@example.com>')).toBe('example.com');
  });

  it('preflights with Vercel reads only and writes no state', async () => {
    const root = await createReadyProject();
    const providers = new MockAuthProviders();
    const result = await preflightAuthProduction({
      projectRoot: root,
      providerContext,
      authContext,
      environment: secrets,
      options: { fetch: providers.fetch },
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'auth-production-live-preflight',
      bindings: 'absent',
      sender_domain: 'mail.example.com',
      bootstrap_administrator: 'owner@example.com',
    });
    expect(providers.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(providers.requests.every((request) => request.url.hostname === 'api.vercel.com')).toBe(
      true,
    );
    expect(await readAuthProductionState(root)).toBeNull();
  });

  it('binds once, sends an email smoke, persists no secrets and makes resume a no-op', async () => {
    const root = await createReadyProject();
    const providers = new MockAuthProviders();
    const state = await applyAuthProduction({
      projectRoot: root,
      providerContext,
      authContext,
      environment: secrets,
      options: { fetch: providers.fetch, now: () => fixedNow },
    });

    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      observation: {
        email_id: 'email_example',
        administrator_email: 'owner@example.com',
        requires_redeployment: true,
      },
    });
    expect(providers.vercelCreates).toBe(1);
    expect(providers.resendSends).toBe(1);
    const receiptPath = join(root, '.void-starter/auth-state.json');
    const persisted = await readFile(receiptPath, 'utf8');
    expect(persisted).not.toContain(secrets.VERCEL_TOKEN);
    expect(persisted).not.toContain(secrets.BETTER_AUTH_SECRET);
    expect(persisted).not.toContain(secrets.RESEND_API_KEY);
    expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);

    const resumed = await applyAuthProduction({
      projectRoot: root,
      providerContext,
      authContext,
      environment: secrets,
      requireExistingState: true,
      options: { fetch: providers.fetch, now: () => fixedNow },
    });
    expect(resumed).toEqual(state);
    expect(providers.vercelCreates).toBe(1);
    expect(providers.resendSends).toBe(1);
    const sourceState = await readSourcePublicationState(root);
    if (!sourceState) throw new Error('Expected source state');
    await expect(
      validateAuthProductionState(state, state.plan.manifest_sha256, sourceState),
    ).resolves.toBeUndefined();
  });

  it('resumes after a Resend failure without recreating Vercel variables', async () => {
    const root = await createReadyProject();
    const providers = new MockAuthProviders();
    providers.failNextResend = true;

    await expect(
      applyAuthProduction({
        projectRoot: root,
        providerContext,
        authContext,
        environment: secrets,
        options: { fetch: providers.fetch, now: () => fixedNow },
      }),
    ).rejects.toMatchObject<Partial<AuthProductionApplyError>>({ code: 'RESEND_HTTP_500' });
    expect(await readAuthProductionState(root)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { code: 'RESEND_HTTP_500', retryable: true },
    });

    const resumed = await applyAuthProduction({
      projectRoot: root,
      providerContext,
      authContext,
      environment: secrets,
      requireExistingState: true,
      options: { fetch: providers.fetch, now: () => fixedNow },
    });
    expect(resumed).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(providers.vercelCreates).toBe(1);
    expect(providers.resendSends).toBe(2);
  });

  it('fails closed when any managed Vercel variable is unowned', async () => {
    const root = await createReadyProject();
    const providers = new MockAuthProviders();
    providers.environment = [
      {
        id: 'env_foreign',
        key: 'BETTER_AUTH_URL',
        value: 'https://foreign.example',
        type: 'encrypted',
        target: ['production'],
      },
    ];

    await expect(
      preflightAuthProduction({
        projectRoot: root,
        providerContext,
        authContext,
        environment: secrets,
        options: { fetch: providers.fetch },
      }),
    ).rejects.toMatchObject({ code: 'VERCEL_AUTH_BINDING_CONFLICT' });
    expect(providers.vercelCreates).toBe(0);
    expect(providers.resendSends).toBe(0);
  });
});
