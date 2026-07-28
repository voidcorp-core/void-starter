import type {
  BuildManifest,
  CapabilityFilePlan,
  GeneratedFile,
  ProjectFilePlan,
} from './factory.types';
import { createSurfaceFilePlan } from './surface-composition.service';

const WEB_ROOT = 'apps/web';

const OPTIONAL_MODULES = [
  '_modules/analytics-posthog',
  '_modules/audit-log',
  '_modules/auth-clerk',
  '_modules/cms-payload',
  '_modules/cookie-consent',
  '_modules/db-self-hosted-postgres',
  '_modules/email-resend',
  '_modules/i18n-next-intl',
  '_modules/jobs-vercel-workflow',
  '_modules/observability-sentry',
  '_modules/payment-stripe',
  '_modules/rate-limit-upstash',
] as const;

const BETTER_AUTH_WEB_PATHS = [
  `${WEB_ROOT}/src/actions/auth.actions.test.ts`,
  `${WEB_ROOT}/src/actions/auth.actions.ts`,
  `${WEB_ROOT}/src/app/(auth)`,
  `${WEB_ROOT}/src/app/admin`,
  `${WEB_ROOT}/src/app/api/auth`,
  `${WEB_ROOT}/src/app/dashboard`,
  `${WEB_ROOT}/src/components/UserMenu`,
  `${WEB_ROOT}/tests/e2e`,
  `${WEB_ROOT}/playwright.config.ts`,
] as const;

const NOTES_WEB_PATHS = [
  `${WEB_ROOT}/src/actions/notes.actions.ts`,
  `${WEB_ROOT}/src/app/notes`,
] as const;

const DURABLE_JOBS_WEB_PATHS = [
  `${WEB_ROOT}/src/app/api/jobs`,
  `${WEB_ROOT}/src/workflows`,
] as const;

/**
 * Surfaces that only exist to administer invitations. Removed unless the
 * manifest selects `invite_only`, so a public project does not ship an admin
 * screen for a ledger nothing writes to. The ledger itself (`invitations` table
 * and `@repo/auth` invitation modules) stays in every Better Auth project, the
 * same way `job_executions` stays whether or not durable jobs are selected:
 * pruning a schema file would desynchronize the published Drizzle migrations.
 */
const INVITE_ONLY_WEB_PATHS = [
  `${WEB_ROOT}/src/actions/invitations.actions.ts`,
  `${WEB_ROOT}/src/actions/invitations.actions.test.ts`,
  `${WEB_ROOT}/src/app/admin/invitations`,
] as const;

const SENTRY_WEB_PATHS = [
  `${WEB_ROOT}/src/app/global-error.tsx`,
  `${WEB_ROOT}/src/instrumentation-client.ts`,
  `${WEB_ROOT}/src/instrumentation.ts`,
] as const;

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeTypeScriptStringArray(values: string[]): string {
  const elements = values.map((value) => `'${value}'`);
  const inline = `[${elements.join(', ')}]`;
  if (`  transpilePackages: ${inline},`.length <= 110) {
    return inline;
  }
  return `[
${elements.map((element) => `    ${element},`).join('\n')}
  ]`;
}

