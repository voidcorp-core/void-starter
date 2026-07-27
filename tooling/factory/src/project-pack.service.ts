import { randomUUID } from 'node:crypto';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type ApplyProjectPackInput,
  type ProjectPackAction,
  type ProjectPackActionKind,
  type ProjectPackApplyResult,
  type ProjectPackInput,
  type ProjectPackManifest,
  type ProjectPackPlan,
  type ProjectPackReceipt,
  projectPackManifestSchema,
  projectPackReceiptSchema,
} from './project-pack.types';

const RECEIPT_PATH = '.void-starter/project-pack-receipt.json' as const;
const LOCK_PATH = '.void-starter/project-pack.lock';
const CONSUMER_VERSION = '0.0.1';

type LoadedProjectPack = {
  manifest: ProjectPackManifest;
  packMetadataRoot: string;
  targetRoot: string;
  contents: ReadonlyMap<string, string>;
  receipt: ProjectPackReceipt | null;
  receiptSource: string | null;
};

type ProjectPackLock = {
  schema_version: 1;
  pid: number;
  owner_token: string;
};

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function digest(content: string): string {
  return `sha256:${sha256(content)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

function resolveInside(root: string, relativePath: string, label: string): string {
  const destination = resolve(root, relativePath);
  if (!destination.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} escapes its root: ${relativePath}`);
  }
  return destination;
}

async function assertNoSymbolicLink(root: string, relativePath: string): Promise<void> {
  let currentPath = root;
  for (const segment of relativePath.split('/')) {
    currentPath = join(currentPath, segment);
    try {
      const currentStats = await lstat(currentPath);
      if (currentStats.isSymbolicLink()) {
        throw new Error(`Project Pack path contains a symbolic link: ${relativePath}`);
      }
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
  }
}

async function canonicalTargetRoot(inputPath: string): Promise<string> {
  const requestedRoot = resolve(inputPath);
  const requestedStats = await lstat(requestedRoot);
  if (requestedStats.isSymbolicLink()) {
    throw new Error('Project Pack target root must not be a symbolic link');
  }
  if (!requestedStats.isDirectory()) {
    throw new Error('Project Pack target root must be an existing directory');
  }
  return realpath(requestedRoot);
}

async function loadManifest(manifestInputPath: string): Promise<{
  manifest: ProjectPackManifest;
  packMetadataRoot: string;
}> {
  const requestedManifestPath = resolve(manifestInputPath);
  const manifestStats = await lstat(requestedManifestPath);
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    throw new Error('Project Pack manifest must be a regular file, not a symbolic link');
  }
  const manifestPath = await realpath(requestedManifestPath);
  if (basename(dirname(manifestPath)) !== 'project-pack') {
    throw new Error('Project Pack manifest must live directly under a project-pack directory');
  }

  const source = await readFile(manifestPath, 'utf8');
  let parsedSource: unknown;
  try {
    parsedSource = manifestPath.endsWith('.json') ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Project Pack manifest syntax: ${message}`);
  }

  const parsedManifest = projectPackManifestSchema.safeParse(parsedSource);
  if (!parsedManifest.success) {
    throw new Error(`Invalid Project Pack manifest: ${parsedManifest.error.message}`);
  }

  return {
    manifest: parsedManifest.data,
    packMetadataRoot: dirname(dirname(manifestPath)),
  };
}

async function readPackContents(
  manifest: ProjectPackManifest,
  packMetadataRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const contents = new Map<string, string>();

  for (const document of manifest.documents) {
    await assertNoSymbolicLink(packMetadataRoot, document.pack_path);
    const sourcePath = resolveInside(packMetadataRoot, document.pack_path, 'Project Pack source');
    const sourceStats = await lstat(sourcePath);
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
      throw new Error(`Project Pack source must be a regular file: ${document.pack_path}`);
    }
    const content = await readFile(sourcePath, 'utf8');
    if (digest(content) !== document.content_hash) {
      throw new Error(`Project Pack content hash mismatch: ${document.pack_path}`);
    }
    contents.set(document.id, content);
  }

  return contents;
}

async function readReceipt(targetRoot: string): Promise<{
  receipt: ProjectPackReceipt | null;
  receiptSource: string | null;
}> {
  await assertNoSymbolicLink(targetRoot, RECEIPT_PATH);
  const receiptPath = resolveInside(targetRoot, RECEIPT_PATH, 'Project Pack receipt');
  if (!(await pathExists(receiptPath))) {
    return { receipt: null, receiptSource: null };
  }

  const receiptStats = await lstat(receiptPath);
  if (!receiptStats.isFile() || receiptStats.isSymbolicLink()) {
    throw new Error('Invalid Project Pack receipt: expected a regular file');
  }
  const receiptSource = await readFile(receiptPath, 'utf8');
  try {
    const parsedReceipt = projectPackReceiptSchema.parse(JSON.parse(receiptSource));
    return { receipt: parsedReceipt, receiptSource };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Project Pack receipt: ${message}`);
  }
}

