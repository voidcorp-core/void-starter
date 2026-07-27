#!/usr/bin/env bun

import { deliveryUsage, runDeliveryPlanCli } from './delivery.cli';
import { printProvisioningResult } from './provisioning.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(deliveryUsage);
} else {
  try {
    printProvisioningResult(await runDeliveryPlanCli({ arguments: arguments_ }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory delivery plan failed: ${message}\n`);
    process.exitCode = 1;
  }
}
