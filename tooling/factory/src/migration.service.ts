import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type MigrationEntry,
  type MigrationObservation,
  type MigrationPlan,
  type MigrationState,
  migrationPlanSchema,
  migrationStateSchema,
} from './migration.types';
import type { ProvisioningContext } from './provisioning.types';
import { readProvisioningState, validateProvisioningState } from './provisioning-apply.service';
import {
  readSourcePublicationState,
  validateSourcePublicationState,
} from './source-publication.service';

const NEON_API = 'https://console.neon.tech/api/v2';
const METADATA_DIRECTORY = '.void-starter';
const MIGRATION_STATE_FILE = 'migration-state.json';
const MIGRATION_LOCK_FILE = 'migration.lock';
const MIGRATIONS_DIRECTORY = 'packages/db/migrations';
const MIGRATION_SCHEMA = 'drizzle';
const MIGRATION_TABLE = '__drizzle_migrations';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type MigrationHistoryEntry = {
  sha256: string;
  createdAt: number;
};

export type MigrationDatabaseInspection = {
  history: MigrationHistoryEntry[];
};

export type MigrationDatabase = {
  inspect(): Promise<MigrationDatabaseInspection>;
  apply(migrationsDirectory: string, lockKey: string): Promise<void>;
  close(): Promise<void>;
};

export type MigrationOptions = {
  fetch?: FetchLike;
  databaseFactory?: (connectionUri: string) => MigrationDatabase;
  now?: () => number;
  requestTimeoutMs?: number;
  databaseTimeoutMs?: number;
};

type MigrationLockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

const journalSchema = z.strictObject({
  version: z.literal('7'),
  dialect: z.literal('postgresql'),
  entries: z
    .array(
      z.strictObject({
        idx: z.number().int().nonnegative(),
        version: z.literal('7'),
        when: z.number().int().nonnegative(),
        tag: z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/),
        breakpoints: z.boolean(),
      }),
    )
    .min(1),
});

const neonProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region_id: z.string().min(1),
});

const neonProjectsSchema = z.object({
  projects: z.array(neonProjectSchema),
});

const neonConnectionUriSchema = z
  .union([z.object({ uri: z.string().url() }), z.object({ connection_uri: z.string().url() })])
  .transform((value) => ('uri' in value ? value.uri : value.connection_uri));

export class MigrationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'MigrationError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export class MigrationApplyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Database migration failed with code ${code}`);
    this.name = 'MigrationApplyError';
    this.code = code;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function requiredNeonApiKey(environment: Record<string, string | undefined>): string {
  const key = environment['NEON_API_KEY']?.trim();
  if (!key) {
    throw new Error('Live database migration requires NEON_API_KEY');
  }
  return key;
}

function migrationStatePath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, MIGRATION_STATE_FILE);
}

function migrationLockPath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, MIGRATION_LOCK_FILE);
}

export function migrationPlanDigest(plan: MigrationPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

async function writeMigrationStateAtomic(
  projectRoot: string,
  state: MigrationState,
): Promise<void> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  const temporaryPath = join(
    metadataRoot,
    `.${MIGRATION_STATE_FILE}.${process.pid}.${randomUUID()}.temporary`,
  );
  await mkdir(metadataRoot, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeCanonicalJson(state), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, migrationStatePath(projectRoot));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

async function recoverStaleMigrationLock(projectRoot: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(
      await readFile(migrationLockPath(projectRoot), 'utf8'),
    ) as Partial<MigrationLockMetadata>;
    if (
      metadata.schema_version !== 1 ||
      typeof metadata.pid !== 'number' ||
      typeof metadata.owner_token !== 'string' ||
      processIsAlive(metadata.pid)
    ) {
      return false;
    }
    await rm(migrationLockPath(projectRoot));
    return true;
  } catch {
    return false;
  }
}

async function acquireMigrationLock(projectRoot: string): Promise<MigrationLockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const metadata: MigrationLockMetadata = {
    schema_version: 1,
    pid: process.pid,
    owner_token: randomUUID(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(migrationLockPath(projectRoot), serializeCanonicalJson(metadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return metadata;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await recoverStaleMigrationLock(projectRoot))) {
        continue;
      }
      throw new Error('Another database migration is active or left an unreadable lock');
    }
  }
  throw new Error('Unable to acquire the database migration lock');
}

