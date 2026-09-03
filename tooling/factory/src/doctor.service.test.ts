import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const processGuard = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Child-process execution is forbidden in local-only checks');
  }),
);

vi.mock('node:child_process', () => ({
  execFile: processGuard,
}));

import { doctorProject } from './doctor.service';
import { parseManifestSource } from './factory-preview.service';
import { renderProject } from './generation.service';
import { parseProvisioningHandoffContextSource } from './provisioning-handoff.service';

const temporaryRoots: string[] = [];
const manifestFixtureUrl = new URL('../fixtures/manifests/web-minimal.yaml', import.meta.url);
const contextFixtureUrl = new URL('../fixtures/provisioning/eu.yaml', import.meta.url);

async function createGeneratedProject() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'void-starter-handoff-doctor-test-'));
  temporaryRoots.push(temporaryRoot);
  const sourceRoot = join(temporaryRoot, 'source');
  const targetRoot = join(temporaryRoot, 'generated');
  await mkdir(sourceRoot);
  await writeFile(
    join(sourceRoot, 'package.json'),
    `${JSON.stringify({
      name: 'void-starter',
      private: true,
      workspaces: ['apps/*', 'packages/*', '_modules/*', 'tooling/*'],
    })}\n`,
    'utf8',
  );

  const [manifestSource, contextSource] = await Promise.all([
    readFile(manifestFixtureUrl, 'utf8'),
    readFile(contextFixtureUrl, 'utf8'),
  ]);
  await renderProject({
    manifest: parseManifestSource(manifestSource, manifestFixtureUrl.pathname),
    provisioningContext: parseProvisioningHandoffContextSource(
      contextSource,
      contextFixtureUrl.pathname,
    ),
    sourceRoot,
    targetRoot,
  });
  return targetRoot;
}

async function readTextTree(root: string): Promise<string> {
  const contents: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      contents.push(await readTextTree(path));
    } else if (entry.isFile()) {
      contents.push(await readFile(path, 'utf8'));
    }
  }
  return contents.join('\n');
}

function handoffCheck(report: Awaited<ReturnType<typeof doctorProject>>) {
  return report.checks.find((check) => check.id === 'provisioning-handoff');
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  processGuard.mockClear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('doctorProject provisioning handoff', () => {
  it('validates a matching manifest, receipt, plan, and derived runbook locally', async () => {
    const networkGuard = vi.fn(() => {
      throw new Error('Network access is forbidden in local-only checks');
    });
    vi.stubGlobal('fetch', networkGuard);
    vi.stubEnv('GITHUB_TOKEN', 'sentinel-github-secret');
    vi.stubEnv('VERCEL_TOKEN', 'sentinel-vercel-secret');
    const targetRoot = await createGeneratedProject();

    const report = await doctorProject(targetRoot);

    expect(report.ok).toBe(true);
    expect(handoffCheck(report)).toEqual({
      id: 'provisioning-handoff',
      status: 'pass',
      message: 'Provisioning plan, runbook, manifest, and receipt agree locally',
    });
    expect(networkGuard).not.toHaveBeenCalled();
    expect(processGuard).not.toHaveBeenCalled();
    const generatedContents = await readTextTree(targetRoot);
    expect(generatedContents).not.toContain('sentinel-github-secret');
    expect(generatedContents).not.toContain('sentinel-vercel-secret');
  });

  it('reports precise plan, runbook, and receipt inconsistencies', async () => {
    const runbookRoot = await createGeneratedProject();
    await writeFile(join(runbookRoot, 'docs/PROVISIONING.md'), '\nMissing actions.\n', {
      encoding: 'utf8',
      flag: 'a',
    });
    expect(handoffCheck(await doctorProject(runbookRoot))).toEqual(
      expect.objectContaining({
        status: 'fail',
        message: expect.stringMatching(/runbook/i),
      }),
    );

    const receiptRoot = await createGeneratedProject();
    const receiptPath = join(receiptRoot, '.void-starter/receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.provisioning_plan_sha256 = '0'.repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    expect(handoffCheck(await doctorProject(receiptRoot))).toEqual(
      expect.objectContaining({
        status: 'fail',
        message: expect.stringMatching(/receipt.*digest/i),
      }),
    );

    const planRoot = await createGeneratedProject();
    await writeFile(
      join(planRoot, '.void-starter/provisioning-plan.json'),
      '{"schema_version":2}\n',
      'utf8',
    );
    expect(handoffCheck(await doctorProject(planRoot))).toEqual(
      expect.objectContaining({
        status: 'fail',
        message: expect.stringMatching(/plan.*invalid/i),
      }),
    );
  });

  it('keeps historical receipts diagnosable across the exclusion-policy split', async () => {
    const targetRoot = await createGeneratedProject();
    const receiptPath = join(targetRoot, '.void-starter/receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.schema_version = 1;
    delete receipt.provisioning_plan_sha256;
    receipt.excluded_source_paths = [
      '.agents',
      '.git',
      '.mcp.json',
      '.void',
      'CLAUDE.md',
      'tooling/factory',
    ];
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await unlink(join(targetRoot, '.void-starter/provisioning-plan.json'));
    await unlink(join(targetRoot, 'docs/PROVISIONING.md'));

    const report = await doctorProject(targetRoot);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'receipt-plan', status: 'pass' }),
    );
    expect(handoffCheck(report)).toEqual({
      id: 'provisioning-handoff',
      status: 'fail',
      message: 'Historical receipt is readable but cannot establish version 2 handoff integrity',
    });
  });

  it('rejects a current receipt that drops its required handoff digest', async () => {
    const targetRoot = await createGeneratedProject();
    const receiptPath = join(targetRoot, '.void-starter/receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    delete receipt.provisioning_plan_sha256;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    const report = await doctorProject(targetRoot);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([expect.objectContaining({ id: 'metadata', status: 'fail' })]);
  });

  it('compares the exclusion policy strictly for current receipts', async () => {
    const targetRoot = await createGeneratedProject();
    const receiptPath = join(targetRoot, '.void-starter/receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.excluded_source_paths = ['tooling/factory'];
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    const report = await doctorProject(targetRoot);

    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'receipt-plan', status: 'fail' }),
    );
  });

  it('allows project-owned governance while rejecting leaked Factory internals', async () => {
    const targetRoot = await createGeneratedProject();
    await mkdir(join(targetRoot, '.git'));
    await mkdir(join(targetRoot, '.void'));
    await mkdir(join(targetRoot, '.claude'));
    await writeFile(join(targetRoot, 'CLAUDE.md'), '# Project doctrine\n', 'utf8');
    await writeFile(join(targetRoot, '.mcp.json'), '{}\n', 'utf8');
    await writeFile(join(targetRoot, '.claude/settings.local.json'), '{}\n', 'utf8');

    const livingProjectReport = await doctorProject(targetRoot);
    expect(livingProjectReport.checks).toContainEqual(
      expect.objectContaining({ id: 'development-artifacts', status: 'pass' }),
    );

    await mkdir(join(targetRoot, '.agents'));
    const leakedFactoryReport = await doctorProject(targetRoot);
    expect(leakedFactoryReport.checks).toContainEqual(
      expect.objectContaining({ id: 'development-artifacts', status: 'fail' }),
    );
  });
});
