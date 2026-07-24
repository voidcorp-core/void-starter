#!/usr/bin/env bun

import { printProvisioningResult, provisioningUsage, runProvisioningCli } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(provisioningUsage);
} else {
  try {
    printProvisioningResult(
      await runProvisioningCli({
        arguments: arguments_,
        requireExistingState: false,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory apply failed: ${message}\n`);
    process.exitCode = 1;
  }
}
