import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyEasNativeBuild,
  createEasNativeBuildPlan,
  type EasNativeBuildOptions,
  parseEasNativeBuildContextSource,
  preflightEasNativeBuild,
} from './eas-native-build.service';

export const easNativeBuildUsage = `Usage:
  bun run eas-build:plan -- <generated-project-directory> <eas-build-context.yaml|json>
  bun run eas-build:preflight -- <generated-project-directory> <eas-build-context.yaml|json>
  bun run eas-build:live -- <generated-project-directory> <eas-build-context.yaml|json> \\
    --confirm-project <project-name> --confirm-build-count <count> --approve-max-charge-usd <amount>
  bun run eas-build:resume -- <generated-project-directory> <eas-build-context.yaml|json> \\
    --confirm-project <project-name> --confirm-build-count <count> --approve-max-charge-usd <amount>

The local plan binds the succeeded EAS project and source-publication receipts, generated eas.json,
profile, platforms, required environment metadata, signing ownership and the declared cost envelope.
Preflight uses EXPO_TOKEN for read-only account, project, environment and build-history checks.
Live and resume require exact project/build-count/USD confirmations, freeze remote credentials, never
auto-submit, start at most one no-wait build per selected platform and persist no secret values.
The USD envelope is a human approval boundary; it is not a provider-enforced spending limit.
`;

async function loadInputs(targetArgument: string, contextArgument: string) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const context = parseEasNativeBuildContextSource(
    await readFile(contextPath, 'utf8'),
    contextPath,
  );
  return { projectRoot, context };
}

export async function runEasNativeBuildPlanCli(input: { arguments: string[] }) {
  const [target, context, ...extra] = input.arguments;
  if (!target || !context || extra.length > 0) throw new Error(easNativeBuildUsage);
  const loaded = await loadInputs(target, context);
  return createEasNativeBuildPlan(loaded.projectRoot, loaded.context);
}

export async function runEasNativeBuildPreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: EasNativeBuildOptions;
}) {
  const [target, context, ...extra] = input.arguments;
  if (!target || !context || extra.length > 0) throw new Error(easNativeBuildUsage);
  const loaded = await loadInputs(target, context);
  return preflightEasNativeBuild({
    ...loaded,
    environment: input.environment,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runEasNativeBuildApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: EasNativeBuildOptions;
}) {
  const [
    target,
    context,
    projectFlag,
    project,
    buildCountFlag,
    buildCountSource,
    chargeFlag,
    chargeSource,
    ...extra
  ] = input.arguments;
  if (
    !target ||
    !context ||
    projectFlag !== '--confirm-project' ||
    !project ||
    buildCountFlag !== '--confirm-build-count' ||
    !buildCountSource ||
    chargeFlag !== '--approve-max-charge-usd' ||
    chargeSource === undefined ||
    extra.length > 0
  ) {
    throw new Error(easNativeBuildUsage);
  }
  const maximumBuilds = Number(buildCountSource);
  const maximumProviderChargeUsd = Number(chargeSource);
  if (
    !Number.isInteger(maximumBuilds) ||
    maximumBuilds < 1 ||
    maximumBuilds > 2 ||
    !Number.isFinite(maximumProviderChargeUsd) ||
    maximumProviderChargeUsd < 0
  ) {
    throw new Error('EAS build confirmation contains an invalid count or USD amount');
  }
  const loaded = await loadInputs(target, context);
  return applyEasNativeBuild({
    ...loaded,
    environment: input.environment,
    confirmation: {
      project,
      maximumBuilds,
      maximumProviderChargeUsd,
    },
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
