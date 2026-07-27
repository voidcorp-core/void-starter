import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type ProvisionedResource,
  type ProvisioningAction,
  type ProvisioningActionState,
  type ProvisioningApplyState,
  type ProvisioningPlan,
  provisionedResourceSchema,
  provisioningApplyStateSchema,
  provisioningPlanSchema,
} from './provisioning.types';
import { provisioningPlanDigest } from './provisioning-plan.service';

const METADATA_DIRECTORY = '.void-starter';
const STATE_FILE = 'apply-state.json';
const LOCK_FILE = 'apply.lock';

type LockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

export type ProvisioningAdapter = {
  readonly mode: 'simulate' | 'live';
  preflight(plan: ProvisioningPlan): Promise<void>;
  ensure(
    action: ProvisioningAction,
    context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource>;
};

export type ProvisioningExecutionContext = {
  resources: ReadonlyMap<ProvisioningAction['id'], ProvisionedResource>;
  previousError: ProvisioningActionState['error'];
};

export type ApplyProvisioningInput = {
  projectRoot: string;
  plan: ProvisioningPlan;
  adapter: ProvisioningAdapter;
  requireExistingState?: boolean;
};

export class ProvisioningAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable: boolean }) {
    super(input.message);
    this.name = 'ProvisioningAdapterError';
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export class ProvisioningApplyError extends Error {
  readonly actionId: string;
  readonly code: string;

  constructor(actionId: string, code: string) {
    super(`Provisioning action ${actionId} failed with code ${code}`);
    this.name = 'ProvisioningApplyError';
    this.actionId = actionId;
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

async function writeStateAtomic(projectRoot: string, state: ProvisioningApplyState): Promise<void> {
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

async function recoverStaleLock(projectRoot: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(
      await readFile(lockPath(projectRoot), 'utf8'),
    ) as Partial<LockMetadata>;
    if (
      metadata.schema_version !== 1 ||
      typeof metadata.pid !== 'number' ||
      typeof metadata.owner_token !== 'string'
    ) {
      return false;
    }
    if (processIsAlive(metadata.pid)) {
      return false;
    }
    await rm(lockPath(projectRoot));
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(projectRoot: string): Promise<LockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const metadata: LockMetadata = {
    schema_version: 1,
    pid: process.pid,
    owner_token: randomUUID(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath(projectRoot), serializeCanonicalJson(metadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return metadata;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await recoverStaleLock(projectRoot))) {
        continue;
      }
      throw new Error('Another provisioning apply is active or left an unreadable lock');
    }
  }

  throw new Error('Unable to acquire the provisioning lock');
}

async function releaseLock(projectRoot: string, lock: LockMetadata): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath(projectRoot), 'utf8')) as LockMetadata;
    if (current.owner_token === lock.owner_token) {
      await rm(lockPath(projectRoot));
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
  }
}

function initialState(
  plan: ProvisioningPlan,
  mode: ProvisioningAdapter['mode'],
): ProvisioningApplyState {
  return {
    schema_version: 1,
    mode,
    status: 'pending',
    plan_sha256: provisioningPlanDigest(plan),
    plan,
    actions: plan.actions.map((action) => ({
      action_id: action.id,
      idempotency_key: action.idempotency_key,
      status: 'pending',
      attempts: 0,
      resource: null,
      error: null,
    })),
  };
}

function assertStateMatchesPlan(state: ProvisioningApplyState, plan: ProvisioningPlan): void {
  const planDigest = provisioningPlanDigest(plan);
  if (state.plan_sha256 !== planDigest || provisioningPlanDigest(state.plan) !== planDigest) {
    throw new Error('Existing provisioning state belongs to a different or modified plan');
  }
  if (state.actions.length !== plan.actions.length) {
    throw new Error('Existing provisioning state does not match the plan action set');
  }

  for (const [index, action] of plan.actions.entries()) {
    const actionState = state.actions[index];
    if (
      !actionState ||
      actionState.action_id !== action.id ||
      actionState.idempotency_key !== action.idempotency_key
    ) {
      throw new Error('Existing provisioning state does not match the plan action set');
    }
  }
}

async function readProjectManifestSha(projectRoot: string): Promise<string> {
  const source = await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8');
  const manifest = parseBuildManifest(JSON.parse(source));
  return sha256(serializeCanonicalJson(manifest));
}

