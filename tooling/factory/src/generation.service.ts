import { cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createProjectFilePlan } from './capability-composition.service';
import { createCompositionPlan } from './factory.service';
import type { BuildManifest, GenerationReceipt, ProjectFilePlan } from './factory.types';
import { serializeCanonicalJson, sha256 } from './integrity.service';

const METADATA_DIRECTORY = '.void-starter';

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.expo',
  '.next',
  // The Workflow SDK compiler caches SWC plugins here during a build.
  '.swc',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

const EXCLUDED_SOURCE_PATHS = [
  '.agents',
  '.codex',
  '.git',
  // Points agents at the void-starter team's own Linear workspace: development
  // governance, like CLAUDE.md, never a dependency of a generated project.
  '.mcp.json',
  '.void',
  'AGENTS.md',
  'CLAUDE.md',
  'bun.lock',
  'docs/discovery',
  'docs/FACTORY.md',
  'docs/superpowers',
  'tooling/factory',
].toSorted();

/**
 * Build artifacts that a tool writes INSIDE the source tree rather than into a
 * conventional output directory. They are never copied, but unlike
 * `EXCLUDED_SOURCE_PATHS` they are legitimate in a generated project once it has
 * been built, so they must not count as development artifacts in `doctor`.
 *
 * The Workflow SDK emits its route handlers under `.well-known/workflow` and drops
 * a `.gitignore` containing `*` beside them. Copying those files produces a
 * snapshot git refuses to stage, which breaks source publication; the generated
 * project regenerates them from its own `use workflow` directives.
 */
const EXCLUDED_BUILD_ARTIFACT_PATHS = ['apps/web/src/app/.well-known/workflow'].toSorted();

