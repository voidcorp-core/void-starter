#!/usr/bin/env bun

import { migrationUsage, runMigrationPlanCli } from './migration.cli';
import { printProvisioningResult } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(migrationUsage);
} else {
  try {
    printProvisioningResult(await runMigrationPlanCli({ arguments: arguments_ }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory migration plan failed: ${message}\n`);
    process.exitCode = 1;
  }
}
