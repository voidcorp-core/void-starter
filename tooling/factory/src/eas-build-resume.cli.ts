#!/usr/bin/env bun

import { easNativeBuildUsage, runEasNativeBuildApplyCli } from './eas-native-build.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(easNativeBuildUsage);
} else {
  try {
    const result = await runEasNativeBuildApplyCli({
      arguments: arguments_,
      environment: process.env,
      requireExistingState: true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory EAS native build resume failed: ${message}\n`);
    process.exitCode = 1;
  }
}
