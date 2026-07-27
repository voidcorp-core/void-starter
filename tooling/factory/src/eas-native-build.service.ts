import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { createProjectFilePlan } from './capability-composition.service';
import {
  type EasNativeBuildContext,
  type EasNativeBuildObservation,
  type EasNativeBuildPlan,
  type EasNativeBuildState,
  easNativeBuildContextSchema,
  easNativeBuildPlanSchema,
  easNativeBuildStateSchema,
} from './eas-native-build.types';
import {
  EasCliExecutionError,
  type EasCliResult,
  type EasCliRunner,
  readEasProjectState,
  validateEasProjectState,
} from './eas-project.service';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  readSourcePublicationState,
  validateSourcePublicationState,
} from './source-publication.service';

const EAS_CLI_PACKAGE = 'eas-cli@21.2.0';
const METADATA_DIRECTORY = '.void-starter';
const STATE_FILE = 'eas-build-state.json';
const LOCK_FILE = 'eas-build.lock';
const EAS_CONFIG_PATH = 'apps/mobile/eas.json';
const MOBILE_ROOT = 'apps/mobile';

const easBuildProfileSchema = z.object({
  environment: z.enum(['development', 'preview', 'production']).optional(),
  distribution: z.enum(['internal', 'store']).optional(),
  credentialsSource: z.enum(['remote', 'local']).optional(),
});

const easConfigSchema = z.object({
  build: z.object({
    development: easBuildProfileSchema,
    preview: easBuildProfileSchema,
    production: easBuildProfileSchema,
  }),
});

const remoteBuildSchema = z.object({
  id: z.string().min(1),
  status: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  platform: z.enum(['ANDROID', 'IOS']),
  buildProfile: z.string().min(1),
  message: z.string().nullable().optional(),
  gitCommitHash: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().optional(),
});

type RemoteBuild = z.infer<typeof remoteBuildSchema>;

type EasBuildLock = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

export type EasNativeBuildOptions = {
  runner?: EasCliRunner;
};

type EasNativeBuildBlocker = {
  code: string;
  message: string;
};

export type EasNativeBuildPreflight = {
  mode: 'eas-native-build-live-preflight';
  ok: true;
  ready_to_build: boolean;
  plan_sha256: string;
  project: {
    id: string;
    full_name: string;
    account_role: string;
  };
  environment: {
    name: string;
    required: Array<{ name: string; visibility: string; type: string }>;
    observed: Array<{ name: string; visibility: string; type: string }>;
  };
  builds: EasNativeBuildObservation[];
  missing_platforms: Array<'android' | 'ios'>;
  blockers: EasNativeBuildBlocker[];
  cost_approval_required: true;
};

class EasNativeBuildError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly diagnostic: string | undefined;

  constructor(input: {
    code: string;
    message: string;
    retryable?: boolean;
    diagnostic?: string;
  }) {
    super(input.message);
    this.name = 'EasNativeBuildError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.diagnostic = input.diagnostic;
  }
}

class EasNativeBuildApplyError extends Error {
  readonly code: string;

  constructor(code: string, diagnostic?: string) {
    super(
      `EAS native build lifecycle failed with code ${code}${diagnostic ? `: ${diagnostic}` : ''}`,
    );
    this.name = 'EasNativeBuildApplyError';
    this.code = code;
  }
}

class BunxEasNativeBuildRunner implements EasCliRunner {
  run(input: {
    arguments: string[];
    cwd: string;
    environment: NodeJS.ProcessEnv;
  }): Promise<EasCliResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      execFile(
        'bunx',
        [EAS_CLI_PACKAGE, ...input.arguments],
        {
          cwd: input.cwd,
          encoding: 'utf8',
          env: input.environment,
          maxBuffer: 8 * 1024 * 1024,
          timeout: 15 * 60_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            rejectPromise(new EasCliExecutionError({ stdout, stderr }));
            return;
          }
          resolvePromise({ stdout, stderr });
        },
      );
    });
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

function expoToken(environment: Record<string, string | undefined>): string {
  const token = environment['EXPO_TOKEN']?.trim();
  if (!token) throw new Error('EAS native build lifecycle requires EXPO_TOKEN');
  return token;
}

function cliEnvironment(token: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_TOKEN: token,
  };
}

