#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFactoryPreview, parseManifestSource } from './factory-preview.service';

const usage = `Usage: bun run plan -- <manifest.yaml|manifest.json>

Validates a build manifest and prints its composition and file plan.
This preview command never writes or removes project files.
`;

const manifestArgument = process.argv[2];

if (!manifestArgument || manifestArgument === '--help' || manifestArgument === '-h') {
  process.stdout.write(usage);
  process.exitCode = manifestArgument ? 0 : 1;
} else {
  try {
    const manifestPath = resolve(process.cwd(), manifestArgument);
    const source = await readFile(manifestPath, 'utf8');
    const manifest = parseManifestSource(source, manifestPath);
    const preview = createFactoryPreview(manifest);

    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory preview failed: ${message}\n`);
    process.exitCode = 1;
  }
}
