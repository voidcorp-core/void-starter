import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  type AuthProductionContext,
  type AuthProductionObservation,
  type AuthProductionPlan,
  type AuthProductionState,
  authProductionContextSchema,
  authProductionPlanSchema,
  authProductionStateSchema,
} from './auth-production.types';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import { readMigrationState, validateMigrationState } from './migration.service';
import type { ProvisioningContext } from './provisioning.types';
import { readProvisioningState, validateProvisioningState } from './provisioning-apply.service';
import {
  readSourcePublicationState,
  validateSourcePublicationState,
} from './source-publication.service';

const VERCEL_API = 'https://api.vercel.com';
const RESEND_API = 'https://api.resend.com';
const METADATA_DIRECTORY = '.void-starter';
const STATE_FILE = 'auth-state.json';
const LOCK_FILE = 'auth.lock';
const OWNERSHIP_MARKER = 'VOID_STARTER_AUTH_CONFIGURATION';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AuthProductionOptions = {
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
};

type AuthLockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

type AuthCredentials = {
  vercelToken: string;
  betterAuthSecret: string;
  resendApiKey: string;
};

type VercelEnvironmentVariable = {
  id: string;
  key: string;
  value?: string | undefined;
  type: 'plain' | 'encrypted' | 'sensitive';
  target: string[];
};

const vercelTeamSchema = z.object({ id: z.string().min(1) });
const vercelProjectSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const vercelEnvironmentVariablesSchema = z.object({
  envs: z.array(
    z.object({
      id: z.string().min(1),
      key: z.string().min(1),
      value: z.string().optional(),
      type: z.enum(['plain', 'encrypted', 'sensitive']),
      target: z.array(z.string()),
    }),
  ),
});
const resendSuccessSchema = z.object({ id: z.string().min(1) });

export class AuthProductionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'AuthProductionError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export class AuthProductionApplyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Production authentication configuration failed with code ${code}`);
    this.name = 'AuthProductionApplyError';
    this.code = code;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function statePath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, STATE_FILE);
}

function lockPath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, LOCK_FILE);
}

function exactTargets(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.toSorted().every((target, index) => target === expected.toSorted()[index])
  );
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function senderDomain(sender: string): string {
  const match = sender.trim().match(/^(?:[^<>\r\n]+<)?([^<>\s]+@[^<>\s]+)>?$/);
  const address = match?.[1];
  const domain = address?.split('@')[1]?.toLowerCase();
  if (!domain?.includes('.')) {
    throw new Error('Auth production sender must contain a valid email address');
  }
  return domain;
}

export function parseAuthProductionContext(input: unknown): AuthProductionContext {
  return authProductionContextSchema.parse(input);
}

export function parseAuthProductionContextSource(
  source: string,
  fileName: string,
): AuthProductionContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') {
    return parseAuthProductionContext(JSON.parse(source));
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseAuthProductionContext(parseYaml(source));
  }
  throw new Error(
    `Unsupported auth production context format: ${extension || 'missing extension'}`,
  );
}