function createWebPackageJson(manifest: BuildManifest): GeneratedFile {
  const usesBetterAuth = manifest.auth.provider === 'better-auth';
  const usesClerk = manifest.auth.provider === 'clerk';
  const usesPosthog = manifest.operations.analytics === 'posthog';
  const usesSentry = manifest.operations.errors === 'sentry';
  const usesDurableJobs = manifest.workloads.durable_jobs === 'vercel-workflows';

  const dependencies: Record<string, string> = {
    '@repo/core': 'workspace:*',
    '@repo/ui': 'workspace:*',
  };

  if (usesBetterAuth) {
    dependencies['@hookform/resolvers'] = '^5.4.0';
    dependencies['@repo/auth'] = 'workspace:*';
    dependencies['@repo/notes'] = 'workspace:*';
  }
  if (usesDurableJobs) {
    dependencies['@repo/jobs-vercel-workflow'] = 'workspace:*';
  }
  if (usesPosthog) {
    dependencies['@repo/posthog'] = 'workspace:*';
  }
  if (usesSentry) {
    dependencies['@repo/sentry'] = 'workspace:*';
    dependencies['@sentry/nextjs'] = '^10.68.0';
  }
  if (usesClerk) {
    dependencies['@clerk/nextjs'] = '^7.6.0';
  }
  if (usesBetterAuth) {
    dependencies['better-auth'] = '^1.6.25';
  }
  dependencies['next'] = '^16.2.11';
  dependencies['react'] = '^19.2.8';
  dependencies['react-dom'] = '^19.2.8';
  if (usesBetterAuth) {
    dependencies['react-hook-form'] = '^7.82.0';
  }
  if (usesDurableJobs) {
    dependencies['workflow'] = '^4.6.2';
  }
  if (usesBetterAuth || usesDurableJobs) {
    dependencies['zod'] = '^4.4.3';
  }

  const scripts: Record<string, string> = {
    dev: 'next dev --turbopack --port 3000',
    build: 'next build',
    start: 'next start',
    lint: 'biome check .',
    'type-check': 'tsc --noEmit',
    test: 'vitest run',
  };
  if (usesBetterAuth) {
    scripts['test:e2e'] = 'playwright test';
    scripts['test:e2e:ui'] = 'playwright test --ui';
  }

  const devDependencies: Record<string, string> = {
    '@repo/config': 'workspace:*',
  };
  if (usesBetterAuth) {
    devDependencies['@playwright/test'] = '^1.61.1';
  }
  Object.assign(devDependencies, {
    '@tailwindcss/postcss': '^4.3.3',
    '@testing-library/dom': '^10.4.1',
    '@testing-library/jest-dom': '^7.0.0',
    '@testing-library/react': '^16.3.2',
    '@testing-library/user-event': '^14.6.1',
    '@typescript/native-preview': 'npm:typescript@^7.0.2',
    '@types/react': '^19.2.17',
    '@types/react-dom': '^19.2.3',
    '@vitest/coverage-v8': '^4.1.10',
    jsdom: '^29.1.1',
  });
  if (usesBetterAuth) {
    devDependencies['postgres'] = '^3.4.9';
  }
  Object.assign(devDependencies, {
    tailwindcss: '^4.3.3',
    typescript: '^7.0.2',
    vitest: '^4.1.10',
  });

  return {
    path: `${WEB_ROOT}/package.json`,
    content: serializeJson({
      name: '@repo/web',
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts,
      dependencies,
      devDependencies,
    }),
  };
}

function createNextConfig(manifest: BuildManifest): GeneratedFile {
  const usesBetterAuth = manifest.auth.provider === 'better-auth';
  const usesPosthog = manifest.operations.analytics === 'posthog';
  const usesSentry = manifest.operations.errors === 'sentry';
  const usesResend = manifest.operations.email === 'resend';
  const usesDurableJobs = manifest.workloads.durable_jobs === 'vercel-workflows';
  const transpilePackages = ['@repo/core', '@repo/ui'];

  if (usesBetterAuth) {
    transpilePackages.push('@repo/auth', '@repo/db', '@repo/notes');
  }
  if (usesDurableJobs) {
    transpilePackages.push('@repo/jobs-vercel-workflow');
  }
  if (usesPosthog) {
    transpilePackages.push('@repo/posthog');
  }
  if (usesSentry) {
    transpilePackages.push('@repo/sentry');
  }
  if (usesResend) {
    transpilePackages.push('@repo/email-resend');
  }
  transpilePackages.sort();

  const imports = [
    "import { defaultSecurityHeaders } from '@repo/core/security-headers';",
    ...(usesSentry ? ["import { withSentryConfig } from '@sentry/nextjs';"] : []),
    "import type { NextConfig } from 'next';",
    ...(usesDurableJobs ? ["import { withWorkflow } from 'workflow/next';"] : []),
  ].join('\n');

  const analyticsConfig = usesPosthog
    ? `  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ];
  },
`
    : '';

  // withWorkflow enables the "use workflow" / "use step" directives and registers
  // the step handlers so only Vercel Queue can deliver to them. It wraps the base
  // config first so Sentry still observes the final Next config.
  const baseConfigSource = usesDurableJobs ? 'withWorkflow(config)' : 'config';
  const exportSource = usesSentry
    ? `export default withSentryConfig(${baseConfigSource}, {
  tunnelRoute: '/sentry-tunnel',
  silent: !process.env['CI'],
});
`
    : `export default ${baseConfigSource};\n`;

  return {
    path: `${WEB_ROOT}/next.config.ts`,
    content: `${imports}

const config: NextConfig = {
  cacheComponents: true,
  typescript: {
    ignoreBuildErrors: true,
  },
${analyticsConfig}  async headers() {
    return [
      {
        source: '/(.*)',
        headers: defaultSecurityHeaders(),
      },
    ];
  },
  transpilePackages: ${serializeTypeScriptStringArray(transpilePackages)},
};

${exportSource}`,
  };
}

