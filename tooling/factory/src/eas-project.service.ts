import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { createProjectFilePlan } from './capability-composition.service';
import {
  type EasProjectContext,
  type EasProjectLink,
  type EasProjectObservation,
  type EasProjectPlan,
  type EasProjectState,
  easProjectContextSchema,
  easProjectLinkSchema,
  easProjectPlanSchema,
  easProjectStateSchema,
} from './eas-project.types';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';

const EAS_CLI_PACKAGE = 'eas-cli@21.2.0';
const METADATA_DIRECTORY = '.void-starter';
const STATE_FILE = 'eas-state.json';
const LOCK_FILE = 'eas.lock';
const STATIC_CONFIG_PATH = 'apps/mobile/app.json';
const DYNAMIC_CONFIG_PATH = 'apps/mobile/app.config.ts';
const LINK_PATH = 'apps/mobile/eas-project.json';

type EasLockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

export type EasCliResult = {
  stdout: string;
  stderr: string;
};

export type EasCliRunner = {
  run(input: {
    arguments: string[];
    cwd: string;
    environment: NodeJS.ProcessEnv;
  }): Promise<EasCliResult>;
};

export type EasProjectOptions = {
  runner?: EasCliRunner;
  now?: () => number;
  temporaryRoot?: string;
};

const expoAppConfigSchema = z.object({
  expo: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    owner: z.string().optional(),
    extra: z
      .object({
        eas: z
          .object({
            projectId: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    ios: z.object({ bundleIdentifier: z.string().min(1) }),
    android: z.object({ package: z.string().min(1) }),
  }),
});

export class EasProjectError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'EasProjectError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export class EasProjectApplyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`EAS project provisioning failed with code ${code}`);
    this.name = 'EasProjectApplyError';
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

function linkPath(projectRoot: string): string {
  return join(projectRoot, LINK_PATH);
}

function expoToken(environment: Record<string, string | undefined>): string {
  const token = environment['EXPO_TOKEN']?.trim();
  if (!token) throw new Error('EAS project provisioning requires EXPO_TOKEN');
  return token;
}

export function parseEasProjectContext(input: unknown): EasProjectContext {
  return easProjectContextSchema.parse(input);
}

export function parseEasProjectContextSource(source: string, fileName: string): EasProjectContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') return parseEasProjectContext(JSON.parse(source));
  if (extension === '.yaml' || extension === '.yml') {
    return parseEasProjectContext(parseYaml(source));
  }
  throw new Error(`Unsupported EAS context format: ${extension || 'missing extension'}`);
}

export function easProjectPlanDigest(plan: EasProjectPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

async function readOptionalLink(projectRoot: string): Promise<EasProjectLink | null> {
  try {
    return easProjectLinkSchema.parse(JSON.parse(await readFile(linkPath(projectRoot), 'utf8')));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

export async function createEasProjectPlan(
  projectRoot: string,
  context: EasProjectContext,
): Promise<EasProjectPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  if (manifest.surfaces.mobile.adapter !== 'expo-eas') {
    throw new Error('EAS project provisioning requires the Expo/EAS mobile surface');
  }

  const generatedFiles = createProjectFilePlan(manifest).writes;
  const expectedStatic = generatedFiles.find((file) => file.path === STATIC_CONFIG_PATH);
  const expectedDynamic = generatedFiles.find((file) => file.path === DYNAMIC_CONFIG_PATH);
  if (!expectedStatic || !expectedDynamic) {
    throw new Error('EAS project provisioning requires generated Expo configuration files');
  }
  const staticSource = await readFile(join(projectRoot, STATIC_CONFIG_PATH), 'utf8');
  const dynamicSource = await readFile(join(projectRoot, DYNAMIC_CONFIG_PATH), 'utf8');
  if (
    sha256(staticSource) !== sha256(expectedStatic.content) ||
    sha256(dynamicSource) !== sha256(expectedDynamic.content)
  ) {
    throw new Error('EAS project provisioning refuses modified generated Expo configuration');
  }
  const app = expoAppConfigSchema.parse(JSON.parse(staticSource));
  if (app.expo.owner || app.expo.extra?.eas?.projectId) {
    throw new Error('Generated static Expo configuration must remain provider-neutral');
  }
  if (
    app.expo.slug !== manifest.project.name ||
    app.expo.ios.bundleIdentifier !== manifest.surfaces.mobile.ios_bundle_identifier ||
    app.expo.android.package !== manifest.surfaces.mobile.android_package
  ) {
    throw new Error('Generated Expo configuration does not match the manifest');
  }

  const existingLink = await readOptionalLink(projectRoot);
  if (
    existingLink &&
    (existingLink.owner !== context.account || existingLink.slug !== manifest.project.name)
  ) {
    throw new Error('Existing EAS project link belongs to a different owner or slug');
  }

  return easProjectPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: sha256(serializeCanonicalJson(manifest)),
    context_sha256: sha256(serializeCanonicalJson(context)),
    application: {
      provider: 'expo-eas',
      owner: context.account,
      slug: manifest.project.name,
      full_name: `@${context.account}/${manifest.project.name}`,
      ios_bundle_identifier: manifest.surfaces.mobile.ios_bundle_identifier,
      android_package: manifest.surfaces.mobile.android_package,
      static_config_path: STATIC_CONFIG_PATH,
      static_config_sha256: sha256(staticSource),
      dynamic_config_path: DYNAMIC_CONFIG_PATH,
      dynamic_config_sha256: sha256(dynamicSource),
      link_path: LINK_PATH,
    },
    permissions: ['account:read', 'project:read', 'project:create'],
  });
}

class BunxEasCliRunner implements EasCliRunner {
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
          maxBuffer: 4 * 1024 * 1024,
          timeout: 120_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise({ stdout, stderr });
        },
      );
    });
  }
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function accountRole(output: string, account: string): string {
  const plain = stripAnsi(output);
  const accountMatch = plain.match(
    new RegExp(
      `^•\\s+${escapeRegex(account)}\\s+\\(Role:\\s+(Owner|Admin|Developer|Viewer|Custom)\\)$`,
      'im',
    ),
  );
  const role = accountMatch?.[1];
  if (role === 'Viewer') {
    throw new EasProjectError({
      code: 'EAS_ACCOUNT_PERMISSION_REQUIRED',
      message: 'Expo account membership cannot create or link projects',
    });
  }
  if (role) return role;

  const actor = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+\(authenticated using EXPO_TOKEN\)$/, '');
  if (actor?.toLowerCase() === account.toLowerCase()) return 'Owner';
  throw new EasProjectError({
    code: 'EAS_ACCOUNT_MISMATCH',
    message: 'Authenticated Expo actor cannot access the requested account',
  });
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
    if (error instanceof EasProjectError) throw error;
    throw new EasProjectError({ code: input.code, message: input.message, retryable: true });
  }
}

