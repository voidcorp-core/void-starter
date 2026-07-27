#!/usr/bin/env bun

import { resolve } from 'node:path';
import { doctorProject } from './doctor.service';

const usage = `Usage: bun run doctor -- <generated-project-directory>

Verifies generation metadata, selected surfaces, generated file digests,
and the absence of factory or external governance artifacts.
`;

const targetArgument = process.argv[2];

if (!targetArgument || targetArgument === '--help' || targetArgument === '-h') {
  process.stdout.write(usage);
  process.exitCode = targetArgument ? 0 : 1;
} else {
  try {
    const report = await doctorProject(resolve(process.cwd(), targetArgument));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory doctor failed: ${message}\n`);
    process.exitCode = 1;
  }
}
