import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  clerkManifest,
  documentsManifest,
  durableJobsManifest,
  minimalManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { createCapabilityFilePlan, createProjectFilePlan } from './capability-composition.service';
import { parseBuildManifest } from './factory.service';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BIOME_BIN = resolve(REPO_ROOT, 'node_modules/.bin/biome');

/**
 * Upper bound for the one `biome check` child a lint-gate case spawns.
 *
 * Measured on 2026-09-02 against base 8e011c2 on an 8-core host. A case is the
 * plan generation (1 to 19 ms), the temporary directory I/O (under 20 ms) and
 * the child, so the child is the case: 89 to 147 ms isolated, 308 to 1237 ms
 * under the root Turborepo fan-out at load average 25 to 42, when sibling
 * worktrees run their suites too. The bound is three times that worst case. It
 * still fails a hung or swapped biome long before Vitest gives up, yet a
 * regression that doubles the cost stays invisible; that is the accepted margin.
 * The per-file spawns this replaces cost 700 to 2900 ms per profile at load
 * average 87 and tripped Vitest's implicit 5 s default, which is why the bound
 * is written here rather than inherited.
 */
const BIOME_CHECK_TIMEOUT_MS = 4_000;

/**
 * Per-case Vitest bound, passed explicitly so a change to the shared base
 * config can neither loosen nor tighten this case unnoticed. The spawn is
 * synchronous, so the child bound is the one enforced while biome runs and
 * Vitest only reads its own clock once the call returns; the extra second
 * covers plan generation and the temporary directory I/O.
 */
const LINT_GATE_CASE_TIMEOUT_MS = BIOME_CHECK_TIMEOUT_MS + 1_000;

/** Biome prints this line whether or not it found errors; the count is asserted. */
const BIOME_CHECKED_COUNT_PATTERN = /Checked (\d+) files?/;

type GeneratedSource = { path: string; content: string };

/**
 * The longest project name the manifest schema accepts (63 characters).
 *
 * Generated sources must satisfy the lint gate at this length, not only at the
 * short names the fixtures happen to use.
 */
const LONGEST_PROJECT_NAME = 'void-starter-canary-internal-tool-with-a-deliberately-long-name';

/**
 * Runs one profile's generated sources through the same `biome check` the
 * generated project runs, in a single child process from the repository root so
 * the real configuration applies. One process per profile, not per file: the
 * process start dominates the cost, and `--stdin-file-path` takes one file per
 * process, so the sources are materialized in a temporary directory instead.
 * Biome resolves its configuration from the working directory, so the root
 * `biome.json` governs files outside the repository too (verified: a
 * double-quoted probe under the OS temporary directory came back single-quoted).
 * Neither the root nor the base config carries path-scoped overrides, and every
 * enabled rule is per-file, so co-locating a profile's sources changes nothing.
 *
 * Returns each source's content after biome wrote its fixes, keyed by path.
 * The caller asserts it equals the generated content. The number of files biome
 * reports is asserted against the number handed over, so a source that
 * `files.includes` silently skips fails the gate instead of passing it
 * (verified: a probe at `apps/web/next-env.d.ts` reports "Checked 0 files").
 * Warnings pass, exactly as they pass the generated project's `bun run lint`.
 */
