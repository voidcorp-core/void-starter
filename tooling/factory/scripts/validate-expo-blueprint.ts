import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createFactoryPreview, parseManifestSource } from '../src/factory-preview.service';

const fixturePath = new URL('../fixtures/manifests/web-expo.yaml', import.meta.url);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'void-starter-expo-blueprint-'));
const normalizedRoot = `${resolve(temporaryRoot)}${sep}`;
let succeeded = false;

const run = (command: string, arguments_: string[], cwd: string) => {
  const result = spawnSync(command, arguments_, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} exited with ${result.status ?? 'no status'}`,
    );
  }
};

const runOutput = (command: string, arguments_: string[], cwd: string): string => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(
      `${command} ${arguments_.join(' ')} exited with ${result.status ?? 'no status'}`,
    );
  }
  return result.stdout;
};

try {
  const source = await readFile(fixturePath, 'utf8');
  const manifest = parseManifestSource(source, fixturePath.pathname);
  const preview = createFactoryPreview(manifest);

  for (const file of preview.files.writes) {
    const destination = resolve(temporaryRoot, file.path);
    if (!destination.startsWith(normalizedRoot)) {
      throw new Error(`Generated path escapes the validation root: ${file.path}`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
  }

  const mobileRoot = join(temporaryRoot, 'apps/mobile');
  run('bun', ['install'], mobileRoot);
  run('bun', ['run', 'type-check'], mobileRoot);
  const projectId = '123e4567-e89b-42d3-a456-426614174000';
  await writeFile(
    join(mobileRoot, 'eas-project.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        owner: 'void-sandbox',
        slug: manifest.project.name,
        project_id: projectId,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const resolvedConfig = JSON.parse(
    runOutput('bunx', ['expo', 'config', '--type', 'public', '--json'], mobileRoot),
  ) as { owner?: string; extra?: { eas?: { projectId?: string } } };
  if (
    resolvedConfig.owner !== 'void-sandbox' ||
    resolvedConfig.extra?.eas?.projectId !== projectId
  ) {
    throw new Error('Expo dynamic config did not materialize the exact EAS project link');
  }
  run('bun', ['run', 'build'], mobileRoot);
  succeeded = true;
} finally {
  if (succeeded) {
    await rm(temporaryRoot, { recursive: true });
  } else {
    process.stderr.write(`Expo blueprint validation files kept at ${temporaryRoot}\n`);
  }
}
