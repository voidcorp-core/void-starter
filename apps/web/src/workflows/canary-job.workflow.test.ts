import { beforeEach, describe, expect, it, vi } from 'vitest';

// The `use workflow` / `use step` directives are inert under vitest (no Workflow
// compiler), so the orchestration runs as plain functions and the contract the
// workflow enforces stays unit-testable without a running server. Suspension and
// replay themselves belong to the live canary, not to this suite.
const mockSleep = vi.fn();
// The class is declared inside the factory: `vi.mock` is hoisted above the
// module body, so a top-level class would still be in its temporal dead zone.
vi.mock('workflow', () => {
  class FatalError extends Error {}
  return {
    sleep: (duration: string) => mockSleep(duration),
    getStepMetadata: () => ({ stepId: 'step_abc' }),
    getWorkflowMetadata: () => ({ workflowRunId: 'run_123' }),
    FatalError,
  };
});

const mockRecordJobStep = vi.fn();
const mockGetJobExecution = vi.fn();
const mockCountRunExecutions = vi.fn();
vi.mock('@repo/jobs-vercel-workflow', () => ({
  recordJobStep: (input: unknown) => mockRecordJobStep(input),
  getJobExecution: (key: string) => mockGetJobExecution(key),
  countRunExecutions: (runId: string) => mockCountRunExecutions(runId),
}));

vi.mock('@repo/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FatalError } from 'workflow';
import { runCanaryJob } from './canary-job.workflow';

const reference = 'canary-0001';

const ledgerRow = {
  id: 'je1',
  runId: 'run_123',
  idempotencyKey: 'step_abc',
  reference,
  attempts: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordJobStep.mockResolvedValue(ledgerRow);
  mockGetJobExecution.mockResolvedValue(ledgerRow);
  mockCountRunExecutions.mockResolvedValue(1);
});

describe('runCanaryJob', () => {
  it('records the step under the stable step id and reports the run', async () => {
    const result = await runCanaryJob(reference);

    expect(mockRecordJobStep).toHaveBeenCalledWith({
      runId: 'run_123',
      idempotencyKey: 'step_abc',
      reference,
    });
    expect(result).toEqual({
      reference,
      runId: 'run_123',
      idempotencyKey: 'step_abc',
      attempts: 1,
      ledgerRows: 1,
      status: 'completed',
    });
  });

  it('suspends between recording and verifying so the run is durable', async () => {
    await runCanaryJob(reference);

    expect(mockSleep).toHaveBeenCalledWith('5s');
  });

  it('surfaces the attempt count when the step was replayed', async () => {
    mockGetJobExecution.mockResolvedValueOnce({ ...ledgerRow, attempts: 4 });

    const result = await runCanaryJob(reference);

    expect(result.attempts).toBe(4);
  });

  it('fails fatally when the recorded ledger entry disappeared', async () => {
    mockGetJobExecution.mockResolvedValueOnce(undefined);

    await expect(runCanaryJob(reference)).rejects.toBeInstanceOf(FatalError);
  });

  it('fails fatally when the ledger entry belongs to another reference', async () => {
    mockGetJobExecution.mockResolvedValueOnce({ ...ledgerRow, reference: 'canary-9999' });

    await expect(runCanaryJob(reference)).rejects.toThrow(/does not match/i);
  });

  // A second row for the same run is exactly what a broken idempotency key
  // would produce, so the workflow must refuse to report success.
  it('fails fatally when a replay duplicated the ledger row', async () => {
    mockCountRunExecutions.mockResolvedValueOnce(2);

    await expect(runCanaryJob(reference)).rejects.toThrow(/expected exactly 1/i);
  });

  it('does not retry a broken invariant', async () => {
    mockCountRunExecutions.mockResolvedValueOnce(0);

    await expect(runCanaryJob(reference)).rejects.toBeInstanceOf(FatalError);
  });
});
