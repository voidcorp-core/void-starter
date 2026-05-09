import { requireAuth } from '@void/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@void/ui';
import { UserMenu } from '@/components/UserMenu';

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <UserMenu />
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p>
            <strong>Email:</strong> {user.email}
          </p>
          <p>
            <strong>Name:</strong> {user.name ?? 'Not set'}
          </p>
          <p>
            <strong>Role:</strong> {user.role}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
