import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  applyMigration,
  createMigrationPlan,
  type MigrationApplyError,
  type MigrationDatabase,
  type MigrationDatabaseInspection,
  MigrationError,
  migrationPlanDigest,
  preflightMigration,
  readMigrationState,
  validateMigrationState,
} from './migration.service';
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
const neonApiKey = 'neon-api-secret-value';
const databasePassword = 'database-password-secret-value';
const commitSha = 'a'.repeat(40);
const fixedNow = 1_760_000_000_000;

const migrationSources = [
  {
    idx: 0,
    when: 1_750_000_000_000,
    tag: '0000_initial_schema',
    sql: 'CREATE TABLE users (id text PRIMARY KEY);\n',
  },
  {
    idx: 1,
    when: 1_750_000_010_000,
    tag: '0001_add_email',
    sql: 'ALTER TABLE users ADD COLUMN email text;\n',
  },
] as const;

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
};

type RecordedRequest = {
  url: URL;
  authorization: string | null;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class MockNeonMigrationApi {
  connectionUri = `postgresql://neondb_owner:${databasePassword}@ep-example.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
  readonly requests: RecordedRequest[] = [];

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    this.requests.push({
      url,
      authorization: headers.get('authorization'),
    });
    if (url.pathname === '/api/v2/projects') {
      return jsonResponse({
        projects: [
          {
            id: 'neon-example',
            name: 'example-saas',
            region_id: 'aws-eu-central-1',
          },
        ],
      });
    }
    if (url.pathname === '/api/v2/projects/neon-example/connection_uri') {
      return jsonResponse({ uri: this.connectionUri });
    }
    throw new Error(`Unexpected Neon migration request: ${url.toString()}`);
  };
}

class MockMigrationDatabase implements MigrationDatabase {
  history: MigrationDatabaseInspection['history'] = [];
  expectedHistory: MigrationDatabaseInspection['history'] = [];
  applyCalls = 0;
  closeCalls = 0;
  failNextApply = false;

  async inspect(): Promise<MigrationDatabaseInspection> {
    return { history: this.history.map((entry) => ({ ...entry })) };
  }

  async apply(): Promise<void> {
    this.applyCalls += 1;
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new MigrationError({
        code: 'DATABASE_MIGRATION_UNCONFIRMED',
        message: 'Mock migration transport failed',
        retryable: true,
      });
    }
    this.history = this.expectedHistory.map((entry) => ({ ...entry }));
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

async function createPublishedProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-starter-migration-test-'));
  temporaryRoots.push(root);
  await mkdir(join(root, '.void-starter'), { recursive: true });
  await mkdir(join(root, 'packages/db/migrations/meta'), { recursive: true });
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
  for (const migration of migrationSources) {
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
      entries: migrationSources.map((migration) => ({
        idx: migration.idx,
        version: '7',
        when: migration.when,
        tag: migration.tag,
        breakpoints: true,
      })),
    }),
    'utf8',
  );

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

function expectedHistoryFromPlan(
  plan: Awaited<ReturnType<typeof createMigrationPlan>>,
): MigrationDatabaseInspection['history'] {
  return plan.migrations.entries.map((entry) => ({
    sha256: entry.sha256,
    createdAt: entry.created_at,
  }));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('database migration', () => {
  it('builds a stable plan bound to source, Neon identity, and exact SQL history', async () => {
    const root = await createPublishedProject();
    const plan = await createMigrationPlan(root, context);

    expect(plan).toMatchObject({
      source: { commit_sha: commitSha },
      database: {
        provider: 'neon',
        org_id: 'org-example',
        project_id: 'neon-example',
        project_name: 'example-saas',
        database_name: 'neondb',
        role_name: 'neondb_owner',
      },
      migrations: {
        directory: 'packages/db/migrations',
        schema: 'drizzle',
        table: '__drizzle_migrations',
        entries: [
          { index: 0, tag: '0000_initial_schema' },
          { index: 1, tag: '0001_add_email' },
        ],
      },
    });
    expect(migrationPlanDigest(plan)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preflights through read-only Neon and database inspection without state', async () => {
    const root = await createPublishedProject();
    const api = new MockNeonMigrationApi();
    const database = new MockMigrationDatabase();
    const uris: string[] = [];
    const result = await preflightMigration({
      projectRoot: root,
      context,
      environment: { NEON_API_KEY: neonApiKey },
      options: {
        fetch: api.fetch,
        databaseFactory: (uri) => {
          uris.push(uri);
          return database;
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'migration-live-preflight',
      source_commit_sha: commitSha,
      database_project_id: 'neon-example',
      status: 'pending',
      applied_migrations: 0,
      pending_migrations: 2,
    });
    expect(api.requests).toHaveLength(2);
    expect(api.requests.every((request) => request.authorization === `Bearer ${neonApiKey}`)).toBe(
      true,
    );
    expect(api.requests[0]?.url.searchParams.get('org_id')).toBe('org-example');
    expect(api.requests[0]?.url.searchParams.get('search')).toBe('neon-example');
    expect(api.requests[1]?.url.searchParams.get('database_name')).toBe('neondb');
    expect(api.requests[1]?.url.searchParams.get('role_name')).toBe('neondb_owner');
    expect(api.requests[1]?.url.searchParams.get('pooled')).toBe('false');
    expect(uris).toEqual([api.connectionUri]);
    expect(database.applyCalls).toBe(0);
    expect(database.closeCalls).toBe(1);
    expect(await readMigrationState(root)).toBeNull();
  });

  it('applies exact pending history, stores no credential, and makes resume a no-op', async () => {
    const root = await createPublishedProject();
    const plan = await createMigrationPlan(root, context);
    const api = new MockNeonMigrationApi();
    const database = new MockMigrationDatabase();
    database.expectedHistory = expectedHistoryFromPlan(plan);
    let databaseFactoryCalls = 0;
    const options = {
      fetch: api.fetch,
      now: () => fixedNow,
      databaseFactory: (uri: string) => {
        expect(uri).toBe(api.connectionUri);
        databaseFactoryCalls += 1;
        return database;
      },
    };

    const state = await applyMigration({
      projectRoot: root,
      context,
      environment: { NEON_API_KEY: neonApiKey },
      options,
    });
    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      observation: {
        database_project_id: 'neon-example',
        applied_before: 0,
        applied_during_attempt: 2,
        applied_migrations: 2,
        latest_migration_tag: '0001_add_email',
      },
    });
    expect(database.applyCalls).toBe(1);
    const persisted = await readFile(join(root, '.void-starter/migration-state.json'), 'utf8');
    expect(persisted).not.toContain(neonApiKey);
    expect(persisted).not.toContain(databasePassword);
    expect(persisted).not.toContain(api.connectionUri);

    const requestCount = api.requests.length;
    const resumed = await applyMigration({
      projectRoot: root,
      context,
      environment: { NEON_API_KEY: neonApiKey },
      requireExistingState: true,
      options,
    });
    expect(resumed).toEqual(state);
    expect(api.requests).toHaveLength(requestCount);
    expect(databaseFactoryCalls).toBe(1);
    const sourceState = await readSourcePublicationState(root);
    expect(sourceState).not.toBeNull();
    if (!sourceState) throw new Error('Expected source state');
    await expect(
      validateMigrationState(state, state.plan.manifest_sha256, sourceState),
    ).resolves.toBeUndefined();
  });

  it('adopts already-current exact migration history without executing SQL', async () => {
    const root = await createPublishedProject();
    const plan = await createMigrationPlan(root, context);
    const api = new MockNeonMigrationApi();
    const database = new MockMigrationDatabase();
    database.history = expectedHistoryFromPlan(plan);

    const state = await applyMigration({
      projectRoot: root,
      context,
      environment: { NEON_API_KEY: neonApiKey },
      options: { fetch: api.fetch, databaseFactory: () => database, now: () => fixedNow },
    });
    expect(state).toMatchObject({
      status: 'succeeded',
      observation: {
        applied_before: 2,
        applied_during_attempt: 0,
        applied_migrations: 2,
      },
    });
    expect(database.applyCalls).toBe(0);
  });

  it('fails closed when remote migration history diverges from source', async () => {
    const root = await createPublishedProject();
    const api = new MockNeonMigrationApi();
    const database = new MockMigrationDatabase();
    database.history = [{ sha256: 'c'.repeat(64), createdAt: migrationSources[0].when }];

    await expect(
      applyMigration({
        projectRoot: root,
        context,
        environment: { NEON_API_KEY: neonApiKey },
        options: { fetch: api.fetch, databaseFactory: () => database },
      }),
    ).rejects.toMatchObject<Partial<MigrationApplyError>>({
      code: 'DATABASE_MIGRATION_HISTORY_CONFLICT',
    });
    expect(database.applyCalls).toBe(0);
    expect(await readMigrationState(root)).toMatchObject({
      status: 'failed',
      attempts: 1,
      observation: null,
      error: { code: 'DATABASE_MIGRATION_HISTORY_CONFLICT', retryable: false },
    });
  });

  it('resumes safely after an unconfirmed transactional migration attempt', async () => {
    const root = await createPublishedProject();
    const plan = await createMigrationPlan(root, context);
    const api = new MockNeonMigrationApi();
    const database = new MockMigrationDatabase();
    database.expectedHistory = expectedHistoryFromPlan(plan);
    database.failNextApply = true;
    const options = { fetch: api.fetch, databaseFactory: () => database, now: () => fixedNow };

    await expect(
      applyMigration({
        projectRoot: root,
        context,
        environment: { NEON_API_KEY: neonApiKey },
        options,
      }),
    ).rejects.toMatchObject<Partial<MigrationApplyError>>({
      code: 'DATABASE_MIGRATION_UNCONFIRMED',
    });
    const succeeded = await applyMigration({
      projectRoot: root,
      context,
      environment: { NEON_API_KEY: neonApiKey },
      requireExistingState: true,
      options,
    });
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      observation: { applied_migrations: 2 },
      error: null,
    });
    expect(database.applyCalls).toBe(2);
  });

  it('refuses a connection URI outside the exact Neon database boundary', async () => {
    const root = await createPublishedProject();
    const api = new MockNeonMigrationApi();
    api.connectionUri = `postgresql://neondb_owner:${databasePassword}@attacker.example/neondb`;
    let databaseFactoryCalled = false;

    await expect(
      applyMigration({
        projectRoot: root,
        context,
        environment: { NEON_API_KEY: neonApiKey },
        options: {
          fetch: api.fetch,
          databaseFactory: () => {
            databaseFactoryCalled = true;
            return new MockMigrationDatabase();
          },
        },
      }),
    ).rejects.toMatchObject<Partial<MigrationApplyError>>({
      code: 'NEON_CONNECTION_URI_INVALID',
    });
    expect(databaseFactoryCalled).toBe(false);
    expect(await readMigrationState(root)).toMatchObject({
      status: 'failed',
      error: { code: 'NEON_CONNECTION_URI_INVALID' },
    });
  });
});