function assertReceiptMatchesManifest(
  receipt: ProjectPackReceipt,
  manifest: ProjectPackManifest,
): void {
  if (receipt.contract !== manifest.schema_version || receipt.project_id !== manifest.project_id) {
    throw new Error('Project Pack receipt identity does not match the manifest');
  }

  const receiptFiles = new Map(receipt.files.map((file) => [file.document_id, file]));
  for (const document of manifest.documents) {
    const receiptFile = receiptFiles.get(document.id);
    if (!receiptFile || receiptFile.target_path !== document.target_path) {
      throw new Error(`Project Pack receipt target mapping drifted for ${document.id}`);
    }
  }
}

async function loadProjectPack(input: ProjectPackInput): Promise<LoadedProjectPack> {
  const [{ manifest, packMetadataRoot }, targetRoot] = await Promise.all([
    loadManifest(input.manifestPath),
    canonicalTargetRoot(input.targetRoot),
  ]);
  const [contents, receiptResult] = await Promise.all([
    readPackContents(manifest, packMetadataRoot),
    readReceipt(targetRoot),
  ]);
  if (receiptResult.receipt) {
    assertReceiptMatchesManifest(receiptResult.receipt, manifest);
  }

  return {
    manifest,
    packMetadataRoot,
    targetRoot,
    contents,
    ...receiptResult,
  };
}

async function readDestinationDigest(
  targetRoot: string,
  targetPath: string,
): Promise<string | null> {
  await assertNoSymbolicLink(targetRoot, targetPath);
  const destination = resolveInside(targetRoot, targetPath, 'Project Pack destination');
  if (!(await pathExists(destination))) {
    return null;
  }
  const destinationStats = await lstat(destination);
  if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) {
    throw new Error(`Project Pack destination must be a regular file: ${targetPath}`);
  }
  return digest(await readFile(destination, 'utf8'));
}

function receiptMetadataMatches(
  receipt: ProjectPackReceipt,
  manifest: ProjectPackManifest,
): boolean {
  const receiptFiles = new Map(receipt.files.map((file) => [file.document_id, file]));
  return (
    receipt.pack_source_hash === manifest.source_hash &&
    receipt.pack_generated_at === manifest.generated_at &&
    receipt.pack_status === manifest.status &&
    serializeCanonicalJson(receipt.stage_statuses) ===
      serializeCanonicalJson(manifest.stage_statuses) &&
    serializeCanonicalJson(receipt.open_gap_ids) ===
      serializeCanonicalJson(manifest.open_gap_ids) &&
    manifest.documents.every((document) => {
      const receiptFile = receiptFiles.get(document.id);
      return (
        receiptFile?.target_path === document.target_path &&
        receiptFile.after_sha256 === document.content_hash
      );
    })
  );
}

