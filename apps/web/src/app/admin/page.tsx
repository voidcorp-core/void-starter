import { requireRole } from '@void/auth';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@void/ui';
import { isNull } from 'drizzle-orm';

export default async function AdminPage() {
  await requireRole('admin');
  const db = getDb();
  const allUsers = await db.select().from(users).where(isNull(users.deletedAt)).limit(50);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-semibold">Admin</h1>
      <Card>
        <CardHeader>
          <CardTitle>Users ({allUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map((u) => (
                <tr key={u.id} className="border-b border-border">
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2 text-muted-foreground">{u.createdAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
