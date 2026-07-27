#!/usr/bin/env bun

import { easNativeBuildUsage, runEasNativeBuildPlanCli } from './eas-native-build.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(easNativeBuildUsage);
} else {
  try {
    const result = await runEasNativeBuildPlanCli({ arguments: arguments_ });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory EAS native build plan failed: ${message}\n`);
    process.exitCode = 1;
  }
}
