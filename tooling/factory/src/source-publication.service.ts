import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import type { ProvisioningContext } from './provisioning.types';
import { readProvisioningState } from './provisioning-apply.service';
import {
  type SourcePublicationPlan,
  type SourcePublicationState,
  sourcePublicationPlanSchema,
  sourcePublicationStateSchema,
} from './source-publication.types';

const GITHUB_API = 'https://api.github.com';
const METADATA_DIRECTORY = '.void-starter';
const SOURCE_STATE_FILE = 'source-state.json';
const SOURCE_LOCK_FILE = 'source.lock';
const SOURCE_MARKER = 'Void-Starter-Source-SHA256';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.expo',
  '.git',
  '.next',
  '.turbo',
  '.vitest-cache',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

const EXCLUDED_EXACT_PATHS = new Set([
  '.claude/settings.local.json',
  '.void-starter/apply-state.json',
  '.void-starter/apply.lock',
  '.void-starter/delivery-state.json',
  '.void-starter/delivery.lock',
  '.void-starter/source-state.json',
  '.void-starter/source.lock',
]);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SourceSnapshotFile = {
  path: string;
  mode: '100644' | '100755';
  gitBlobSha1: string;
  sha256: string;
  size: number;
};

type SourceSnapshot = {
  sha256: string;
  files: SourceSnapshotFile[];
  totalBytes: number;
};

type AuthenticatedGitHubUser = {
  login: string;
  id: number;
};

export type RemoteSource = {
  commitSha: string;
  treeSha: string;
  sourceSha256: string | null;
};

type SourceUpdateBase = {
  commitSha: string;
  treeSha: string;
  sourceSha256: string;
  owner: string;
  repository: string;
  branch: 'main';
  token: string;
};

export type PreparedSourceCommit = {
  commitSha: string;
  treeSha: string;
};

export type SourceControl = {
  prepare(input: {
    projectRoot: string;
    snapshot: SourceSnapshot;
    projectName: string;
    user: AuthenticatedGitHubUser;
    base?: SourceUpdateBase;
  }): Promise<PreparedSourceCommit>;
  push(input: {
    projectRoot: string;
    commitSha: string;
    owner: string;
    repository: string;
    branch: 'main';
    token: string;
  }): Promise<void>;
};

export type SourcePublicationOptions = {
  fetch?: FetchLike;
  sourceControl?: SourceControl;
};

type SourceLockMetadata = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

const githubUserSchema = z.object({
  login: z.string().min(1),
  id: z.number().int().positive(),
});

const githubMembershipSchema = z.object({
  state: z.enum(['active', 'pending']),
  organization: z.object({
    login: z.string().min(1),
  }),
});

const githubRepositorySchema = z.object({
  node_id: z.string().min(1),
  full_name: z.string().min(1),
  private: z.boolean(),
  default_branch: z.string().min(1),
});

const githubReferenceSchema = z.object({
  object: z.object({
    sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  }),
});

const githubCommitSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  message: z.string(),
  tree: z.object({
    sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  }),
});

export class SourcePublicationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'SourcePublicationError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
}

