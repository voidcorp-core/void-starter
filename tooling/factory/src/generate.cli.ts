#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifestSource } from './factory-preview.service';
import { renderProject } from './generation.service';

const usage = `Usage: bun run generate -- <manifest.yaml|manifest.json> <new-target-directory>

Renders a new repository from the current Void Starter baseline.
The target directory must not exist and must not be inside the source repository.
`;

const manifestArgument = process.argv[2];
const targetArgument = process.argv[3];

if (
  !manifestArgument ||
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
    const targetRoot = resolve(process.cwd(), targetArgument);
    const source = await readFile(manifestPath, 'utf8');
    const manifest = parseManifestSource(source, manifestPath);
    const receipt = await renderProject({
      manifest,
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