async function createPlan(loaded: LoadedProjectPack): Promise<ProjectPackPlan> {
  const receiptFiles = new Map(
    (loaded.receipt?.files ?? []).map((file) => [file.document_id, file]),
  );
  const actions: ProjectPackAction[] = [];

  for (const document of loaded.manifest.documents.toSorted((left, right) =>
    left.target_path.localeCompare(right.target_path),
  )) {
    const currentDigest = await readDestinationDigest(loaded.targetRoot, document.target_path);
    const receiptFile = receiptFiles.get(document.id);
    let action: ProjectPackAction;

    if (!receiptFile && currentDigest === null) {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'create',
        reason: 'destination_missing',
        expected_before_sha256: null,
        desired_sha256: document.content_hash,
      };
    } else if (!receiptFile) {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'conflict',
        reason: 'destination_exists_without_receipt',
        expected_before_sha256: currentDigest,
        desired_sha256: document.content_hash,
      };
    } else if (currentDigest === null) {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'conflict',
        reason: 'managed_destination_missing',
        expected_before_sha256: null,
        desired_sha256: document.content_hash,
      };
    } else if (currentDigest !== receiptFile.after_sha256) {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'conflict',
        reason: 'managed_destination_modified',
        expected_before_sha256: currentDigest,
        desired_sha256: document.content_hash,
      };
    } else if (currentDigest === document.content_hash) {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'unchanged',
        reason: 'managed_destination_matches_pack',
        expected_before_sha256: currentDigest,
        desired_sha256: document.content_hash,
      };
    } else {
      action = {
        document_id: document.id,
        source_path: document.pack_path,
        target_path: document.target_path,
        action: 'update',
        reason: 'managed_destination_outdated',
        expected_before_sha256: currentDigest,
        desired_sha256: document.content_hash,
      };
    }
    actions.push(action);
  }

  const summary: Record<ProjectPackActionKind, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
  };
  for (const action of actions) {
    summary[action.action] += 1;
  }

  const hasFileMutation = summary.create > 0 || summary.update > 0;
  const receipt_action = !loaded.receipt
    ? 'create'
    : hasFileMutation || !receiptMetadataMatches(loaded.receipt, loaded.manifest)
      ? 'update'
      : 'unchanged';
  const status =
    summary.conflict > 0
      ? 'conflict'
      : !hasFileMutation && receipt_action === 'unchanged'
        ? 'current'
        : 'applicable';

  return {
    schema_version: 1,
    contract: 'forge/project-pack-v1',
    project_id: loaded.manifest.project_id,
    pack_source_hash: loaded.manifest.source_hash,
    pack_status: loaded.manifest.status,
    open_gap_ids: loaded.manifest.open_gap_ids,
    receipt_path: RECEIPT_PATH,
    receipt_action,
    status,
    summary,
    actions,
  };
}

export async function createProjectPackPlan(input: ProjectPackInput): Promise<ProjectPackPlan> {
  return createPlan(await loadProjectPack(input));
}

