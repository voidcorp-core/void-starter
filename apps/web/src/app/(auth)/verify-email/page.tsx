import { Button, Card, CardContent, CardHeader, CardTitle } from '@void/ui';
import Link from 'next/link';
import { VerifyEmailClient } from './VerifyEmailClient';

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string; callbackURL?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="mx-auto max-w-sm px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Invalid link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The verification link is missing a token. Please check your email and try again.
            </p>
            <Button asChild className="w-full">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <VerifyEmailClient token={token} />;
}