async function verifyAccount(input: {
  runner: EasCliRunner;
  projectRoot: string;
  token: string;
  account: string;
}): Promise<string> {
  const result = await runCli({
    runner: input.runner,
    arguments: ['account:view'],
    cwd: input.projectRoot,
    token: input.token,
    code: 'EAS_ACCOUNT_READ_FAILED',
    message: 'Expo account preflight failed',
  });
  return accountRole(result.stdout, input.account);
}

async function createTemporaryAppConfig(input: {
  projectRoot: string;
  plan: EasProjectPlan;
  link: EasProjectLink | null;
  temporaryRoot?: string;
}): Promise<string> {
  const directory = await mkdtemp(join(input.temporaryRoot ?? tmpdir(), 'void-starter-eas-'));
  const source = JSON.parse(
    await readFile(join(input.projectRoot, input.plan.application.static_config_path), 'utf8'),
  ) as { expo: Record<string, unknown> };
  source.expo['owner'] = input.plan.application.owner;
  if (input.link) {
    const extra =
      typeof source.expo['extra'] === 'object' && source.expo['extra'] !== null
        ? (source.expo['extra'] as Record<string, unknown>)
        : {};
    const eas =
      typeof extra['eas'] === 'object' && extra['eas'] !== null
        ? (extra['eas'] as Record<string, unknown>)
        : {};
    source.expo['extra'] = { ...extra, eas: { ...eas, projectId: input.link.project_id } };
  }
  await writeFile(join(directory, 'app.json'), `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  return directory;
}

async function inspectLinkedProject(input: {
  runner: EasCliRunner;
  directory: string;
  token: string;
  plan: EasProjectPlan;
}): Promise<EasProjectLink> {
  const source = expoAppConfigSchema.parse(
    JSON.parse(await readFile(join(input.directory, 'app.json'), 'utf8')),
  );
  const projectId = source.expo.extra?.eas?.projectId;
  if (
    source.expo.owner !== input.plan.application.owner ||
    source.expo.slug !== input.plan.application.slug ||
    source.expo.ios.bundleIdentifier !== input.plan.application.ios_bundle_identifier ||
    source.expo.android.package !== input.plan.application.android_package ||
    !projectId
  ) {
    throw new EasProjectError({
      code: 'EAS_PROJECT_CONFIG_MISMATCH',
      message: 'EAS CLI produced an unexpected Expo project link',
    });
  }
  const link = easProjectLinkSchema.parse({
    schema_version: 1,
    owner: source.expo.owner,
    slug: source.expo.slug,
    project_id: projectId,
  });
  const info = await runCli({
    runner: input.runner,
    arguments: ['project:info'],
    cwd: input.directory,
    token: input.token,
    code: 'EAS_PROJECT_READ_FAILED',
    message: 'EAS project verification failed',
  });
  const output = stripAnsi(info.stdout);
  if (!output.includes(input.plan.application.full_name) || !output.includes(link.project_id)) {
    throw new EasProjectError({
      code: 'EAS_PROJECT_IDENTITY_MISMATCH',
      message: 'EAS project identity does not match the provisioning plan',
    });
  }
  return link;
}

async function inspectExistingLink(input: {
  runner: EasCliRunner;
  projectRoot: string;
  token: string;
  plan: EasProjectPlan;
  link: EasProjectLink;
  temporaryRoot?: string;
}): Promise<void> {
  const directory = await createTemporaryAppConfig(input);
  try {
    await inspectLinkedProject({ ...input, directory });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function preflightEasProject(input: {
  projectRoot: string;
  context: EasProjectContext;
  environment: Record<string, string | undefined>;
  options?: EasProjectOptions;
}) {
  const plan = await createEasProjectPlan(input.projectRoot, input.context);
  const token = expoToken(input.environment);
  const runner = input.options?.runner ?? new BunxEasCliRunner();
  const role = await verifyAccount({
    runner,
    projectRoot: input.projectRoot,
    token,
    account: plan.application.owner,
  });
  const link = await readOptionalLink(input.projectRoot);
  if (link) {
    await inspectExistingLink({
      runner,
      projectRoot: input.projectRoot,
      token,
      plan,
      link,
      ...(input.options?.temporaryRoot ? { temporaryRoot: input.options.temporaryRoot } : {}),
    });
  }
  return {
    mode: 'eas-project-live-preflight' as const,
    ok: true as const,
    plan_sha256: easProjectPlanDigest(plan),
    account: plan.application.owner,
    account_role: role,
    project: link ? ('linked' as const) : ('absent-or-unlinked' as const),
    full_name: plan.application.full_name,
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

async function acquireLock(projectRoot: string): Promise<EasLockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const lock: EasLockMetadata = { schema_version: 1, pid: process.pid, owner_token: randomUUID() };
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
          ) as Partial<EasLockMetadata>;
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
      throw new Error('Another EAS project provisioning is active or left an unreadable lock');
    }
  }
  throw new Error('Unable to acquire EAS project provisioning lock');
}

async function releaseLock(projectRoot: string, lock: EasLockMetadata): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath(projectRoot), 'utf8')) as EasLockMetadata;
    if (current.owner_token === lock.owner_token) await rm(lockPath(projectRoot));
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
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
    await writeFile(temporaryPath, input.content, {
      encoding: 'utf8',
      mode: input.mode,
    });
    await rename(temporaryPath, input.destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writeState(projectRoot: string, state: EasProjectState): Promise<void> {
  await writeAtomic({
    destination: statePath(projectRoot),
    content: serializeCanonicalJson(state),
    mode: 0o600,
  });
}

async function writeLink(projectRoot: string, link: EasProjectLink): Promise<string> {
  const content = serializeCanonicalJson(link);
  await writeAtomic({ destination: linkPath(projectRoot), content, mode: 0o644 });
  return sha256(content);
}

export async function readEasProjectState(projectRoot: string): Promise<EasProjectState | null> {
  try {
    return easProjectStateSchema.parse(JSON.parse(await readFile(statePath(projectRoot), 'utf8')));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

function safeError(error: unknown) {
  if (error instanceof EasProjectError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'EAS_PROJECT_FAILURE',
      message: 'EAS project provisioning failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_EAS_PROJECT_FAILURE',
    message: 'EAS project provisioning failed without a safe diagnostic',
    retryable: false,
  };
}

export async function applyEasProject(input: {
  projectRoot: string;
  context: EasProjectContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: EasProjectOptions;
}): Promise<EasProjectState> {
  const token = expoToken(input.environment);
  const lock = await acquireLock(input.projectRoot);
  try {
    const plan = await createEasProjectPlan(input.projectRoot, input.context);
    const digest = easProjectPlanDigest(plan);
    const existing = await readEasProjectState(input.projectRoot);
    if (!existing && input.requireExistingState) {
      throw new Error('No EAS project provisioning state exists to resume');
    }
    const state =
      existing ??
      easProjectStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: digest,
        plan,
        attempts: 0,
        observation: null,
        error: null,
      });
    if (state.plan_sha256 !== digest || easProjectPlanDigest(state.plan) !== digest) {
      throw new Error('Existing EAS project state belongs to a different plan');
    }
    if (state.status === 'succeeded') {
      await validateEasProjectState(state, plan.manifest_sha256, input.projectRoot);
      return state;
    }

    state.status = 'running';
    state.attempts += 1;
    state.observation = null;
    state.error = null;
    await writeState(input.projectRoot, state);

    let directory: string | undefined;
    try {
      const runner = input.options?.runner ?? new BunxEasCliRunner();
      await verifyAccount({
        runner,
        projectRoot: input.projectRoot,
        token,
        account: plan.application.owner,
      });
      const existingLink = await readOptionalLink(input.projectRoot);
      directory = await createTemporaryAppConfig({
        projectRoot: input.projectRoot,
        plan,
        link: existingLink,
        ...(input.options?.temporaryRoot ? { temporaryRoot: input.options.temporaryRoot } : {}),
      });
      await runCli({
        runner,
        arguments: ['project:init', '--force', '--non-interactive'],
        cwd: directory,
        token,
        code: 'EAS_PROJECT_INIT_FAILED',
        message: 'EAS project creation or adoption failed',
      });
      const link = await inspectLinkedProject({ runner, directory, token, plan });
      const linkSha256 = await writeLink(input.projectRoot, link);
      const observation: EasProjectObservation = {
        project_id: link.project_id,
        owner: link.owner,
        slug: link.slug,
        full_name: plan.application.full_name,
        link_sha256: linkSha256,
        linked_at: new Date((input.options?.now ?? Date.now)()).toISOString(),
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
      throw new EasProjectApplyError(sanitized.code);
    } finally {
      if (directory) await rm(directory, { force: true, recursive: true });
    }
  } finally {
    await releaseLock(input.projectRoot, lock);
  }
}

export async function validateEasProjectState(
  state: EasProjectState,
  expectedManifestSha256: string,
  projectRoot: string,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('EAS project state manifest digest does not match generation metadata');
  }
  const digest = easProjectPlanDigest(state.plan);
  if (state.plan_sha256 !== digest) {
    throw new Error('EAS project state plan digest is invalid');
  }
  if (
    sha256(await readFile(join(projectRoot, state.plan.application.static_config_path), 'utf8')) !==
      state.plan.application.static_config_sha256 ||
    sha256(
      await readFile(join(projectRoot, state.plan.application.dynamic_config_path), 'utf8'),
    ) !== state.plan.application.dynamic_config_sha256
  ) {
    throw new Error('EAS project state no longer matches generated Expo configuration');
  }
  if (state.status === 'succeeded') {
    if (!state.observation || state.error) {
      throw new Error('Succeeded EAS project state is missing its observation');
    }
    const link = await readOptionalLink(projectRoot);
    if (
      !link ||
      link.project_id !== state.observation.project_id ||
      link.owner !== state.observation.owner ||
      link.slug !== state.observation.slug ||
      sha256(serializeCanonicalJson(link)) !== state.observation.link_sha256
    ) {
      throw new Error('EAS project link does not match its provisioning receipt');
    }
  }
}