export async function checkProjectPack(input: ProjectPackInput): Promise<ProjectPackPlan> {
  const plan = await createProjectPackPlan(input);
  if (plan.status !== 'current') {
    throw new Error(
      `Project Pack is not current: status=${plan.status}, conflicts=${plan.summary.conflict}, receipt=${plan.receipt_action}`,
    );
  }
  return plan;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

function metadataRoot(targetRoot: string): string {
  return resolveInside(targetRoot, '.void-starter', 'Project Pack metadata');
}

function lockFilePath(targetRoot: string): string {
  return resolveInside(targetRoot, LOCK_PATH, 'Project Pack lock');
}

async function recoverStaleLock(targetRoot: string): Promise<boolean> {
  const lockPath = lockFilePath(targetRoot);
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<ProjectPackLock>;
    if (
      parsed.schema_version !== 1 ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.owner_token !== 'string' ||
      processIsAlive(parsed.pid)
    ) {
      return false;
    }
    await rm(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function acquireProjectPackLock(targetRoot: string): Promise<ProjectPackLock> {
  await assertNoSymbolicLink(targetRoot, '.void-starter');
  await mkdir(metadataRoot(targetRoot), { recursive: true });
  await assertNoSymbolicLink(targetRoot, '.void-starter');
  const lock: ProjectPackLock = {
    schema_version: 1,
    pid: process.pid,
    owner_token: randomUUID(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockFilePath(targetRoot), serializeCanonicalJson(lock), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return lock;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await recoverStaleLock(targetRoot))) {
        continue;
      }
      throw new Error('Another Project Pack apply is active or left an unreadable lock');
    }
  }

  throw new Error('Unable to acquire the Project Pack lock');
}

async function releaseProjectPackLock(targetRoot: string, lock: ProjectPackLock): Promise<void> {
  const lockPath = lockFilePath(targetRoot);
  try {
    const currentLock = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<ProjectPackLock>;
    if (currentLock.owner_token !== lock.owner_token || currentLock.pid !== lock.pid) {
      throw new Error('Project Pack lock ownership changed while apply was running');
    }
    await rm(lockPath);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
  }
}

function createReceipt(loaded: LoadedProjectPack, plan: ProjectPackPlan): ProjectPackReceipt {
  const receipt = {
    schema_version: 1 as const,
    contract: 'forge/project-pack-v1' as const,
    consumer: {
      name: 'void-starter' as const,
      version: CONSUMER_VERSION,
    },
    project_id: loaded.manifest.project_id,
    pack_source_hash: loaded.manifest.source_hash,
    pack_generated_at: loaded.manifest.generated_at,
    pack_status: loaded.manifest.status,
    stage_statuses: loaded.manifest.stage_statuses,
    open_gap_ids: loaded.manifest.open_gap_ids,
    files: plan.actions.map((action) => ({
      document_id: action.document_id,
      target_path: action.target_path,
      action:
        action.action === 'create'
          ? ('created' as const)
          : action.action === 'update'
            ? ('updated' as const)
            : ('unchanged' as const),
      before_sha256: action.expected_before_sha256,
      after_sha256: action.desired_sha256,
    })),
  };
  return projectPackReceiptSchema.parse(receipt);
}

type CreatedDirectoryChain = {
  leaf: string;
  firstCreated: string;
};

async function createDestinationParents(
  targetRoot: string,
  actions: ProjectPackAction[],
): Promise<CreatedDirectoryChain[]> {
  const createdDirectories: CreatedDirectoryChain[] = [];
  for (const targetPath of new Set(
    actions
      .filter((action) => action.action === 'create' || action.action === 'update')
      .map((action) =>
        dirname(resolveInside(targetRoot, action.target_path, 'Project Pack target')),
      ),
  )) {
    const firstCreated = await mkdir(targetPath, { recursive: true });
    if (firstCreated) {
      createdDirectories.push({ leaf: targetPath, firstCreated });
    }
  }
  return createdDirectories;
}

async function cleanCreatedDirectories(chains: CreatedDirectoryChain[]): Promise<void> {
  for (const chain of chains.toReversed()) {
    let currentPath = chain.leaf;
    while (currentPath.startsWith(chain.firstCreated)) {
      try {
        await rmdir(currentPath);
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) {
          break;
        }
        if (isNodeError(error, 'ENOTEMPTY') || isNodeError(error, 'EEXIST')) {
          break;
        }
        throw error;
      }
      if (currentPath === chain.firstCreated) {
        break;
      }
      currentPath = dirname(currentPath);
    }
  }
}

