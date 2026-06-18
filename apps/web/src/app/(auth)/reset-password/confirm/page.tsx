import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import Link from 'next/link';
import { connection } from 'next/server';
import { ConfirmResetClient } from './ConfirmResetClient';

interface ConfirmResetPageProps {
  // Better-Auth redirects the email link here with `?token=VALID_TOKEN`, or
  // `?error=INVALID_TOKEN` when the token is missing/expired.
  searchParams: Promise<{ token?: string; error?: string }>;
}

export default async function ConfirmResetPage({ searchParams }: ConfirmResetPageProps) {
  // `connection()` opts this page out of static prerendering in Next 16
  // cacheComponents mode -- `searchParams` is request-bound data.
  await connection();
  const { token, error } = await searchParams;

  if (!token || error) {
    return (
      <main className="mx-auto max-w-sm px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Invalid or expired link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This password reset link is no longer valid. Request a new one to continue.
            </p>
            <Button asChild className="w-full">
              <Link href="/reset-password">Request a new link</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <ConfirmResetClient token={token} />;
}
