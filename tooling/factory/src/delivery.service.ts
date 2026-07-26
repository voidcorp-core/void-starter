import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  type DeliveryPlan,
  type DeliveryState,
  type DeploymentObservation,
  deliveryPlanSchema,
  deliveryStateSchema,
  type SmokeReceipt,
} from './delivery.types';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import type { ProvisioningContext } from './provisioning.types';
import { readProvisioningState, validateProvisioningState } from './provisioning-apply.service';
import {
  readSourcePublicationState,
  validateSourcePublicationState,
} from './source-publication.service';

const VERCEL_API = 'https://api.vercel.com';
const METADATA_DIRECTORY = '.void-starter';
const DELIVERY_STATE_FILE = 'delivery-state.json';
const DELIVERY_LOCK_FILE = 'delivery.lock';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

export type DeliveryOptions = {
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  requestTimeoutMs?: number;
  observationTimeoutMs?: number;
  pollIntervalMs?: number;
};

type DeliveryLockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

type DeploymentStatus = 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';

type ObservedDeployment = {
  id: string;
  url: string;
  status: DeploymentStatus;
  target: 'production';
  sourceCommitSha: string;
  createdAt: number;
  readyAt: number | null;
};

const vercelTeamSchema = z.object({
  id: z.string().min(1),
});

const vercelProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const deploymentStatusSchema = z.enum([
  'QUEUED',
  'INITIALIZING',
  'BUILDING',
  'READY',
  'ERROR',
  'CANCELED',
]);

const vercelDeploymentSchema = z
  .object({
    uid: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
    projectId: z.string().min(1).optional(),
    readyState: deploymentStatusSchema.optional(),
    state: deploymentStatusSchema.optional(),
    target: z.string().nullable().optional(),
    created: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative().optional(),
    ready: z.number().int().nonnegative().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((deployment) => deployment.readyState !== undefined || deployment.state !== undefined, {
    message: 'Deployment response is missing state',
  })
  .refine((deployment) => deployment.created !== undefined || deployment.createdAt !== undefined, {
    message: 'Deployment response is missing creation time',
  });

const vercelDeploymentsSchema = z.object({
  deployments: z.array(vercelDeploymentSchema),
});

export class DeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'DeliveryError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export class DeliveryApplyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Delivery observation failed with code ${code}`);
    this.name = 'DeliveryApplyError';
    this.code = code;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function requiredVercelToken(environment: Record<string, string | undefined>): string {
  const token = environment['VERCEL_TOKEN']?.trim();
  if (!token) {
    throw new Error('Live delivery observation requires VERCEL_TOKEN');
  }
  return token;
}

function optionalBypassSecret(environment: Record<string, string | undefined>): string | null {
  return environment['VERCEL_AUTOMATION_BYPASS_SECRET']?.trim() || null;
}

function deliveryStatePath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, DELIVERY_STATE_FILE);
}

function deliveryLockPath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, DELIVERY_LOCK_FILE);
}

export function deliveryPlanDigest(plan: DeliveryPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

async function writeDeliveryStateAtomic(projectRoot: string, state: DeliveryState): Promise<void> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  const temporaryPath = join(
    metadataRoot,
    `.${DELIVERY_STATE_FILE}.${process.pid}.${randomUUID()}.temporary`,
  );
  await mkdir(metadataRoot, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeCanonicalJson(state), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, deliveryStatePath(projectRoot));
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

async function recoverStaleDeliveryLock(projectRoot: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(
      await readFile(deliveryLockPath(projectRoot), 'utf8'),
    ) as Partial<DeliveryLockMetadata>;
    if (
      metadata.schema_version !== 1 ||
      typeof metadata.pid !== 'number' ||
      typeof metadata.owner_token !== 'string' ||
      processIsAlive(metadata.pid)
    ) {
      return false;
    }
    await rm(deliveryLockPath(projectRoot));
    return true;
  } catch {
    return false;
  }
}

async function acquireDeliveryLock(projectRoot: string): Promise<DeliveryLockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const metadata: DeliveryLockMetadata = {
    schema_version: 1,
    pid: process.pid,
    owner_token: randomUUID(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(deliveryLockPath(projectRoot), serializeCanonicalJson(metadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return metadata;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await recoverStaleDeliveryLock(projectRoot))) {
        continue;
      }
      throw new Error('Another delivery observation is active or left an unreadable lock');
    }
  }
  throw new Error('Unable to acquire the delivery observation lock');
}

