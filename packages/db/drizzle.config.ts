import { required } from '@void/core/env';
import { defineConfig } from 'drizzle-kit';

// `dbCredentials.url` is exposed via a getter so the env read fires at
// command-time (when drizzle-kit actually reaches for the URL) and not at
// config-load time. This keeps the failure mode loud and immediate for
// `drizzle-kit generate`/`migrate` while letting static analyzers (e.g.
// knip's drizzle plugin, which only reads `schema`) load the file without
// `DATABASE_URL` set.
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    get url() {
      return required('DATABASE_URL');
    },
  },
  verbose: true,
  strict: true,
});
