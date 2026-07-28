import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFactoryPreview, parseManifestSource } from './factory-preview.service';

const fixtureUrl = (name: string) => new URL(`../fixtures/manifests/${name}.yaml`, import.meta.url);

const previewFixture = (name: string) => {
  const source = readFileSync(fixtureUrl(name), 'utf8');
  const manifest = parseManifestSource(source, `${name}.yaml`);
  return createFactoryPreview(manifest);
};

describe('factory preview fixtures', () => {
  it('previews the web-only fixture without Expo writes', () => {
    const preview = previewFixture('web-only');

    expect(preview.composition.units).toContainEqual({
      kind: 'surface',
      id: 'web',
      adapter: 'next-vercel',
    });
    expect(preview.files.writes.map((file) => file.path)).not.toContain('apps/mobile/package.json');
    expect(preview.files.writes.map((file) => file.path)).toContain('apps/web/package.json');
    expect(preview.files.removals).toEqual(
      expect.arrayContaining([
        '_modules/analytics-posthog',
        '_modules/observability-sentry',
        'apps/mobile',
        'apps/worker',
      ]),
    );
  });

  it('previews the mobile-only fixture and removes the web baseline', () => {
    const preview = previewFixture('mobile-only');

    expect(preview.composition.units).toContainEqual({
      kind: 'surface',
      id: 'mobile',
      adapter: 'expo-eas',
    });
    expect(preview.files.writes).not.toHaveLength(0);
    expect(preview.files.removals).toEqual(
      expect.arrayContaining(['apps/web', 'apps/worker', 'packages/auth', 'packages/db']),
    );
  });

  it('previews the mixed fixture with both surfaces', () => {
    const preview = previewFixture('web-expo');

    expect(preview.composition.units.filter((unit) => unit.kind === 'surface')).toEqual([
      {
        kind: 'surface',
        id: 'web',
        adapter: 'next-vercel',
      },
      {
        kind: 'surface',
        id: 'mobile',
        adapter: 'expo-eas',
      },
    ]);
    expect(preview.files.removals).toContain('apps/worker');
    expect(preview.files.removals).not.toContain('_modules/analytics-posthog');
    expect(preview.files.removals).not.toContain('_modules/observability-sentry');
  });

  it('previews minimal and Clerk capability topologies', () => {
    const minimal = previewFixture('web-minimal');
    const clerk = previewFixture('web-clerk');

    expect(minimal.files.removals).toEqual(
      expect.arrayContaining(['packages/auth', 'packages/db', 'packages/notes']),
    );
    expect(clerk.files.writes.map((file) => file.path)).toContain(
      'apps/web/src/app/sign-in/[[...sign-in]]/page.tsx',
    );
    expect(clerk.files.removals).toContain('packages/auth');
  });

  it('previews the durable-jobs fixture with its workload and runtime wiring', () => {
    const preview = previewFixture('web-durable-jobs');

    expect(preview.composition.units).toContainEqual({
      kind: 'workload',
      id: 'durable_jobs',
      adapter: 'vercel-workflows',
    });
    expect(preview.files.removals).not.toContain('_modules/jobs-vercel-workflow');
    expect(preview.files.removals).not.toContain('apps/web/src/workflows');
    expect(preview.files.removals).toContain('apps/mobile');

    const nextConfig = preview.files.writes.find(
      (file) => file.path === 'apps/web/next.config.ts',
    )?.content;
    expect(nextConfig).toContain('withWorkflow(config)');
  });

  it('accepts JSON input and rejects unsupported manifest formats', () => {
    const yamlSource = readFileSync(fixtureUrl('web-only'), 'utf8');
    const manifest = parseManifestSource(yamlSource, 'web-only.yaml');

    expect(parseManifestSource(JSON.stringify(manifest), 'web-only.json')).toEqual(manifest);
    expect(() => parseManifestSource(yamlSource, 'web-only.toml')).toThrow(/format/i);
    expect(() => parseManifestSource(yamlSource, 'manifest')).toThrow(/missing extension/i);
  });
});
