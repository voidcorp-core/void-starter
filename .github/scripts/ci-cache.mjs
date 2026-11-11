#!/usr/bin/env node
// tdd-cover: e2e .github/scripts/ci-cache.test.mjs
// Prunes the local Turbo cache to the tasks this run hashed, before `main`
// saves it as the seed every pull request restores.
//
// The seed is restored by prefix, so without pruning each save carries every
// older entry forward and the cache only grows. Run summaries
// (`turbo run --summarize`) name every task hash of the run, hit or miss: the
// rest belongs to trees that no longer exist. Pruning is not validation: a
// wrong answer only costs cache hits. It refuses to run without a summary
// rather than empty the seed.
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = '.turbo/cache';
const RUNS_DIR = '.turbo/runs';
const HASH = /^[0-9a-f]{16}$/;
// `<hash>.tar.zst`, `<hash>-meta.json`, `<hash>-manifest.json`.
const ARTIFACT = /^([0-9a-f]{16})[.-]/;

export function keptHashes(summaries) {
  const hashes = new Set(
    summaries.flatMap((summary) =>
      (Array.isArray(summary?.tasks) ? summary.tasks : [])
        .map((task) => task?.hash)
        .filter((hash) => typeof hash === 'string' && HASH.test(hash)),
    ),
  );
  if (hashes.size === 0) {
    throw new Error(
      'CI_CACHE_PRUNE: no run summary names a task hash; refusing to empty the seed.',
    );
  }
  return hashes;
}

export function staleEntries(files, keep) {
  return files.filter((file) => {
    const hash = ARTIFACT.exec(file)?.[1];
    return hash !== undefined && !keep.has(hash);
  });
}

function prune() {
  const summaries = readdirSync(RUNS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(RUNS_DIR, file), 'utf8')));
  const keep = keptHashes(summaries);
  const stale = staleEntries(readdirSync(CACHE_DIR), keep);
  let bytes = 0;
  for (const file of stale) {
    const path = join(CACHE_DIR, file);
    bytes += statSync(path).size;
    rmSync(path);
  }
  process.stdout.write(
    `ci-cache: kept ${keep.size} task hash(es), removed ${stale.length} stale file(s), ${(bytes / 1e6).toFixed(1)} MB\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== 'prune') throw new Error('usage: ci-cache.mjs prune');
    prune();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message.startsWith('CI_CACHE_PRUNE') ? message : `CI_CACHE_PRUNE: ${message}`}\n`,
    );
    process.exitCode = 1;
  }
}
