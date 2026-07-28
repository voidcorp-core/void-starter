import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCurrentUser = vi.fn();
vi.mock('@repo/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const mockStart = vi.fn();
const mockGetRun = vi.fn();
vi.mock('workflow/api', () => ({
  start: (workflow: unknown, args: unknown[]) => mockStart(workflow, args),
  getRun: (runId: string) => mockGetRun(runId),
}));

vi.mock('@/workflows/canary-job.workflow', () => ({
  runCanaryJob: 'run-canary-job-fn',
}));

vi.mock('@repo/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET, POST } from './route';

const user = { id: 'u1', email: 'user@example.com', role: 'user' };

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/jobs/canary', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue(user);
  mockStart.mockResolvedValue({ runId: 'run_123' });
});

describe('POST /api/jobs/canary', () => {
  it('starts the workflow and returns its run id', async () => {
    const response = await POST(postRequest({ reference: 'canary-0001' }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ runId: 'run_123' });
    expect(mockStart).toHaveBeenCalledWith('run-canary-job-fn', ['canary-0001']);
  });

  it('refuses an anonymous caller before starting anything', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ reference: 'canary-0001' }));

    expect(response.status).toBe(401);
    expect(mockStart).not.toHaveBeenCalled();
  });

  // The payload contract is the data-residency boundary: run data leaves the EU,
  // so a reference carrying personal data must be rejected at the trust boundary.
  it('rejects a reference that carries personal data', async () => {
    const response = await POST(postRequest({ reference: 'user@example.com' }));

    expect(response.status).toBe(400);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const response = await POST(postRequest({ notAReference: 1 }));

    expect(response.status).toBe(400);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('rejects a body that is not valid JSON', async () => {
    const request = new Request('https://example.com/api/jobs/canary', {
      method: 'POST',
      body: 'not-json',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('GET /api/jobs/canary', () => {
  function getRequest(query: string): Request {
    return new Request(`https://example.com/api/jobs/canary${query}`);
  }

  it('reports the status of an existing run', async () => {
    mockGetRun.mockReturnValueOnce({
      exists: Promise.resolve(true),
      status: Promise.resolve('completed'),
      returnValue: Promise.resolve({ attempts: 1, ledgerRows: 1 }),
    });

    const response = await GET(getRequest('?runId=run_123'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runId: 'run_123',
      status: 'completed',
      result: { attempts: 1, ledgerRows: 1 },
    });
  });

  it('omits the result while the run is still going', async () => {
    mockGetRun.mockReturnValueOnce({
      exists: Promise.resolve(true),
      status: Promise.resolve('running'),
      returnValue: Promise.resolve(undefined),
    });

    const response = await GET(getRequest('?runId=run_123'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runId: 'run_123', status: 'running' });
  });

  it('returns 404 for an unknown run', async () => {
    mockGetRun.mockReturnValueOnce({ exists: Promise.resolve(false) });

    const response = await GET(getRequest('?runId=run_missing'));

    expect(response.status).toBe(404);
  });

  it('requires a run id', async () => {
    const response = await GET(getRequest(''));

    expect(response.status).toBe(400);
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await GET(getRequest('?runId=run_123'));

    expect(response.status).toBe(401);
    expect(mockGetRun).not.toHaveBeenCalled();
  });
});
