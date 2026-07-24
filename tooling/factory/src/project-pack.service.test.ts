import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { sha256 } from './integrity.service';
import { applyProjectPack, checkProjectPack, createProjectPackPlan } from './project-pack.service';

const temporaryRoots: string[] = [];

function digest(content: string): string {
  return `sha256:${sha256(content)}`;
}

type Fixture = {
  manifestPath: string;
  packMetadataRoot: string;
  targetRoot: string;
  visionSourcePath: string;
  contextSourcePath: string;
  visionContent: string;
  contextContent: string;
  extraDocuments: Array<{
    id: string;
    fileName: string;
    content: string;
  }>;
};

async function writeManifest(
  fixture: Fixture,
  overrides: {
    visionContent?: string;
    contextContent?: string;
    visionTargetPath?: string;
    sourceHash?: string;
  } = {},
): Promise<void> {
  const visionContent = overrides.visionContent ?? fixture.visionContent;
  const contextContent = overrides.contextContent ?? fixture.contextContent;
  const manifest = {
    schema_version: 'forge/project-pack-v1',
    project_id: 'example-cortex',
    status: 'conditional',
    generated_at: '2026-07-24T08:00:00.000Z',
    source_hash: overrides.sourceHash ?? digest(`${visionContent}\n${contextContent}`),
    stage_statuses: {
      product: 'accepted',
      trust: 'conditional',
      experience: 'accepted',
      build: 'conditional',
    },
    open_gap_ids: ['GAP-001'],
    merge_contract: {
      initial_write: 'create_only',
      update_write: 'replace_if_destination_hash_matches_receipt',
      conflict: 'fail_without_overwrite',
      receipt_required: true,
      agent_context_target: '.agents/context/forge-project.md',
    },
    documents: [
      {
        id: 'vision',
        pack_path: 'project-pack/VISION.md',
        target_path: overrides.visionTargetPath ?? 'docs/foundation/VISION.md',
        status: 'conditional',
        media_type: 'text/markdown',
        merge_policy: 'create_or_replace_if_receipt_matches',
        source_paths: ['stages/product/vision.md'],
        source_hash: digest('vision-source'),
        content_hash: digest(visionContent),
      },
      {
        id: 'agent-context',
        pack_path: 'project-pack/AGENT-CONTEXT.md',
        target_path: '.agents/context/forge-project.md',
        status: 'ready',
        media_type: 'text/markdown',
        merge_policy: 'create_or_replace_if_receipt_matches',
        source_paths: ['project-pack/VISION.md'],
        source_hash: digest('agent-source'),
        content_hash: digest(contextContent),
      },
      ...fixture.extraDocuments.map((document) => ({
        id: document.id,
        pack_path: `project-pack/${document.fileName}`,
        target_path: `docs/foundation/${document.fileName}`,
        status: 'conditional',
        media_type: 'text/markdown',
        merge_policy: 'create_or_replace_if_receipt_matches',
        source_paths: [`stages/${document.id}.md`],
        source_hash: digest(`${document.id}-source`),
        content_hash: digest(document.content),
      })),
    ],
  };

  await writeFile(fixture.manifestPath, stringify(manifest), 'utf8');
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'void-project-pack-test-'));
  temporaryRoots.push(root);

  const packMetadataRoot = join(root, 'forge-output', '.forge');
  const packRoot = join(packMetadataRoot, 'project-pack');
  const targetRoot = join(root, 'target');
  const visionSourcePath = join(packRoot, 'VISION.md');
  const contextSourcePath = join(packRoot, 'AGENT-CONTEXT.md');
  const fixture: Fixture = {
    manifestPath: join(packRoot, 'manifest.yaml'),
    packMetadataRoot,
    targetRoot,
    visionSourcePath,
    contextSourcePath,
    visionContent: '# Vision\n\nBuild the right product.\n',
    contextContent: '# Agent context\n\nUse the validated product frame.\n',
    extraDocuments: [
      ['product-doctrine', 'PRODUCT-DOCTRINE.md'],
      ['positioning', 'POSITIONING.md'],
      ['target-users', 'TARGET-USERS.md'],
      ['product-contract', 'PRODUCT-CONTRACT.md'],
      ['experience-principles', 'EXPERIENCE-PRINCIPLES.md'],
      ['trust-and-data', 'TRUST-AND-DATA.md'],
      ['measurement', 'MEASUREMENT.md'],
      ['roadmap', 'ROADMAP.md'],
      ['build-plan', 'BUILD-PLAN.md'],
      ['decisions', 'DECISIONS.md'],
      ['open-gaps', 'OPEN-GAPS.md'],
      ['evidence-index', 'EVIDENCE-INDEX.md'],
    ].map(([id, fileName]) => ({
      id: id ?? '',
      fileName: fileName ?? '',
      content: `# ${id}\n\nGenerated foundation.\n`,
    })),
  };

  await mkdir(packRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  await writeFile(visionSourcePath, fixture.visionContent, 'utf8');
  await writeFile(contextSourcePath, fixture.contextContent, 'utf8');
  await Promise.all(
    fixture.extraDocuments.map((document) =>
      writeFile(join(packRoot, document.fileName), document.content, 'utf8'),
    ),
  );
  await writeManifest(fixture);

  return fixture;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('Project Pack injection', () => {
  it('previews every create without mutating the target', async () => {
    const fixture = await createFixture();

    const plan = await createProjectPackPlan(fixture);

    expect(plan.status).toBe('applicable');
    expect(plan.pack_status).toBe('conditional');
    expect(plan.summary).toEqual({ create: 14, update: 0, unchanged: 0, conflict: 0 });
    expect(plan.actions[0]).toMatchObject({
      target_path: '.agents/context/forge-project.md',
      action: 'create',
    });
    expect(plan.actions.at(-1)).toMatchObject({
      target_path: 'docs/foundation/VISION.md',
      action: 'create',
    });
    await expect(lstat(join(fixture.targetRoot, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      lstat(join(fixture.targetRoot, '.void-starter/project-pack-receipt.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires the exact project confirmation before applying', async () => {
    const fixture = await createFixture();

    await expect(
      applyProjectPack({ ...fixture, confirmedProjectId: 'another-project' }),
    ).rejects.toThrow(/exact project id/i);
    await expect(lstat(join(fixture.targetRoot, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('applies once, writes a receipt, checks current state, and remains idempotent', async () => {
    const fixture = await createFixture();

    const applied = await applyProjectPack({
      ...fixture,
      confirmedProjectId: 'example-cortex',
    });

    expect(applied.mutated).toBe(true);
    expect(await readFile(join(fixture.targetRoot, 'docs/foundation/VISION.md'), 'utf8')).toBe(
      fixture.visionContent,
    );
    const receiptPath = join(fixture.targetRoot, '.void-starter/project-pack-receipt.json');
    const firstReceipt = await readFile(receiptPath, 'utf8');
    expect(JSON.parse(firstReceipt)).toMatchObject({
      schema_version: 1,
      contract: 'forge/project-pack-v1',
      project_id: 'example-cortex',
      pack_status: 'conditional',
      open_gap_ids: ['GAP-001'],
    });

    const checked = await checkProjectPack(fixture);
    expect(checked.status).toBe('current');
    expect(checked.summary).toEqual({ create: 0, update: 0, unchanged: 14, conflict: 0 });

    const reapplied = await applyProjectPack({
      ...fixture,
      confirmedProjectId: 'example-cortex',
    });
    expect(reapplied.mutated).toBe(false);
    expect(await readFile(receiptPath, 'utf8')).toBe(firstReceipt);
  });

  it('updates a managed destination only while its current hash matches the receipt', async () => {
    const fixture = await createFixture();
    await applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' });
    const nextVision = '# Vision\n\nShip the sharper product.\n';
    await writeFile(fixture.visionSourcePath, nextVision, 'utf8');
    await writeManifest(fixture, { visionContent: nextVision });

    const plan = await createProjectPackPlan(fixture);
    expect(plan.summary).toEqual({ create: 0, update: 1, unchanged: 13, conflict: 0 });

    const applied = await applyProjectPack({
      ...fixture,
      confirmedProjectId: 'example-cortex',
    });
    expect(applied.mutated).toBe(true);
    expect(await readFile(join(fixture.targetRoot, 'docs/foundation/VISION.md'), 'utf8')).toBe(
      nextVision,
    );
  });

  it('refreshes receipt metadata without rewriting documents when only the pack source changes', async () => {
    const fixture = await createFixture();
    await applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' });
    const destination = join(fixture.targetRoot, 'docs/foundation/VISION.md');
    const initialVision = await readFile(destination, 'utf8');
    await writeManifest(fixture, { sourceHash: digest('new-global-source') });

    const plan = await createProjectPackPlan(fixture);
    expect(plan.status).toBe('applicable');
    expect(plan.receipt_action).toBe('update');
    expect(plan.summary).toEqual({ create: 0, update: 0, unchanged: 14, conflict: 0 });

    const applied = await applyProjectPack({
      ...fixture,
      confirmedProjectId: 'example-cortex',
    });
    expect(applied.mutated).toBe(true);
    expect(await readFile(destination, 'utf8')).toBe(initialVision);
    await expect(checkProjectPack(fixture)).resolves.toMatchObject({ status: 'current' });
  });

  it('fails the whole apply without overwriting when one managed destination was edited', async () => {
    const fixture = await createFixture();
    await applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' });
    const userVision = '# Vision\n\nHuman-owned revision.\n';
    const nextVision = '# Vision\n\nForge revision.\n';
    const nextContext = '# Agent context\n\nNew generated context.\n';
    await writeFile(join(fixture.targetRoot, 'docs/foundation/VISION.md'), userVision, 'utf8');
    await writeFile(fixture.visionSourcePath, nextVision, 'utf8');
    await writeFile(fixture.contextSourcePath, nextContext, 'utf8');
    await writeManifest(fixture, { visionContent: nextVision, contextContent: nextContext });

    const plan = await createProjectPackPlan(fixture);
    expect(plan.status).toBe('conflict');
    expect(plan.summary).toEqual({ create: 0, update: 1, unchanged: 12, conflict: 1 });

    await expect(
      applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' }),
    ).rejects.toThrow(/conflict/i);
    expect(await readFile(join(fixture.targetRoot, 'docs/foundation/VISION.md'), 'utf8')).toBe(
      userVision,
    );
    expect(
      await readFile(join(fixture.targetRoot, '.agents/context/forge-project.md'), 'utf8'),
    ).toBe(fixture.contextContent);
  });

  it('treats an unmanaged existing destination as a conflict', async () => {
    const fixture = await createFixture();
    const destination = join(fixture.targetRoot, 'docs/foundation/VISION.md');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, '# Existing project vision\n', 'utf8');

    const plan = await createProjectPackPlan(fixture);
    expect(plan.status).toBe('conflict');
    expect(plan.actions.find((action) => action.document_id === 'vision')).toMatchObject({
      action: 'conflict',
      reason: 'destination_exists_without_receipt',
    });
  });

  it('treats deletion of a managed destination as a conflict', async () => {
    const fixture = await createFixture();
    await applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' });
    await unlink(join(fixture.targetRoot, 'docs/foundation/VISION.md'));

    const plan = await createProjectPackPlan(fixture);
    expect(plan.actions.find((action) => action.document_id === 'vision')).toMatchObject({
      action: 'conflict',
      reason: 'managed_destination_missing',
    });
  });

  it('rejects source content that does not match the manifest hash', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.visionSourcePath, '# Tampered source\n', 'utf8');

    await expect(createProjectPackPlan(fixture)).rejects.toThrow(/content hash/i);
  });

  it('rejects paths that escape the pack or target root', async () => {
    const fixture = await createFixture();
    await writeManifest(fixture, { visionTargetPath: '../outside.md' });

    await expect(createProjectPackPlan(fixture)).rejects.toThrow(/safe relative path/i);
  });

  it('rejects symbolic links in pack sources and target ancestors', async () => {
    const sourceFixture = await createFixture();
    const outsideSource = join(dirname(sourceFixture.packMetadataRoot), 'outside.md');
    await writeFile(outsideSource, sourceFixture.visionContent, 'utf8');
    await unlink(sourceFixture.visionSourcePath);
    await symlink(outsideSource, sourceFixture.visionSourcePath);

    await expect(createProjectPackPlan(sourceFixture)).rejects.toThrow(/symbolic link/i);

    const targetFixture = await createFixture();
    const outsideDirectory = join(dirname(targetFixture.targetRoot), 'outside-target');
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(targetFixture.targetRoot, 'docs'));

    await expect(createProjectPackPlan(targetFixture)).rejects.toThrow(/symbolic link/i);
  });

  it('fails closed when the previous receipt is malformed', async () => {
    const fixture = await createFixture();
    await applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' });
    const receiptPath = join(fixture.targetRoot, '.void-starter/project-pack-receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
      files: Array<{ after_sha256: string }>;
    };
    const firstFile = receipt.files[0];
    if (!firstFile) {
      throw new Error('Expected the test receipt to contain files');
    }
    firstFile.after_sha256 = 'not-a-hash';
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    await expect(createProjectPackPlan(fixture)).rejects.toThrow(/receipt/i);
  });

  it('refuses an unreadable concurrent apply lock without writing documents', async () => {
    const fixture = await createFixture();
    const metadataRoot = join(fixture.targetRoot, '.void-starter');
    const lockPath = join(metadataRoot, 'project-pack.lock');
    await mkdir(metadataRoot);
    await writeFile(lockPath, 'not-json\n', 'utf8');

    await expect(
      applyProjectPack({ ...fixture, confirmedProjectId: 'example-cortex' }),
    ).rejects.toThrow(/unreadable lock/i);
    expect(await readFile(lockPath, 'utf8')).toBe('not-json\n');
    await expect(lstat(join(fixture.targetRoot, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
