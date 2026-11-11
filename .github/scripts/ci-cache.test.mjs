import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keptHashes, staleEntries } from './ci-cache.mjs';

const KEEP = '0123456789abcdef';
const OLD = 'fedcba9876543210';
const summary = (...hashes) => ({ tasks: hashes.map((hash) => ({ taskId: `x#${hash}`, hash })) });

test('keeps exactly the task hashes this run computed, across every summary', () => {
  assert.deepEqual([...keptHashes([summary(KEEP), summary(OLD, KEEP)])].sort(), [KEEP, OLD].sort());
});

test('refuses to prune when no run summary names a task: that would empty the seed', () => {
  for (const summaries of [[], [{}], [{ tasks: [] }], [{ tasks: [{ hash: 'not-a-hash' }] }]]) {
    assert.throws(() => keptHashes(summaries), /CI_CACHE_PRUNE/);
  }
});

test('drops every artifact of a hash the run did not use, and nothing it does not recognise', () => {
  const files = [
    `${KEEP}.tar.zst`,
    `${KEEP}-meta.json`,
    `${KEEP}-manifest.json`,
    `${OLD}.tar.zst`,
    `${OLD}-meta.json`,
    `${OLD}-manifest.json`,
    'README',
    'tmp',
  ];
  assert.deepEqual(staleEntries(files, new Set([KEEP])).sort(), [
    `${OLD}-manifest.json`,
    `${OLD}-meta.json`,
    `${OLD}.tar.zst`,
  ]);
});

test('prunes a real cache directory from the run summaries on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-cache-'));
  mkdirSync(join(root, '.turbo/cache'), { recursive: true });
  mkdirSync(join(root, '.turbo/runs'), { recursive: true });
  writeFileSync(join(root, '.turbo/runs/run.json'), JSON.stringify(summary(KEEP)));
  for (const hash of [KEEP, OLD]) {
    writeFileSync(join(root, `.turbo/cache/${hash}.tar.zst`), 'x');
    writeFileSync(join(root, `.turbo/cache/${hash}-meta.json`), '{}');
  }
  const result = spawnSync('node', [resolve('.github/scripts/ci-cache.mjs'), 'prune'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(join(root, '.turbo/cache')).sort(), [
    `${KEEP}-meta.json`,
    `${KEEP}.tar.zst`,
  ]);
  assert.match(result.stdout, /removed 2/);
});

test('fails loudly without run summaries, leaving the cache untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-cache-'));
  mkdirSync(join(root, '.turbo/cache'), { recursive: true });
  writeFileSync(join(root, `.turbo/cache/${OLD}.tar.zst`), 'x');
  const result = spawnSync('node', [resolve('.github/scripts/ci-cache.mjs'), 'prune'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI_CACHE_PRUNE/);
  assert.deepEqual(readdirSync(join(root, '.turbo/cache')), [`${OLD}.tar.zst`]);
});