function createVercelConfig(): GeneratedFile {
  return {
    path: `${WEB_ROOT}/vercel.json`,
    content: `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["fra1"]
}
`,
  };
}

function createRootLayout(manifest: BuildManifest): GeneratedFile {
  const usesClerk = manifest.auth.provider === 'clerk';
  const usesPosthog = manifest.operations.analytics === 'posthog';
  const imports = [
    ...(usesClerk ? ["import { ClerkProvider } from '@clerk/nextjs';"] : []),
    ...(usesPosthog ? ["import { AnalyticsProvider } from '@repo/posthog/client';"] : []),
    "import { ThemeProvider, Toaster } from '@repo/ui';",
    "import type { Metadata } from 'next';",
    "import type { ReactNode } from 'react';",
    "import './globals.css';",
  ].join('\n');
  const bodyChildren = usesPosthog
    ? [
        '          <AnalyticsProvider>',
        '            {children}',
        '            <Toaster />',
        '          </AnalyticsProvider>',
      ]
    : ['          {children}', '          <Toaster />'];
  const document = [
    '    <html lang="en" suppressHydrationWarning>',
    '      <body>',
    '        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>',
    ...bodyChildren,
    '        </ThemeProvider>',
    '      </body>',
    '    </html>',
  ].join('\n');
  const renderedDocument = usesClerk
    ? `    <ClerkProvider>
${document
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
    </ClerkProvider>`
    : document;

  return {
    path: `${WEB_ROOT}/src/app/layout.tsx`,
    content: `${imports}

export const metadata: Metadata = {
  title: '${manifest.project.name}',
  description: 'Built with Void Starter',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
${renderedDocument}
  );
}
`,
  };
}

function createPublicHomePage(manifest: BuildManifest): GeneratedFile {
  return {
    path: `${WEB_ROOT}/src/app/page.tsx`,
    content: `import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">${manifest.project.name}</h1>
        <p className="text-muted-foreground">Production-grade Next.js 16 starter.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Ready to build</CardTitle>
        </CardHeader>
        <CardContent>
          <p>This public project was generated without an authentication provider.</p>
        </CardContent>
      </Card>
    </main>
  );
}
`,
  };
}

/**
 * Writes the access mode into `@repo/auth` as code rather than configuration.
 *
 * The generated constant is what `auth.repository.ts` reads to decide whether
 * account creation goes through the invitation ledger. Emitting it as a source
 * file, not an environment variable, means an `invite_only` project cannot be
 * quietly reopened from a provider dashboard: lifting the restriction requires
 * changing the manifest and redeploying, which leaves a trace (ADR 63).
 */
function createAccessModeModule(manifest: BuildManifest): GeneratedFile {
  return {
    path: 'packages/auth/src/access-mode.ts',
    content: `/**
 * The access mode this project was generated with (ADR 63).
 *
 * GENERATED by the Void Starter factory from \`auth.access_mode\` in the
 * manifest. Edit the manifest and regenerate rather than editing this file:
 * the value is code so the restriction cannot be lifted without a redeploy.
 */
export type AccessMode =
  | 'public_verified'
  | 'invite_only'
  | 'public_signup_gated_activation'
  | 'none';

export const ACCESS_MODE: AccessMode = '${manifest.auth.access_mode}';

/** Whether account creation requires an invitation in this project. */
export function isInviteOnly(mode: AccessMode = ACCESS_MODE): boolean {
  return mode === 'invite_only';
}
`,
  };
}

function createBetterAuthHomePage(manifest: BuildManifest): GeneratedFile {
  return {
    path: `${WEB_ROOT}/src/app/page.tsx`,
    content: `import { getCurrentUser } from '@repo/auth';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import Link from 'next/link';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">${manifest.project.name}</h1>
        <p className="text-muted-foreground">Production-grade Next.js 16 starter.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{user ? \`Welcome back, \${user.email}\` : 'Get started'}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
`,
  };
}

