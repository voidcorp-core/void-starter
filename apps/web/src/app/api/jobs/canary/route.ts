import { getCurrentUser } from '@repo/auth';
import { logger } from '@repo/core/logger';
import { jobReferenceSchema } from '@repo/jobs-vercel-workflow/types';
import { getRun, start } from 'workflow/api';
import { z } from 'zod';
import { runCanaryJob } from '@/workflows/canary-job.workflow';

/**
 * Durable-jobs trigger and status endpoint.
 *
 * A route handler rather than a Server Action because the caller is a machine:
 * the live canary starts a run over HTTP and then polls it. Server Actions stay
 * the rule for UI-driven mutations (see docs/PATTERNS.md).
 *
 * Both verbs require a session. The Workflow handlers themselves are never
 * publicly reachable -- the SDK registers each one so that only Vercel Queue can
 * deliver to it -- but this endpoint is, so it is a real trust boundary:
 * authenticate first, then validate, then start work. Rate limiting belongs to
 * the opt-in `_modules/rate-limit-upstash` module; the in-memory limiter in
 * `@repo/core` is per-invocation and would not hold across serverless instances.
 */

const startJobSchema = z.strictObject({ reference: jobReferenceSchema });

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const parsed = startJobSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid job payload', issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  const run = await start(runCanaryJob, [parsed.data.reference]);

  logger.info({ runId: run.runId, userId: user.id }, 'durable job: run started');

  return Response.json({ runId: run.runId }, { status: 202 });
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const runId = new URL(request.url).searchParams.get('runId');
  if (!runId) {
    return Response.json({ error: 'A runId query parameter is required' }, { status: 400 });
  }

  const run = getRun(runId);
  if (!(await run.exists)) {
    return Response.json({ error: 'Workflow run not found' }, { status: 404 });
  }

  const status = await run.status;
  // `returnValue` only resolves once the run completed; an unfinished run
  // reports its status alone rather than blocking the request.
  const result = status === 'completed' ? await run.returnValue : undefined;

  return Response.json(result === undefined ? { runId, status } : { runId, status, result });
}
