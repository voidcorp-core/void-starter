import {
  LiveProvisioningAdapter,
  loadLiveProvisioningCredentials,
} from './live-provisioning.service';
import { loadProvisioningPlan } from './provisioning.cli';
import { applyProvisioning } from './provisioning-apply.service';
import { provisioningPlanDigest } from './provisioning-plan.service';

export const liveProvisioningUsage = `Usage:
  bun run preflight:live -- <generated-project-directory> <context.yaml|context.json>
  bun run apply:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run resume:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>

Credentials are read from GITHUB_TOKEN and, when selected, VERCEL_TOKEN and NEON_API_KEY.
preflight:live performs authenticated identity checks using GET requests only.
apply:live and resume:live can create remote resources and require the exact project-name confirmation.
`;

export async function runLivePreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(liveProvisioningUsage);
  }
  const { plan } = await loadProvisioningPlan({
    targetArgument,
    contextArgument,
  });
  const adapter = new LiveProvisioningAdapter({
    credentials: loadLiveProvisioningCredentials(input.environment, plan),
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });
  await adapter.preflight(plan);
  return {
    ok: true,
    mode: 'live-preflight',
    plan_sha256: provisioningPlanDigest(plan),
    providers: [...new Set(plan.actions.map((action) => action.provider))].toSorted(),
  };
}

export async function runLiveApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  fetch?: typeof fetch;
  requireExistingState: boolean;
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
    throw new Error(liveProvisioningUsage);
  }
  const { projectRoot, plan } = await loadProvisioningPlan({
    targetArgument,
    contextArgument,
  });
  const projectName = plan.actions.find((action) => action.id === 'github.repository')?.input.name;
  if (!projectName || confirmedProject !== projectName) {
    throw new Error('Live confirmation must exactly match the generated project name');
  }

  return applyProvisioning({
    projectRoot,
    plan,
    adapter: new LiveProvisioningAdapter({
      credentials: loadLiveProvisioningCredentials(input.environment, plan),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }),
    requireExistingState: input.requireExistingState,
  });
}
