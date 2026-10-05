import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
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
    expect(workflow.jobs['code']?.steps.some((step) => step.run === 'bun run test')).toBe(true);
    expect(
      workflow.jobs['dependency-audit']?.steps.some((step) => step.run === 'bun run audit'),
    ).toBe(true);
    expect(workflow.jobs['e2e']?.needs).toBe('code');
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
    const script = gate?.steps[0]?.run;
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
