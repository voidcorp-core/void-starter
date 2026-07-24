import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseBuildManifest } from './factory.service';
import { serializeCanonicalJson } from './integrity.service';
import { applyProvisioning, SimulatedProvisioningAdapter } from './provisioning-apply.service';
import {
  createProvisioningPlan,
  parseProvisioningContextSource,
} from './provisioning-plan.service';

export const provisioningUsage = `Usage:
  bun run apply -- <generated-project-directory> <context.yaml|context.json> [--dry-run|--simulate]
  bun run resume -- <generated-project-directory> <context.yaml|context.json> --simulate

--dry-run is the safe default and prints the deterministic remote-action plan without writing.
--simulate executes the resumable state machine locally; it does not call provider APIs.
Live provider execution is intentionally unavailable in this increment.
`;

export async function runProvisioningCli(input: {
  arguments: string[];
  requireExistingState: boolean;
}): Promise<unknown> {
  const [targetArgument, contextArgument, modeArgument = '--dry-run', ...extraArguments] =
    input.arguments;
  if (!targetArgument || !contextArgument || extraArguments.length > 0) {
    throw new Error(provisioningUsage);
  }
  if (modeArgument !== '--dry-run' && modeArgument !== '--simulate') {
    throw new Error(`Unsupported apply mode: ${modeArgument}\n\n${provisioningUsage}`);
  }
  if (input.requireExistingState && modeArgument !== '--simulate') {
    throw new Error(`resume requires --simulate in the current increment\n\n${provisioningUsage}`);
  }

  const projectRoot = resolve(process.cwd(), targetArgument);
  const contextPath = resolve(process.cwd(), contextArgument);
  const manifestSource = await readFile(
    resolve(projectRoot, '.void-starter/manifest.json'),
    'utf8',
  );
  const contextSource = await readFile(contextPath, 'utf8');
  const manifest = parseBuildManifest(JSON.parse(manifestSource));
  const context = parseProvisioningContextSource(contextSource, contextPath);
  const plan = createProvisioningPlan(manifest, context);

  if (modeArgument === '--dry-run') {
    return plan;
  }

  return applyProvisioning({
    projectRoot,
    plan,
    adapter: new SimulatedProvisioningAdapter(),
    requireExistingState: input.requireExistingState,
  });
}

export function printProvisioningResult(result: unknown): void {
  process.stdout.write(serializeCanonicalJson(result));
}
