import { describe, expect, it, vi } from 'vitest';

// `server-only` throws outside a server bundle (vitest); neutralize it.
vi.mock('server-only', () => ({}));

const mockRecordJobExecution = vi.fn();
const mockFindJobExecutionByIdempotencyKey = vi.fn();
vi.mock('./jobs.repository', () => ({
  recordJobExecution: (input: unknown) => mockRecordJobExecution(input),
  findJobExecutionByIdempotencyKey: (key: string) => mockFindJobExecutionByIdempotencyKey(key),
  countJobExecutionsByRun: vi.fn(),
}));

import { getJobExecution, recordJobStep } from './jobs.service';

const row = {
  id: 'je1',
  runId: 'run_123',
  idempotencyKey: 'step_abc',
  reference: 'canary-0001',
  attempts: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validInput = {
  runId: 'run_123',
  idempotencyKey: 'step_abc',
  reference: 'canary-0001',
};

describe('recordJobStep', () => {
  it('records an opaque reference through the repository', async () => {
    mockRecordJobExecution.mockResolvedValueOnce(row);

    const result = await recordJobStep(validInput);

    expect(result).toEqual(row);
    expect(mockRecordJobExecution).toHaveBeenCalledWith(validInput);
  });

  it('reports the attempt count so a replayed step stays observable', async () => {
    mockRecordJobExecution.mockResolvedValueOnce({ ...row, attempts: 3 });

    const result = await recordJobStep(validInput);

    expect(result.attempts).toBe(3);
  });

  // The payload contract is the data-residency boundary: run data leaves the EU,
  // so a reference that looks like personal data must never reach the workflow.
  it.each([
    ['an email address', 'user@example.com'],
    ['a human name', 'Marie Dupont'],
    ['a postal address', '12 rue de la Paix, Paris'],
    ['free text', 'reset the password of this account'],
  ])('rejects %s as a job reference', async (_label, reference) => {
    await expect(recordJobStep({ ...validInput, reference })).rejects.toThrow(/opaque|reference/i);
    expect(mockRecordJobExecution).not.toHaveBeenCalledWith(expect.objectContaining({ reference }));
  });

  it('rejects a reference too short to be a real opaque identifier', async () => {
    await expect(recordJobStep({ ...validInput, reference: 'abc' })).rejects.toThrow(/short/i);
  });

  it('rejects unknown payload fields so smuggled data cannot ride along', async () => {
    await expect(
      recordJobStep({ ...validInput, email: 'user@example.com' } as never),
    ).rejects.toThrow(/unrecognized/i);
  });
});

describe('getJobExecution', () => {
  it('returns the ledger row for a known idempotency key', async () => {
    mockFindJobExecutionByIdempotencyKey.mockResolvedValueOnce(row);

    await expect(getJobExecution('step_abc')).resolves.toEqual(row);
    expect(mockFindJobExecutionByIdempotencyKey).toHaveBeenCalledWith('step_abc');
  });

  it('returns undefined when the step never ran', async () => {
    mockFindJobExecutionByIdempotencyKey.mockResolvedValueOnce(undefined);

    await expect(getJobExecution('step_missing')).resolves.toBeUndefined();
  });
});
