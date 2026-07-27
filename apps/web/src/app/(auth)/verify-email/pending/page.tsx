import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import Link from 'next/link';

export default function VerificationPendingPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We sent you a verification link. Open it to activate your account, then sign in.
          </p>
          <Button asChild className="w-full">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
