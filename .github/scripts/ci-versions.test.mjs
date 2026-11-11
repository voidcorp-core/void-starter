import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resolveBunVersion, resolvePlaywrightVersion } from './ci-versions.mjs';

const lock = (test, runner, core) =>
  [
    `"@playwright/test": ["@playwright/test@${test}", "", {}, "x"],`,
    `"playwright": ["playwright@${runner}", "", {}, "x"],`,
    `"playwright-core": ["playwright-core@${core}", "", {}, "x"],`,
  ].join('\n');

test('the browser image follows the one Playwright version bun.lock resolves', () => {
  assert.equal(resolvePlaywrightVersion(lock('1.61.1', '1.61.1', '1.61.1')), '1.61.1');
  assert.match(resolvePlaywrightVersion(readFileSync('bun.lock', 'utf8')), /^\d+\.\d+\.\d+$/);
});

test('an ambiguous or missing Playwright version refuses to pick an image', () => {
  for (const text of [
    lock('1.61.1', '1.61.0', '1.61.1'),
    lock('1.61.1', '1.61.1', '1.62.0'),
    lock('1.61.1-beta', '1.61.1-beta', '1.61.1-beta'),
    `${lock('1.61.1', '1.61.1', '1.61.1')}\n"apps/web/@playwright/test": ["@playwright/test@1.60.0", "", {}, "x"],`,
    '{ "packages": {} }',
  ]) {
    assert.throws(() => resolvePlaywrightVersion(text), /CI_PLAYWRIGHT_VERSION/);
  }
});

test('the bun version comes from packageManager, the single pinned source', () => {
  assert.equal(resolveBunVersion('{"packageManager":"bun@1.3.14"}'), '1.3.14');
  assert.match(resolveBunVersion(readFileSync('package.json', 'utf8')), /^\d+\.\d+\.\d+$/);
  for (const text of ['{}', '{"packageManager":"pnpm@9.0.0"}', '{"packageManager":"bun@^1.3"}']) {
    assert.throws(() => resolveBunVersion(text), /CI_BUN_VERSION/);
  }
});

test('the CLI writes both outputs from the repository files', () => {
  const output = resolve(mkdtempSync(resolve(tmpdir(), 'ci-versions-')), 'output');
  writeFileSync(output, '');
  const result = spawnSync('node', ['.github/scripts/ci-versions.mjs'], {
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /^playwright=\d+\.\d+\.\d+\nbun=\d+\.\d+\.\d+\n$/);
});
