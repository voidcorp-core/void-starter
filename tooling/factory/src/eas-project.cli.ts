import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyEasProject,
  createEasProjectPlan,
  type EasProjectOptions,
  parseEasProjectContextSource,
  preflightEasProject,
} from './eas-project.service';

export const easProjectUsage = `Usage:
  bun run eas:plan -- <generated-project-directory> <eas-context.yaml|json>
  bun run eas:preflight -- <generated-project-directory> <eas-context.yaml|json>
  bun run eas:live -- <generated-project-directory> <eas-context.yaml|json> --confirm-project <project-name>
  bun run eas:resume -- <generated-project-directory> <eas-context.yaml|json> --confirm-project <project-name>

eas:plan is local and binds the generated Expo configuration plus non-secret account intent.
eas:preflight authenticates with EXPO_TOKEN and performs account/project reads only.
eas:live creates or adopts the exact @account/slug project through EAS CLI 21.2.0, then writes a
public non-secret apps/mobile/eas-project.json link and a private operational receipt.
eas:resume safely reconciles a project that may have been created before an interrupted receipt.
EXPO_TOKEN stays in process memory and EAS CLI remains an on-demand development dependency.
Native builds, signing credentials and store submissions are outside this provisioning lifecycle.
`;

async function loadInputs(targetArgument: string, contextArgument: string) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const context = parseEasProjectContextSource(await readFile(contextPath, 'utf8'), contextPath);
  return { projectRoot, context };
}

export async function runEasProjectPlanCli(input: { arguments: string[] }) {
  const [target, context, ...extra] = input.arguments;
  if (!target || !context || extra.length > 0) throw new Error(easProjectUsage);
  const loaded = await loadInputs(target, context);
  return createEasProjectPlan(loaded.projectRoot, loaded.context);
}

export async function runEasProjectPreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: EasProjectOptions;
}) {
  const [target, context, ...extra] = input.arguments;
  if (!target || !context || extra.length > 0) throw new Error(easProjectUsage);
  const loaded = await loadInputs(target, context);
  return preflightEasProject({
    ...loaded,
    environment: input.environment,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runEasProjectApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: EasProjectOptions;
}) {
  const [target, context, confirmationFlag, confirmedProject, ...extra] = input.arguments;
  if (
    !target ||
    !context ||
    confirmationFlag !== '--confirm-project' ||
    !confirmedProject ||
    extra.length > 0
  ) {
    throw new Error(easProjectUsage);
  }
  const loaded = await loadInputs(target, context);
  const plan = await createEasProjectPlan(loaded.projectRoot, loaded.context);
  if (confirmedProject !== plan.application.slug) {
    throw new Error('EAS confirmation must exactly match the generated project name');
  }
  return applyEasProject({
    ...loaded,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
