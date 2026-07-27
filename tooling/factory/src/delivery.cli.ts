import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createDeliveryPlan,
  type DeliveryOptions,
  observeDelivery,
  preflightDelivery,
} from './delivery.service';
import { parseProvisioningContextSource } from './provisioning-plan.service';

export const deliveryUsage = `Usage:
  bun run delivery:plan -- <generated-project-directory> <context.yaml|context.json>
  bun run delivery:preflight -- <generated-project-directory> <context.yaml|context.json>
  bun run delivery:live -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>
  bun run delivery:resume -- <generated-project-directory> <context.yaml|context.json> --confirm-project <project-name>

delivery:plan is local and requires succeeded live provisioning plus source-publication state.
delivery:preflight performs authenticated Vercel reads only and binds the exact source commit.
delivery:live waits for that Production deployment, then smokes its root page and writes a receipt.
delivery:resume retries a failed or interrupted observation without changing provider resources.
VERCEL_TOKEN is required for authenticated reads. VERCEL_AUTOMATION_BYPASS_SECRET is optional for
public deployments and required when Deployment Protection redirects the smoke to Vercel SSO.
Neither credential is written to delivery state.
`;

async function loadDeliveryInputs(targetArgument: string, contextArgument: string) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const context = parseProvisioningContextSource(await readFile(contextPath, 'utf8'), contextPath);
  return { projectRoot, context };
}

export async function runDeliveryPlanCli(input: { arguments: string[] }): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(deliveryUsage);
  }
  const { projectRoot, context } = await loadDeliveryInputs(targetArgument, contextArgument);
  return createDeliveryPlan(projectRoot, context);
}

export async function runDeliveryPreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: DeliveryOptions;
}): Promise<unknown> {
  const [targetArgument, contextArgument, ...extraArguments] = input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(deliveryUsage);
  }
  const { projectRoot, context } = await loadDeliveryInputs(targetArgument, contextArgument);
  return preflightDelivery({
    projectRoot,
    context,
    environment: input.environment,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runDeliveryApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: DeliveryOptions;
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
    throw new Error(deliveryUsage);
  }
  const { projectRoot, context } = await loadDeliveryInputs(targetArgument, contextArgument);
  const plan = await createDeliveryPlan(projectRoot, context);
  if (confirmedProject !== plan.deployment.project_name) {
    throw new Error('Delivery confirmation must exactly match the generated project name');
  }
  return observeDelivery({
    projectRoot,
    context,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
