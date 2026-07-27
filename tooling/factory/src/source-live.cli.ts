#!/usr/bin/env bun

import { printProvisioningResult } from './provisioning.cli';
import { runSourceApplyCli, sourcePublicationUsage } from './source-publication.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(sourcePublicationUsage);
} else {
  try {
    printProvisioningResult(
      await runSourceApplyCli({
        arguments: arguments_,
        environment: process.env,
        requireExistingState: false,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory source publication failed: ${message}\n`);
    process.exitCode = 1;
  }
}