async function releaseDeliveryLock(projectRoot: string, lock: DeliveryLockMetadata): Promise<void> {
  try {
    const current = JSON.parse(
      await readFile(deliveryLockPath(projectRoot), 'utf8'),
    ) as DeliveryLockMetadata;
    if (current.owner_token === lock.owner_token) {
      await rm(deliveryLockPath(projectRoot));
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
  }
}

export async function readDeliveryState(projectRoot: string): Promise<DeliveryState | null> {
  try {
    return deliveryStateSchema.parse(
      JSON.parse(await readFile(deliveryStatePath(projectRoot), 'utf8')),
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

function assertDeliveryStateMatchesPlan(state: DeliveryState, plan: DeliveryPlan): void {
  const digest = deliveryPlanDigest(plan);
  if (state.plan_sha256 !== digest || deliveryPlanDigest(state.plan) !== digest) {
    throw new Error('Existing delivery state belongs to a different or modified plan');
  }
}

export async function createDeliveryPlan(
  projectRoot: string,
  context: ProvisioningContext,
): Promise<DeliveryPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  if (manifest.surfaces.web !== 'next-vercel') {
    throw new Error('Delivery observation requires a Next.js Vercel web surface');
  }
  if (!context.vercel) {
    throw new Error('Delivery observation requires Vercel context');
  }

  const manifestSha256 = sha256(serializeCanonicalJson(manifest));
  const contextSha256 = sha256(serializeCanonicalJson(context));
  const provisioningState = await readProvisioningState(projectRoot);
  if (provisioningState?.mode !== 'live' || provisioningState.status !== 'succeeded') {
    throw new Error('Delivery observation requires succeeded live provisioning state');
  }
  validateProvisioningState(provisioningState, manifestSha256);
  if (provisioningState.plan.context_sha256 !== contextSha256) {
    throw new Error('Delivery context does not match live provisioning state');
  }

  const projectAction = provisioningState.plan.actions.find(
    (action) => action.id === 'vercel.project',
  );
  const projectState = provisioningState.actions.find(
    (action) => action.action_id === 'vercel.project',
  );
  if (
    !projectAction ||
    !projectState ||
    projectState.status !== 'succeeded' ||
    !projectState.resource ||
    projectState.resource.provider !== 'vercel' ||
    projectState.resource.resource_kind !== 'project'
  ) {
    throw new Error('Delivery observation requires a succeeded Vercel project resource');
  }
  if (
    projectAction.input.team_id !== context.vercel.team_id ||
    projectAction.input.name !== manifest.project.name ||
    projectState.resource.display_name !== manifest.project.name
  ) {
    throw new Error('Delivery context does not match provisioned Vercel project');
  }

  const sourceState = await readSourcePublicationState(projectRoot);
  if (sourceState?.status !== 'succeeded' || !sourceState.commit_sha) {
    throw new Error('Delivery observation requires succeeded source publication state');
  }
  await validateSourcePublicationState(sourceState, manifestSha256, projectRoot);
  if (sourceState.plan.context_sha256 !== contextSha256) {
    throw new Error('Delivery context does not match source publication state');
  }

  return deliveryPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: manifestSha256,
    context_sha256: contextSha256,
    source: {
      commit_sha: sourceState.commit_sha,
      source_sha256: sourceState.plan.source.sha256,
    },
    deployment: {
      provider: 'vercel',
      team_id: context.vercel.team_id,
      project_id: projectState.resource.resource_id,
      project_name: manifest.project.name,
      target: 'production',
    },
    smoke: {
      method: 'GET',
      path: '/',
      expected_status: 200,
      expected_content_type_prefix: 'text/html',
      expected_body_contains: manifest.project.name,
      max_body_bytes: 1_048_576,
    },
    permissions: ['deployment:read'],
  });
}

function safeHttpsDeploymentUrl(hostOrUrl: string): string {
  let url: URL;
  try {
    url = new URL(hostOrUrl.includes('://') ? hostOrUrl : `https://${hostOrUrl}`);
  } catch {
    throw new DeliveryError({
      code: 'VERCEL_INVALID_DEPLOYMENT_URL',
      message: 'Vercel returned an invalid deployment URL',
    });
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.vercel.app') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new DeliveryError({
      code: 'VERCEL_INVALID_DEPLOYMENT_URL',
      message: 'Vercel returned an unsafe deployment URL',
    });
  }
  return url.toString().replace(/\/$/, '');
}