export function authProductionPlanDigest(plan: AuthProductionPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

function credentials(environment: Record<string, string | undefined>): AuthCredentials {
  const vercelToken = environment['VERCEL_TOKEN']?.trim();
  const betterAuthSecret = environment['BETTER_AUTH_SECRET']?.trim();
  const resendApiKey = environment['RESEND_API_KEY']?.trim();
  if (!vercelToken) {
    throw new Error('Production authentication configuration requires VERCEL_TOKEN');
  }
  if (!betterAuthSecret || betterAuthSecret.length < 32) {
    throw new Error(
      'Production authentication configuration requires BETTER_AUTH_SECRET (32+ chars)',
    );
  }
  if (!resendApiKey?.startsWith('re_')) {
    throw new Error('Production authentication configuration requires RESEND_API_KEY');
  }
  return { vercelToken, betterAuthSecret, resendApiKey };
}

export async function createAuthProductionPlan(
  projectRoot: string,
  providerContext: ProvisioningContext,
  authContext: AuthProductionContext,
): Promise<AuthProductionPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  if (
    manifest.auth.provider !== 'better-auth' ||
    manifest.operations.email !== 'resend' ||
    manifest.surfaces.web !== 'next-vercel'
  ) {
    throw new Error('Production auth configuration requires Better Auth, Resend and Vercel web');
  }
  if (!providerContext.vercel) {
    throw new Error('Production auth configuration requires Vercel provider context');
  }

  const manifestSha256 = sha256(serializeCanonicalJson(manifest));
  const providerContextSha256 = sha256(serializeCanonicalJson(providerContext));
  const provisioningState = await readProvisioningState(projectRoot);
  if (provisioningState?.mode !== 'live' || provisioningState.status !== 'succeeded') {
    throw new Error('Production auth configuration requires succeeded live provisioning');
  }
  validateProvisioningState(provisioningState, manifestSha256);
  if (provisioningState.plan.context_sha256 !== providerContextSha256) {
    throw new Error('Production auth provider context does not match provisioning state');
  }

  const projectState = provisioningState.actions.find(
    (action) => action.action_id === 'vercel.project',
  );
  if (
    projectState?.resource?.provider !== 'vercel' ||
    projectState.resource.resource_kind !== 'project'
  ) {
    throw new Error('Production auth configuration requires a provisioned Vercel project');
  }

  const sourceState = await readSourcePublicationState(projectRoot);
  if (sourceState?.status !== 'succeeded' || !sourceState.commit_sha) {
    throw new Error('Production auth configuration requires succeeded source publication');
  }
  await validateSourcePublicationState(sourceState, manifestSha256, projectRoot);
  if (sourceState.plan.context_sha256 !== providerContextSha256) {
    throw new Error('Production auth provider context does not match source state');
  }

  const migrationState = await readMigrationState(projectRoot);
  if (migrationState?.status !== 'succeeded') {
    throw new Error('Production auth configuration requires succeeded database migrations');
  }
  await validateMigrationState(migrationState, manifestSha256, sourceState);

  const bindings = authProductionPlanSchema.shape.bindings
    .parse([
      { key: 'AUTH_BOOTSTRAP_ADMIN_EMAIL', type: 'encrypted', targets: ['production'] },
      { key: 'BETTER_AUTH_SECRET', type: 'sensitive', targets: ['production'] },
      { key: 'BETTER_AUTH_URL', type: 'encrypted', targets: ['production'] },
      { key: 'EMAIL_APP_NAME', type: 'encrypted', targets: ['production'] },
      { key: 'EMAIL_FROM', type: 'encrypted', targets: ['production'] },
      ...(authContext.email.reply_to
        ? [{ key: 'EMAIL_REPLY_TO', type: 'encrypted', targets: ['production'] }]
        : []),
      { key: 'NEXT_PUBLIC_APP_URL', type: 'encrypted', targets: ['production'] },
      { key: 'RESEND_API_KEY', type: 'sensitive', targets: ['production'] },
    ])
    .toSorted((left, right) => left.key.localeCompare(right.key));

  return authProductionPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: manifestSha256,
    provider_context_sha256: providerContextSha256,
    auth_context_sha256: sha256(serializeCanonicalJson(authContext)),
    source: {
      commit_sha: sourceState.commit_sha,
      source_sha256: sourceState.plan.source.sha256,
    },
    application: {
      provider: 'vercel',
      team_id: providerContext.vercel.team_id,
      project_id: projectState.resource.resource_id,
      project_name: manifest.project.name,
      canonical_url: authContext.canonical_url,
    },
    email: {
      provider: 'resend',
      from: authContext.email.from,
      reply_to: authContext.email.reply_to ?? null,
      sender_domain: senderDomain(authContext.email.from),
    },
    bootstrap: {
      administrator_email: normalizedEmail(authContext.bootstrap.administrator_email),
      role: 'admin',
      strategy: 'exact-email-on-user-create',
    },
    bindings,
    permissions: [
      'project:read',
      'project-environment:read',
      'project-environment:write',
      'email:send',
    ],
  });
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

