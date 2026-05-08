import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './index';
import { users } from './users';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('users schema integration', () => {
  let queryClient: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    queryClient = postgres(databaseUrl as string, { max: 1 });
    db = drizzle(queryClient, { schema });
  });

  afterAll(async () => {
    await queryClient.end();
  });

  it('inserts and retrieves a user with default role', async () => {
    const id = randomUUID();
    const email = `test-${Date.now()}@example.com`;
    const [inserted] = await db.insert(users).values({ id, email }).returning();
    expect(inserted?.role).toBe('user');
    expect(inserted?.emailVerified).toBe(false);
    expect(inserted?.deletedAt).toBeNull();

    if (inserted) {
      const [found] = await db.select().from(users).where(eq(users.id, inserted.id));
      expect(found?.email).toBe(email);
      await db.delete(users).where(eq(users.id, inserted.id));
    }
  });

  it('enforces email uniqueness', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const [first] = await db.insert(users).values({ id: randomUUID(), email }).returning();
    await expect(db.insert(users).values({ id: randomUUID(), email })).rejects.toThrow();
    if (first) {
      await db.delete(users).where(eq(users.id, first.id));
    }
  });
});