export class SourcePublicationApplyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Source publication failed with code ${code}`);
    this.name = 'SourcePublicationApplyError';
    this.code = code;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function normalizedPath(path: string): string {
  return path.split(sep).join('/');
}

function isExcludedPath(path: string, isDirectory: boolean): boolean {
  if (EXCLUDED_EXACT_PATHS.has(path)) {
    return true;
  }
  const segments = path.split('/');
  if (isDirectory && segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }
  if (path.startsWith('.void-starter/.apply-state.json.')) {
    return true;
  }
  if (path.startsWith('.void-starter/.source-state.json.')) {
    return true;
  }
  if (path.startsWith('.void-starter/.delivery-state.json.')) {
    return true;
  }
  const fileName = segments.at(-1) ?? '';
  if (fileName === '.DS_Store' || fileName.endsWith('.log') || fileName.endsWith('.tsbuildinfo')) {
    return true;
  }
  if (fileName.startsWith('.env') && fileName !== '.env.example') {
    return true;
  }
  return false;
}

async function collectSourceSnapshot(projectRoot: string): Promise<SourceSnapshot> {
  const root = await realpath(resolve(projectRoot));
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) {
    throw new Error('Source publication root must be a directory');
  }

  const files: SourceSnapshotFile[] = [];
  let totalBytes = 0;

  async function walk(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).toSorted(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizedPath(relative(root, absolutePath));
      if (isExcludedPath(relativePath, entry.isDirectory())) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new SourcePublicationError({
          code: 'SOURCE_SYMLINK_FORBIDDEN',
          message: `Source publication refuses symbolic link ${relativePath}`,
        });
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new SourcePublicationError({
          code: 'SOURCE_ENTRY_UNSUPPORTED',
          message: `Source publication refuses unsupported entry ${relativePath}`,
        });
      }
      if (
        relativePath.includes('\n') ||
        relativePath.includes('\t') ||
        relativePath.includes('\0')
      ) {
        throw new SourcePublicationError({
          code: 'SOURCE_PATH_UNSUPPORTED',
          message: 'Source publication refuses control characters in paths',
        });
      }
      if (entry.name === '.npmrc' || entry.name === '.netrc') {
        throw new SourcePublicationError({
          code: 'SOURCE_CREDENTIAL_FILE_FORBIDDEN',
          message: `Source publication refuses credential-bearing file ${relativePath}`,
        });
      }
      const content = await readFile(absolutePath);
      const metadata = await lstat(absolutePath);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_SOURCE_BYTES) {
        throw new SourcePublicationError({
          code: 'SOURCE_TOO_LARGE',
          message: `Source publication exceeds ${MAX_SOURCE_BYTES} bytes`,
        });
      }
      files.push({
        path: relativePath,
        mode: (metadata.mode & 0o111) === 0 ? '100644' : '100755',
        gitBlobSha1: createHash('sha1')
          .update(`blob ${content.byteLength}\0`)
          .update(content)
          .digest('hex'),
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.byteLength,
      });
    }
  }

  await walk(root);
  if (!files.some((file) => file.path === 'bun.lock')) {
    throw new SourcePublicationError({
      code: 'SOURCE_LOCKFILE_MISSING',
      message: 'Source publication requires bun.lock; run bun install first',
    });
  }
  if (files.length === 0) {
    throw new SourcePublicationError({
      code: 'SOURCE_EMPTY',
      message: 'Source publication found no publishable files',
    });
  }

  const sortedFiles = files.toSorted((left, right) => left.path.localeCompare(right.path));
  return {
    sha256: sha256(serializeCanonicalJson(sortedFiles)),
    files: sortedFiles,
    totalBytes,
  };
}

function sourceStatePath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, SOURCE_STATE_FILE);
}

function sourceLockPath(projectRoot: string): string {
  return join(projectRoot, METADATA_DIRECTORY, SOURCE_LOCK_FILE);
}

function sourcePlanDigest(plan: SourcePublicationPlan): string {
  return sha256(serializeCanonicalJson(plan));
}

async function writeSourceStateAtomic(
  projectRoot: string,
  state: SourcePublicationState,
): Promise<void> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  const temporaryPath = join(
    metadataRoot,
    `.${SOURCE_STATE_FILE}.${process.pid}.${randomUUID()}.temporary`,
  );
  await mkdir(metadataRoot, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeCanonicalJson(state), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, sourceStatePath(projectRoot));
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

async function recoverStaleSourceLock(projectRoot: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(
      await readFile(sourceLockPath(projectRoot), 'utf8'),
    ) as Partial<SourceLockMetadata>;
    if (
      metadata.schema_version !== 1 ||
      typeof metadata.pid !== 'number' ||
      typeof metadata.owner_token !== 'string' ||
      processIsAlive(metadata.pid)
    ) {
      return false;
    }
    await rm(sourceLockPath(projectRoot));
    return true;
  } catch {
    return false;
  }
}

async function acquireSourceLock(projectRoot: string): Promise<SourceLockMetadata> {
  const metadataRoot = join(projectRoot, METADATA_DIRECTORY);
  await mkdir(metadataRoot, { recursive: true });
  const metadata: SourceLockMetadata = {
    schema_version: 1,
    pid: process.pid,
    owner_token: randomUUID(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(sourceLockPath(projectRoot), serializeCanonicalJson(metadata), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return metadata;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await recoverStaleSourceLock(projectRoot))) {
        continue;
      }
      throw new Error('Another source publication is active or left an unreadable lock');
    }
  }
  throw new Error('Unable to acquire the source publication lock');
}

async function releaseSourceLock(projectRoot: string, lock: SourceLockMetadata): Promise<void> {
  try {
    const current = JSON.parse(
      await readFile(sourceLockPath(projectRoot), 'utf8'),
    ) as SourceLockMetadata;
    if (current.owner_token === lock.owner_token) {
      await rm(sourceLockPath(projectRoot));
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
  }
}

export async function readSourcePublicationState(
  projectRoot: string,
): Promise<SourcePublicationState | null> {
  try {
    return sourcePublicationStateSchema.parse(
      JSON.parse(await readFile(sourceStatePath(projectRoot), 'utf8')),
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

function assertSourceStateMatchesPlan(
  state: SourcePublicationState,
  plan: SourcePublicationPlan,
): void {
  const digest = sourcePlanDigest(plan);
  if (state.plan_sha256 !== digest || sourcePlanDigest(state.plan) !== digest) {
    throw new Error('Existing source publication state belongs to a different or modified plan');
  }
}

export async function createSourcePublicationPlan(
  projectRoot: string,
  context: ProvisioningContext,
): Promise<SourcePublicationPlan> {
  const manifest = parseBuildManifest(
    JSON.parse(await readFile(join(projectRoot, METADATA_DIRECTORY, 'manifest.json'), 'utf8')),
  );
  const provisioningState = await readProvisioningState(projectRoot);
  if (provisioningState?.mode !== 'live' || provisioningState.status !== 'succeeded') {
    throw new Error('Source publication requires succeeded live provisioning state');
  }
  const repositoryAction = provisioningState.plan.actions.find(
    (action) => action.id === 'github.repository',
  );
  const repositoryState = provisioningState.actions.find(
    (action) => action.action_id === 'github.repository',
  );
  if (
    !repositoryAction ||
    !repositoryState ||
    repositoryState.status !== 'succeeded' ||
    !repositoryState.resource ||
    repositoryState.resource.provider !== 'github' ||
    repositoryState.resource.resource_kind !== 'repository'
  ) {
    throw new Error('Source publication requires a succeeded GitHub repository resource');
  }
  if (
    repositoryAction.input.owner !== context.github.owner ||
    repositoryAction.input.owner_kind !== context.github.owner_kind ||
    repositoryAction.input.visibility !== context.github.visibility ||
    repositoryAction.input.name !== manifest.project.name
  ) {
    throw new Error('Source publication context does not match provisioned GitHub repository');
  }

  const snapshot = await collectSourceSnapshot(projectRoot);
  return sourcePublicationPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: sha256(serializeCanonicalJson(manifest)),
    context_sha256: sha256(serializeCanonicalJson(context)),
    repository: {
      owner: context.github.owner,
      owner_kind: context.github.owner_kind,
      name: manifest.project.name,
      node_id: repositoryState.resource.resource_id,
      visibility: context.github.visibility,
      branch: 'main',
    },
    source: {
      sha256: snapshot.sha256,
      file_count: snapshot.files.length,
      total_bytes: snapshot.totalBytes,
      required_lockfile: 'bun.lock',
    },
    permissions: ['repository:contents:write', 'repository:workflows:write'],
  });
}

function createSourceUpdatePlan(
  sourcePlan: SourcePublicationPlan,
  remote: RemoteSource | null,
): SourcePublicationPlan {
  if (!remote) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_UPDATE_BASE_MISSING',
      message: 'Source update requires an existing remote main branch',
    });
  }
  if (!remote.sourceSha256) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_UPDATE_BASE_UNMANAGED',
      message: 'Remote main does not carry a Void Starter source marker',
    });
  }
  if (remote.sourceSha256 === sourcePlan.source.sha256) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_UPDATE_UNCHANGED',
      message: 'Remote main already carries the requested source snapshot',
    });
  }
  return sourcePublicationPlanSchema.parse({
    ...sourcePlan,
    base: {
      commit_sha: remote.commitSha,
      tree_sha: remote.treeSha,
      source_sha256: remote.sourceSha256,
    },
  });
}

function sourceMarker(sourceSha256: string): string {
  return `${SOURCE_MARKER}: ${sourceSha256}`;
}

function parseSourceMarker(message: string): string | null {
  const match = message.match(new RegExp(`(?:^|\\n)${SOURCE_MARKER}: ([a-f0-9]{64})(?:\\n|$)`));
  return match?.[1] ?? null;
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

class GitHubSourceClient {
  readonly #token: string;
  readonly #fetch: FetchLike;

  constructor(token: string, fetchImplementation: FetchLike) {
    this.#token = token;
    this.#fetch = fetchImplementation;
  }

  async #request(url: string, acceptedStatuses: number[]): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.#token}`,
          'User-Agent': 'void-starter-factory',
          'X-GitHub-Api-Version': '2026-03-10',
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SourcePublicationError({
        code: 'GITHUB_NETWORK_FAILURE',
        message: 'GitHub source request failed before a response was confirmed',
        retryable: true,
      });
    }
    if (!acceptedStatuses.includes(response.status)) {
      throw new SourcePublicationError({
        code: `GITHUB_HTTP_${response.status}`,
        message: `GitHub source request returned HTTP ${response.status}`,
        retryable: response.status === 423 || response.status === 429 || response.status >= 500,
      });
    }
    return response;
  }

  async #json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw new SourcePublicationError({
        code: 'GITHUB_INVALID_RESPONSE',
        message: 'GitHub returned an invalid source-publication response',
      });
    }
  }

  async preflight(plan: SourcePublicationPlan): Promise<AuthenticatedGitHubUser> {
    const user = await this.#json(
      await this.#request(`${GITHUB_API}/user`, [200]),
      githubUserSchema,
    );
    if (plan.repository.owner_kind === 'user') {
      if (user.login.toLowerCase() !== plan.repository.owner.toLowerCase()) {
        throw new SourcePublicationError({
          code: 'GITHUB_OWNER_MISMATCH',
          message: 'Authenticated GitHub user does not match source repository owner',
        });
      }
    } else {
      const membershipResponse = await this.#request(
        `${GITHUB_API}/user/memberships/orgs/${encoded(plan.repository.owner)}`,
        [200, 403, 404],
      );
      if (membershipResponse.status === 403) {
        throw new SourcePublicationError({
          code: 'GITHUB_MEMBERS_PERMISSION_REQUIRED',
          message: 'GitHub source preflight requires Organization permissions > Members: read',
        });
      }
      if (membershipResponse.status === 404) {
        throw new SourcePublicationError({
          code: 'GITHUB_ORGANIZATION_MISMATCH',
          message: 'Authenticated GitHub user is not a member of source repository organization',
        });
      }
      const membership = await this.#json(membershipResponse, githubMembershipSchema);
      if (
        membership.state !== 'active' ||
        membership.organization.login.toLowerCase() !== plan.repository.owner.toLowerCase()
      ) {
        throw new SourcePublicationError({
          code: 'GITHUB_ORGANIZATION_MISMATCH',
          message: 'Authenticated GitHub user is not an active member of source organization',
        });
      }
    }

    const repository = await this.#json(
      await this.#request(
        `${GITHUB_API}/repos/${encoded(plan.repository.owner)}/${encoded(plan.repository.name)}`,
        [200],
      ),
      githubRepositorySchema,
    );
    const expectedFullName = `${plan.repository.owner}/${plan.repository.name}`;
    if (
      repository.node_id !== plan.repository.node_id ||
      repository.full_name.toLowerCase() !== expectedFullName.toLowerCase() ||
      repository.private !== (plan.repository.visibility === 'private') ||
      repository.default_branch !== plan.repository.branch
    ) {
      throw new SourcePublicationError({
        code: 'GITHUB_REPOSITORY_MISMATCH',
        message: 'GitHub source repository does not match the provisioned resource',
      });
    }
    return user;
  }

  async lookup(plan: SourcePublicationPlan): Promise<RemoteSource | null> {
    const repositoryPath = `${encoded(plan.repository.owner)}/${encoded(plan.repository.name)}`;
    const referenceResponse = await this.#request(
      `${GITHUB_API}/repos/${repositoryPath}/git/ref/heads/${plan.repository.branch}`,
      [200, 404, 409],
    );
    if (referenceResponse.status === 404 || referenceResponse.status === 409) {
      return null;
    }
    const reference = await this.#json(referenceResponse, githubReferenceSchema);
    const commit = await this.#json(
      await this.#request(
        `${GITHUB_API}/repos/${repositoryPath}/git/commits/${encoded(reference.object.sha)}`,
        [200],
      ),
      githubCommitSchema,
    );
    return {
      commitSha: commit.sha,
      treeSha: commit.tree.sha,
      sourceSha256: parseSourceMarker(commit.message),
    };
  }
}

