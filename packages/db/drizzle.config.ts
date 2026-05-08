import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads this config at command-time; the check is deferred to
// the URL field (drizzle-kit fails clearly if the URL is empty) so that
// static loaders such as knip can parse this file without DATABASE_URL set.
const databaseUrl = process.env['DATABASE_URL'] ?? '';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
});
