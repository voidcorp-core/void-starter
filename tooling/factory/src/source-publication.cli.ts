import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseProvisioningContextSource } from './provisioning-plan.service';
import {
  applySourcePublication,
  applySourceUpdate,
  createSourcePublicationPlan,
  preflightSourcePublication,
  preflightSourceUpdate,
  type SourcePublicationOptions,
} from './source-publication.service';

export const sourcePublicationUsage = `Usage:
  bun run source:plan -- <generated-project-directory> <context.yaml|context.json>
  bun run source:preflight -- <generated-project-directory> <context.yaml|context.json>
  bun run source:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run source:resume -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run source:update:preflight -- <generated-project-directory> <context.yaml|context.json>
  bun run source:update:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run source:update:resume -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>

source:plan is local and requires a generated bun.lock plus succeeded live provisioning state.
source:preflight performs authenticated GitHub reads only.
source:live and source:resume can publish the initial main branch and require exact confirmation.
source:update:* requires a fresh generated/adopted target and advances only a marked, unchanged
remote Factory HEAD through a normal fast-forward commit.
The GitHub token stays in process memory and is never written to Git configuration or receipts.
`;

async function loadSourceInputs(targetArgument: string, contextArgument: string) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const context = parseProvisioningContextSource(await readFile(contextPath, 'utf8'), contextPath);
  return {
    projectRoot,
    context,
  };
}

export async function runSourcePlanCli(input: { arguments: string[] }): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(sourcePublicationUsage);
  }
  const { projectRoot, context } = await loadSourceInputs(targetArgument, contextArgument);
  return createSourcePublicationPlan(projectRoot, context);
}

export async function runSourcePreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: Pick<SourcePublicationOptions, 'fetch'>;
}): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(sourcePublicationUsage);
  }
  const { projectRoot, context } = await loadSourceInputs(targetArgument, contextArgument);
  return preflightSourcePublication({
    projectRoot,
    context,
    environment: input.environment,
    ...(input.options?.fetch ? { fetch: input.options.fetch } : {}),
  });
}

export async function runSourceApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: SourcePublicationOptions;
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
    throw new Error(sourcePublicationUsage);
  }
  const { projectRoot, context } = await loadSourceInputs(targetArgument, contextArgument);
  const plan = await createSourcePublicationPlan(projectRoot, context);
  if (confirmedProject !== plan.repository.name) {
    throw new Error('Source confirmation must exactly match the generated project name');
  }
  return applySourcePublication({
    projectRoot,
    context,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runSourceUpdatePreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: Pick<SourcePublicationOptions, 'fetch'>;
}): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(sourcePublicationUsage);
  }
  const { projectRoot, context } = await loadSourceInputs(targetArgument, contextArgument);
  return preflightSourceUpdate({
    projectRoot,
    context,
    environment: input.environment,
    ...(input.options?.fetch ? { fetch: input.options.fetch } : {}),
  });
}

export async function runSourceUpdateApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: SourcePublicationOptions;
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
    throw new Error(sourcePublicationUsage);
  }
  const { projectRoot, context } = await loadSourceInputs(targetArgument, contextArgument);
  const localPlan = await createSourcePublicationPlan(projectRoot, context);
  if (confirmedProject !== localPlan.repository.name) {
    throw new Error('Source update confirmation must exactly match the generated project name');
  }
  return applySourceUpdate({
    projectRoot,
    context,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
