#!/usr/bin/env bun

import { resolve } from 'node:path';
import { applyProjectPack, checkProjectPack, createProjectPackPlan } from './project-pack.service';

const usage = `Usage:
  bun run foundation -- preview <project-pack-manifest.yaml|json> <target-project>
  bun run foundation -- apply <project-pack-manifest.yaml|json> <target-project> --confirm-project <project-id>
  bun run foundation -- check <project-pack-manifest.yaml|json> <target-project>

preview and check never write. apply refuses every conflict and requires the exact project id.
`;

const [command, manifestArgument, targetArgument, confirmationFlag, confirmationValue, ...rest] =
  process.argv.slice(2);

if (command === '--help' || command === '-h') {
  process.stdout.write(usage);
} else if (
  !command ||
  !manifestArgument ||
  !targetArgument ||
  rest.length > 0 ||
  !['preview', 'apply', 'check'].includes(command)
) {
  process.stderr.write(usage);
  process.exitCode = 1;
} else {
  try {
    const input = {
      manifestPath: resolve(process.cwd(), manifestArgument),
      targetRoot: resolve(process.cwd(), targetArgument),
    };

    if (command === 'apply') {
      if (confirmationFlag !== '--confirm-project' || !confirmationValue) {
        throw new Error('Project Pack apply requires --confirm-project <project-id>');
      }
      const result = await applyProjectPack({
        ...input,
        confirmedProjectId: confirmationValue,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      if (confirmationFlag || confirmationValue) {
        throw new Error(`${command} does not accept apply confirmation arguments`);
      }
      const plan =
        command === 'preview' ? await createProjectPackPlan(input) : await checkProjectPack(input);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Project Pack ${command} failed: ${message}\n`);
    process.exitCode = 1;
  }
}
