import { createEnv } from '@t3-oss/env-nextjs';
import type { ZodType } from 'zod';

type EnvShape<
  TServer extends Record<string, ZodType>,
  TClient extends Record<`NEXT_PUBLIC_${string}`, ZodType>,
> = {
  server: TServer;
  client: TClient;
  runtimeEnv: Record<string, string | undefined>;
};

export function createAppEnv<
  TServer extends Record<string, ZodType>,
  TClient extends Record<`NEXT_PUBLIC_${string}`, ZodType>,
>({ server, client, runtimeEnv }: EnvShape<TServer, TClient>) {
  return createEnv({
    server,
    client,
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: process.env['SKIP_ENV_VALIDATION'] === 'true',
  });
}
