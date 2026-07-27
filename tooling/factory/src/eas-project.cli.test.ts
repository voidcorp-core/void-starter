import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expoManifest } from './__fixtures__/manifest.fixture';
import { createProjectFilePlan } from './capability-composition.service';
import {
  runEasProjectApplyCli,
  runEasProjectPlanCli,
  runEasProjectPreflightCli,
} from './eas-project.cli';
import type { EasCliRunner } from './eas-project.service';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('EAS project CLI', () => {
  it('loads strict context, runs read-only preflight and rejects an inexact confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-starter-eas-cli-test-'));
    temporaryRoots.push(root);
    const manifest = parseBuildManifest(expoManifest);
    await mkdir(join(root, '.void-starter'), { recursive: true });
    await writeFile(
      join(root, '.void-starter/manifest.json'),
      serializeCanonicalJson(manifest),
      'utf8',
    );
    for (const file of createProjectFilePlan(manifest).writes.filter((file) =>
      ['apps/mobile/app.json', 'apps/mobile/app.config.ts'].includes(file.path),
    )) {
      const destination = join(root, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, 'utf8');
    }
    const contextPath = join(root, 'eas.yaml');
    await writeFile(contextPath, 'schema_version: 1\naccount: void-sandbox\n', 'utf8');

    await expect(runEasProjectPlanCli({ arguments: [root, contextPath] })).resolves.toMatchObject({
      application: { full_name: '@void-sandbox/example-saas' },
    });

    let mutations = 0;
    const runner: EasCliRunner = {
      async run(input) {
        if (input.arguments[0] !== 'account:view') mutations += 1;
        return {
          stdout:
            'factory-user (authenticated using EXPO_TOKEN)\n\nAccounts:\n• void-sandbox (Role: Admin)\n',
          stderr: '',
        };
      },
    };
    await expect(
      runEasProjectPreflightCli({
        arguments: [root, contextPath],
        environment: { EXPO_TOKEN: 'memory-only-token' },
        options: { runner },
      }),
    ).resolves.toMatchObject({ ok: true, account_role: 'Admin' });
    expect(mutations).toBe(0);

    await expect(
      runEasProjectApplyCli({
        arguments: [root, contextPath, '--confirm-project', 'wrong-project'],
        environment: { EXPO_TOKEN: 'memory-only-token' },
        requireExistingState: false,
        options: { runner },
      }),
    ).rejects.toThrow(/exactly match/);
    expect(mutations).toBe(0);
  });
});