async function assertPlanStillCurrent(
  loaded: LoadedProjectPack,
  plan: ProjectPackPlan,
): Promise<void> {
  for (const action of plan.actions) {
    const currentDigest = await readDestinationDigest(loaded.targetRoot, action.target_path);
    if (currentDigest !== action.expected_before_sha256) {
      throw new Error(`Project Pack destination changed during apply: ${action.target_path}`);
    }
  }

  const currentReceipt = await readReceipt(loaded.targetRoot);
  if (currentReceipt.receiptSource !== loaded.receiptSource) {
    throw new Error('Project Pack receipt changed during apply');
  }

  const currentContents = await readPackContents(loaded.manifest, loaded.packMetadataRoot);
  for (const [documentId, expectedContent] of loaded.contents) {
    if (currentContents.get(documentId) !== expectedContent) {
      throw new Error(`Project Pack source changed during apply: ${documentId}`);
    }
  }
}

async function restoreCommittedFiles(input: {
  targetRoot: string;
  committed: ProjectPackAction[];
  backups: ReadonlyMap<string, string>;
}): Promise<void> {
  for (const action of input.committed.toReversed()) {
    const destination = resolveInside(
      input.targetRoot,
      action.target_path,
      'Project Pack rollback target',
    );
    if (action.action === 'create') {
      if (
        (await readDestinationDigest(input.targetRoot, action.target_path)) ===
        action.desired_sha256
      ) {
        await rm(destination);
      }
      continue;
    }
    const backup = input.backups.get(action.document_id);
    if (!backup) {
      throw new Error(`Missing Project Pack rollback backup for ${action.document_id}`);
    }
    await rename(backup, destination);
  }
}

async function writeProjectPackTransaction(
  loaded: LoadedProjectPack,
  plan: ProjectPackPlan,
  receipt: ProjectPackReceipt,
): Promise<void> {
  const transactionRoot = join(metadataRoot(loaded.targetRoot), `.project-pack-${randomUUID()}`);
  await mkdir(transactionRoot);
  const stagedFiles = new Map<string, string>();
  const backups = new Map<string, string>();
  const committed: ProjectPackAction[] = [];
  let receiptCommitted = false;
  let preserveTransaction = false;
  let createdDirectories: CreatedDirectoryChain[] = [];

  try {
    for (const [index, action] of plan.actions.entries()) {
      if (action.action !== 'create' && action.action !== 'update') {
        continue;
      }
      const content = loaded.contents.get(action.document_id);
      if (content === undefined) {
        throw new Error(`Missing Project Pack content for ${action.document_id}`);
      }
      const stagedPath = join(transactionRoot, `new-${index}`);
      await writeFile(stagedPath, content, { encoding: 'utf8', flag: 'wx' });
      stagedFiles.set(action.document_id, stagedPath);
    }

    const stagedReceiptPath = join(transactionRoot, 'receipt.json');
    const receiptSource = serializeCanonicalJson(receipt);
    await writeFile(stagedReceiptPath, receiptSource, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });

    createdDirectories = await createDestinationParents(loaded.targetRoot, plan.actions);
    for (const action of plan.actions) {
      await assertNoSymbolicLink(loaded.targetRoot, action.target_path);
      if (action.action === 'update') {
        const destination = resolveInside(
          loaded.targetRoot,
          action.target_path,
          'Project Pack backup target',
        );
        const backupPath = join(transactionRoot, `backup-${action.document_id}`);
        await copyFile(destination, backupPath);
        backups.set(action.document_id, backupPath);
      }
    }

    const receiptBackupPath = join(transactionRoot, 'receipt.previous.json');
    if (loaded.receiptSource !== null) {
      await writeFile(receiptBackupPath, loaded.receiptSource, { encoding: 'utf8', flag: 'wx' });
    }

    await assertPlanStillCurrent(loaded, plan);

    for (const action of plan.actions) {
      if (action.action !== 'create' && action.action !== 'update') {
        continue;
      }
      if (
        (await readDestinationDigest(loaded.targetRoot, action.target_path)) !==
        action.expected_before_sha256
      ) {
        throw new Error(`Project Pack destination changed before commit: ${action.target_path}`);
      }
      const stagedPath = stagedFiles.get(action.document_id);
      if (!stagedPath) {
        throw new Error(`Missing staged Project Pack file for ${action.document_id}`);
      }
      const destination = resolveInside(
        loaded.targetRoot,
        action.target_path,
        'Project Pack commit target',
      );
      if (action.action === 'create') {
        await link(stagedPath, destination);
      } else {
        await rename(stagedPath, destination);
      }
      committed.push(action);
    }

    const currentReceipt = await readReceipt(loaded.targetRoot);
    if (currentReceipt.receiptSource !== loaded.receiptSource) {
      throw new Error('Project Pack receipt changed before commit');
    }
    const destinationReceipt = resolveInside(
      loaded.targetRoot,
      RECEIPT_PATH,
      'Project Pack receipt target',
    );
    if (loaded.receiptSource === null) {
      await link(stagedReceiptPath, destinationReceipt);
    } else {
      await rename(stagedReceiptPath, destinationReceipt);
    }
    receiptCommitted = true;
  } catch (error) {
    try {
      if (receiptCommitted) {
        const destinationReceipt = resolveInside(
          loaded.targetRoot,
          RECEIPT_PATH,
          'Project Pack receipt rollback target',
        );
        if (loaded.receiptSource === null) {
          await rm(destinationReceipt);
        } else {
          await rename(join(transactionRoot, 'receipt.previous.json'), destinationReceipt);
        }
      }
      await restoreCommittedFiles({ targetRoot: loaded.targetRoot, committed, backups });
      await cleanCreatedDirectories(createdDirectories);
    } catch (rollbackError) {
      preserveTransaction = true;
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(
        `Project Pack apply failed (${originalMessage}) and rollback failed (${rollbackMessage}). Recovery files remain at ${transactionRoot}`,
      );
    }
    throw error;
  } finally {
    if (!preserveTransaction) {
      await rm(transactionRoot, { force: true, recursive: true });
    }
  }
}

