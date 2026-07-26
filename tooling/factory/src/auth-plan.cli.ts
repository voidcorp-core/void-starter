#!/usr/bin/env bun

import { runAuthProductionPlanCli } from './auth-production.cli';

try {
  const result = await runAuthProductionPlanCli({ arguments: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Factory auth plan failed: ${message}\n`);
  process.exitCode = 1;
}
