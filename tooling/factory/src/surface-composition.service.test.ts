import { describe, expect, it } from 'vitest';
import {
  canonicalManifest,
  expoManifest,
  mobileOnlyManifest,
} from './__fixtures__/manifest.fixture';
import { parseBuildManifest } from './factory.service';
import { createSurfaceFilePlan } from './surface-composition.service';

describe('createSurfaceFilePlan', () => {
  it('does not add Expo files to a web-only project', () => {
    const filePlan = createSurfaceFilePlan(parseBuildManifest(canonicalManifest));

    expect(filePlan).toEqual({
      writes: [],
      removals: ['apps/mobile', 'apps/worker'],
    });
  });

  it('adds a complete Expo SDK 57 and EAS surface only when selected', () => {
    const filePlan = createSurfaceFilePlan(parseBuildManifest(expoManifest));

    expect(filePlan.writes.map((file) => file.path)).toEqual([
      'apps/mobile/.gitignore',
      'apps/mobile/app.json',
      'apps/mobile/app/_layout.tsx',
      'apps/mobile/app/index.tsx',
      'apps/mobile/eas.json',
      'apps/mobile/expo-env.d.ts',
      'apps/mobile/package.json',
      'apps/mobile/tsconfig.json',
    ]);
    expect(filePlan.removals).toEqual(['apps/worker']);

    const appConfig = JSON.parse(
      filePlan.writes.find((file) => file.path === 'apps/mobile/app.json')?.content ?? '',
    );
    expect(appConfig.expo).toMatchObject({
      name: 'example-saas',
      slug: 'example-saas',
      ios: {
        bundleIdentifier: 'com.example.examplesaas',
      },
      android: {
        package: 'com.example.examplesaas',
      },
    });

    const packageJson = JSON.parse(
      filePlan.writes.find((file) => file.path === 'apps/mobile/package.json')?.content ?? '',
    );
    expect(packageJson.name).toBe('example-saas-mobile');
    expect(packageJson.dependencies).toMatchObject({
      expo: '~57.0.8',
      'expo-router': '~57.0.8',
      'expo-system-ui': '~57.0.1',
      react: '19.2.3',
      'react-native': '0.86.0',
    });
    expect(packageJson.devDependencies).toMatchObject({
      'eas-cli': '^21.2.0',
      typescript: '~6.0.3',
    });
  });

  it('removes the web baseline for a mobile-only project', () => {
    const filePlan = createSurfaceFilePlan(parseBuildManifest(mobileOnlyManifest));

    expect(filePlan.removals).toEqual(['apps/web', 'apps/worker']);
    expect(filePlan.writes).not.toHaveLength(0);
  });

  it('does not schedule removal of a selected worker surface', () => {
    const filePlan = createSurfaceFilePlan(
      parseBuildManifest({
        ...canonicalManifest,
        surfaces: {
          ...canonicalManifest.surfaces,
          worker: 'persistent-node',
        },
      }),
    );

    expect(filePlan.removals).toEqual(['apps/mobile']);
  });

  it('returns byte-for-byte deterministic files without development-governance artifacts', () => {
    const manifest = parseBuildManifest(expoManifest);
    const firstPlan = createSurfaceFilePlan(manifest);
    const secondPlan = createSurfaceFilePlan(manifest);

    expect(secondPlan).toEqual(firstPlan);
    expect(firstPlan.writes.map((file) => file.path)).toEqual(
      firstPlan.writes.map((file) => file.path).toSorted(),
    );
    expect(JSON.stringify(firstPlan)).not.toMatch(/void.?harness|\\.agents|\\.codex/i);
  });
});