function createClerkFiles(manifest: BuildManifest): GeneratedFile[] {
  return [
    {
      path: `${WEB_ROOT}/src/app/dashboard/page.tsx`,
      content: `import { currentUser } from '@clerk/nextjs/server';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{user.primaryEmailAddress?.emailAddress ?? user.id}</p>
        </CardContent>
      </Card>
    </main>
  );
}
`,
    },
    {
      path: `${WEB_ROOT}/src/app/page.tsx`,
      content: `import { Show, UserButton } from '@clerk/nextjs';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-8">
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">${manifest.project.name}</h1>
          <p className="text-muted-foreground">Production-grade Next.js 16 starter.</p>
        </div>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Show when="signed-out">
            <Button asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/sign-up">Sign up</Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          </Show>
        </CardContent>
      </Card>
    </main>
  );
}
`,
    },
    {
      path: `${WEB_ROOT}/src/app/sign-in/[[...sign-in]]/page.tsx`,
      content: `import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center">
      <SignIn />
    </main>
  );
}
`,
    },
    {
      path: `${WEB_ROOT}/src/app/sign-up/[[...sign-up]]/page.tsx`,
      content: `import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center">
      <SignUp />
    </main>
  );
}
`,
    },
    {
      path: `${WEB_ROOT}/src/proxy.ts`,
      content: `import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
`,
    },
  ];
}

function createEnvironmentExample(manifest: BuildManifest): GeneratedFile {
  const lines = ['# Generated environment bindings. Never commit real secret values.'];

  if (manifest.surfaces.web !== 'none') {
    lines.push('NEXT_PUBLIC_APP_URL=http://localhost:3000');
  }
  if (manifest.data.database === 'neon-eu') {
    lines.push(
      '',
      '# Neon / Drizzle',
      'DATABASE_URL=postgres://<user>:<password>@<host>/<db>?sslmode=require',
    );
  }
  if (manifest.auth.provider === 'better-auth') {
    lines.push(
      '',
      '# Better Auth',
      'BETTER_AUTH_SECRET=replace-me-with-openssl-rand-base64-32',
      'BETTER_AUTH_URL=http://localhost:3000',
      'AUTH_BOOTSTRAP_ADMIN_EMAIL=',
      'GOOGLE_CLIENT_ID=',
      'GOOGLE_CLIENT_SECRET=',
    );
  }
  if (manifest.auth.provider === 'clerk') {
    lines.push(
      '',
      '# Clerk',
      'CLERK_SECRET_KEY=',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=',
      'NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in',
      'NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up',
    );
  }
  if (manifest.operations.analytics === 'posthog') {
    lines.push('', '# PostHog EU', 'NEXT_PUBLIC_POSTHOG_KEY=', 'NEXT_PUBLIC_POSTHOG_HOST=/ingest');
  }
  if (manifest.operations.errors === 'sentry') {
    lines.push(
      '',
      '# Sentry',
      'SENTRY_DSN=',
      'NEXT_PUBLIC_SENTRY_DSN=',
      'SENTRY_AUTH_TOKEN=',
      'SENTRY_ORG=',
      'SENTRY_PROJECT=',
    );
  }
  if (manifest.operations.email === 'resend') {
    lines.push(
      '',
      '# Resend',
      'RESEND_API_KEY=',
      'EMAIL_FROM=',
      'EMAIL_REPLY_TO=',
      `EMAIL_APP_NAME=${manifest.project.name}`,
    );
  }
  if (manifest.data.files === 'cloudflare-r2-eu') {
    lines.push(
      '',
      '# Cloudflare R2',
      'CLOUDFLARE_ACCOUNT_ID=',
      'R2_ACCESS_KEY_ID=',
      'R2_SECRET_ACCESS_KEY=',
      'R2_BUCKET_NAME=',
      'R2_ENDPOINT=',
    );
  } else if (manifest.data.files === 'vercel-blob') {
    lines.push('', '# Vercel Blob', 'BLOB_READ_WRITE_TOKEN=');
  } else if (manifest.data.files === 'aws-s3-eu-worm') {
    lines.push(
      '',
      '# AWS S3',
      'AWS_REGION=eu-west-3',
      'AWS_ACCESS_KEY_ID=',
      'AWS_SECRET_ACCESS_KEY=',
      'AWS_S3_BUCKET=',
    );
  }

  return {
    path: '.env.example',
    content: `${lines.join('\n')}\n`,
  };
}