function checkWithBiome(profile: string, sources: readonly GeneratedSource[]): Map<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'factory-lint-gate-'));
  try {
    materializeSources(root, sources);
    const startedAt = performance.now();
    const result = spawnSync(BIOME_BIN, ['check', '--write', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: BIOME_CHECK_TIMEOUT_MS,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const files = sources.map((file) => file.path).join(', ');
    if (result.error) {
      throw new Error(
        `biome check for ${profile} (${files}) ended by ${result.signal ?? 'no signal'} ` +
          `after ${elapsedMs} ms, bound ${BIOME_CHECK_TIMEOUT_MS} ms: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `biome check failed for ${profile} (${files}) after ${elapsedMs} ms:\n` +
          `${result.stdout}${result.stderr}`,
      );
    }
    const checkedCount = result.stdout.match(BIOME_CHECKED_COUNT_PATTERN)?.[1];
    if (checkedCount === undefined) {
      throw new Error(
        `biome printed no "Checked N files" line for ${profile} (${files}):\n` +
          `${result.stdout}${result.stderr}`,
      );
    }
    if (Number(checkedCount) !== sources.length) {
      throw new Error(
        `biome checked ${checkedCount} of ${sources.length} files for ${profile} (${files}):\n` +
          result.stdout,
      );
    }
    return new Map(sources.map((file) => [file.path, readFileSync(join(root, file.path), 'utf8')]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function materializeSources(root: string, sources: readonly GeneratedSource[]): void {
  for (const file of sources) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}

function withProjectName<T extends { project: { name: string; profile: string } }>(
  fixture: T,
  name: string,
): Record<string, unknown> {
  return { ...fixture, project: { ...fixture.project, name } };
}

function readGeneratedJson(
  plan: ReturnType<typeof createCapabilityFilePlan>,
  path: string,
): Record<string, unknown> {
  return JSON.parse(readGeneratedFile(plan, path)) as Record<string, unknown>;
}

function readGeneratedFile(
  plan: ReturnType<typeof createCapabilityFilePlan>,
  path: string,
): string {
  const content = plan.writes.find((file) => file.path === path)?.content;
  if (!content) {
    throw new Error(`Missing generated file: ${path}`);
  }
  return content;
}

describe('createCapabilityFilePlan', () => {
  it('prunes every optional local capability from a minimal public web project', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(minimalManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(plan.removals).toEqual(
      expect.arrayContaining([
        '_modules/analytics-posthog',
        '_modules/auth-clerk',
        '_modules/email-resend',
        '_modules/observability-sentry',
        'apps/web/src/app/(auth)',
        'apps/web/src/app/api/auth',
        'apps/web/src/components/_examples/UserProfileCard',
        'apps/web/src/instrumentation.ts',
        'apps/web/src/proxy.ts',
        'packages/auth',
        'packages/db',
        'packages/notes',
      ]),
    );
    expect(webPackage.dependencies).toEqual({
      '@repo/core': 'workspace:*',
      '@repo/ui': 'workspace:*',
      next: '^16.2.11',
      react: '^19.2.8',
      'react-dom': '^19.2.8',
    });
    expect(webPackage.devDependencies).not.toHaveProperty('postgres');
    expect(webPackage.scripts).not.toHaveProperty('test:e2e');
    expect(readGeneratedJson(plan, 'apps/web/vercel.json')).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: 'nextjs',
      regions: ['fra1'],
    });
    expect(readGeneratedFile(plan, 'apps/web/vercel.json')).toBe(`{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["fra1"]
}
`);

    const generatedSource = plan.writes.map((file) => file.content).join('\n');
    expect(generatedSource).not.toMatch(
      /@repo\/auth|@repo\/posthog|@repo\/sentry|@sentry\/nextjs|better-auth|DATABASE_URL/,
    );
  });

  it('keeps and wires the selected Better Auth, database, PostHog, and Sentry packages', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(canonicalManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(plan.removals).not.toContain('packages/auth');
    expect(plan.removals).not.toContain('packages/db');
    expect(plan.removals).not.toContain('packages/notes');
    expect(plan.removals).not.toContain('_modules/analytics-posthog');
    expect(plan.removals).not.toContain('_modules/observability-sentry');
    expect(plan.removals).not.toContain('_modules/email-resend');
    expect(plan.removals).toContain('_modules/auth-clerk');
    expect(webPackage.dependencies).toMatchObject({
      '@repo/auth': 'workspace:*',
      '@repo/notes': 'workspace:*',
      '@repo/posthog': 'workspace:*',
      '@repo/sentry': 'workspace:*',
      '@sentry/nextjs': '^10.68.0',
      'better-auth': '^1.6.25',
    });
    expect(webPackage.devDependencies).toHaveProperty('postgres');
    expect(readGeneratedFile(plan, 'apps/web/next.config.ts')).toContain("'@repo/email-resend'");
    expect(readGeneratedFile(plan, '.env.example')).toContain('EMAIL_APP_NAME=example-saas');
  });

  it('prunes the durable-jobs runtime when no jobs workload is selected', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(canonicalManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
    };

    expect(plan.removals).toEqual(
      expect.arrayContaining([
        '_modules/jobs-vercel-workflow',
        'apps/web/src/app/api/jobs',
        'apps/web/src/workflows',
      ]),
    );
    expect(webPackage.dependencies).not.toHaveProperty('workflow');
    expect(webPackage.dependencies).not.toHaveProperty('@repo/jobs-vercel-workflow');
    expect(readGeneratedFile(plan, 'apps/web/next.config.ts')).not.toContain('withWorkflow');
  });

  it('keeps and wires the durable-jobs runtime when the jobs workload is selected', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(durableJobsManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
    };
    const nextConfig = readGeneratedFile(plan, 'apps/web/next.config.ts');

    expect(plan.removals).not.toContain('_modules/jobs-vercel-workflow');
    expect(plan.removals).not.toContain('apps/web/src/workflows');
    expect(plan.removals).not.toContain('apps/web/src/app/api/jobs');
    expect(webPackage.dependencies).toMatchObject({
      '@repo/jobs-vercel-workflow': 'workspace:*',
      workflow: '^4.6.2',
    });
    expect(nextConfig).toContain("import { withWorkflow } from 'workflow/next';");
    expect(nextConfig).toContain('withWorkflow(config)');
    expect(nextConfig).toContain("'@repo/jobs-vercel-workflow'");
  });

  it('prunes the documents surface and its storage module when no object storage is selected', () => {
    // `minimalManifest`, not the canonical one: the canonical fixture already
    // selects R2, so asserting the pruned case against it would pass for the
    // wrong reason -- or rather, would never pass at all.
    const plan = createCapabilityFilePlan(parseBuildManifest(minimalManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
    };

    expect(plan.removals).toEqual(
      expect.arrayContaining([
        '_modules/storage-r2',
        'apps/web/src/actions/documents.actions.ts',
        'apps/web/src/app/documents',
      ]),
    );
    expect(webPackage.dependencies).not.toHaveProperty('@repo/storage-r2');
    expect(readGeneratedFile(plan, 'apps/web/next.config.ts')).not.toContain('@repo/storage-r2');
    expect(readGeneratedFile(plan, '.env.example')).not.toContain('R2_BUCKET_NAME');
  });

  it('keeps and wires the documents surface when R2 is selected', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(documentsManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
    };
    const environment = readGeneratedFile(plan, '.env.example');

    expect(plan.removals).not.toContain('_modules/storage-r2');
    expect(plan.removals).not.toContain('apps/web/src/app/documents');
    expect(plan.removals).not.toContain('apps/web/src/actions/documents.actions.ts');
    expect(webPackage.dependencies).toMatchObject({ '@repo/storage-r2': 'workspace:*' });
    expect(readGeneratedFile(plan, 'apps/web/next.config.ts')).toContain("'@repo/storage-r2'");
    // Every variable the R2 adapter reads, or the generated project starts and
    // fails on its first upload rather than at boot.
    for (const key of [
      'CLOUDFLARE_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
    ]) {
      expect(environment).toContain(key);
    }
  });

  it('keeps the documents schema in both, so the published migrations stay in step', () => {
    // The surfaces are pruned; the table is not. A generated project without R2
    // still applies migration 0006, so removing the schema file would leave the
    // Drizzle history describing a table the schema does not declare.
    for (const manifest of [minimalManifest, documentsManifest]) {
      const plan = createCapabilityFilePlan(parseBuildManifest(manifest));
      expect(plan.removals).not.toContain('packages/db/src/schema/documents.ts');
    }
  });

  it('materializes Clerk directly and removes the non-runtime scaffold and Better Auth graph', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(clerkManifest));
    const webPackage = readGeneratedJson(plan, 'apps/web/package.json') as {
      dependencies: Record<string, string>;
    };

    expect(plan.removals).toEqual(
      expect.arrayContaining([
        '_modules/auth-clerk',
        'apps/web/src/app/(auth)',
        'apps/web/src/app/api/auth',
        'packages/auth',
        'packages/notes',
      ]),
    );
    expect(webPackage.dependencies).toMatchObject({
      '@clerk/nextjs': '^7.6.0',
    });
    expect(webPackage.dependencies).not.toHaveProperty('@repo/auth');
    expect(webPackage.dependencies).not.toHaveProperty('better-auth');
    expect(plan.writes.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'apps/web/src/app/dashboard/page.tsx',
        'apps/web/src/app/sign-in/[[...sign-in]]/page.tsx',
        'apps/web/src/app/sign-up/[[...sign-up]]/page.tsx',
        'apps/web/src/proxy.ts',
      ]),
    );
    expect(
      plan.writes.find((file) => file.path === 'apps/web/src/app/layout.tsx')?.content,
    ).toContain('ClerkProvider');
  });

  it('drops every web-only package from a mobile-only repository', () => {
    const plan = createCapabilityFilePlan(parseBuildManifest(mobileOnlyManifest));

    expect(plan.writes.map((file) => file.path)).toEqual(['.env.example']);
    expect(plan.removals).toEqual(
      expect.arrayContaining([
        'packages/auth',
        'packages/core',
        'packages/db',
        'packages/notes',
        'packages/ui',
      ]),
    );
  });

  it.each([
    ['public web', minimalManifest],
    ['better-auth web', canonicalManifest],
    ['clerk web', clerkManifest],
    ['durable-jobs web', durableJobsManifest],
  ])(
    'emits %s TypeScript sources that already pass the lint gate',
    (profile, fixture) => {
      const plan = createProjectFilePlan(
        parseBuildManifest(withProjectName(fixture, LONGEST_PROJECT_NAME)),
      );
      const sources = plan.writes.filter((file) => /\.tsx?$/.test(file.path));

      expect(sources.length).toBeGreaterThan(0);
      const checked = checkWithBiome(profile, sources);
      for (const file of sources) {
        expect(checked.get(file.path), file.path).toBe(file.content);
      }
    },
    LINT_GATE_CASE_TIMEOUT_MS,
  );

  it('combines surface and capability plans deterministically without duplicate writes', () => {
    const manifest = parseBuildManifest(mobileOnlyManifest);
    const first = createProjectFilePlan(manifest);
    const second = createProjectFilePlan(manifest);

    expect(second).toEqual(first);
    expect(first.writes.map((file) => file.path)).toEqual(
      first.writes.map((file) => file.path).toSorted(),
    );
    expect(new Set(first.writes.map((file) => file.path)).size).toBe(first.writes.length);
    expect(first.removals).toContain('apps/web');
  });
});
