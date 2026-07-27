#!/usr/bin/env bun

import { runAuthProductionPreflightCli } from './auth-production.cli';

try {
  const result = await runAuthProductionPreflightCli({
    arguments: process.argv.slice(2),
    environment: process.env,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Factory auth preflight failed: ${message}\n`);
  process.exitCode = 1;
}
