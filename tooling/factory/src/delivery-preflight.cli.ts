#!/usr/bin/env bun

import { deliveryUsage, runDeliveryPreflightCli } from './delivery.cli';
import { printProvisioningResult } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(deliveryUsage);
} else {
  try {
    printProvisioningResult(
      await runDeliveryPreflightCli({ arguments: arguments_, environment: process.env }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory delivery preflight failed: ${message}\n`);
    process.exitCode = 1;
  }
}