function stripAnsi(value: string): string {
  const ansiEscape = String.fromCharCode(27);
  return value
    .split(ansiEscape)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-?]*[ -/]*[@-~]/, '')))
    .join('');
}

function safeCliDiagnostic(error: unknown, token: string): string | undefined {
  if (!(error instanceof EasCliExecutionError)) return undefined;
  const output = stripAnsi(`${error.stderr}\n${error.stdout}`)
    .replaceAll(token, '[REDACTED]')
    .replace(/([?&](?:access_)?token=)[^&\s]+/gi, '$1[REDACTED]');
  const diagnostic = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 800);
  return diagnostic || undefined;
}

async function runCli(input: {
  runner: EasCliRunner;
  arguments: string[];
  cwd: string;
  token: string;
  code: string;
  message: string;
}): Promise<EasCliResult> {
  try {
    return await input.runner.run({
      arguments: input.arguments,
      cwd: input.cwd,
      environment: cliEnvironment(input.token),
    });
  } catch (error) {
    const diagnostic = safeCliDiagnostic(error, input.token);
    throw new EasNativeBuildError({
      code: input.code,
      message: input.message,
      retryable: true,
      ...(diagnostic ? { diagnostic } : {}),
    });
  }
}

export function parseEasNativeBuildContext(input: unknown): EasNativeBuildContext {
  return easNativeBuildContextSchema.parse(input);
}

export function parseEasNativeBuildContextSource(
  source: string,
  fileName: string,
): EasNativeBuildContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') return parseEasNativeBuildContext(JSON.parse(source));
  if (extension === '.yaml' || extension === '.yml') {
    return parseEasNativeBuildContext(parseYaml(source));
  }
  throw new Error(
    `Unsupported EAS native build context format: ${extension || 'missing extension'}`,
  );
}

function easNativeBuildPlanDigest(plan: EasNativeBuildPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

export function easNativeBuildMessage(plan: EasNativeBuildPlan): string {
  return `void-starter:${easNativeBuildPlanDigest(plan)}`;
}

async function readLocalGitHead(projectRoot: string): Promise<string> {
  const gitRoot = join(projectRoot, '.git');
  let head: string;
  try {
    head = (await readFile(join(gitRoot, 'HEAD'), 'utf8')).trim();
  } catch {
    throw new Error('EAS native builds require local Git metadata from source publication');
  }
  if (/^[a-f0-9]{40,64}$/.test(head)) return head;
  const reference = head.match(/^ref: (refs\/.+)$/)?.[1];
  if (!reference) throw new Error('EAS native builds found an invalid local Git HEAD');
  try {
    const loose = (await readFile(join(gitRoot, reference), 'utf8')).trim();
    if (/^[a-f0-9]{40,64}$/.test(loose)) return loose;
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
  try {
    const packed = await readFile(join(gitRoot, 'packed-refs'), 'utf8');
    const match = packed
      .split(/\r?\n/)
      .find((line) => line.endsWith(` ${reference}`))
      ?.split(' ')[0];
    if (match && /^[a-f0-9]{40,64}$/.test(match)) return match;
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
  throw new Error('EAS native builds could not resolve local Git HEAD');
}

export async function createEasNativeBuildPlan(
  projectRoot: string,
  context: EasNativeBuildContext,
): Promise<EasNativeBuildPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  if (manifest.surfaces.mobile.adapter !== 'expo-eas') {
    throw new Error('EAS native builds require the Expo/EAS mobile surface');
  }
  const manifestSha256 = sha256(serializeCanonicalJson(manifest));

  const easProjectState = await readEasProjectState(projectRoot);
  if (easProjectState?.status !== 'succeeded' || !easProjectState.observation) {
    throw new Error('EAS native builds require succeeded EAS project provisioning state');
  }
  await validateEasProjectState(easProjectState, manifestSha256, projectRoot);

  const sourceState = await readSourcePublicationState(projectRoot);
  if (sourceState?.status !== 'succeeded' || !sourceState.commit_sha) {
    throw new Error('EAS native builds require succeeded source publication state');
  }
  await validateSourcePublicationState(sourceState, manifestSha256, projectRoot);
  if ((await readLocalGitHead(projectRoot)) !== sourceState.commit_sha) {
    throw new Error('Local Git HEAD does not match the published source commit');
  }

  const generatedEasConfig = createProjectFilePlan(manifest).writes.find(
    (file) => file.path === EAS_CONFIG_PATH,
  );
  if (!generatedEasConfig) throw new Error('Generated EAS configuration is missing');
  const easConfigSource = await readFile(join(projectRoot, EAS_CONFIG_PATH), 'utf8');
  if (sha256(easConfigSource) !== sha256(generatedEasConfig.content)) {
    throw new Error('EAS native builds refuse modified generated eas.json');
  }
  const easConfig = easConfigSchema.parse(JSON.parse(easConfigSource));
  const profile = easConfig.build[context.profile];
  const credentialsSource = profile.credentialsSource ?? 'remote';
  if (credentialsSource !== 'remote') {
    throw new Error('EAS native builds currently require remote EAS-managed credentials');
  }
  for (const platform of context.platforms) {
    if (context.signing[platform].owner !== easProjectState.observation.owner) {
      throw new Error(`EAS ${platform} signing owner must match the provisioned EAS account`);
    }
  }

  return easNativeBuildPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: manifestSha256,
    context_sha256: sha256(serializeCanonicalJson(context)),
    eas_project: {
      state_plan_sha256: easProjectState.plan_sha256,
      project_id: easProjectState.observation.project_id,
      owner: easProjectState.observation.owner,
      slug: easProjectState.observation.slug,
      full_name: easProjectState.observation.full_name,
    },
    source: {
      state_plan_sha256: sourceState.plan_sha256,
      commit_sha: sourceState.commit_sha,
      sha256: sourceState.plan.source.sha256,
    },
    configuration: {
      path: EAS_CONFIG_PATH,
      sha256: sha256(easConfigSource),
      profile: context.profile,
      environment: profile.environment ?? context.profile,
      distribution: profile.distribution ?? 'store',
      credentials_source: credentialsSource,
      platforms: context.platforms,
    },
    environment: context.environment,
    signing: context.signing,
    store_memberships: context.store_memberships,
    safeguards: {
      freeze_credentials: true,
      auto_submit: false,
      non_interactive: true,
      no_wait: true,
      maximum_builds: context.cost.maximum_builds,
      maximum_provider_charge_usd: context.cost.maximum_provider_charge_usd,
      paid_builds: context.cost.paid_builds,
    },
    permissions: ['account:read', 'project:read', 'environment:read', 'build:read', 'build:create'],
  });
}