function executeGit(
  arguments_: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      arguments_,
      {
        cwd,
        encoding: 'utf8',
        env: environment,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(stdout.trim());
      },
    );
  });
}

async function optionalGit(arguments_: string[], cwd: string): Promise<string | null> {
  try {
    return await executeGit(arguments_, cwd);
  } catch {
    return null;
  }
}

async function ensureSafeGitHubRemote(input: {
  projectRoot: string;
  owner: string;
  repository: string;
}): Promise<void> {
  const remoteUrl = `https://github.com/${input.owner}/${input.repository}.git`;
  const existingRemote = await optionalGit(['remote', 'get-url', 'origin'], input.projectRoot);
  if (existingRemote && existingRemote !== remoteUrl) {
    throw new SourcePublicationError({
      code: 'LOCAL_GIT_REMOTE_CONFLICT',
      message: 'Existing Git origin does not match the provisioned repository',
    });
  }
  if (!existingRemote) {
    try {
      await executeGit(['remote', 'add', 'origin', remoteUrl], input.projectRoot);
    } catch {
      throw new SourcePublicationError({
        code: 'LOCAL_GIT_REMOTE_FAILED',
        message: 'Unable to configure the safe GitHub remote',
      });
    }
  }
}

async function withGitHubAskPass<T>(
  token: string,
  operation: (environment: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const askPassRoot = await mkdtemp(join(tmpdir(), 'void-starter-git-askpass-'));
  const askPassPath = join(askPassRoot, 'askpass.sh');
  try {
    await writeFile(
      askPassPath,
      `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$VOID_STARTER_GITHUB_TOKEN" ;;
  *) exit 1 ;;
esac
`,
      { encoding: 'utf8', mode: 0o700 },
    );
    await chmod(askPassPath, 0o700);
    return await operation({
      ...process.env,
      GIT_ASKPASS: askPassPath,
      GIT_TERMINAL_PROMPT: '0',
      VOID_STARTER_GITHUB_TOKEN: token,
    });
  } finally {
    await rm(askPassRoot, { force: true, recursive: true });
  }
}

export class GitSourceControl implements SourceControl {
  async prepare(input: {
    projectRoot: string;
    snapshot: SourceSnapshot;
    projectName: string;
    user: AuthenticatedGitHubUser;
    base?: SourceUpdateBase;
  }): Promise<PreparedSourceCommit> {
    const gitRoot = join(input.projectRoot, '.git');
    try {
      const metadata = await lstat(gitRoot);
      if (!metadata.isDirectory()) {
        throw new SourcePublicationError({
          code: 'LOCAL_GIT_METADATA_UNSAFE',
          message: 'Local .git metadata is not a directory',
        });
      }
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) {
        throw error;
      }
      try {
        await executeGit(
          ['init', '--quiet', '--initial-branch=main', '--template='],
          input.projectRoot,
        );
      } catch {
        throw new SourcePublicationError({
          code: 'LOCAL_GIT_INIT_FAILED',
          message: 'Unable to initialize local Git metadata',
        });
      }
    }

    try {
      const base = input.base;
      if (base) {
        await ensureSafeGitHubRemote({
          projectRoot: input.projectRoot,
          owner: base.owner,
          repository: base.repository,
        });
        try {
          await withGitHubAskPass(base.token, async (environment) =>
            executeGit(
              [
                '-c',
                'credential.helper=',
                'fetch',
                '--quiet',
                '--no-tags',
                '--depth=1',
                'origin',
                base.commitSha,
              ],
              input.projectRoot,
              environment,
            ),
          );
        } catch {
          throw new SourcePublicationError({
            code: 'GITHUB_SOURCE_BASE_FETCH_FAILED',
            message: 'Unable to fetch the exact managed source-update base',
            retryable: true,
          });
        }
        const fetchedCommit = await executeGit(['rev-parse', 'FETCH_HEAD'], input.projectRoot);
        const fetchedTree = await executeGit(['rev-parse', 'FETCH_HEAD^{tree}'], input.projectRoot);
        const fetchedMessage = await executeGit(
          ['show', '--quiet', '--format=%B', 'FETCH_HEAD'],
          input.projectRoot,
        );
        if (
          fetchedCommit !== base.commitSha ||
          fetchedTree !== base.treeSha ||
          !fetchedMessage.includes(sourceMarker(base.sourceSha256))
        ) {
          throw new SourcePublicationError({
            code: 'GITHUB_SOURCE_BASE_CONFLICT',
            message: 'Fetched Git base does not match the guarded source-update plan',
          });
        }
        const currentHead = await optionalGit(['rev-parse', '--verify', 'HEAD'], input.projectRoot);
        if (!currentHead) {
          await executeGit(
            ['update-ref', `refs/heads/${base.branch}`, base.commitSha],
            input.projectRoot,
          );
        }
      }

      await executeGit(['read-tree', '--empty'], input.projectRoot);
      for (let index = 0; index < input.snapshot.files.length; index += 100) {
        const paths = input.snapshot.files.slice(index, index + 100).map((file) => file.path);
        await executeGit(['-c', 'core.autocrlf=false', 'add', '--', ...paths], input.projectRoot);
      }
      const stagedEntries = new Map(
        (await executeGit(['ls-files', '--stage'], input.projectRoot)).split('\n').map((entry) => {
          const match = entry.match(/^([0-9]{6}) ([a-f0-9]{40}) 0\t(.+)$/);
          return match ? [match[3], { mode: match[1], sha: match[2] }] : [entry, null];
        }),
      );
      if (
        stagedEntries.size !== input.snapshot.files.length ||
        [...stagedEntries.values()].some((entry) => entry === null)
      ) {
        throw new SourcePublicationError({
          code: 'LOCAL_GIT_INDEX_MISMATCH',
          message: 'Local Git index does not contain the exact source file set',
        });
      }
      for (const file of input.snapshot.files) {
        const staged = stagedEntries.get(file.path);
        if (!staged || staged.mode !== file.mode || staged.sha !== file.gitBlobSha1) {
          throw new SourcePublicationError({
            code: 'LOCAL_GIT_INDEX_MISMATCH',
            message: 'Local Git index does not match the exact source snapshot',
          });
        }
      }
      const treeSha = await executeGit(['write-tree'], input.projectRoot);
      const existingHead = await optionalGit(['rev-parse', '--verify', 'HEAD'], input.projectRoot);
      if (existingHead) {
        const existingTree = await executeGit(['rev-parse', 'HEAD^{tree}'], input.projectRoot);
        const existingMessage = await executeGit(
          ['show', '--quiet', '--format=%B', 'HEAD'],
          input.projectRoot,
        );
        const existingCommitMatchesSnapshot =
          existingTree === treeSha && existingMessage.includes(sourceMarker(input.snapshot.sha256));
        if (existingCommitMatchesSnapshot) {
          if (input.base) {
            const existingParent = await optionalGit(['rev-parse', 'HEAD^'], input.projectRoot);
            if (existingParent !== input.base.commitSha) {
              throw new SourcePublicationError({
                code: 'LOCAL_GIT_HISTORY_CONFLICT',
                message: 'Existing local source update has an unexpected parent',
              });
            }
          }
          return {
            commitSha: existingHead,
            treeSha,
          };
        }
        if (!input.base || existingHead !== input.base.commitSha) {
          throw new SourcePublicationError({
            code: 'LOCAL_GIT_HISTORY_CONFLICT',
            message: 'Existing local Git history does not match the source publication plan',
          });
        }
      }

      const email = `${input.user.id}+${input.user.login}@users.noreply.github.com`;
      await executeGit(
        [
          '-c',
          `user.name=${input.user.login}`,
          '-c',
          `user.email=${email}`,
          '-c',
          'commit.gpgSign=false',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--quiet',
          '--no-gpg-sign',
          '--no-verify',
          '-m',
          input.base
            ? `chore: update ${input.projectName}`
            : `chore: initialize ${input.projectName}`,
          '-m',
          sourceMarker(input.snapshot.sha256),
        ],
        input.projectRoot,
      );
      const commitSha = await executeGit(['rev-parse', 'HEAD'], input.projectRoot);
      const committedTree = await executeGit(['rev-parse', 'HEAD^{tree}'], input.projectRoot);
      if (committedTree !== treeSha) {
        throw new SourcePublicationError({
          code: 'LOCAL_GIT_TREE_MISMATCH',
          message: 'Local Git commit tree does not match staged source',
        });
      }
      return {
        commitSha,
        treeSha,
      };
    } catch (error) {
      if (error instanceof SourcePublicationError) {
        throw error;
      }
      throw new SourcePublicationError({
        code: 'LOCAL_GIT_PREPARE_FAILED',
        message: 'Unable to prepare the source commit',
      });
    }
  }

  async push(input: {
    projectRoot: string;
    commitSha: string;
    owner: string;
    repository: string;
    branch: 'main';
    token: string;
  }): Promise<void> {
    await ensureSafeGitHubRemote(input);
    try {
      await withGitHubAskPass(input.token, async (environment) =>
        executeGit(
          [
            '-c',
            'credential.helper=',
            'push',
            '--porcelain',
            'origin',
            `${input.commitSha}:refs/heads/${input.branch}`,
          ],
          input.projectRoot,
          environment,
        ),
      );
    } catch {
      throw new SourcePublicationError({
        code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
        message: 'GitHub source push did not return a confirmed success',
        retryable: true,
      });
    }
  }
}

