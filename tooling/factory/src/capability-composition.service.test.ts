import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  clerkManifest,
  minimalManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { createCapabilityFilePlan, createProjectFilePlan } from './capability-composition.service';
import { parseBuildManifest } from './factory.service';

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
