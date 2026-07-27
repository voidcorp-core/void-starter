#!/usr/bin/env bun

import { migrationUsage, runMigrationApplyCli } from './migration.cli';
import { printProvisioningResult } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(migrationUsage);
} else {
  try {
    printProvisioningResult(
      await runMigrationApplyCli({
        arguments: arguments_,
        environment: process.env,
        requireExistingState: false,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory migration failed: ${message}\n`);
    process.exitCode = 1;
  }
}