function assertRemoteMatches(
  remote: RemoteSource,
  plan: SourcePublicationPlan,
  expectedTreeSha?: string,
): void {
  if (remote.sourceSha256 !== plan.source.sha256) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_CONFLICT',
      message: 'Remote main branch is not owned by this exact source publication plan',
    });
  }
  if (expectedTreeSha && remote.treeSha !== expectedTreeSha) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_TREE_CONFLICT',
      message: 'Remote main tree does not match the exact prepared source tree',
    });
  }
}

function requiredGitHubToken(environment: Record<string, string | undefined>): string {
  const token = environment['GITHUB_TOKEN']?.trim();
  if (!token) {
    throw new Error('Live source publication requires GITHUB_TOKEN');
  }
  return token;
}

export async function preflightSourcePublication(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  fetch?: FetchLike;
}): Promise<{
  ok: true;
  mode: 'source-live-preflight';
  plan_sha256: string;
  source_sha256: string;
  remote: 'empty' | 'adoptable';
}> {
  const plan = await createSourcePublicationPlan(input.projectRoot, input.context);
  const client = new GitHubSourceClient(
    requiredGitHubToken(input.environment),
    input.fetch ?? fetch,
  );
  await client.preflight(plan);
  const remote = await client.lookup(plan);
  if (remote) {
    assertRemoteMatches(remote, plan);
  }
  return {
    ok: true,
    mode: 'source-live-preflight',
    plan_sha256: sourcePlanDigest(plan),
    source_sha256: plan.source.sha256,
    remote: remote ? 'adoptable' : 'empty',
  };
}

