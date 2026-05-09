import { getCurrentUser } from '@void/auth';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@void/ui';
import Link from 'next/link';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Void Factory App</h1>
        <p className="text-muted-foreground">Production-grade Next.js 16 starter.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{user ? `Welcome back, ${user.email}` : 'Get started'}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