export function createCapabilityFilePlan(manifest: BuildManifest): CapabilityFilePlan {
  const removals = new Set<string>();
  const writes: GeneratedFile[] = [createEnvironmentExample(manifest)];
  const hasWeb = manifest.surfaces.web !== 'none';
  const usesBetterAuth = hasWeb && manifest.auth.provider === 'better-auth';
  const usesClerk = hasWeb && manifest.auth.provider === 'clerk';
  const usesDatabase = hasWeb && manifest.data.database !== 'none';
  const usesPosthog = hasWeb && manifest.operations.analytics === 'posthog';
  const usesSentry = hasWeb && manifest.operations.errors === 'sentry';
  const usesResend = hasWeb && manifest.operations.email === 'resend';
  const usesDurableJobs = hasWeb && manifest.workloads.durable_jobs === 'vercel-workflows';

  for (const modulePath of OPTIONAL_MODULES) {
    const selected =
      (modulePath === '_modules/analytics-posthog' && usesPosthog) ||
      (modulePath === '_modules/observability-sentry' && usesSentry) ||
      (modulePath === '_modules/jobs-vercel-workflow' && usesDurableJobs) ||
      (modulePath === '_modules/email-resend' && usesResend);
    if (!selected) {
      removals.add(modulePath);
    }
  }

  if (!hasWeb) {
    for (const path of [
      'packages/auth',
      'packages/core',
      'packages/db',
      'packages/notes',
      'packages/ui',
    ]) {
      removals.add(path);
    }
    return {
      writes: writes.toSorted((left, right) => left.path.localeCompare(right.path)),
      removals: [...removals].toSorted(),
    };
  }

  writes.push(
    createWebPackageJson(manifest),
    createNextConfig(manifest),
    createRootLayout(manifest),
    createVercelConfig(),
  );

  if (!usesDatabase) {
    removals.add('packages/db');
  }

  if (!usesBetterAuth) {
    removals.add('packages/auth');
    for (const path of BETTER_AUTH_WEB_PATHS) {
      removals.add(path);
    }
    removals.add(`${WEB_ROOT}/src/components/_examples/UserProfileCard`);
  }

  if (!usesBetterAuth || !usesDatabase) {
    removals.add('packages/notes');
    for (const path of NOTES_WEB_PATHS) {
      removals.add(path);
    }
  }

  if (!usesSentry) {
    for (const path of SENTRY_WEB_PATHS) {
      removals.add(path);
    }
  }

  if (!usesDurableJobs) {
    for (const path of DURABLE_JOBS_WEB_PATHS) {
      removals.add(path);
    }
  }

  if (usesBetterAuth && manifest.auth.access_mode !== 'invite_only') {
    for (const path of INVITE_ONLY_WEB_PATHS) {
      removals.add(path);
    }
  }

  if (usesClerk) {
    writes.push(...createClerkFiles(manifest));
  } else if (usesBetterAuth) {
    writes.push(createAccessModeModule(manifest), createBetterAuthHomePage(manifest));
  } else {
    writes.push(createPublicHomePage(manifest));
    removals.add(`${WEB_ROOT}/src/proxy.ts`);
  }

  return {
    writes: writes.toSorted((left, right) => left.path.localeCompare(right.path)),
    removals: [...removals].toSorted(),
  };
}

export function createProjectFilePlan(manifest: BuildManifest): ProjectFilePlan {
  const surfacePlan = createSurfaceFilePlan(manifest);
  const capabilityPlan = createCapabilityFilePlan(manifest);
  const writes = [...surfacePlan.writes, ...capabilityPlan.writes].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
  const writePaths = new Set<string>();
  for (const write of writes) {
    if (writePaths.has(write.path)) {
      throw new Error(`Composition scheduled duplicate generated path: ${write.path}`);
    }
    writePaths.add(write.path);
  }

  return {
    writes,
    removals: [...new Set([...surfacePlan.removals, ...capabilityPlan.removals])].toSorted(),
  };
}
