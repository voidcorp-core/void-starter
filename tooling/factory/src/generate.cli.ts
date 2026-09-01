#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifestSource } from './factory-preview.service';
import { renderProject } from './generation.service';
import { parseProvisioningHandoffContextSource } from './provisioning-handoff.service';

const usage = `Usage: bun run generate -- <manifest.yaml|manifest.json> <provisioning-context.yaml|json> <new-target-directory>

Renders a new repository and its external provisioning handoff from the current baseline.
The target directory must not exist and must not be inside the source repository.
`;

const manifestArgument = process.argv[2];
const contextArgument = process.argv[3];
const targetArgument = process.argv[4];

if (
  !manifestArgument ||
  !contextArgument ||
  !targetArgument ||
  manifestArgument === '--help' ||
  manifestArgument === '-h'
) {
  process.stdout.write(usage);
  process.exitCode = manifestArgument === '--help' || manifestArgument === '-h' ? 0 : 1;
} else {
  try {
    const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const manifestPath = resolve(process.cwd(), manifestArgument);
    const contextPath = resolve(process.cwd(), contextArgument);
    const targetRoot = resolve(process.cwd(), targetArgument);
    const [manifestSource, contextSource] = await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(contextPath, 'utf8'),
    ]);
    const manifest = parseManifestSource(manifestSource, manifestPath);
    const provisioningContext = parseProvisioningHandoffContextSource(contextSource, contextPath);
    const receipt = await renderProject({
      manifest,
      provisioningContext,
      sourceRoot,
      targetRoot,
    });

    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory generation failed: ${message}\n`);
    process.exitCode = 1;
  }
}
