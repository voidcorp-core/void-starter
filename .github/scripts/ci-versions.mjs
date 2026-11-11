#!/usr/bin/env node
// tdd-cover: e2e .github/scripts/ci-versions.test.mjs
// The exact tool versions the browser shards run with, read from the
// repository so they can never drift: the official Playwright image at the
// version bun.lock resolves (browsers and their system libraries included, no
// apt), and bun at the packageManager version. Any ambiguity fails the job,
// which skips the shards and turns the required `e2e` check red.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXACT = /^\d+\.\d+\.\d+$/;

export function resolvePlaywrightVersion(lockText) {
  const versions = new Set();
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    const escaped = name.replace(/[/.]/g, '\\$&');
    const entry = new RegExp(`"(?:[^"\\s]*/)?${escaped}": \\["${escaped}@([^"]+)"`, 'g');
    const found = [...lockText.matchAll(entry)].map((match) => match[1]);
    if (found.length === 0) versions.add(`${name} missing`);
    for (const version of found) versions.add(version);
  }
  const [version] = versions;
  if (versions.size !== 1 || !EXACT.test(version)) {
    throw new Error(
      `CI_PLAYWRIGHT_VERSION: bun.lock must resolve @playwright/test, playwright and playwright-core to one exact version, found ${[...versions].join(', ')}.`,
    );
  }
  return version;
}

export function resolveBunVersion(manifestText) {
  const match = /^bun@(.+)$/.exec(JSON.parse(manifestText).packageManager ?? '');
  if (!match || !EXACT.test(match[1])) {
    throw new Error('CI_BUN_VERSION: package.json packageManager must pin an exact bun@x.y.z.');
  }
  return match[1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { GITHUB_OUTPUT } = process.env;
    if (!GITHUB_OUTPUT) throw new Error('CI_VERSIONS: GITHUB_OUTPUT is unset.');
    const playwright = resolvePlaywrightVersion(readFileSync('bun.lock', 'utf8'));
    const bun = resolveBunVersion(readFileSync('package.json', 'utf8'));
    process.stdout.write(`ci-versions: playwright ${playwright}, bun ${bun}\n`);
    appendFileSync(GITHUB_OUTPUT, `playwright=${playwright}\nbun=${bun}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
