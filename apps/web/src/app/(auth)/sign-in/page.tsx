'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { authClient } from '@void/auth';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@void/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const signInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const router = useRouter();
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInValues) {
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      callbackURL: '/dashboard',
    });
    if (error) {
      toast.error(error.message ?? 'Sign in failed');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </Form>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() =>
              authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })
            }
          >
            Continue with Google
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            No account?{' '}
            <Link href="/sign-up" className="underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