async function acquireLock(projectRoot: string): Promise<AuthLockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const lock: AuthLockMetadata = { schema_version: 1, pid: process.pid, owner_token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath(projectRoot), serializeCanonicalJson(lock), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return lock;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      if (attempt === 0) {
        try {
          const previous = JSON.parse(
            await readFile(lockPath(projectRoot), 'utf8'),
          ) as Partial<AuthLockMetadata>;
          if (
            previous.schema_version === 1 &&
            typeof previous.pid === 'number' &&
            typeof previous.owner_token === 'string' &&
            !processIsAlive(previous.pid)
          ) {
            await rm(lockPath(projectRoot));
            continue;
          }
        } catch {}
      }
      throw new Error('Another production auth configuration is active or left an unreadable lock');
    }
  }
  throw new Error('Unable to acquire production auth configuration lock');
}

async function releaseLock(projectRoot: string, lock: AuthLockMetadata): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath(projectRoot), 'utf8')) as AuthLockMetadata;
    if (current.owner_token === lock.owner_token) await rm(lockPath(projectRoot));
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

async function writeState(projectRoot: string, state: AuthProductionState): Promise<void> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  const temporaryPath = join(
    metadataRoot,
    `.${STATE_FILE}.${process.pid}.${randomUUID()}.temporary`,
  );
  await mkdir(metadataRoot, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeCanonicalJson(state), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, statePath(projectRoot));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readAuthProductionState(
  projectRoot: string,
): Promise<AuthProductionState | null> {
  try {
    return authProductionStateSchema.parse(
      JSON.parse(await readFile(statePath(projectRoot), 'utf8')),
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

class AuthProductionClient {
  readonly #credentials: AuthCredentials;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(authCredentials: AuthCredentials, options: AuthProductionOptions) {
    this.#credentials = authCredentials;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  async #request(input: {
    provider: 'resend' | 'vercel';
    url: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    acceptedStatuses: number[];
  }): Promise<Response> {
    const token =
      input.provider === 'vercel' ? this.#credentials.vercelToken : this.#credentials.resendApiKey;
    let response: Response;
    try {
      response = await this.#fetch(input.url, {
        method: input.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'void-starter-factory',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(input.provider === 'resend' && input.method === 'POST'
            ? {
                'Idempotency-Key': `void-auth-config-${sha256(input.url + JSON.stringify(input.body))}`,
              }
            : {}),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new AuthProductionError({
        code: `${input.provider.toUpperCase()}_NETWORK_FAILURE`,
        message: `${input.provider} request failed before a response was confirmed`,
        retryable: true,
      });
    }
    if (!input.acceptedStatuses.includes(response.status)) {
      throw new AuthProductionError({
        code: `${input.provider.toUpperCase()}_HTTP_${response.status}`,
        message: `${input.provider} request returned HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return response;
  }

  async #json<T>(response: Response, schema: z.ZodType<T>, provider: string): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw new AuthProductionError({
        code: `${provider.toUpperCase()}_INVALID_RESPONSE`,
        message: `${provider} returned an invalid response`,
      });
    }
  }

  async #environment(plan: AuthProductionPlan): Promise<VercelEnvironmentVariable[]> {
    const url = new URL(
      `${VERCEL_API}/v9/projects/${encodeURIComponent(plan.application.project_id)}/env`,
    );
    url.searchParams.set('teamId', plan.application.team_id);
    return (
      await this.#json(
        await this.#request({ provider: 'vercel', url: url.toString(), acceptedStatuses: [200] }),
        vercelEnvironmentVariablesSchema,
        'vercel',
      )
    ).envs;
  }

  async inspect(plan: AuthProductionPlan): Promise<string | null> {
    const team = await this.#json(
      await this.#request({
        provider: 'vercel',
        url: `${VERCEL_API}/v2/teams/${encodeURIComponent(plan.application.team_id)}`,
        acceptedStatuses: [200],
      }),
      vercelTeamSchema,
      'vercel',
    );
    if (team.id !== plan.application.team_id) {
      throw new AuthProductionError({
        code: 'VERCEL_TEAM_MISMATCH',
        message: 'Authenticated Vercel team does not match auth plan',
      });
    }

    const projectUrl = new URL(
      `${VERCEL_API}/v9/projects/${encodeURIComponent(plan.application.project_id)}`,
    );
    projectUrl.searchParams.set('teamId', plan.application.team_id);
    const project = await this.#json(
      await this.#request({
        provider: 'vercel',
        url: projectUrl.toString(),
        acceptedStatuses: [200],
      }),
      vercelProjectSchema,
      'vercel',
    );
    if (
      project.id !== plan.application.project_id ||
      project.name !== plan.application.project_name
    ) {
      throw new AuthProductionError({
        code: 'VERCEL_PROJECT_MISMATCH',
        message: 'Vercel project does not match auth plan',
      });
    }

    const environment = await this.#environment(plan);
    const managedKeys = new Set([...plan.bindings.map((binding) => binding.key), OWNERSHIP_MARKER]);
    const managed = environment.filter((variable) => managedKeys.has(variable.key));
    if (managed.length === 0) return null;

    const marker = managed.find((variable) => variable.key === OWNERSHIP_MARKER);
    const bindingsMatch = plan.bindings.every((binding) => {
      const variables = managed.filter((variable) => variable.key === binding.key);
      return (
        variables.length === 1 &&
        variables[0]?.type === binding.type &&
        exactTargets(variables[0].target, binding.targets)
      );
    });
    if (
      managed.length !== plan.bindings.length + 1 ||
      !bindingsMatch ||
      !marker ||
      marker.type !== 'plain' ||
      marker.value !== authProductionPlanDigest(plan) ||
      !exactTargets(marker.target, ['production'])
    ) {
      throw new AuthProductionError({
        code: 'VERCEL_AUTH_BINDING_CONFLICT',
        message: 'Existing Vercel auth variables are not owned by this exact plan',
      });
    }
    return marker.id;
  }

  async ensureBindings(plan: AuthProductionPlan): Promise<string> {
    const existing = await this.inspect(plan);
    if (existing) return existing;

    const values: Record<AuthProductionPlan['bindings'][number]['key'], string> = {
      AUTH_BOOTSTRAP_ADMIN_EMAIL: plan.bootstrap.administrator_email,
      BETTER_AUTH_SECRET: this.#credentials.betterAuthSecret,
      BETTER_AUTH_URL: plan.application.canonical_url,
      EMAIL_APP_NAME: plan.application.project_name,
      EMAIL_FROM: plan.email.from,
      EMAIL_REPLY_TO: plan.email.reply_to ?? '',
      NEXT_PUBLIC_APP_URL: plan.application.canonical_url,
      RESEND_API_KEY: this.#credentials.resendApiKey,
    };
    const url = new URL(
      `${VERCEL_API}/v10/projects/${encodeURIComponent(plan.application.project_id)}/env`,
    );
    url.searchParams.set('teamId', plan.application.team_id);
    let mutationError: unknown;
    try {
      await this.#request({
        provider: 'vercel',
        url: url.toString(),
        method: 'POST',
        body: [
          ...plan.bindings.map((binding) => ({
            key: binding.key,
            value: values[binding.key],
            type: binding.type,
            target: binding.targets,
          })),
          {
            key: OWNERSHIP_MARKER,
            value: authProductionPlanDigest(plan),
            type: 'plain',
            target: ['production'],
          },
        ],
        acceptedStatuses: [200, 201],
      });
    } catch (error) {
      mutationError = error;
    }
    const reconciled = await this.inspect(plan);
    if (reconciled) return reconciled;
    if (mutationError) throw mutationError;
    throw new AuthProductionError({
      code: 'VERCEL_AUTH_BINDING_AMBIGUOUS',
      message: 'Vercel accepted auth bindings but they are not observable',
      retryable: true,
    });
  }

  async sendSmoke(plan: AuthProductionPlan): Promise<string> {
    const response = await this.#request({
      provider: 'resend',
      url: `${RESEND_API}/emails`,
      method: 'POST',
      body: {
        from: plan.email.from,
        to: [plan.bootstrap.administrator_email],
        subject: `${plan.application.project_name} authentication configured`,
        text: `Authentication email delivery is configured for ${plan.application.canonical_url}. No action is required.`,
        ...(plan.email.reply_to ? { reply_to: plan.email.reply_to } : {}),
      },
      acceptedStatuses: [200],
    });
    return (await this.#json(response, resendSuccessSchema, 'resend')).id;
  }
}

function safeError(error: unknown) {
  if (error instanceof AuthProductionError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'AUTH_CONFIGURATION_FAILURE',
      message: 'Production authentication configuration failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_AUTH_CONFIGURATION_FAILURE',
    message: 'Production authentication configuration failed without a safe diagnostic',
    retryable: false,
  };
}

export async function preflightAuthProduction(input: {
  projectRoot: string;
  providerContext: ProvisioningContext;
  authContext: AuthProductionContext;
  environment: Record<string, string | undefined>;
  options?: AuthProductionOptions;
}) {
  const plan = await createAuthProductionPlan(
    input.projectRoot,
    input.providerContext,
    input.authContext,
  );
  const client = new AuthProductionClient(credentials(input.environment), input.options ?? {});
  const marker = await client.inspect(plan);
  return {
    mode: 'auth-production-live-preflight' as const,
    ok: true as const,
    plan_sha256: authProductionPlanDigest(plan),
    source_commit_sha: plan.source.commit_sha,
    bindings: marker ? ('owned' as const) : ('absent' as const),
    sender_domain: plan.email.sender_domain,
    bootstrap_administrator: plan.bootstrap.administrator_email,
  };
}

export async function applyAuthProduction(input: {
  projectRoot: string;
  providerContext: ProvisioningContext;
  authContext: AuthProductionContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: AuthProductionOptions;
}): Promise<AuthProductionState> {
  const authCredentials = credentials(input.environment);
  const lock = await acquireLock(input.projectRoot);
  try {
    const plan = await createAuthProductionPlan(
      input.projectRoot,
      input.providerContext,
      input.authContext,
    );
    const digest = authProductionPlanDigest(plan);
    const existing = await readAuthProductionState(input.projectRoot);
    if (!existing && input.requireExistingState) {
      throw new Error('No production auth state exists to resume');
    }
    const state =
      existing ??
      authProductionStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: digest,
        plan,
        attempts: 0,
        observation: null,
        error: null,
      });
    if (state.plan_sha256 !== digest || authProductionPlanDigest(state.plan) !== digest) {
      throw new Error('Existing production auth state belongs to a different plan');
    }
    if (state.status === 'succeeded') return state;

    state.status = 'running';
    state.attempts += 1;
    state.observation = null;
    state.error = null;
    await writeState(input.projectRoot, state);

    try {
      const client = new AuthProductionClient(authCredentials, input.options ?? {});
      const markerId = await client.ensureBindings(plan);
      const emailId = await client.sendSmoke(plan);
      const observation: AuthProductionObservation = {
        project_id: plan.application.project_id,
        binding_marker_id: markerId,
        bound_keys: plan.bindings.map((binding) => binding.key).toSorted(),
        email_id: emailId,
        sender_domain: plan.email.sender_domain,
        administrator_email: plan.bootstrap.administrator_email,
        bootstrap_strategy: 'exact-email-on-user-create',
        requires_redeployment: true,
        configured_at: new Date((input.options?.now ?? Date.now)()).toISOString(),
      };
      state.status = 'succeeded';
      state.observation = observation;
      await writeState(input.projectRoot, state);
      return state;
    } catch (error) {
      const sanitized = safeError(error);
      state.status = 'failed';
      state.error = sanitized;
      await writeState(input.projectRoot, state);
      throw new AuthProductionApplyError(sanitized.code);
    }
  } finally {
    await releaseLock(input.projectRoot, lock);
  }
}

export async function validateAuthProductionState(
  state: AuthProductionState,
  expectedManifestSha256: string,
  sourceState: NonNullable<Awaited<ReturnType<typeof readSourcePublicationState>>>,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('Production auth state manifest digest does not match generation metadata');
  }
  const digest = authProductionPlanDigest(state.plan);
  if (state.plan_sha256 !== digest) {
    throw new Error('Production auth state plan digest is invalid');
  }
  if (
    sourceState.status !== 'succeeded' ||
    !sourceState.commit_sha ||
    state.plan.source.commit_sha !== sourceState.commit_sha ||
    state.plan.source.source_sha256 !== sourceState.plan.source.sha256
  ) {
    throw new Error('Production auth state source identity does not match publication state');
  }
  if (state.status === 'succeeded' && (!state.observation || state.error)) {
    throw new Error('Succeeded production auth state is missing its observation');
  }
}
