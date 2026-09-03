import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('./generate.cli.ts', import.meta.url));

describe('generate CLI', () => {
  it('documents the manifest, non-secret provisioning context, and target contract', () => {
    const result = spawnSync('bun', [cliPath, '--help'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      '<manifest.yaml|manifest.json> <provisioning-context.yaml|json> <new-target-directory>',
    );
  });
});
