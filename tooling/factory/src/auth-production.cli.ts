import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type AuthProductionOptions,
  applyAuthProduction,
  createAuthProductionPlan,
  parseAuthProductionContextSource,
  preflightAuthProduction,
} from './auth-production.service';
import { parseProvisioningContextSource } from './provisioning-plan.service';

export const authProductionUsage = `Usage:
  bun run auth:plan -- <generated-project-directory> <provider-context.yaml|json> <auth-context.yaml|json>
  bun run auth:preflight -- <generated-project-directory> <provider-context.yaml|json> <auth-context.yaml|json>
  bun run auth:live -- <generated-project-directory> <provider-context.yaml|json> <auth-context.yaml|json> --confirm-project <project-name>
  bun run auth:resume -- <generated-project-directory> <provider-context.yaml|json> <auth-context.yaml|json> --confirm-project <project-name>

auth:plan is local and binds the exact published source, migrated database and non-secret auth intent.
auth:preflight performs authenticated Vercel reads only; it does not send email or mutate bindings.
auth:live creates write-only Production bindings, sends one idempotent configuration email, and
writes a non-secret receipt. auth:resume reconciles owned bindings before retrying the email smoke.
VERCEL_TOKEN, BETTER_AUTH_SECRET and RESEND_API_KEY stay in process memory and never enter state.
The exact administrator email receives role admin only when that verified identity is first created.
`;

async function loadInputs(
  targetArgument: string,
  providerContextArgument: string,
  authContextArgument: string,
) {
  const projectRoot = resolve(process.cwd(), targetArgument);
  const providerContextPath = resolve(process.cwd(), providerContextArgument);
  const authContextPath = resolve(process.cwd(), authContextArgument);
  const providerContext = parseProvisioningContextSource(
    await readFile(providerContextPath, 'utf8'),
    providerContextPath,
  );
  const authContext = parseAuthProductionContextSource(
    await readFile(authContextPath, 'utf8'),
    authContextPath,
  );
  return { projectRoot, providerContext, authContext };
}

export async function runAuthProductionPlanCli(input: { arguments: string[] }) {
  const [target, providerContext, authContext, ...extra] = input.arguments;
  if (!target || !providerContext || !authContext || extra.length > 0) {
    throw new Error(authProductionUsage);
  }
  const loaded = await loadInputs(target, providerContext, authContext);
  return createAuthProductionPlan(loaded.projectRoot, loaded.providerContext, loaded.authContext);
}

export async function runAuthProductionPreflightCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  options?: AuthProductionOptions;
}) {
  const [target, providerContext, authContext, ...extra] = input.arguments;
  if (!target || !providerContext || !authContext || extra.length > 0) {
    throw new Error(authProductionUsage);
  }
  const loaded = await loadInputs(target, providerContext, authContext);
  return preflightAuthProduction({
    ...loaded,
    environment: input.environment,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function runAuthProductionApplyCli(input: {
  arguments: string[];
  environment: Record<string, string | undefined>;
  requireExistingState: boolean;
  options?: AuthProductionOptions;
}) {
  const [target, providerContext, authContext, confirmationFlag, confirmedProject, ...extra] =
    input.arguments;
  if (
    !target ||
    !providerContext ||
    !authContext ||
    confirmationFlag !== '--confirm-project' ||
    !confirmedProject ||
    extra.length > 0
  ) {
    throw new Error(authProductionUsage);
  }
  const loaded = await loadInputs(target, providerContext, authContext);
  const plan = await createAuthProductionPlan(
    loaded.projectRoot,
    loaded.providerContext,
    loaded.authContext,
  );
  if (confirmedProject !== plan.application.project_name) {
    throw new Error('Production auth confirmation must exactly match the generated project name');
  }
  return applyAuthProduction({
    ...loaded,
    environment: input.environment,
    requireExistingState: input.requireExistingState,
    ...(input.options ? { options: input.options } : {}),
  });
}
