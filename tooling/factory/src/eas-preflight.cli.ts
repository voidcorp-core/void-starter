#!/usr/bin/env bun

import { easProjectUsage, runEasProjectPreflightCli } from './eas-project.cli';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--help' || arguments_[0] === '-h') {
  process.stdout.write(easProjectUsage);
} else {
  try {
    const result = await runEasProjectPreflightCli({
      arguments: arguments_,
      environment: process.env,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Factory EAS preflight failed: ${message}\n`);
    process.exitCode = 1;
  }
}
