import { test } from 'bun:test';
import { YAML } from 'bun';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const evaluate = (expression, github) => runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), { github }, { timeout: 1000 });
const eventFile = resolve(mkdtempSync(resolve(tmpdir(), 'ci-admission-')), 'event.json');
function admit(name, event) {
  writeFileSync(eventFile, JSON.stringify(event));
  return spawnSync('node', ['.github/scripts/ci-admission.mjs'], {
    env: { ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: eventFile },
    encoding: 'utf8', timeout: 5000,
  });
}

test('draft documentation PR does not admit package installation, build or browser tests', () => {
  const result = admit('pull_request', { number: 11, action: 'opened', pull_request: { draft: true } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI_DEFERRED_DRAFT/);
  const quality = workflow.jobs.quality;
  assert.equal(quality['continue-on-error'], undefined);
  const index = quality.steps.findIndex(step => step.run === 'node .github/scripts/ci-admission.mjs');
  assert.ok(index >= 0);
  assert.equal(quality.steps[index]['continue-on-error'], undefined);
  const install = quality.steps.findIndex(step => step.run?.includes('bun install'));
  assert.ok(install === -1 || index < install);
  for (const step of quality.steps.slice(index + 1)) assert.equal(step.if, undefined);
});

test('readiness without another commit and a fresh revision both run full validation', () => {
  for (const action of ['ready_for_review', 'synchronize', 'reopened']) {
    assert.ok(workflow.on.pull_request.types.includes(action));
    const result = admit('pull_request', { action, pull_request: { draft: false } });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const name of ['push', 'merge_group', 'workflow_dispatch']) {
    assert.ok(Object.hasOwn(workflow.on, name));
    assert.equal(admit(name, {}).status, 0);
  }
  assert.equal(admit('pull_request', { pull_request: {} }).status, 1);
  assert.equal(admit('unknown', {}).status, 1);
});

test('returning to draft cancels only the same PR, not push/manual/merge-group runs', () => {
  assert.ok(workflow.on.pull_request.types.includes('converted_to_draft'));
  const context = (name, run, number) => ({ workflow: 'CI', event_name: name, run_id: run, event: { pull_request: { number } } });
  const group = github => workflow.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_, expression) => evaluate(expression, github));
  assert.equal(group(context('pull_request', 1, 11)), group(context('pull_request', 2, 11)));
  assert.notEqual(group(context('pull_request', 1, 11)), group(context('pull_request', 2, 12)));
  for (const name of ['push', 'merge_group', 'workflow_dispatch']) {
    assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], context(name, 1)), false);
    assert.notEqual(group(context(name, 1)), group(context(name, 2)));
  }
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], context('pull_request', 1, 11)), true);
});

test('secret scanning is independent and still runs on drafts', () => {
  const secrets = workflow.jobs.secrets;
  assert.ok(secrets);
  assert.equal(secrets.if, undefined);
  assert.equal(secrets.needs, undefined);
  assert.ok(secrets.steps.some(step => step.run?.includes('git --redact')));
  assert.ok(!secrets.steps.some(step => step.run?.includes('bun install')));
});

test('draft heavy jobs cannot report successful quality through skipped dependencies', () => {
  const quality = workflow.jobs.quality;
  assert.equal(quality.if, '${{ always() }}');
  for (const id of ['code']) {
    const job = workflow.jobs[id];
    assert.ok(quality.needs.includes(id));
    assert.equal(evaluate(job.if, { event_name: 'pull_request', event: { pull_request: { draft: true } } }), false);
    for (const name of ['pull_request', 'merge_group', 'push', 'workflow_dispatch']) {
      assert.equal(evaluate(job.if, { event_name: name, event: { pull_request: { draft: false } } }), true);
    }
  }
  const gate = quality.steps.find(step => step.name === 'Require every quality check');
  const success = Object.fromEntries(Object.keys(gate.env).map(key => [key, key.endsWith('_RESULT') ? 'success' : 'true']));
  for (const key of Object.keys(success).filter(key => key.endsWith('_RESULT'))) {
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      const outcome = spawnSync('bash', ['-e', '-c', gate.run], {
        env: { ...process.env, ...success, IS_DRAFT: 'false', [key]: result }, encoding: 'utf8', timeout: 1000,
      });
      assert.equal(outcome.status, result === 'success' ? 0 : 1, `${key}: ${result}`);
    }
  }
});
