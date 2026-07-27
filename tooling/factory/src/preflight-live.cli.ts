#!/usr/bin/env bun

import { liveProvisioningUsage, runLivePreflightCli } from './live-provisioning.cli';
import { printProvisioningResult } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(liveProvisioningUsage);
} else {
  try {
    printProvisioningResult(
      await runLivePreflightCli({
        arguments: arguments_,
        environment: process.env,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory live preflight failed: ${message}\n`);
    process.exitCode = 1;
  }
}