export const FORBIDDEN_OUTPUT_PATHS = EXCLUDED_SOURCE_PATHS.filter((path) => path !== 'bun.lock');

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isExcludedSourcePath(relativePath: string): boolean {
  if (!relativePath) {
    return false;
  }

  const normalizedPath = relativePath.split(sep).join('/');
  if (
    [...EXCLUDED_SOURCE_PATHS, ...EXCLUDED_BUILD_ARTIFACT_PATHS].some(
      (excludedPath) =>
        normalizedPath === excludedPath || normalizedPath.startsWith(`${excludedPath}/`),
    )
  ) {
    return true;
  }

  const pathSegments = normalizedPath.split('/');
  if (pathSegments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const fileName = pathSegments.at(-1) ?? '';
  if (fileName === '.DS_Store' || fileName.endsWith('.log')) {
    return true;
  }
  if (fileName.startsWith('.env') && fileName !== '.env.example') {
    return true;
  }

  return false;
}

function resolveInside(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error(`Generated path must be a non-empty relative path: ${relativePath}`);
  }

  const destination = resolve(root, relativePath);
  if (!destination.startsWith(`${root}${sep}`)) {
    throw new Error(`Generated path escapes the target root: ${relativePath}`);
  }
  return destination;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function sanitizeGeneratedBaseline(targetRoot: string, manifest: BuildManifest) {
  const packagePath = join(targetRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    name?: string;
    scripts?: unknown;
    workspaces?: unknown;
  };
  if (!Array.isArray(packageJson.workspaces)) {
    throw new Error('Baseline package.json must declare an array of workspaces');
  }

  packageJson.name = manifest.project.name;
  if (packageJson.scripts === undefined) {
    packageJson.scripts = {};
  }
  if (
    packageJson.scripts === null ||
    typeof packageJson.scripts !== 'object' ||
    Array.isArray(packageJson.scripts)
  ) {
    throw new Error('Baseline package.json scripts must be an object when present');
  }
  (packageJson.scripts as Record<string, unknown>)['hooks:install'] = 'lefthook install';
  packageJson.workspaces = packageJson.workspaces.filter(
    (workspace): workspace is string =>
      typeof workspace === 'string' &&
      workspace !== 'tooling/*' &&
      !(
        workspace === '_modules/*' &&
        manifest.operations.analytics === 'none' &&
        manifest.operations.errors === 'none' &&
        manifest.operations.email === 'none'
      ),
  );
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  const knipPath = join(targetRoot, 'knip.json');
  const knipSource = await readOptionalFile(knipPath);
  if (knipSource) {
    const knipConfig = JSON.parse(knipSource) as {
      workspaces?: Record<string, unknown>;
    };
    if (knipConfig.workspaces) {
      delete knipConfig.workspaces['tooling/*'];
      if (manifest.surfaces.web === 'none') {
        delete knipConfig.workspaces['apps/*'];
        delete knipConfig.workspaces['packages/*'];
        delete knipConfig.workspaces['packages/core'];
        delete knipConfig.workspaces['packages/ui'];

        const configWorkspace = knipConfig.workspaces['packages/config'];
        if (
          configWorkspace &&
          typeof configWorkspace === 'object' &&
          !Array.isArray(configWorkspace)
        ) {
          delete (configWorkspace as Record<string, unknown>)['ignoreDependencies'];
        }
      } else if (manifest.auth.provider !== 'better-auth') {
        const webWorkspaces = knipConfig.workspaces['apps/*'];
        if (webWorkspaces && typeof webWorkspaces === 'object' && !Array.isArray(webWorkspaces)) {
          (webWorkspaces as Record<string, unknown>)['entry'] = [
            'src/app/**/page.tsx',
            'src/app/**/layout.tsx',
          ];
          (webWorkspaces as Record<string, unknown>)['project'] = ['src/**/*.{ts,tsx,css}'];
        }
      }
      if (manifest.surfaces.mobile.adapter === 'expo-eas') {
        knipConfig.workspaces['apps/mobile'] = {
          entry: ['app/**/*.tsx'],
          project: ['app/**/*.{ts,tsx}', '*.ts'],
          ignoreDependencies: ['expo-updates'],
        };
      }
    }
    await writeFile(knipPath, `${JSON.stringify(knipConfig, null, 2)}\n`, 'utf8');
  }

  const biomePath = join(targetRoot, 'biome.json');
  const biomeSource = await readOptionalFile(biomePath);
  if (biomeSource) {
    const biomeConfig = JSON.parse(biomeSource) as {
      overrides?: unknown;
    };
    if (biomeConfig.overrides !== undefined) {
      throw new Error('Baseline biome.json overrides must be merged explicitly before generation');
    }

    const closingBraceIndex = biomeSource.lastIndexOf('}');
    if (closingBraceIndex === -1) {
      throw new Error('Baseline biome.json must contain a root object');
    }
    const configWithoutClosingBrace = biomeSource.slice(0, closingBraceIndex).trimEnd();
    const generatedJsonOverride = `  "overrides": [
    {
      "includes": [".void-starter/**/*.json", "apps/mobile/*.json", "knip.json"],
      "formatter": {
        "enabled": false
      }
    }
  ]
`;
    await writeFile(
      biomePath,
      `${configWithoutClosingBrace},\n${generatedJsonOverride}}\n`,
      'utf8',
    );
  }

  const readmePath = join(targetRoot, 'README.md');
  const readmeSource = await readOptionalFile(readmePath);
  if (readmeSource) {
    const readme = readmeSource
      .replace(/^# .+$/m, `# ${manifest.project.name}`)
      .replace(
        /`-- tooling\/\r?\n {4}`-- factory\/[^\r\n]*\r?\n/,
        '`-- tooling/                       # Reserved for project scripts\n',
      )
      .split(/\r?\n/)
      .filter((line) => !line.includes('docs/FACTORY.md'))
      .join('\n');
    await writeFile(readmePath, readme.endsWith('\n') ? readme : `${readme}\n`, 'utf8');
  }
}

export type RenderProjectInput = {
  manifest: BuildManifest;
  sourceRoot: string;
  targetRoot: string;
};

export function createGenerationReceipt(
  manifest: BuildManifest,
  filePlan: ProjectFilePlan,
): GenerationReceipt {
  const manifestSource = serializeCanonicalJson(manifest);
  return {
    schema_version: 1,
    project: manifest.project,
    manifest_sha256: sha256(manifestSource),
    composition: createCompositionPlan(manifest),
    generated_files: filePlan.writes.map((file) => ({
      path: file.path,
      sha256: sha256(file.content),
    })),
    removed_paths: filePlan.removals,
    excluded_source_paths: EXCLUDED_SOURCE_PATHS,
    next_actions: [
      'git init',
      'bun install',
      'bun run hooks:install',
      'bun run type-check',
      'bun run test',
      'bun run build',
    ],
  };
}

export async function renderProject(input: RenderProjectInput): Promise<GenerationReceipt> {
  const sourceRoot = await realpath(resolve(input.sourceRoot));
  const sourceStats = await stat(sourceRoot);
  if (!sourceStats.isDirectory()) {
    throw new Error('Source root must be a directory');
  }

  const requestedTarget = resolve(input.targetRoot);
  const targetParent = await realpath(dirname(requestedTarget));
  const targetRoot = join(targetParent, basename(requestedTarget));

  if (targetRoot === sourceRoot || targetRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('Target root must not be the source root or live inside it');
  }
  if (await pathExists(targetRoot)) {
    throw new Error(`Target root already exists: ${targetRoot}`);
  }

  const filePlan = createProjectFilePlan(input.manifest);

  try {
    await cp(sourceRoot, targetRoot, {
      errorOnExist: true,
      force: false,
      recursive: true,
      filter: async (sourcePath) => {
        const sourcePathStats = await lstat(sourcePath);
        if (sourcePathStats.isSymbolicLink()) {
          throw new Error(`Source contains a symbolic link: ${relative(sourceRoot, sourcePath)}`);
        }
        return !isExcludedSourcePath(relative(sourceRoot, sourcePath));
      },
    });

    for (const removal of filePlan.removals) {
      await rm(resolveInside(targetRoot, removal), { force: true, recursive: true });
    }

    for (const file of filePlan.writes) {
      const destination = resolveInside(targetRoot, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { encoding: 'utf8', flag: 'w' });
    }

    await sanitizeGeneratedBaseline(targetRoot, input.manifest);

    const manifestSource = serializeCanonicalJson(input.manifest);
    const receipt = createGenerationReceipt(input.manifest, filePlan);

    const metadataRoot = join(targetRoot, METADATA_DIRECTORY);
    await mkdir(metadataRoot);
    await writeFile(join(metadataRoot, 'manifest.json'), manifestSource, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await writeFile(join(metadataRoot, 'receipt.json'), serializeCanonicalJson(receipt), {
      encoding: 'utf8',
      flag: 'wx',
    });

    return receipt;
  } catch (error) {
    await rm(targetRoot, { force: true, recursive: true });
    throw error;
  }
}