function assertApplyAuthorized(plan: ProjectPackPlan, confirmedProjectId: string): void {
  if (confirmedProjectId !== plan.project_id) {
    throw new Error(`Project Pack apply requires the exact project id: ${plan.project_id}`);
  }
  if (plan.status === 'conflict') {
    const conflicts = plan.actions
      .filter((action) => action.action === 'conflict')
      .map((action) => action.target_path)
      .join(', ');
    throw new Error(`Project Pack apply refused because of conflicts: ${conflicts}`);
  }
}

export async function applyProjectPack(
  input: ApplyProjectPackInput,
): Promise<ProjectPackApplyResult> {
  const initialLoaded = await loadProjectPack(input);
  const initialPlan = await createPlan(initialLoaded);
  assertApplyAuthorized(initialPlan, input.confirmedProjectId);

  const metadataExisted = await pathExists(metadataRoot(initialLoaded.targetRoot));
  const lock = await acquireProjectPackLock(initialLoaded.targetRoot);
  try {
    const loaded = await loadProjectPack(input);
    const plan = await createPlan(loaded);
    assertApplyAuthorized(plan, input.confirmedProjectId);

    if (plan.status === 'current') {
      if (!loaded.receipt) {
        throw new Error('Current Project Pack state is missing its receipt');
      }
      return { mutated: false, plan, receipt: loaded.receipt };
    }

    const receipt = createReceipt(loaded, plan);
    await writeProjectPackTransaction(loaded, plan, receipt);
    return { mutated: true, plan, receipt };
  } finally {
    await releaseProjectPackLock(initialLoaded.targetRoot, lock);
    if (!metadataExisted) {
      try {
        await rmdir(metadataRoot(initialLoaded.targetRoot));
      } catch (error) {
        const cleanupIsExpected =
          isNodeError(error, 'ENOTEMPTY') ||
          isNodeError(error, 'EEXIST') ||
          isNodeError(error, 'ENOENT');
        if (!cleanupIsExpected) {
          process.stderr.write(
            `Project Pack metadata cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
    }
  }
}