async function releaseMigrationLock(
  projectRoot: string,
  lock: MigrationLockMetadata,
): Promise<void> {
  try {
    const current = JSON.parse(
      await readFile(migrationLockPath(projectRoot), 'utf8'),
    ) as MigrationLockMetadata;
    if (current.owner_token === lock.owner_token) {
      await rm(migrationLockPath(projectRoot));
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
  }
}

export async function readMigrationState(projectRoot: string): Promise<MigrationState | null> {
  try {
    return migrationStateSchema.parse(
      JSON.parse(await readFile(migrationStatePath(projectRoot), 'utf8')),
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

function assertMigrationStateMatchesPlan(state: MigrationState, plan: MigrationPlan): void {
  const digest = migrationPlanDigest(plan);
  if (state.plan_sha256 !== digest || migrationPlanDigest(state.plan) !== digest) {
    throw new Error('Existing migration state belongs to a different or modified plan');
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file without symbolic links`);
  }
}

async function collectMigrations(projectRoot: string): Promise<MigrationEntry[]> {
  const migrationsRoot = join(projectRoot, MIGRATIONS_DIRECTORY);
  const journalPath = join(migrationsRoot, 'meta/_journal.json');
  await assertRegularFile(journalPath, 'Drizzle migration journal');
  const journal = journalSchema.parse(JSON.parse(await readFile(journalPath, 'utf8')));
  const sqlFiles = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith('.sql'))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Drizzle migrations must be regular SQL files without symbolic links');
      }
      return entry.name;
    })
    .toSorted();
  const expectedFiles = journal.entries.map((entry) => `${entry.tag}.sql`).toSorted();
  if (serializeCanonicalJson(sqlFiles) !== serializeCanonicalJson(expectedFiles)) {
    throw new Error('Drizzle migration journal and SQL file set do not match exactly');
  }

  const entries: MigrationEntry[] = [];
  let previousCreatedAt = -1;
  for (const entry of journal.entries) {
    if (entry.idx !== entries.length || entry.when <= previousCreatedAt) {
      throw new Error('Drizzle migration journal must be sequential and strictly ordered');
    }
    const path = join(migrationsRoot, `${entry.tag}.sql`);
    await assertRegularFile(path, `Drizzle migration ${entry.tag}`);
    const content = await readFile(path);
    if (content.byteLength === 0) {
      throw new Error(`Drizzle migration ${entry.tag} is empty`);
    }
    entries.push({
      index: entry.idx,
      tag: entry.tag,
      created_at: entry.when,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
    previousCreatedAt = entry.when;
  }
  return entries;
}

export async function createMigrationPlan(
  projectRoot: string,
  context: ProvisioningContext,
): Promise<MigrationPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  if (manifest.data.database !== 'neon-eu' || manifest.data.orm !== 'drizzle') {
    throw new Error('Database migration requires the Neon and Drizzle capabilities');
  }
  if (!context.neon) {
    throw new Error('Database migration requires Neon context');
  }

  const manifestSha256 = sha256(serializeCanonicalJson(manifest));
  const contextSha256 = sha256(serializeCanonicalJson(context));
  const provisioningState = await readProvisioningState(projectRoot);
  if (provisioningState?.mode !== 'live' || provisioningState.status !== 'succeeded') {
    throw new Error('Database migration requires succeeded live provisioning state');
  }
  validateProvisioningState(provisioningState, manifestSha256);
  if (provisioningState.plan.context_sha256 !== contextSha256) {
    throw new Error('Migration context does not match live provisioning state');
  }

  const projectAction = provisioningState.plan.actions.find(
    (action) => action.id === 'neon.project',
  );
  const projectState = provisioningState.actions.find(
    (action) => action.action_id === 'neon.project',
  );
  if (
    !projectAction ||
    !projectState ||
    projectState.status !== 'succeeded' ||
    !projectState.resource ||
    projectState.resource.provider !== 'neon' ||
    projectState.resource.resource_kind !== 'project'
  ) {
    throw new Error('Database migration requires a succeeded Neon project resource');
  }
  if (
    projectAction.input.org_id !== context.neon.org_id ||
    projectAction.input.name !== manifest.project.name ||
    projectAction.input.region_id !== context.neon.region_id ||
    projectState.resource.display_name !== manifest.project.name
  ) {
    throw new Error('Migration context does not match provisioned Neon project');
  }

  const sourceState = await readSourcePublicationState(projectRoot);
  if (sourceState?.status !== 'succeeded' || !sourceState.commit_sha) {
    throw new Error('Database migration requires succeeded source publication state');
  }
  await validateSourcePublicationState(sourceState, manifestSha256, projectRoot);
  if (sourceState.plan.context_sha256 !== contextSha256) {
    throw new Error('Migration context does not match source publication state');
  }

  const entries = await collectMigrations(projectRoot);
  return migrationPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: manifestSha256,
    context_sha256: contextSha256,
    source: {
      commit_sha: sourceState.commit_sha,
      source_sha256: sourceState.plan.source.sha256,
    },
    database: {
      provider: 'neon',
      org_id: context.neon.org_id,
      project_id: projectState.resource.resource_id,
      project_name: manifest.project.name,
      region_id: context.neon.region_id,
      database_name: projectState.resource.database_name,
      role_name: projectState.resource.role_name,
    },
    migrations: {
      directory: MIGRATIONS_DIRECTORY,
      schema: MIGRATION_SCHEMA,
      table: MIGRATION_TABLE,
      sha256: sha256(serializeCanonicalJson(entries)),
      entries,
    },
    permissions: ['project:read', 'connection-uri:read', 'database:schema:write'],
  });
}

function withQuery(base: string, parameters: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function safeConnectionUri(value: string, plan: MigrationPlan): string {
  let url: URL;
  let username: string;
  let databaseName: string;
  try {
    url = new URL(value);
    username = decodeURIComponent(url.username);
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new MigrationError({
      code: 'NEON_CONNECTION_URI_INVALID',
      message: 'Neon returned an invalid database connection URI',
    });
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.neon.tech') ||
    username !== plan.database.role_name ||
    databaseName !== plan.database.database_name ||
    !url.password ||
    url.hash
  ) {
    throw new MigrationError({
      code: 'NEON_CONNECTION_URI_INVALID',
      message: 'Neon returned a connection URI outside the migration plan boundary',
    });
  }
  return value;
}

class NeonMigrationClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(apiKey: string, options: MigrationOptions) {
    this.#apiKey = apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  async #request(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
          'User-Agent': 'void-starter-factory',
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      throw new MigrationError({
        code: 'NEON_NETWORK_FAILURE',
        message: 'Neon migration request failed before a response was confirmed',
        retryable: true,
      });
    }
    if (response.status !== 200) {
      throw new MigrationError({
        code: `NEON_HTTP_${response.status}`,
        message: `Neon migration request returned HTTP ${response.status}`,
        retryable: response.status === 423 || response.status === 429 || response.status >= 500,
      });
    }
    return response;
  }

  async #json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw new MigrationError({
        code: 'NEON_INVALID_RESPONSE',
        message: 'Neon returned an invalid migration response',
      });
    }
  }

  async preflight(plan: MigrationPlan): Promise<void> {
    const result = await this.#json(
      await this.#request(
        withQuery(`${NEON_API}/projects`, {
          org_id: plan.database.org_id,
          search: plan.database.project_id,
          limit: '100',
        }),
      ),
      neonProjectsSchema,
    );
    const projects = result.projects.filter((project) => project.id === plan.database.project_id);
    const project = projects[0];
    if (
      projects.length !== 1 ||
      !project ||
      project.name !== plan.database.project_name ||
      project.region_id !== plan.database.region_id
    ) {
      throw new MigrationError({
        code: 'NEON_PROJECT_MISMATCH',
        message: 'Authenticated Neon project does not match migration plan',
      });
    }
  }

  async connectionUri(plan: MigrationPlan): Promise<string> {
    const uri = await this.#json(
      await this.#request(
        withQuery(
          `${NEON_API}/projects/${encodeURIComponent(plan.database.project_id)}/connection_uri`,
          {
            database_name: plan.database.database_name,
            role_name: plan.database.role_name,
            pooled: 'false',
          },
        ),
      ),
      neonConnectionUriSchema,
    );
    return safeConnectionUri(uri, plan);
  }
}

function parseCreatedAt(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MigrationError({
      code: 'DATABASE_MIGRATION_HISTORY_INVALID',
      message: 'Database migration history contains an invalid timestamp',
    });
  }
  return parsed;
}

class PostgresMigrationDatabase implements MigrationDatabase {
  readonly #sql: ReturnType<typeof postgres>;

  constructor(connectionUri: string, timeoutMs: number) {
    this.#sql = postgres(connectionUri, {
      connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      idle_timeout: 5,
      max: 1,
      prepare: false,
      connection: {
        application_name: 'void-starter-factory',
        statement_timeout: timeoutMs,
        lock_timeout: timeoutMs,
        idle_in_transaction_session_timeout: timeoutMs,
      },
    });
  }

  async inspect(): Promise<MigrationDatabaseInspection> {
    try {
      const table = await this.#sql<{ migration_table: string | null }[]>`
        select to_regclass('drizzle.__drizzle_migrations')::text as migration_table
      `;
      if (!table[0]?.migration_table) {
        return { history: [] };
      }
      const rows = await this.#sql<{ hash: string; created_at: string | number | bigint }[]>`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at asc, id asc
      `;
      return {
        history: rows.map((row) => ({
          sha256: row.hash,
          createdAt: parseCreatedAt(row.created_at),
        })),
      };
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError({
        code: 'DATABASE_INSPECTION_FAILURE',
        message: 'Unable to inspect database migration history',
        retryable: true,
      });
    }
  }

  async apply(migrationsDirectory: string, lockKey: string): Promise<void> {
    let locked = false;
    try {
      await this.#sql`select pg_advisory_lock(hashtext(${lockKey}))`;
      locked = true;
      await migrate(drizzle(this.#sql), {
        migrationsFolder: migrationsDirectory,
        migrationsSchema: MIGRATION_SCHEMA,
        migrationsTable: MIGRATION_TABLE,
      });
    } catch {
      throw new MigrationError({
        code: 'DATABASE_MIGRATION_UNCONFIRMED',
        message: 'Database migration did not return a confirmed success',
        retryable: true,
      });
    } finally {
      if (locked) {
        try {
          await this.#sql`select pg_advisory_unlock(hashtext(${lockKey}))`;
        } catch {
          // Session locks are also released when the connection closes.
        }
      }
    }
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}

function validateHistory(
  inspection: MigrationDatabaseInspection,
  plan: MigrationPlan,
): { applied: number; pending: number } {
  if (inspection.history.length > plan.migrations.entries.length) {
    throw new MigrationError({
      code: 'DATABASE_MIGRATION_HISTORY_CONFLICT',
      message: 'Database contains migrations outside the exact source plan',
    });
  }
  for (const [index, history] of inspection.history.entries()) {
    const expected = plan.migrations.entries[index];
    if (
      !expected ||
      history.sha256 !== expected.sha256 ||
      history.createdAt !== expected.created_at
    ) {
      throw new MigrationError({
        code: 'DATABASE_MIGRATION_HISTORY_CONFLICT',
        message: 'Database migration history diverges from the exact source plan',
      });
    }
  }
  return {
    applied: inspection.history.length,
    pending: plan.migrations.entries.length - inspection.history.length,
  };
}

function createDatabase(connectionUri: string, options: MigrationOptions): MigrationDatabase {
  return options.databaseFactory
    ? options.databaseFactory(connectionUri)
    : new PostgresMigrationDatabase(connectionUri, options.databaseTimeoutMs ?? 20_000);
}

async function withMigrationDatabase<T>(
  client: NeonMigrationClient,
  plan: MigrationPlan,
  options: MigrationOptions,
  operation: (database: MigrationDatabase) => Promise<T>,
): Promise<T> {
  const connectionUri = await client.connectionUri(plan);
  const database = createDatabase(connectionUri, options);
  try {
    return await operation(database);
  } finally {
    await database.close().catch(() => {});
  }
}

export async function preflightMigration(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  options?: MigrationOptions;
}): Promise<{
  ok: true;
  mode: 'migration-live-preflight';
  plan_sha256: string;
  source_commit_sha: string;
  database_project_id: string;
  status: 'pending' | 'current';
  applied_migrations: number;
  pending_migrations: number;
}> {
  const plan = await createMigrationPlan(input.projectRoot, input.context);
  const options = input.options ?? {};
  const client = new NeonMigrationClient(requiredNeonApiKey(input.environment), options);
  await client.preflight(plan);
  const progress = await withMigrationDatabase(client, plan, options, async (database) =>
    validateHistory(await database.inspect(), plan),
  );
  return {
    ok: true,
    mode: 'migration-live-preflight',
    plan_sha256: migrationPlanDigest(plan),
    source_commit_sha: plan.source.commit_sha,
    database_project_id: plan.database.project_id,
    status: progress.pending === 0 ? 'current' : 'pending',
    applied_migrations: progress.applied,
    pending_migrations: progress.pending,
  };
}

function safeMigrationError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof MigrationError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'DATABASE_MIGRATION_FAILURE',
      message: 'Database migration failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_DATABASE_MIGRATION_FAILURE',
    message: 'Database migration failed without a safe diagnostic',
    retryable: false,
  };
}

export async function applyMigration(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: MigrationOptions;
}): Promise<MigrationState> {
  const apiKey = requiredNeonApiKey(input.environment);
  const options = input.options ?? {};
  const lock = await acquireMigrationLock(input.projectRoot);
  try {
    const plan = await createMigrationPlan(input.projectRoot, input.context);
    const existingState = await readMigrationState(input.projectRoot);
    if (!existingState && input.requireExistingState) {
      throw new Error('No database migration state exists to resume');
    }
    const state: MigrationState =
      existingState ??
      migrationStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: migrationPlanDigest(plan),
        plan,
        attempts: 0,
        observation: null,
        error: null,
      });
    assertMigrationStateMatchesPlan(state, plan);
    if (state.status === 'succeeded') {
      return state;
    }

    const client = new NeonMigrationClient(apiKey, options);
    await client.preflight(plan);
    state.status = 'running';
    state.attempts += 1;
    state.observation = null;
    state.error = null;
    await writeMigrationStateAtomic(input.projectRoot, state);

    try {
      const observation = await withMigrationDatabase(
        client,
        plan,
        options,
        async (database): Promise<MigrationObservation> => {
          const before = validateHistory(await database.inspect(), plan);
          if (before.pending > 0) {
            await database.apply(
              join(input.projectRoot, plan.migrations.directory),
              `void-starter:migration:${plan.database.project_id}:${plan.database.database_name}`,
            );
          }
          const after = validateHistory(await database.inspect(), plan);
          if (after.pending !== 0) {
            throw new MigrationError({
              code: 'DATABASE_MIGRATION_INCOMPLETE',
              message: 'Database migration completed without the full planned history',
              retryable: true,
            });
          }
          const latest = plan.migrations.entries.at(-1);
          if (!latest) {
            throw new Error('Migration plan unexpectedly contains no entries');
          }
          return {
            database_project_id: plan.database.project_id,
            database_name: plan.database.database_name,
            migration_schema: plan.migrations.schema,
            migration_table: plan.migrations.table,
            applied_before: before.applied,
            applied_during_attempt: after.applied - before.applied,
            applied_migrations: after.applied,
            latest_migration_tag: latest.tag,
            latest_migration_sha256: latest.sha256,
            latest_migration_created_at: latest.created_at,
            verified_at: new Date((options.now ?? Date.now)()).toISOString(),
          };
        },
      );
      state.observation = observation;
      state.status = 'succeeded';
      await writeMigrationStateAtomic(input.projectRoot, state);
      return state;
    } catch (error) {
      const safeError = safeMigrationError(error);
      state.status = 'failed';
      state.error = safeError;
      await writeMigrationStateAtomic(input.projectRoot, state);
      throw new MigrationApplyError(safeError.code);
    }
  } finally {
    await releaseMigrationLock(input.projectRoot, lock);
  }
}

export async function validateMigrationState(
  state: MigrationState,
  expectedManifestSha256: string,
  sourceState: NonNullable<Awaited<ReturnType<typeof readSourcePublicationState>>>,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('Migration state manifest digest does not match generation metadata');
  }
  assertMigrationStateMatchesPlan(state, state.plan);
  if (
    state.plan.migrations.sha256 !== sha256(serializeCanonicalJson(state.plan.migrations.entries))
  ) {
    throw new Error('Migration state contains an inconsistent migration-set digest');
  }
  if (
    sourceState.status !== 'succeeded' ||
    !sourceState.commit_sha ||
    state.plan.source.commit_sha !== sourceState.commit_sha ||
    state.plan.source.source_sha256 !== sourceState.plan.source.sha256
  ) {
    throw new Error('Migration state source identity does not match source publication state');
  }
  if (state.status === 'succeeded') {
    const latest = state.plan.migrations.entries.at(-1);
    if (
      !latest ||
      !state.observation ||
      state.error ||
      state.observation.database_project_id !== state.plan.database.project_id ||
      state.observation.database_name !== state.plan.database.database_name ||
      state.observation.applied_migrations !== state.plan.migrations.entries.length ||
      state.observation.latest_migration_tag !== latest.tag ||
      state.observation.latest_migration_sha256 !== latest.sha256 ||
      state.observation.latest_migration_created_at !== latest.created_at
    ) {
      throw new Error('Succeeded migration state contains inconsistent evidence');
    }
  }
  if (state.status === 'failed' && !state.error) {
    throw new Error('Failed migration state is missing safe diagnostics');
  }
  if ((state.status === 'pending' || state.status === 'running') && state.error) {
    throw new Error('Incomplete migration state contains terminal diagnostics');
  }
}