function assertRemoteIsUpdateBase(remote: RemoteSource | null, plan: SourcePublicationPlan): void {
  if (
    !remote ||
    !plan.base ||
    remote.commitSha !== plan.base.commit_sha ||
    remote.treeSha !== plan.base.tree_sha ||
    remote.sourceSha256 !== plan.base.source_sha256
  ) {
    throw new SourcePublicationError({
      code: 'GITHUB_SOURCE_UPDATE_BASE_CONFLICT',
      message: 'Remote main changed after the guarded source-update plan was created',
    });
  }
}

function assertUpdateStateMatchesLocalPlan(
  state: SourcePublicationState,
  localPlan: SourcePublicationPlan,
): void {
  if (!state.plan.base) {
    throw new Error('Existing source state is not a source-update operation');
  }
  const { base: _base, ...stateLocalPlan } = state.plan;
  if (serializeCanonicalJson(stateLocalPlan) !== serializeCanonicalJson(localPlan)) {
    throw new Error('Existing source update belongs to a different local source snapshot');
  }
  assertSourceStateMatchesPlan(state, state.plan);
}

export async function preflightSourceUpdate(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  fetch?: FetchLike;
}): Promise<{
  ok: true;
  mode: 'source-update-preflight';
  plan_sha256: string;
  source_sha256: string;
  base_commit_sha: string;
  base_source_sha256: string;
}> {
  const localPlan = await createSourcePublicationPlan(input.projectRoot, input.context);
  const client = new GitHubSourceClient(
    requiredGitHubToken(input.environment),
    input.fetch ?? fetch,
  );
  await client.preflight(localPlan);
  const plan = createSourceUpdatePlan(localPlan, await client.lookup(localPlan));
  return {
    ok: true,
    mode: 'source-update-preflight',
    plan_sha256: sourcePlanDigest(plan),
    source_sha256: plan.source.sha256,
    base_commit_sha: plan.base?.commit_sha ?? '',
    base_source_sha256: plan.base?.source_sha256 ?? '',
  };
}

