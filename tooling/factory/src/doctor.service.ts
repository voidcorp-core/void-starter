import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { readAuthProductionState, validateAuthProductionState } from './auth-production.service';
import { createProjectFilePlan } from './capability-composition.service';
import { readDeliveryState, validateDeliveryState } from './delivery.service';
import { createCompositionPlan, parseBuildManifest } from './factory.service';
import type { BuildManifest, DoctorCheck, DoctorReport, GenerationReceipt } from './factory.types';
import { createGenerationReceipt, FORBIDDEN_OUTPUT_PATHS } from './generation.service';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import { readMigrationState, validateMigrationState } from './migration.service';
import { readProvisioningState, validateProvisioningState } from './provisioning-apply.service';
import {
  readSourcePublicationState,
  validateSourcePublicationState,
} from './source-publication.service';

const receiptSchema = z.strictObject({
  schema_version: z.literal(1),
  project: z.strictObject({
    name: z.string(),
    profile: z.enum(['saas', 'internal-tool']),
  }),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  composition: z.unknown(),
  generated_files: z.array(
    z.strictObject({
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  removed_paths: z.array(z.string()),
  excluded_source_paths: z.array(z.string()),
  next_actions: z.array(z.string()),
});

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

function createCheck(id: string, passed: boolean, message: string): DoctorCheck {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    message,
  };
}

async function generatedFilesAreValid(
  projectRoot: string,
  generatedFiles: GenerationReceipt['generated_files'],
): Promise<boolean> {
  for (const file of generatedFiles) {
    if (!file.path || isAbsolute(file.path)) {
      return false;
    }
    const filePath = resolve(projectRoot, file.path);
    if (!filePath.startsWith(`${resolve(projectRoot)}${sep}`)) {
      return false;
    }
    try {
      const content = await readFile(filePath, 'utf8');
      if (sha256(content) !== file.sha256) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function listPackageJsonFiles(directory: string): Promise<string[]> {
  const packageFiles: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!['.git', '.next', '.turbo', 'node_modules'].includes(entry.name)) {
        packageFiles.push(...(await listPackageJsonFiles(path)));
      }
    } else if (entry.name === 'package.json') {
      packageFiles.push(path);
    }
  }

  return packageFiles;
}

async function hasHarnessDependency(projectRoot: string): Promise<boolean> {
  const dependencyPattern = /void.*harness|harness.*void/i;
  for (const packagePath of await listPackageJsonFiles(projectRoot)) {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = packageJson[field];
      if (
        dependencies &&
        typeof dependencies === 'object' &&
        Object.keys(dependencies).some((dependency) => dependencyPattern.test(dependency))
      ) {
        return true;
      }
    }
  }

  try {
    return dependencyPattern.test(await readFile(join(projectRoot, 'bun.lock'), 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function readPackageDependencies(packagePath: string): Promise<Set<string>> {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  const dependencyNames = new Set<string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson[field];
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      for (const dependency of Object.keys(dependencies)) {
        dependencyNames.add(dependency);
      }
    }
  }
  return dependencyNames;
}

async function capabilitiesMatchManifest(
  projectRoot: string,
  manifest: BuildManifest,
): Promise<boolean> {
  const hasWeb = manifest.surfaces.web !== 'none';
  const usesBetterAuth = hasWeb && manifest.auth.provider === 'better-auth';
  const usesClerk = hasWeb && manifest.auth.provider === 'clerk';
  const usesDatabase = hasWeb && manifest.data.database !== 'none';
  const usesPosthog = hasWeb && manifest.operations.analytics === 'posthog';
  const usesSentry = hasWeb && manifest.operations.errors === 'sentry';
  const usesResend = hasWeb && manifest.operations.email === 'resend';

  const pathExpectations = new Map<string, boolean>([
    ['apps/web/vercel.json', hasWeb],
    ['packages/auth/package.json', usesBetterAuth],
    ['packages/db/package.json', usesDatabase],
    ['packages/notes/package.json', usesBetterAuth && usesDatabase],
    ['_modules/analytics-posthog/package.json', usesPosthog],
    ['_modules/observability-sentry/package.json', usesSentry],
    ['_modules/email-resend/package.json', usesResend],
    ['apps/web/src/instrumentation.ts', usesSentry],
    ['apps/web/src/instrumentation-client.ts', usesSentry],
    ['apps/web/src/app/sign-in/[[...sign-in]]/page.tsx', usesClerk],
  ]);

  for (const [path, expected] of pathExpectations) {
    if ((await pathExists(join(projectRoot, path))) !== expected) {
      return false;
    }
  }

  if (!hasWeb) {
    return (
      !(await pathExists(join(projectRoot, 'packages/core/package.json'))) &&
      !(await pathExists(join(projectRoot, 'packages/ui/package.json')))
    );
  }

  const dependencies = await readPackageDependencies(join(projectRoot, 'apps/web/package.json'));
  const dependencyExpectations = new Map<string, boolean>([
    ['@repo/auth', usesBetterAuth],
    ['better-auth', usesBetterAuth],
    ['@clerk/nextjs', usesClerk],
    ['@repo/notes', usesBetterAuth && usesDatabase],
    ['@repo/posthog', usesPosthog],
    ['@repo/sentry', usesSentry],
    ['@sentry/nextjs', usesSentry],
  ]);
  for (const [dependency, expected] of dependencyExpectations) {
    if (dependencies.has(dependency) !== expected) {
      return false;
    }
  }

  return true;
}

export async function doctorProject(projectRoot: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let manifest: ReturnType<typeof parseBuildManifest>;
  let receipt: GenerationReceipt;

  try {
    const manifestSource = await readFile(join(projectRoot, '.void-starter/manifest.json'), 'utf8');
    manifest = parseBuildManifest(JSON.parse(manifestSource));
    const receiptSource = await readFile(join(projectRoot, '.void-starter/receipt.json'), 'utf8');
    const parsedReceipt = receiptSchema.parse(JSON.parse(receiptSource));
    receipt = parsedReceipt as GenerationReceipt;
    checks.push(createCheck('metadata', true, 'Manifest and receipt are readable and valid'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(createCheck('metadata', false, `Manifest or receipt is invalid: ${message}`));
    return {
      ok: false,
      checks,
    };
  }

  const canonicalManifest = serializeCanonicalJson(manifest);
  checks.push(
    createCheck(
      'manifest-integrity',
      receipt.manifest_sha256 === sha256(canonicalManifest),
      'Manifest digest matches the generation receipt',
    ),
  );

  const expectedComposition = createCompositionPlan(manifest);
  const expectedFilePlan = createProjectFilePlan(manifest);
  const expectedReceipt = createGenerationReceipt(manifest, expectedFilePlan);
  const receiptMatchesPlan =
    serializeCanonicalJson(receipt) === serializeCanonicalJson(expectedReceipt) &&
    serializeCanonicalJson(receipt.composition) === serializeCanonicalJson(expectedComposition);
  checks.push(
    createCheck('receipt-plan', receiptMatchesPlan, 'Receipt matches the normalized factory plan'),
  );

  checks.push(
    createCheck(
      'generated-files',
      await generatedFilesAreValid(projectRoot, receipt.generated_files),
      'Generated files exist and match their recorded SHA-256 digests',
    ),
  );

  const webExists = await pathExists(join(projectRoot, 'apps/web/package.json'));
  const mobileExists = await pathExists(join(projectRoot, 'apps/mobile/package.json'));
  const workerExists = await pathExists(join(projectRoot, 'apps/worker/package.json'));
  const surfacesMatch =
    webExists === (manifest.surfaces.web !== 'none') &&
    mobileExists === (manifest.surfaces.mobile.adapter !== 'none') &&
    workerExists === (manifest.surfaces.worker !== 'none');
  checks.push(
    createCheck('surfaces', surfacesMatch, 'Rendered surface directories match the manifest'),
  );

  checks.push(
    createCheck(
      'capabilities',
      await capabilitiesMatchManifest(projectRoot, manifest),
      'Rendered local capability packages and dependencies match the manifest',
    ),
  );

  let sourcePublicationState: Awaited<ReturnType<typeof readSourcePublicationState>> | undefined;
  let sourcePublicationStateError: unknown;
  try {
    sourcePublicationState = await readSourcePublicationState(projectRoot);
    if (sourcePublicationState) {
      await validateSourcePublicationState(
        sourcePublicationState,
        receipt.manifest_sha256,
        projectRoot,
      );
    }
  } catch (error) {
    sourcePublicationStateError = error;
  }

  const presentForbiddenPaths: string[] = [];
  for (const forbiddenPath of FORBIDDEN_OUTPUT_PATHS) {
    if (forbiddenPath === '.git' && sourcePublicationState && !sourcePublicationStateError) {
      continue;
    }
    if (await pathExists(join(projectRoot, forbiddenPath))) {
      presentForbiddenPaths.push(forbiddenPath);
    }
  }
  checks.push(
    createCheck(
      'development-artifacts',
      presentForbiddenPaths.length === 0,
      presentForbiddenPaths.length === 0
        ? 'Factory and external development-governance artifacts are absent'
        : `Forbidden development artifacts found: ${presentForbiddenPaths.join(', ')}`,
    ),
  );

  checks.push(
    createCheck(
      'dependencies',
      !(await hasHarnessDependency(projectRoot)),
      'No Void Harness dependency is present',
    ),
  );

  try {
    const provisioningState = await readProvisioningState(projectRoot);
    if (!provisioningState) {
      checks.push(
        createCheck(
          'provisioning-state',
          true,
          'No provisioning state is recorded; the project remains local-only',
        ),
      );
    } else {
      validateProvisioningState(provisioningState, receipt.manifest_sha256);
      checks.push(
        createCheck(
          'provisioning-state',
          provisioningState.status === 'succeeded',
          `Provisioning state is structurally valid and ${provisioningState.status}`,
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(
      createCheck('provisioning-state', false, `Provisioning state is invalid: ${message}`),
    );
  }

  if (sourcePublicationStateError) {
    const message =
      sourcePublicationStateError instanceof Error
        ? sourcePublicationStateError.message
        : String(sourcePublicationStateError);
    checks.push(
      createCheck(
        'source-publication-state',
        false,
        `Source publication state is invalid: ${message}`,
      ),
    );
  } else if (!sourcePublicationState) {
    checks.push(
      createCheck('source-publication-state', true, 'No source publication state is recorded'),
    );
  } else {
    checks.push(
      createCheck(
        'source-publication-state',
        sourcePublicationState.status === 'succeeded',
        `Source publication state is structurally valid and ${sourcePublicationState.status}`,
      ),
    );
  }

  try {
    const migrationState = await readMigrationState(projectRoot);
    if (!migrationState) {
      checks.push(createCheck('migration-state', true, 'No database migration state is recorded'));
    } else if (!sourcePublicationState || sourcePublicationStateError) {
      checks.push(
        createCheck(
          'migration-state',
          false,
          'Migration state requires a valid source publication state',
        ),
      );
    } else {
      await validateMigrationState(migrationState, receipt.manifest_sha256, sourcePublicationState);
      checks.push(
        createCheck(
          'migration-state',
          migrationState.status === 'succeeded',
          `Migration state is structurally valid and ${migrationState.status}`,
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(createCheck('migration-state', false, `Migration state is invalid: ${message}`));
  }

  try {
    const deliveryState = await readDeliveryState(projectRoot);
    if (!deliveryState) {
      checks.push(createCheck('delivery-state', true, 'No delivery state is recorded'));
    } else if (!sourcePublicationState || sourcePublicationStateError) {
      checks.push(
        createCheck(
          'delivery-state',
          false,
          'Delivery state requires a valid source publication state',
        ),
      );
    } else {
      await validateDeliveryState(deliveryState, receipt.manifest_sha256, sourcePublicationState);
      checks.push(
        createCheck(
          'delivery-state',
          deliveryState.status === 'succeeded',
          `Delivery state is structurally valid and ${deliveryState.status}`,
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(createCheck('delivery-state', false, `Delivery state is invalid: ${message}`));
  }

  try {
    const authState = await readAuthProductionState(projectRoot);
    if (!authState) {
      checks.push(
        createCheck('auth-production-state', true, 'No production auth state is recorded'),
      );
    } else if (!sourcePublicationState || sourcePublicationStateError) {
      checks.push(
        createCheck(
          'auth-production-state',
          false,
          'Production auth state requires a valid source publication state',
        ),
      );
    } else {
      await validateAuthProductionState(authState, receipt.manifest_sha256, sourcePublicationState);
      checks.push(
        createCheck(
          'auth-production-state',
          authState.status === 'succeeded',
          `Production auth state is structurally valid and ${authState.status}`,
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(
      createCheck('auth-production-state', false, `Production auth state is invalid: ${message}`),
    );
  }

  return {
    ok: checks.every((check) => check.status === 'pass'),
    checks,
  };
}
