import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { planScope } from './ci-scope.mjs';

const BASE = 'a'.repeat(40);
const BRANCH = 'b'.repeat(40);
const pr = (files, parents = [BASE, BRANCH]) =>
  planScope({ eventName: 'pull_request', parents, files });

test('a pull request that only touches workspace packages runs the affected graph from the base tip', () => {
  const plan = pr([
    'apps/web/src/app/page.tsx',
    '_modules/storage-r2/src/storage.ts',
    'tooling/factory/src/a.ts',
  ]);
  assert.equal(plan.affected, true);
  assert.equal(plan.base, BASE);
});

test('documentation and agent tooling never widen the run', () => {
  for (const file of [
    'docs/CI.md',
    'README.md',
    'CLAUDE.md',
    '_modules/README.md',
    '.void/active.md',
    '.claude/settings.json',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug.md',
  ]) {
    assert.equal(pr([file]).affected, true, file);
  }
});

test('any doubt runs the full graph', () => {
  for (const file of [
    'bun.lock',
    'package.json',
    'turbo.json',
    'biome.json',
    'knip.json',
    '.github/workflows/ci.yml',
    '.github/scripts/ci-scope.mjs',
    'tsconfig.json',
    'apps',
    '.env.example',
    'some-new-root-file.ts',
  ]) {
    const plan = pr(['apps/web/src/a.ts', file]);
    assert.equal(plan.affected, false, file);
    assert.equal(plan.base, undefined, file);
    assert.match(plan.reason, new RegExp(file.replace(/[.]/g, '\\.')), file);
  }
});

test('markdown inside a package stays in the affected graph of that package', () => {
  assert.equal(pr(['apps/web/content/post.md']).affected, true);
  assert.equal(pr(['apps/web/content/post.md']).base, BASE);
});

test('an unreadable or empty diff runs the full graph', () => {
  for (const files of [undefined, null, [], [''], [42]]) assert.equal(pr(files).affected, false);
});

test('only the pull request merge commit gives a trustworthy base', () => {
  for (const parents of [[], [BASE], [BASE, BRANCH, BRANCH], undefined, ['main', BRANCH]]) {
    const plan = planScope({ eventName: 'pull_request', parents, files: ['apps/web/a.ts'] });
    assert.equal(plan.affected, false, String(parents));
  }
});

test('push, merge queue and manual runs always run the full graph', () => {
  for (const eventName of ['push', 'merge_group', 'workflow_dispatch', undefined]) {
    const plan = planScope({ eventName, parents: [BASE, BRANCH], files: ['apps/web/a.ts'] });
    assert.equal(plan.affected, false, String(eventName));
  }
});