class VercelDeliveryClient {
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(token: string, options: DeliveryOptions) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  async #request(url: string, acceptedStatuses: number[]): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.#token}`,
          'User-Agent': 'void-starter-factory',
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      throw new DeliveryError({
        code: 'VERCEL_NETWORK_FAILURE',
        message: 'Vercel delivery request failed before a response was confirmed',
        retryable: true,
      });
    }
    if (!acceptedStatuses.includes(response.status)) {
      throw new DeliveryError({
        code: `VERCEL_HTTP_${response.status}`,
        message: `Vercel delivery request returned HTTP ${response.status}`,
        retryable: response.status === 423 || response.status === 429 || response.status >= 500,
      });
    }
    return response;
  }

  async #json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw new DeliveryError({
        code: 'VERCEL_INVALID_RESPONSE',
        message: 'Vercel returned an invalid delivery response',
      });
    }
  }

  async preflight(plan: DeliveryPlan): Promise<void> {
    const team = await this.#json(
      await this.#request(
        `${VERCEL_API}/v2/teams/${encodeURIComponent(plan.deployment.team_id)}`,
        [200],
      ),
      vercelTeamSchema,
    );
    if (team.id !== plan.deployment.team_id) {
      throw new DeliveryError({
        code: 'VERCEL_TEAM_MISMATCH',
        message: 'Authenticated Vercel team does not match delivery plan',
      });
    }

    const projectUrl = new URL(
      `${VERCEL_API}/v9/projects/${encodeURIComponent(plan.deployment.project_id)}`,
    );
    projectUrl.searchParams.set('teamId', plan.deployment.team_id);
    const project = await this.#json(
      await this.#request(projectUrl.toString(), [200]),
      vercelProjectSchema,
    );
    if (
      project.id !== plan.deployment.project_id ||
      project.name !== plan.deployment.project_name
    ) {
      throw new DeliveryError({
        code: 'VERCEL_PROJECT_MISMATCH',
        message: 'Vercel project does not match delivery plan',
      });
    }
  }

  async lookup(plan: DeliveryPlan): Promise<ObservedDeployment | null> {
    const url = new URL(`${VERCEL_API}/v6/deployments`);
    url.searchParams.set('teamId', plan.deployment.team_id);
    url.searchParams.set('projectId', plan.deployment.project_id);
    url.searchParams.set('target', plan.deployment.target);
    url.searchParams.set('limit', '100');
    const result = await this.#json(
      await this.#request(url.toString(), [200]),
      vercelDeploymentsSchema,
    );
    const matching = result.deployments
      .filter((deployment) => {
        const commitSha = deployment.meta?.['githubCommitSha'];
        return (
          commitSha === plan.source.commit_sha &&
          deployment.name === plan.deployment.project_name &&
          (deployment.projectId === undefined ||
            deployment.projectId === plan.deployment.project_id) &&
          deployment.target === plan.deployment.target
        );
      })
      .toSorted(
        (left, right) =>
          (right.created ?? right.createdAt ?? 0) - (left.created ?? left.createdAt ?? 0),
      );
    const deployment = matching[0];
    if (!deployment) {
      return null;
    }
    return {
      id: deployment.uid,
      url: safeHttpsDeploymentUrl(deployment.url),
      status: deployment.readyState ?? deployment.state ?? 'ERROR',
      target: 'production',
      sourceCommitSha: plan.source.commit_sha,
      createdAt: deployment.created ?? deployment.createdAt ?? 0,
      readyAt: deployment.ready ?? null,
    };
  }
}

async function waitForReadyDeployment(input: {
  client: VercelDeliveryClient;
  plan: DeliveryPlan;
  options: DeliveryOptions;
}): Promise<ObservedDeployment> {
  const now = input.options.now ?? Date.now;
  const sleep =
    input.options.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = input.options.observationTimeoutMs ?? 5 * 60_000;
  const pollIntervalMs = input.options.pollIntervalMs ?? 5_000;
  const deadline = now() + timeoutMs;

  while (true) {
    const deployment = await input.client.lookup(input.plan);
    if (deployment?.status === 'READY') {
      return deployment;
    }
    if (deployment?.status === 'ERROR' || deployment?.status === 'CANCELED') {
      throw new DeliveryError({
        code: `VERCEL_DEPLOYMENT_${deployment.status}`,
        message: `Vercel deployment reached terminal state ${deployment.status}`,
        retryable: true,
      });
    }
    if (now() >= deadline) {
      throw new DeliveryError({
        code: deployment ? 'VERCEL_DEPLOYMENT_TIMEOUT' : 'VERCEL_DEPLOYMENT_NOT_FOUND',
        message: deployment
          ? 'Exact Vercel deployment did not become ready before timeout'
          : 'Exact Vercel deployment was not observable before timeout',
        retryable: true,
      });
    }
    await sleep(pollIntervalMs);
  }
}

