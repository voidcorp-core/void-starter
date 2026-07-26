#!/usr/bin/env bun

import { runAuthProductionApplyCli } from './auth-production.cli';

try {
  const result = await runAuthProductionApplyCli({
    arguments: process.argv.slice(2),
    environment: process.env,
    requireExistingState: false,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Factory auth configuration failed: ${message}\n`);
  process.exitCode = 1;
}