export async function readProvisioningState(
  projectRoot: string,
): Promise<ProvisioningApplyState | null> {
  try {
    const source = await readFile(statePath(projectRoot), 'utf8');
    return provisioningApplyStateSchema.parse(JSON.parse(source));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

function actionStateById(state: ProvisioningApplyState, actionId: string): ProvisioningActionState {
  const actionState = state.actions.find((candidate) => candidate.action_id === actionId);
  if (!actionState) {
    throw new Error(`Provisioning state is missing action ${actionId}`);
  }
  return actionState;
}

function assertDependenciesSucceeded(
  state: ProvisioningApplyState,
  action: ProvisioningAction,
): void {
  for (const dependency of action.depends_on) {
    if (actionStateById(state, dependency).status !== 'succeeded') {
      throw new Error(`Provisioning dependency ${dependency} has not succeeded`);
    }
  }
}

function persistedError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ProvisioningAdapterError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'PROVIDER_FAILURE',
      message: 'Provider action failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_ADAPTER_FAILURE',
    message: 'Provisioning adapter failed without a safe diagnostic',
    retryable: false,
  };
}

export async function applyProvisioning(
  input: ApplyProvisioningInput,
): Promise<ProvisioningApplyState> {
  const plan = provisioningPlanSchema.parse(input.plan);
  if ((await readProjectManifestSha(input.projectRoot)) !== plan.manifest_sha256) {
    throw new Error('Provisioning plan does not match the generated project manifest');
  }

  const lock = await acquireLock(input.projectRoot);
  try {
    const existingState = await readProvisioningState(input.projectRoot);
    if (!existingState && input.requireExistingState) {
      throw new Error('No provisioning state exists to resume');
    }

    const state = existingState ?? initialState(plan, input.adapter.mode);
    assertStateMatchesPlan(state, plan);
    validateProvisioningState(state, plan.manifest_sha256);
    if (state.mode !== input.adapter.mode) {
      throw new Error(
        `Provisioning state mode ${state.mode} cannot resume with ${input.adapter.mode}`,
      );
    }

    if (state.status === 'succeeded') {
      return state;
    }

    await input.adapter.preflight(plan);
    state.status = 'running';
    await writeStateAtomic(input.projectRoot, state);

    const resources = new Map<ProvisioningAction['id'], ProvisionedResource>();
    for (const actionState of state.actions) {
      if (actionState.status === 'succeeded' && actionState.resource) {
        resources.set(actionState.action_id, actionState.resource);
      }
    }

    for (const action of plan.actions) {
      const actionState = actionStateById(state, action.id);
      if (actionState.status === 'succeeded') {
        continue;
      }
      assertDependenciesSucceeded(state, action);
      const previousError = actionState.error;
      actionState.status = 'running';
      actionState.attempts += 1;
      actionState.error = null;
      await writeStateAtomic(input.projectRoot, state);

      try {
        actionState.resource = provisionedResourceSchema.parse(
          await input.adapter.ensure(action, {
            resources,
            previousError,
          }),
        );
        actionState.status = 'succeeded';
        resources.set(action.id, actionState.resource);
        await writeStateAtomic(input.projectRoot, state);
      } catch (error) {
        const safeError = persistedError(error);
        actionState.status = 'failed';
        actionState.resource = null;
        actionState.error = safeError;
        state.status = 'failed';
        await writeStateAtomic(input.projectRoot, state);
        throw new ProvisioningApplyError(action.id, safeError.code);
      }
    }

    state.status = 'succeeded';
    await writeStateAtomic(input.projectRoot, state);
    return state;
  } finally {
    await releaseLock(input.projectRoot, lock);
  }
}

export class SimulatedProvisioningAdapter implements ProvisioningAdapter {
  readonly mode = 'simulate' as const;
  readonly #failActionId: ProvisioningAction['id'] | undefined;

  constructor(options: { failActionId?: ProvisioningAction['id'] } = {}) {
    this.#failActionId = options.failActionId;
  }

  async preflight(_plan: ProvisioningPlan): Promise<void> {}

