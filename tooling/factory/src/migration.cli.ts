import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyMigration,
  createMigrationPlan,
  type MigrationOptions,
  preflightMigration,
} from './migration.service';
import { parseProvisioningContextSource } from './provisioning-plan.service';

export const migrationUsage = `Usage:
  bun run migration:plan -- <generated-project-directory> <context.yaml|context.json>
  bun run migration:preflight -- <generated-project-directory> <context.yaml|context.json>
  bun run migration:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run migration:resume -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>

migration:plan is local and binds the exact published source plus Drizzle migration history.
migration:preflight performs authenticated Neon and PostgreSQL reads only.
migration:live applies pending migrations transactionally and writes a non-secret receipt.
migration:resume re-inspects history before safely retrying a failed or interrupted migration.
NEON_API_KEY and the retrieved connection URI stay in process memory and are never written to state.
Application seed/bootstrap is deliberately separate and requires explicit product identity.
`;

async function loadMigrationInputs(targetArgument: string, contextArgument: string) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const context = parseProvisioningContextSource(await readFile(contextPath, 'utf8'), contextPath);
  return { projectRoot, context };
}

export async function runMigrationPlanCli(input: { arguments: string[] }): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(migrationUsage);
  }
  const { projectRoot, context } = await loadMigrationInputs(targetArgument, contextArgument);
  return createMigrationPlan(projectRoot, context);
}

export async function runMigrationPreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: MigrationOptions;
}): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(migrationUsage);
  }
  const { projectRoot, context } = await loadMigrationInputs(targetArgument, contextArgument);
  return preflightMigration({
    projectRoot,
    context,
    environment: input.environment,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runMigrationApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: MigrationOptions;
}): Promise<unknown> {
  const [targetArgument, contextArgument, confirmationFlag, confirmedProject, ...extraArguments] =
    input.arguments;
  if (
    !targetArgument ||
    !contextArgument ||
    confirmationFlag !== '--confirm-project' ||
    !confirmedProject ||
    extraArguments.length > 0
  ) {
    throw new Error(migrationUsage);
  }
  const { projectRoot, context } = await loadMigrationInputs(targetArgument, contextArgument);
  const plan = await createMigrationPlan(projectRoot, context);
  if (confirmedProject !== plan.database.project_name) {
    throw new Error('Migration confirmation must exactly match the generated project name');
  }
  return applyMigration({
    projectRoot,
    context,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