async function readBodyLimited(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new DeliveryError({
        code: 'SMOKE_BODY_TOO_LARGE',
        message: 'Smoke response exceeded the configured body limit',
      });
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isVercelProtectionRedirect(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) {
    return false;
  }
  const location = response.headers.get('location');
  if (!location) {
    return false;
  }
  try {
    const url = new URL(location);
    return url.hostname === 'vercel.com' && url.pathname.startsWith('/sso-api');
  } catch {
    return false;
  }
}

async function smokeDeployment(input: {
  deployment: ObservedDeployment;
  plan: DeliveryPlan;
  bypassSecret: string | null;
  options: DeliveryOptions;
}): Promise<SmokeReceipt> {
  const smokeUrl = new URL(input.plan.smoke.path, `${input.deployment.url}/`).toString();
  const headers: Record<string, string> = {
    Accept: input.plan.smoke.expected_content_type_prefix,
    'User-Agent': 'void-starter-factory',
  };
  if (input.bypassSecret) {
    headers['x-vercel-protection-bypass'] = input.bypassSecret;
  }

  let response: Response;
  try {
    response = await (input.options.fetch ?? fetch)(smokeUrl, {
      method: input.plan.smoke.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(input.options.requestTimeoutMs ?? 20_000),
    });
  } catch {
    throw new DeliveryError({
      code: 'SMOKE_NETWORK_FAILURE',
      message: 'Deployment smoke request failed before a response was confirmed',
      retryable: true,
    });
  }

  if (isVercelProtectionRedirect(response)) {
    throw new DeliveryError({
      code: input.bypassSecret
        ? 'VERCEL_PROTECTION_BYPASS_INVALID'
        : 'VERCEL_PROTECTION_BYPASS_REQUIRED',
      message: input.bypassSecret
        ? 'Vercel rejected the configured automation bypass secret'
        : 'Protected deployment requires VERCEL_AUTOMATION_BYPASS_SECRET',
      retryable: true,
    });
  }
  if (response.status !== input.plan.smoke.expected_status) {
    throw new DeliveryError({
      code: `SMOKE_HTTP_${response.status}`,
      message: `Deployment smoke returned HTTP ${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith(input.plan.smoke.expected_content_type_prefix)) {
    throw new DeliveryError({
      code: 'SMOKE_CONTENT_TYPE_MISMATCH',
      message: 'Deployment smoke returned an unexpected content type',
    });
  }
  const body = await readBodyLimited(response, input.plan.smoke.max_body_bytes);
  const text = new TextDecoder().decode(body);
  if (!text.includes(input.plan.smoke.expected_body_contains)) {
    throw new DeliveryError({
      code: 'SMOKE_BODY_MISMATCH',
      message: 'Deployment smoke body does not contain the generated project identity',
    });
  }

  const finalUrl = response.url || smokeUrl;
  return {
    status: response.status,
    content_type: contentType,
    body_sha256: createHash('sha256').update(body).digest('hex'),
    body_bytes: body.byteLength,
    bypass_used: input.bypassSecret !== null,
    final_url: finalUrl,
    checked_at: new Date((input.options.now ?? Date.now)()).toISOString(),
  };
}

function safeDeliveryError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof DeliveryError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'DELIVERY_FAILURE',
      message: 'Delivery observation failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_DELIVERY_FAILURE',
    message: 'Delivery observation failed without a safe diagnostic',
    retryable: false,
  };
}

export async function preflightDelivery(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  options?: DeliveryOptions;
}): Promise<{
  ok: true;
  mode: 'delivery-live-preflight';
  plan_sha256: string;
  source_commit_sha: string;
  deployment: 'missing' | 'pending' | 'ready';
  deployment_id: string | null;
  ready_state: DeploymentStatus | null;
  bypass: 'configured' | 'absent';
}> {
  const plan = await createDeliveryPlan(input.projectRoot, input.context);
  const client = new VercelDeliveryClient(
    requiredVercelToken(input.environment),
    input.options ?? {},
  );
  await client.preflight(plan);
  const deployment = await client.lookup(plan);
  if (deployment?.status === 'ERROR' || deployment?.status === 'CANCELED') {
    throw new DeliveryError({
      code: `VERCEL_DEPLOYMENT_${deployment.status}`,
      message: `Vercel deployment reached terminal state ${deployment.status}`,
      retryable: true,
    });
  }
  return {
    ok: true,
    mode: 'delivery-live-preflight',
    plan_sha256: deliveryPlanDigest(plan),
    source_commit_sha: plan.source.commit_sha,
    deployment: !deployment ? 'missing' : deployment.status === 'READY' ? 'ready' : 'pending',
    deployment_id: deployment?.id ?? null,
    ready_state: deployment?.status ?? null,
    bypass: optionalBypassSecret(input.environment) ? 'configured' : 'absent',
  };
}

export async function observeDelivery(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: DeliveryOptions;
}): Promise<DeliveryState> {
  const token = requiredVercelToken(input.environment);
  const bypassSecret = optionalBypassSecret(input.environment);
  const options = input.options ?? {};
  const lock = await acquireDeliveryLock(input.projectRoot);
  try {
    const plan = await createDeliveryPlan(input.projectRoot, input.context);
    const existingState = await readDeliveryState(input.projectRoot);
    if (!existingState && input.requireExistingState) {
      throw new Error('No delivery state exists to resume');
    }
    const state: DeliveryState =
      existingState ??
      deliveryStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: deliveryPlanDigest(plan),
        plan,
        attempts: 0,
        observation: null,
        error: null,
      });
    assertDeliveryStateMatchesPlan(state, plan);
    if (state.status === 'succeeded') {
      return state;
    }

    const client = new VercelDeliveryClient(token, options);
    await client.preflight(plan);
    state.status = 'running';
    state.attempts += 1;
    state.observation = null;
    state.error = null;
    await writeDeliveryStateAtomic(input.projectRoot, state);

    try {
      const deployment = await waitForReadyDeployment({ client, plan, options });
      const observation: DeploymentObservation = {
        deployment_id: deployment.id,
        url: deployment.url,
        ready_state: 'READY',
        target: deployment.target,
        source_commit_sha: deployment.sourceCommitSha,
        created_at: deployment.createdAt,
        ready_at: deployment.readyAt,
        observed_at: new Date((options.now ?? Date.now)()).toISOString(),
        smoke: null,
      };
      state.observation = observation;
      await writeDeliveryStateAtomic(input.projectRoot, state);

      observation.smoke = await smokeDeployment({
        deployment,
        plan,
        bypassSecret,
        options,
      });
      state.status = 'succeeded';
      await writeDeliveryStateAtomic(input.projectRoot, state);
      return state;
    } catch (error) {
      const safeError = safeDeliveryError(error);
      state.status = 'failed';
      state.error = safeError;
      await writeDeliveryStateAtomic(input.projectRoot, state);
      throw new DeliveryApplyError(safeError.code);
    }
  } finally {
    await releaseDeliveryLock(input.projectRoot, lock);
  }
}

export async function validateDeliveryState(
  state: DeliveryState,
  expectedManifestSha256: string,
  sourceState: NonNullable<Awaited<ReturnType<typeof readSourcePublicationState>>>,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('Delivery state manifest digest does not match generation metadata');
  }
  assertDeliveryStateMatchesPlan(state, state.plan);
  if (
    sourceState.status !== 'succeeded' ||
    !sourceState.commit_sha ||
    state.plan.source.commit_sha !== sourceState.commit_sha ||
    state.plan.source.source_sha256 !== sourceState.plan.source.sha256
  ) {
    throw new Error('Delivery state source identity does not match source publication state');
  }
  if (state.status === 'succeeded') {
    if (!state.observation?.smoke || state.error) {
      throw new Error('Succeeded delivery state is missing observation or smoke receipt');
    }
    if (
      state.observation.source_commit_sha !== state.plan.source.commit_sha ||
      state.observation.target !== state.plan.deployment.target ||
      state.observation.smoke.status !== state.plan.smoke.expected_status ||
      !state.observation.smoke.content_type
        .toLowerCase()
        .startsWith(state.plan.smoke.expected_content_type_prefix)
    ) {
      throw new Error('Succeeded delivery state contains inconsistent evidence');
    }
  }
  if (state.status === 'failed' && !state.error) {
    throw new Error('Failed delivery state is missing safe diagnostics');
  }
  if ((state.status === 'pending' || state.status === 'running') && state.error) {
    throw new Error('Incomplete delivery state contains terminal diagnostics');
  }
}