  async ensure(
    action: ProvisioningAction,
    _context: ProvisioningExecutionContext,
  ): Promise<ProvisionedResource> {
    if (action.id === this.#failActionId) {
      throw new ProvisioningAdapterError({
        code: 'SIMULATED_FAILURE',
        message: `Simulated failure for ${action.id}`,
        retryable: true,
      });
    }

    const resourceId = `sim_${action.idempotency_key.slice(-24)}`;
    if (action.id === 'github.repository') {
      return {
        provider: 'github',
        resource_kind: 'repository',
        resource_id: resourceId,
        display_name: `${action.input.owner}/${action.input.name}`,
      };
    }
    if (action.id === 'neon.project') {
      return {
        provider: 'neon',
        resource_kind: 'project',
        resource_id: resourceId,
        display_name: action.input.name,
        database_name: 'neondb',
        role_name: 'neondb_owner',
      };
    }
    if (action.id === 'vercel.project') {
      return {
        provider: 'vercel',
        resource_kind: 'project',
        resource_id: resourceId,
        display_name: action.input.name,
      };
    }
    if (action.id === 'cloudflare.r2-bucket') {
      return {
        provider: 'cloudflare',
        resource_kind: 'r2-bucket',
        resource_id: resourceId,
        display_name: action.input.name,
        account_id: action.input.account_id,
        jurisdiction: 'eu',
        public_access: false,
        canary_sha256: sha256(`simulated-r2-canary:${action.idempotency_key}`),
      };
    }
    if (action.id === 'vercel.r2-binding') {
      return {
        provider: 'vercel',
        resource_kind: 'r2-binding',
        resource_id: resourceId,
        display_name: 'Cloudflare R2 runtime binding',
        bound_keys: action.input.bindings,
      };
    }
    return {
      provider: 'vercel',
      resource_kind: 'database-binding',
      resource_id: resourceId,
      display_name: action.input.environment_variable,
    };
  }
}

export function validateProvisioningState(
  state: ProvisioningApplyState,
  expectedManifestSha256: string,
): void {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('Provisioning state manifest digest does not match generation metadata');
  }
  assertStateMatchesPlan(state, state.plan);

  for (const action of state.plan.actions) {
    const actionState = actionStateById(state, action.id);
    const expectedResourceKind =
      action.id === 'github.repository'
        ? 'repository'
        : action.id === 'vercel.database-binding'
          ? 'database-binding'
          : action.id === 'cloudflare.r2-bucket'
            ? 'r2-bucket'
            : action.id === 'vercel.r2-binding'
              ? 'r2-binding'
              : 'project';
    if (
      actionState.status === 'succeeded' &&
      (!actionState.resource ||
        actionState.error ||
        actionState.resource.provider !== action.provider ||
        actionState.resource.resource_kind !== expectedResourceKind)
    ) {
      throw new Error(`Succeeded provisioning action ${action.id} has inconsistent output`);
    }
    if (
      action.id === 'cloudflare.r2-bucket' &&
      actionState.status === 'succeeded' &&
      actionState.resource?.provider === 'cloudflare' &&
      (actionState.resource.display_name !== action.input.name ||
        actionState.resource.account_id !== action.input.account_id ||
        actionState.resource.jurisdiction !== action.input.jurisdiction ||
        actionState.resource.public_access !== false)
    ) {
      throw new Error(
        'Succeeded R2 provisioning action does not attest the exact private EU bucket',
      );
    }
    if (
      action.id === 'vercel.r2-binding' &&
      actionState.status === 'succeeded' &&
      actionState.resource?.provider === 'vercel' &&
      actionState.resource.resource_kind === 'r2-binding' &&
      serializeCanonicalJson(actionState.resource.bound_keys) !==
        serializeCanonicalJson(action.input.bindings)
    ) {
      throw new Error('Succeeded R2 binding action does not attest the exact runtime keys');
    }
    if (actionState.status === 'failed' && (!actionState.error || actionState.resource !== null)) {
      throw new Error(`Failed provisioning action ${action.id} has inconsistent diagnostics`);
    }
    if (
      (actionState.status === 'pending' || actionState.status === 'running') &&
      (actionState.resource !== null || actionState.error !== null)
    ) {
      throw new Error(`Incomplete provisioning action ${action.id} contains terminal output`);
    }
  }

  const allSucceeded = state.actions.every((action) => action.status === 'succeeded');
  const anyFailed = state.actions.some((action) => action.status === 'failed');
  if (state.status === 'succeeded' && !allSucceeded) {
    throw new Error('Provisioning state is marked succeeded with incomplete actions');
  }
  if (state.status === 'failed' && !anyFailed) {
    throw new Error('Provisioning state is marked failed without a failed action');
  }
}
