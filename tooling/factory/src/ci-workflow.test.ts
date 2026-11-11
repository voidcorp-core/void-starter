import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  strategy: z
    .object({
      'fail-fast': z.boolean().optional(),
      matrix: z.object({ shard: z.array(z.number()) }).optional(),
    })
    .optional(),
  container: z.object({ image: z.string() }).optional(),
  steps: z.array(stepSchema),
});
const workflow = z
  .object({ jobs: z.record(z.string(), jobSchema) })
  .parse(
    parse(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')),
  );

describe('starter CI contract', () => {
  it('runs code checks and secret scanning independently of dependency advisories', () => {
    expect(workflow.jobs['code']?.needs).toBeUndefined();
    expect(workflow.jobs['dependency-audit']?.needs).toBeUndefined();
    expect(workflow.jobs['secrets']?.needs).toBeUndefined();
    expect(
      workflow.jobs['code']?.steps.some((step) =>
        step.run?.includes('bunx turbo run type-check test build'),
      ),
    ).toBe(true);
    expect(
      workflow.jobs['dependency-audit']?.steps.some((step) => step.run === 'bun run audit'),
    ).toBe(true);
  });

  it('runs the browser suite in shards, in parallel with the code checks', () => {
    const versions = workflow.jobs['versions'];
    expect(versions?.needs).toBeUndefined();
    expect(versions?.if).toBe(workflow.jobs['code']?.if);
    expect(
      versions?.steps.some((step) => step.run === 'node .github/scripts/ci-versions.mjs'),
    ).toBe(true);
    const shard = workflow.jobs['e2e-shard'];
    expect(shard?.needs).toBe('versions');
    expect(shard?.if).toBe(workflow.jobs['code']?.if);
    // Browsers and their system libraries come with the image: no apt mirror on the path.
    expect(shard?.container?.image).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is literal YAML.
      'mcr.microsoft.com/playwright:v${{ needs.versions.outputs.playwright }}-noble',
    );
    expect(shard?.steps.some((step) => step.run?.includes('playwright install'))).toBe(false);
    expect(shard?.strategy?.['fail-fast']).toBe(false);
    expect(shard?.strategy?.matrix?.shard.length).toBeGreaterThanOrEqual(2);
    expect(
      shard?.steps.some((step) =>
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is literal YAML.
        step.run?.includes('--shard=${{ matrix.shard }}/${{ strategy.job-total }}'),
      ),
    ).toBe(true);
  });

  it('keeps the required e2e check red unless every shard passed', () => {
    const gate = workflow.jobs['e2e'];
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is literal YAML.
    expect(gate?.if).toBe('${{ always() }}');
    expect(gate?.needs).toEqual(['e2e-shard']);
    const steps = gate?.steps ?? [];
    const admission = steps.findIndex(
      (step) => step.run === 'node .github/scripts/ci-admission.mjs',
    );
    const check = steps.findIndex((step) => step.run?.includes('SHARDS_RESULT'));
    expect(admission).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(admission);
    for (const step of steps.slice(0, check + 1)) expect(step.if).toBeUndefined();
    for (const step of steps.slice(check + 1)) expect(step.if).toContain('failure()');
    const script = steps[check]?.run ?? '';
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      const outcome = spawnSync('bash', ['-e', '-c', script], {
        env: { PATH: process.env['PATH'], SHARDS_RESULT: result },
        encoding: 'utf8',
        timeout: 1000,
      });
      expect(outcome.status).toBe(result === 'success' ? 0 : 1);
    }
  });

  it('narrows the Turbo graph only through the fail-closed scope plan', () => {
    const steps = workflow.jobs['code']?.steps ?? [];
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(2);
    const scope = steps.findIndex((step) => step.run === 'node .github/scripts/ci-scope.mjs');
    const turbo = steps.findIndex((step) => step.run?.includes('turbo run type-check test build'));
    expect(scope).toBeGreaterThanOrEqual(0);
    expect(turbo).toBeGreaterThan(scope);
    expect(steps[turbo]?.run).toContain('--summarize');
    expect(steps.filter((step) => step.run?.includes('--affected'))).toEqual([steps[turbo]]);
  });

  it('saves caches from main pushes only, after pruning the Turbo seed', () => {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    expect(steps.some((step) => step.uses?.startsWith('actions/cache@'))).toBe(false);
    const saves = steps.filter((step) => step.uses?.startsWith('actions/cache/save@'));
    expect(saves.length).toBeGreaterThan(0);
    const code = workflow.jobs['code']?.steps ?? [];
    const prune = code.findIndex((step) => step.run === 'node .github/scripts/ci-cache.mjs prune');
    expect(prune).toBeGreaterThanOrEqual(0);
    for (const step of [code[prune], ...saves]) {
      expect(step?.if).toContain("github.event_name == 'push'");
      expect(step?.if).toContain("github.ref == 'refs/heads/main'");
    }
    for (const save of saves) expect(code.indexOf(save)).toBeGreaterThan(prune);
  });

  it('restores the bun cache by exact key on pushes and by prefix elsewhere', () => {
    const restore = workflow.jobs['code']?.steps.find((step) => step.name === 'Restore bun cache');
    const expression = String(restore?.with?.['restore-keys'] ?? '').replace(
      /^\$\{\{\s*|\s*\}\}$/g,
      '',
    );
    // Actions expressions share JavaScript's `&&`/`||` short-circuit and falsy ''.
    const evaluate = (eventName: string): unknown =>
      new Function('github', 'runner', 'format', `return (${expression});`)(
        { event_name: eventName },
        { os: 'Linux' },
        (template: string, value: string) => template.replace('{0}', value),
      );
    expect(evaluate('push')).toBe('');
    for (const eventName of ['pull_request', 'merge_group', 'workflow_dispatch']) {
      expect(evaluate(eventName)).toBe('Linux-bun-');
    }
  });

  it('scans all available repository history without installing project packages', () => {
    const steps = workflow.jobs['secrets']?.steps ?? [];
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(steps.some((step) => step.run?.includes('git --redact'))).toBe(true);
    expect(steps.some((step) => step.run?.includes('bun install'))).toBe(false);
  });

  it('pins every external action to an immutable commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });

  it('keeps the required quality check red for failed, skipped, or cancelled checks', () => {
    const gate = workflow.jobs['quality'];
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is literal YAML.
    expect(gate?.if).toBe('${{ always() }}');
    expect(gate?.needs).toEqual(['code', 'dependency-audit', 'secrets']);
    const script = gate?.steps.find((step) => step.run?.includes('CODE_RESULT'))?.run;
    expect(script).toBeDefined();
    if (!script) throw new Error('Missing quality gate script');
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      for (const check of ['CODE_RESULT', 'AUDIT_RESULT', 'SECRETS_RESULT']) {
        const outcome = spawnSync('bash', ['-e', '-c', script], {
          env: {
            PATH: process.env['PATH'],
            CODE_RESULT: 'success',
            AUDIT_RESULT: 'success',
            SECRETS_RESULT: 'success',
            [check]: result,
          },
          encoding: 'utf8',
          timeout: 1000,
        });
        expect(outcome.error).toBeUndefined();
        expect(outcome.status).toBe(result === 'success' ? 0 : 1);
      }
    }
  });
});