function parseAccountRole(output: string, account: string): string {
  const plain = stripAnsi(output);
  const match = plain.match(
    new RegExp(
      `(?:^|\\n)[^\\n]*${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*Role:\\s*([^)\\n]+)`,
      'i',
    ),
  );
  if (!match?.[1]) {
    throw new EasNativeBuildError({
      code: 'EAS_ACCOUNT_MEMBERSHIP_MISSING',
      message: 'EXPO_TOKEN cannot read the planned EAS account membership',
    });
  }
  return match[1].trim();
}

function parseProjectInfo(output: string): { id: string; fullName: string } {
  const plain = stripAnsi(output);
  const fullName = plain.match(/(?:^|\n)\s*fullName\s{2,}(@[^\s]+)\s*(?:\n|$)/i)?.[1];
  const id = plain.match(
    /(?:^|\n)\s*ID\s{2,}([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*(?:\n|$)/i,
  )?.[1];
  if (!fullName || !id) {
    throw new EasNativeBuildError({
      code: 'EAS_PROJECT_INFO_INVALID',
      message: 'EAS project information could not be safely parsed',
      retryable: true,
    });
  }
  return { id, fullName };
}

type EnvironmentMetadata = { name: string; visibility: string; type: string };

export function parseEasEnvironmentMetadata(output: string): EnvironmentMetadata[] {
  const variables: Array<Record<string, string>> = [];
  let current: Record<string, string> | undefined;
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = line.match(
      /^\s*(ID|Name|Value|Scope|Visibility|Environments|type|Created at|Updated at)\s{2,}(.*)\s*$/,
    );
    if (!match?.[1]) continue;
    if (match[1] === 'ID') {
      current = {};
      variables.push(current);
    }
    if (current && match[1] !== 'Value') current[match[1]] = match[2]?.trim() ?? '';
  }
  return variables
    .filter((variable) => variable['Scope']?.toUpperCase() === 'PROJECT')
    .map((variable) => ({
      name: variable['Name'] ?? '',
      visibility:
        variable['Visibility']?.toUpperCase() === 'PUBLIC'
          ? 'plaintext'
          : (variable['Visibility'] ?? '').toLowerCase(),
      type: (variable['type'] ?? '').toLowerCase(),
    }))
    .filter((variable) => variable.name && variable.visibility && variable.type)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function parseEasBuilds(output: string): RemoteBuild[] {
  const parsed = JSON.parse(stripAnsi(output)) as unknown;
  return z.array(remoteBuildSchema).parse(Array.isArray(parsed) ? parsed : [parsed]);
}

function observation(build: RemoteBuild): EasNativeBuildObservation {
  return {
    build_id: build.id,
    platform: build.platform === 'ANDROID' ? 'android' : 'ios',
    status: build.status,
    message: build.message ?? '',
    created_at: build.createdAt,
    updated_at: build.updatedAt,
    completed_at: build.completedAt ?? null,
  };
}

async function listMatchingBuilds(input: {
  runner: EasCliRunner;
  projectRoot: string;
  token: string;
  plan: EasNativeBuildPlan;
  platform: 'android' | 'ios';
}): Promise<EasNativeBuildObservation[]> {
  const result = await runCli({
    runner: input.runner,
    arguments: [
      'build:list',
      '--platform',
      input.platform,
      '--build-profile',
      input.plan.configuration.profile,
      '--git-commit-hash',
      input.plan.source.commit_sha,
      '--limit',
      '20',
      '--json',
      '--non-interactive',
    ],
    cwd: join(input.projectRoot, MOBILE_ROOT),
    token: input.token,
    code: 'EAS_BUILD_LIST_FAILED',
    message: 'EAS build history could not be read',
  });
  const marker = easNativeBuildMessage(input.plan);
  return parseEasBuilds(result.stdout)
    .filter(
      (build) =>
        build.message === marker &&
        build.gitCommitHash === input.plan.source.commit_sha &&
        build.buildProfile === input.plan.configuration.profile &&
        build.platform === input.platform.toUpperCase(),
    )
    .map(observation)
    .toSorted((left, right) => left.created_at.localeCompare(right.created_at));
}

const failedStatuses = new Set(['CANCELED', 'ERRORED']);
const finishedStatuses = new Set(['FINISHED']);

function lifecycleBlockers(
  plan: EasNativeBuildPlan,
  observedEnvironment: EnvironmentMetadata[],
  builds: EasNativeBuildObservation[],
): EasNativeBuildBlocker[] {
  const blockers: EasNativeBuildBlocker[] = [];
  for (const platform of plan.configuration.platforms) {
    if (!plan.signing[platform].credentials_ready) {
      blockers.push({
        code: `EAS_${platform.toUpperCase()}_SIGNING_NOT_READY`,
        message: `${platform} remote signing credentials are not attested as ready`,
      });
    }
  }
  if (plan.configuration.profile === 'production') {
    if (
      plan.configuration.platforms.includes('ios') &&
      plan.store_memberships.apple.status !== 'active'
    ) {
      blockers.push({
        code: 'APPLE_MEMBERSHIP_NOT_READY',
        message: 'Production iOS builds require an active Apple membership attestation',
      });
    }
    if (
      plan.configuration.platforms.includes('android') &&
      plan.store_memberships.google_play.status !== 'active'
    ) {
      blockers.push({
        code: 'GOOGLE_PLAY_MEMBERSHIP_NOT_READY',
        message: 'Production Android builds require an active Google Play membership attestation',
      });
    }
  }
  for (const required of plan.environment.required) {
    const observed = observedEnvironment.find((variable) => variable.name === required.name);
    if (!observed) {
      blockers.push({
        code: 'EAS_ENVIRONMENT_VARIABLE_MISSING',
        message: `Required EAS environment variable ${required.name} is missing`,
      });
    } else if (observed.visibility !== required.visibility || observed.type !== required.type) {
      blockers.push({
        code: 'EAS_ENVIRONMENT_VARIABLE_METADATA_MISMATCH',
        message: `Required EAS environment variable ${required.name} has unexpected metadata`,
      });
    }
  }
  for (const platform of plan.configuration.platforms) {
    const matches = builds.filter((build) => build.platform === platform);
    if (matches.length > 1) {
      blockers.push({
        code: 'EAS_BUILD_DUPLICATE',
        message: `Multiple ${platform} builds exist for this exact factory plan`,
      });
    } else if (matches[0] && failedStatuses.has(matches[0].status)) {
      blockers.push({
        code: 'EAS_BUILD_TERMINAL_FAILURE',
        message: `The ${platform} build for this exact factory plan ended as ${matches[0].status}`,
      });
    }
  }
  return blockers;
}

export async function preflightEasNativeBuild(input: {
  projectRoot: string;
  context: EasNativeBuildContext;
  environment: Record<string, string | undefined>;
  options?: EasNativeBuildOptions;
}): Promise<EasNativeBuildPreflight> {
  const token = expoToken(input.environment);
  const plan = await createEasNativeBuildPlan(input.projectRoot, input.context);
  const runner = input.options?.runner ?? new BunxEasNativeBuildRunner();
  const cwd = join(input.projectRoot, MOBILE_ROOT);
  const accountResult = await runCli({
    runner,
    arguments: ['account:view'],
    cwd,
    token,
    code: 'EAS_ACCOUNT_READ_FAILED',
    message: 'EAS account membership could not be read',
  });
  const accountRole = parseAccountRole(accountResult.stdout, plan.eas_project.owner);
  const projectResult = await runCli({
    runner,
    arguments: ['project:info'],
    cwd,
    token,
    code: 'EAS_PROJECT_READ_FAILED',
    message: 'EAS project could not be read',
  });
  const project = parseProjectInfo(projectResult.stdout);
  if (
    project.id !== plan.eas_project.project_id ||
    project.fullName !== plan.eas_project.full_name
  ) {
    throw new EasNativeBuildError({
      code: 'EAS_PROJECT_IDENTITY_MISMATCH',
      message: 'Linked EAS project does not match the factory plan',
    });
  }
  const environmentResult = await runCli({
    runner,
    arguments: [
      'env:list',
      plan.configuration.environment,
      '--format',
      'long',
      '--scope',
      'project',
      '--non-interactive',
    ],
    cwd,
    token,
    code: 'EAS_ENVIRONMENT_READ_FAILED',
    message: 'EAS environment metadata could not be read',
  });
  const observedEnvironment = parseEasEnvironmentMetadata(environmentResult.stdout);
  const builds = (
    await Promise.all(
      plan.configuration.platforms.map((platform) =>
        listMatchingBuilds({
          runner,
          projectRoot: input.projectRoot,
          token,
          plan,
          platform,
        }),
      ),
    )
  ).flat();
  const blockers = lifecycleBlockers(plan, observedEnvironment, builds);
  return {
    mode: 'eas-native-build-live-preflight',
    ok: true,
    ready_to_build: blockers.length === 0,
    plan_sha256: easNativeBuildPlanDigest(plan),
    project: { id: project.id, full_name: project.fullName, account_role: accountRole },
    environment: {
      name: plan.configuration.environment,
      required: plan.environment.required,
      observed: observedEnvironment,
    },
    builds,
    missing_platforms: plan.configuration.platforms.filter(
      (platform) => !builds.some((build) => build.platform === platform),
    ),
    blockers,
    cost_approval_required: true,
  };
}

async function writeAtomic(input: {
  destination: string;
  content: string;
  mode: number;
}): Promise<void> {
  const directory = dirname(input.destination);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(input.destination)}.${process.pid}.${randomUUID()}.temporary`,
  );
  try {
    await writeFile(temporaryPath, input.content, { encoding: 'utf8', mode: input.mode });
    await rename(temporaryPath, input.destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writeState(projectRoot: string, state: EasNativeBuildState): Promise<void> {
  await writeAtomic({
    destination: statePath(projectRoot),
    content: serializeCanonicalJson(state),
    mode: 0o600,
  });
}

export async function readEasNativeBuildState(
  projectRoot: string,
): Promise<EasNativeBuildState | null> {
  try {
    return easNativeBuildStateSchema.parse(
      JSON.parse(await readFile(statePath(projectRoot), 'utf8')),
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

async function acquireLock(projectRoot: string): Promise<EasBuildLock> {
  await mkdir(join(projectRoot, METADATA_DIRECTORY), { recursive: true });
  const lock: EasBuildLock = { schema_version: 1, pid: process.pid, owner_token: randomUUID() };
  try {
    await writeFile(lockPath(projectRoot), serializeCanonicalJson(lock), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return lock;
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      throw new Error('Another EAS native build lifecycle is active');
    }
    throw error;
  }
}

async function releaseLock(projectRoot: string, lock: EasBuildLock): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath(projectRoot), 'utf8')) as EasBuildLock;
    if (current.owner_token === lock.owner_token) await rm(lockPath(projectRoot));
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

function safeError(error: unknown) {
  if (error instanceof EasNativeBuildError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'EAS_NATIVE_BUILD_FAILURE',
      message: 'EAS native build lifecycle failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_EAS_NATIVE_BUILD_FAILURE',
    message: 'EAS native build lifecycle failed without a safe diagnostic',
    retryable: false,
  };
}

function deriveStatus(builds: EasNativeBuildObservation[], platformCount: number) {
  if (builds.some((build) => failedStatuses.has(build.status))) return 'failed' as const;
  if (
    builds.length === platformCount &&
    builds.every((build) => finishedStatuses.has(build.status))
  ) {
    return 'succeeded' as const;
  }
  return 'running' as const;
}

export async function applyEasNativeBuild(input: {
  projectRoot: string;
  context: EasNativeBuildContext;
  environment: Record<string, string | undefined>;
  confirmation: {
    project: string;
    maximumBuilds: number;
    maximumProviderChargeUsd: number;
  };
  requireExistingState?: boolean;
  options?: EasNativeBuildOptions;
}): Promise<EasNativeBuildState> {
  const token = expoToken(input.environment);
  const lock = await acquireLock(input.projectRoot);
  try {
    const plan = await createEasNativeBuildPlan(input.projectRoot, input.context);
    const digest = easNativeBuildPlanDigest(plan);
    if (
      input.confirmation.project !== plan.eas_project.slug ||
      input.confirmation.maximumBuilds !== plan.safeguards.maximum_builds ||
      input.confirmation.maximumProviderChargeUsd !== plan.safeguards.maximum_provider_charge_usd
    ) {
      throw new Error('EAS build confirmation must exactly match the project and cost envelope');
    }
    const existing = await readEasNativeBuildState(input.projectRoot);
    if (!existing && input.requireExistingState) {
      throw new Error('No EAS native build state exists to resume');
    }
    const state =
      existing ??
      easNativeBuildStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: digest,
        plan,
        attempts: 0,
        builds: [],
        error: null,
      });
    if (state.plan_sha256 !== digest || easNativeBuildPlanDigest(state.plan) !== digest) {
      throw new Error('Existing EAS native build state belongs to a different plan');
    }
    if (state.status === 'succeeded') {
      await validateEasNativeBuildState(state, plan.manifest_sha256, input.projectRoot);
      return state;
    }

    const runner = input.options?.runner ?? new BunxEasNativeBuildRunner();
    const preflight = await preflightEasNativeBuild({
      projectRoot: input.projectRoot,
      context: input.context,
      environment: input.environment,
      options: { runner },
    });
    if (!preflight.ready_to_build && !existing) {
      throw new EasNativeBuildApplyError('EAS_NATIVE_BUILD_PREFLIGHT_BLOCKED');
    }

    state.status = 'running';
    state.attempts += 1;
    state.builds = preflight.builds;
    state.error = null;
    await writeState(input.projectRoot, state);

    try {
      if (!preflight.ready_to_build) {
        throw new EasNativeBuildError({
          code: 'EAS_NATIVE_BUILD_PREFLIGHT_BLOCKED',
          message: 'EAS native build preflight reported blockers',
        });
      }

      for (const platform of preflight.missing_platforms) {
        let started: EasNativeBuildObservation[] = [];
        try {
          const result = await runCli({
            runner,
            arguments: [
              'build',
              '--platform',
              platform,
              '--profile',
              plan.configuration.profile,
              '--message',
              easNativeBuildMessage(plan),
              '--freeze-credentials',
              '--json',
              '--non-interactive',
              '--no-wait',
            ],
            cwd: join(input.projectRoot, MOBILE_ROOT),
            token,
            code: 'EAS_BUILD_CREATE_FAILED',
            message: `EAS ${platform} build could not be started`,
          });
          started = parseEasBuilds(result.stdout)
            .filter(
              (build) =>
                build.message === easNativeBuildMessage(plan) &&
                build.gitCommitHash === plan.source.commit_sha &&
                build.platform === platform.toUpperCase(),
            )
            .map(observation);
        } catch (error) {
          const reconciled = await listMatchingBuilds({
            runner,
            projectRoot: input.projectRoot,
            token,
            plan,
            platform,
          });
          if (reconciled.length === 0) throw error;
          started = reconciled;
        }
        if (started.length !== 1) {
          throw new EasNativeBuildError({
            code: 'EAS_BUILD_CREATE_UNCONFIRMED',
            message: `EAS ${platform} build creation could not be uniquely confirmed`,
            retryable: true,
          });
        }
        state.builds = [
          ...state.builds.filter((build) => build.platform !== platform),
          started[0] as EasNativeBuildObservation,
        ].toSorted((left, right) => left.platform.localeCompare(right.platform));
        await writeState(input.projectRoot, state);
      }

      const reconciled = (
        await Promise.all(
          plan.configuration.platforms.map((platform) =>
            listMatchingBuilds({
              runner,
              projectRoot: input.projectRoot,
              token,
              plan,
              platform,
            }),
          ),
        )
      ).flat();
      if (reconciled.length === plan.configuration.platforms.length) {
        state.builds = reconciled.toSorted((left, right) =>
          left.platform.localeCompare(right.platform),
        );
      }
      if (
        plan.configuration.platforms.some(
          (platform) => state.builds.filter((build) => build.platform === platform).length !== 1,
        )
      ) {
        throw new EasNativeBuildError({
          code: 'EAS_BUILD_RECONCILIATION_FAILED',
          message: 'EAS builds could not be uniquely reconciled',
          retryable: true,
        });
      }
      state.status = deriveStatus(state.builds, plan.configuration.platforms.length);
      if (state.status === 'failed') {
        throw new EasNativeBuildError({
          code: 'EAS_BUILD_TERMINAL_FAILURE',
          message: 'At least one EAS native build ended unsuccessfully',
        });
      }
      await writeState(input.projectRoot, state);
      return state;
    } catch (error) {
      const sanitized = safeError(error);
      state.status = 'failed';
      state.error = sanitized;
      await writeState(input.projectRoot, state);
      throw new EasNativeBuildApplyError(
        sanitized.code,
        error instanceof EasNativeBuildError ? error.diagnostic : undefined,
      );
    }
  } finally {
    await releaseLock(input.projectRoot, lock);
  }
}

export async function validateEasNativeBuildState(
  state: EasNativeBuildState,
  expectedManifestSha256: string,
  projectRoot: string,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('EAS native build state manifest digest does not match generation metadata');
  }
  if (
    state.plan_sha256 !== easNativeBuildPlanDigest(state.plan) ||
    sha256(await readFile(join(projectRoot, state.plan.configuration.path), 'utf8')) !==
      state.plan.configuration.sha256
  ) {
    throw new Error('EAS native build state no longer matches its immutable plan');
  }
  const easProjectState = await readEasProjectState(projectRoot);
  if (
    easProjectState?.status !== 'succeeded' ||
    easProjectState.plan_sha256 !== state.plan.eas_project.state_plan_sha256
  ) {
    throw new Error('EAS native build state requires its exact succeeded EAS project receipt');
  }
  await validateEasProjectState(easProjectState, expectedManifestSha256, projectRoot);
  const sourceState = await readSourcePublicationState(projectRoot);
  if (
    sourceState?.status !== 'succeeded' ||
    sourceState.plan_sha256 !== state.plan.source.state_plan_sha256 ||
    sourceState.commit_sha !== state.plan.source.commit_sha
  ) {
    throw new Error('EAS native build state requires its exact succeeded source receipt');
  }
  await validateSourcePublicationState(sourceState, expectedManifestSha256, projectRoot);
  const marker = easNativeBuildMessage(state.plan);
  if (
    state.builds.some(
      (build) =>
        build.message !== marker || !state.plan.configuration.platforms.includes(build.platform),
    ) ||
    new Set(state.builds.map((build) => build.platform)).size !== state.builds.length
  ) {
    throw new Error('EAS native build receipt contains builds outside its exact plan');
  }
  if (
    state.status === 'succeeded' &&
    (state.error ||
      state.builds.length !== state.plan.configuration.platforms.length ||
      !state.builds.every((build) => build.status === 'FINISHED'))
  ) {
    throw new Error('Succeeded EAS native build state is missing finished build receipts');
  }
}