function safePublicationError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof SourcePublicationError) {
    return {
      code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'SOURCE_PUBLICATION_FAILURE',
      message: 'Source publication failed',
      retryable: error.retryable,
    };
  }
  return {
    code: 'UNEXPECTED_SOURCE_PUBLICATION_FAILURE',
    message: 'Source publication failed without a safe diagnostic',
    retryable: false,
  };
}

export async function applySourcePublication(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: SourcePublicationOptions;
}): Promise<SourcePublicationState> {
  const token = requiredGitHubToken(input.environment);
  const lock = await acquireSourceLock(input.projectRoot);
  try {
    const plan = await createSourcePublicationPlan(input.projectRoot, input.context);
    const planSha256 = sourcePlanDigest(plan);
    const existingState = await readSourcePublicationState(input.projectRoot);
    if (!existingState && input.requireExistingState) {
      throw new Error('No source publication state exists to resume');
    }
    const state: SourcePublicationState =
      existingState ??
      sourcePublicationStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: planSha256,
        plan,
        attempts: 0,
        commit_sha: null,
        error: null,
      });
    assertSourceStateMatchesPlan(state, plan);
    if (state.status === 'succeeded') {
      return state;
    }

    const client = new GitHubSourceClient(token, input.options?.fetch ?? fetch);
    const user = await client.preflight(plan);
    const snapshot = await collectSourceSnapshot(input.projectRoot);
    if (
      snapshot.sha256 !== plan.source.sha256 ||
      snapshot.files.length !== plan.source.file_count ||
      snapshot.totalBytes !== plan.source.total_bytes
    ) {
      throw new Error('Source files changed after publication plan creation');
    }

    state.status = 'running';
    state.attempts += 1;
    state.error = null;
    await writeSourceStateAtomic(input.projectRoot, state);

    try {
      const sourceControl = input.options?.sourceControl ?? new GitSourceControl();
      const prepared = await sourceControl.prepare({
        projectRoot: input.projectRoot,
        snapshot,
        projectName: plan.repository.name,
        user,
      });
      const existingRemote = await client.lookup(plan);
      if (existingRemote) {
        assertRemoteMatches(existingRemote, plan, prepared.treeSha);
        state.status = 'succeeded';
        state.commit_sha = existingRemote.commitSha;
        await writeSourceStateAtomic(input.projectRoot, state);
        return state;
      }

      try {
        await sourceControl.push({
          projectRoot: input.projectRoot,
          commitSha: prepared.commitSha,
          owner: plan.repository.owner,
          repository: plan.repository.name,
          branch: plan.repository.branch,
          token,
        });
      } catch (error) {
        const reconciledRemote = await client.lookup(plan);
        if (reconciledRemote) {
          assertRemoteMatches(reconciledRemote, plan, prepared.treeSha);
          state.status = 'succeeded';
          state.commit_sha = reconciledRemote.commitSha;
          await writeSourceStateAtomic(input.projectRoot, state);
          return state;
        }
        throw error;
      }

      const confirmedRemote = await client.lookup(plan);
      if (!confirmedRemote) {
        throw new SourcePublicationError({
          code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
          message: 'GitHub source branch was not visible after push',
          retryable: true,
        });
      }
      assertRemoteMatches(confirmedRemote, plan, prepared.treeSha);
      state.status = 'succeeded';
      state.commit_sha = confirmedRemote.commitSha;
      await writeSourceStateAtomic(input.projectRoot, state);
      return state;
    } catch (error) {
      const safeError = safePublicationError(error);
      state.status = 'failed';
      state.commit_sha = null;
      state.error = safeError;
      await writeSourceStateAtomic(input.projectRoot, state);
      throw new SourcePublicationApplyError(safeError.code);
    }
  } finally {
    await releaseSourceLock(input.projectRoot, lock);
  }
}

