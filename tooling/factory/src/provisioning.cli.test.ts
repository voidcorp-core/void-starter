import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalManifest } from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import { runProvisioningCli } from './provisioning.cli';
import { readProvisioningState } from './provisioning-apply.service';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('runProvisioningCli', () => {
  it('defaults to a write-free dry-run and rejects any live execution flag', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'void-starter-apply-cli-test-'));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, '.void-starter'));
    await writeFile(
      join(projectRoot, '.void-starter/manifest.json'),
      serializeCanonicalJson(parseBuildManifest(canonicalManifest)),
      'utf8',
    );
    const contextPath = join(projectRoot, 'provisioning.yaml');
    await writeFile(
      contextPath,
      `schema_version: 1
github:
  owner: voidcorp-core
  owner_kind: organization
  visibility: private
vercel:
  team_id: team_example
  region: fra1
neon:
  org_id: org-example
  region_id: aws-eu-central-1
cloudflare:
  account_id: 0123456789abcdef0123456789abcdef
sentry:
  organization_slug: void-sandbox
  team_slug: platform
  region: de
`,
      'utf8',
    );

    await expect(
      runProvisioningCli({
        arguments: [projectRoot, contextPath],
        requireExistingState: false,
      }),
    ).resolves.toMatchObject({
      schema_version: 1,
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: 'github.repository',
        }),
      ]),
    });
    expect(await readProvisioningState(projectRoot)).toBeNull();
    await expect(readFile(join(projectRoot, '.void-starter/apply.lock'), 'utf8')).rejects.toThrow();

    await expect(
      runProvisioningCli({
        arguments: [projectRoot, contextPath, '--execute'],
        requireExistingState: false,
      }),
    ).rejects.toThrow(/Unsupported apply mode/);
  });
});
