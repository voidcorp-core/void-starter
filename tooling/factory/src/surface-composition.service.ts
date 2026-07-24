import type { BuildManifest, GeneratedFile, SurfaceFilePlan } from './factory.types';

const EXPO_APP_ROOT = 'apps/mobile';

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createExpoFiles(manifest: BuildManifest): GeneratedFile[] {
  const mobile = manifest.surfaces.mobile;
  if (mobile.adapter !== 'expo-eas') {
    return [];
  }

  const packageJson = {
    name: `${manifest.project.name}-mobile`,
    version: '0.0.1',
    private: true,
    main: 'expo-router/entry',
    scripts: {
      start: 'expo start',
      dev: 'expo start',
      android: 'expo start --android',
      ios: 'expo start --ios',
      web: 'expo start --web',
      build: 'expo export --platform all --output-dir dist',
      'type-check': 'tsc --noEmit',
      'eas:build': 'eas build --platform all',
    },
    dependencies: {
      '@expo/metro-runtime': '~57.0.7',
      expo: '~57.0.8',
      'expo-constants': '~57.0.7',
      'expo-dev-client': '~57.0.9',
      'expo-linking': '~57.0.4',
      'expo-router': '~57.0.8',
      'expo-status-bar': '~57.0.1',
      'expo-system-ui': '~57.0.1',
      react: '19.2.3',
      'react-dom': '19.2.3',
      'react-native': '0.86.0',
      'react-native-safe-area-context': '~5.7.0',
      'react-native-web': '~0.21.0',
    },
    devDependencies: {
      '@types/react': '~19.2.2',
      'eas-cli': '^21.2.0',
      typescript: '~6.0.3',
    },
  };

  const appConfig = {
    expo: {
      name: manifest.project.name,
      slug: manifest.project.name,
      version: '1.0.0',
      orientation: 'portrait',
      scheme: `app-${manifest.project.name}`,
      userInterfaceStyle: 'automatic',
      ios: {
        supportsTablet: true,
        bundleIdentifier: mobile.ios_bundle_identifier,
      },
      android: {
        package: mobile.android_package,
        edgeToEdgeEnabled: true,
      },
      web: {
        output: 'static',
      },
      plugins: ['expo-router'],
      experiments: {
        typedRoutes: true,
        reactCompiler: true,
      },
    },
  };

  const easConfig = {
    cli: {
      version: '>=21.2.0',
      appVersionSource: 'remote',
    },
    build: {
      development: {
        developmentClient: true,
        distribution: 'internal',
        environment: 'development',
      },
      preview: {
        distribution: 'internal',
        environment: 'preview',
      },
      production: {
        autoIncrement: true,
        environment: 'production',
      },
    },
    submit: {
      production: {},
    },
  };

  return [
    {
      path: `${EXPO_APP_ROOT}/.gitignore`,
      content: '.expo/\ndist/\n',
    },
    {
      path: `${EXPO_APP_ROOT}/app.json`,
      content: serializeJson(appConfig),
    },
    {
      path: `${EXPO_APP_ROOT}/app/_layout.tsx`,
      content: `import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
`,
    },
    {
      path: `${EXPO_APP_ROOT}/app/index.tsx`,
      content: `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

const projectName = '${manifest.project.name}';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>VOID STARTER</Text>
      <Text style={styles.title}>{projectName}</Text>
      <Text style={styles.body}>Expo is selected for this project.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  eyebrow: {
    color: '#a3a3a3',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
  },
  title: {
    color: '#fafafa',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 12,
  },
  body: {
    color: '#d4d4d4',
    fontSize: 16,
    marginTop: 8,
  },
});
`,
    },
    {
      path: `${EXPO_APP_ROOT}/eas.json`,
      content: serializeJson(easConfig),
    },
    {
      path: `${EXPO_APP_ROOT}/expo-env.d.ts`,
      content: '/// <reference types="expo/types" />\n',
    },
    {
      path: `${EXPO_APP_ROOT}/package.json`,
      content: serializeJson(packageJson),
    },
    {
      path: `${EXPO_APP_ROOT}/tsconfig.json`,
      content: serializeJson({
        extends: 'expo/tsconfig.base',
        compilerOptions: {
          strict: true,
        },
        include: ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
      }),
    },
  ].toSorted((left, right) => left.path.localeCompare(right.path));
}

export function createSurfaceFilePlan(manifest: BuildManifest): SurfaceFilePlan {
  const removals: string[] = [];

  if (manifest.surfaces.web === 'none') {
    removals.push('apps/web');
  }
  if (manifest.surfaces.mobile.adapter === 'none') {
    removals.push(EXPO_APP_ROOT);
  }
  if (manifest.surfaces.worker === 'none') {
    removals.push('apps/worker');
  }

  return {
    writes: createExpoFiles(manifest),
    removals: removals.toSorted(),
  };
}