export async function applySourceUpdate(input: {
  projectRoot: string;
  context: ProvisioningContext;
  environment: Record<string, string | undefined>;
  requireExistingState?: boolean;
  options?: SourcePublicationOptions;
}): Promise<SourcePublicationState> {
  const token = requiredGitHubToken(input.environment);
  const lock = await acquireSourceLock(input.projectRoot);
  try {
    const localPlan = await createSourcePublicationPlan(input.projectRoot, input.context);
    const existingState = await readSourcePublicationState(input.projectRoot);
    if (!existingState && input.requireExistingState) {
      throw new Error('No source update state exists to resume');
    }
    if (existingState) {
      assertUpdateStateMatchesLocalPlan(existingState, localPlan);
      if (existingState.status === 'succeeded') {
        return existingState;
      }
    }

    const client = new GitHubSourceClient(token, input.options?.fetch ?? fetch);
    const user = await client.preflight(localPlan);
    const plan =
      existingState?.plan ?? createSourceUpdatePlan(localPlan, await client.lookup(localPlan));
    const state: SourcePublicationState =
      existingState ??
      sourcePublicationStateSchema.parse({
        schema_version: 1,
        mode: 'live',
        status: 'pending',
        plan_sha256: sourcePlanDigest(plan),
        plan,
        attempts: 0,
        commit_sha: null,
        error: null,
      });
    const snapshot = await collectSourceSnapshot(input.projectRoot);
    if (
      snapshot.sha256 !== plan.source.sha256 ||
      snapshot.files.length !== plan.source.file_count ||
      snapshot.totalBytes !== plan.source.total_bytes
    ) {
      throw new Error('Source files changed after source-update plan creation');
    }

    state.status = 'running';
    state.attempts += 1;
    state.error = null;
    await writeSourceStateAtomic(input.projectRoot, state);

    try {
      const base = plan.base;
      if (!base) {
        throw new Error('Source update plan is missing its guarded remote base');
      }
      const sourceControl = input.options?.sourceControl ?? new GitSourceControl();
      const prepared = await sourceControl.prepare({
        projectRoot: input.projectRoot,
        snapshot,
        projectName: plan.repository.name,
        user,
        base: {
          commitSha: base.commit_sha,
          treeSha: base.tree_sha,
          sourceSha256: base.source_sha256,
          owner: plan.repository.owner,
          repository: plan.repository.name,
          branch: plan.repository.branch,
          token,
        },
      });
      const existingRemote = await client.lookup(plan);
      if (existingRemote?.sourceSha256 === plan.source.sha256) {
        assertRemoteMatches(existingRemote, plan, prepared.treeSha);
        state.status = 'succeeded';
        state.commit_sha = existingRemote.commitSha;
        await writeSourceStateAtomic(input.projectRoot, state);
        return state;
      }
      assertRemoteIsUpdateBase(existingRemote, plan);

      try {
        await sourceControl.push({
          projectRoot: input.projectRoot,
          commitSha: prepared.commitSha,
          owner: plan.repository.owner,
          repository: plan.repository.name,
          branch: plan.repository.branch,
          token,
        });
      } catch (error) {
        const reconciledRemote = await client.lookup(plan);
        if (reconciledRemote?.sourceSha256 === plan.source.sha256) {
          assertRemoteMatches(reconciledRemote, plan, prepared.treeSha);
          state.status = 'succeeded';
          state.commit_sha = reconciledRemote.commitSha;
          await writeSourceStateAtomic(input.projectRoot, state);
          return state;
        }
        if (reconciledRemote) {
          assertRemoteIsUpdateBase(reconciledRemote, plan);
        }
        throw error;
      }

      const confirmedRemote = await client.lookup(plan);
      if (!confirmedRemote) {
        throw new SourcePublicationError({
          code: 'GITHUB_SOURCE_PUSH_UNCONFIRMED',
          message: 'GitHub source branch was not visible after update push',
          retryable: true,
        });
      }
      assertRemoteMatches(confirmedRemote, plan, prepared.treeSha);
      state.status = 'succeeded';
      state.commit_sha = confirmedRemote.commitSha;
      await writeSourceStateAtomic(input.projectRoot, state);
      return state;
    } catch (error) {
      const safeError = safePublicationError(error);
      state.status = 'failed';
      state.commit_sha = null;
      state.error = safeError;
      await writeSourceStateAtomic(input.projectRoot, state);
      throw new SourcePublicationApplyError(safeError.code);
    }
  } finally {
    await releaseSourceLock(input.projectRoot, lock);
  }
}

export async function validateSourcePublicationState(
  state: SourcePublicationState,
  expectedManifestSha256: string,
  projectRoot: string,
): Promise<void> {
  if (state.plan.manifest_sha256 !== expectedManifestSha256) {
    throw new Error('Source publication state manifest digest does not match generation metadata');
  }
  assertSourceStateMatchesPlan(state, state.plan);
  if (state.status === 'succeeded' && !state.commit_sha) {
    throw new Error('Succeeded source publication state is missing commit SHA');
  }
  const snapshot = await collectSourceSnapshot(projectRoot);
  if (
    snapshot.sha256 !== state.plan.source.sha256 ||
    snapshot.files.length !== state.plan.source.file_count ||
    snapshot.totalBytes !== state.plan.source.total_bytes
  ) {
    throw new Error('Current source files do not match source publication state');
  }
}
