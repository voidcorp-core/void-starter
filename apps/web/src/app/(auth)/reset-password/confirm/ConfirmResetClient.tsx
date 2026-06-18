'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { authClient } from '@repo/auth/client';
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
} from '@repo/ui';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const confirmResetSchema = z
  .object({
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ConfirmResetValues = z.infer<typeof confirmResetSchema>;

export function ConfirmResetClient({ token }: { token: string }) {
  const router = useRouter();
  const form = useForm<ConfirmResetValues>({
    resolver: zodResolver(confirmResetSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ConfirmResetValues) {
    const { error } = await authClient.resetPassword({ newPassword: values.newPassword, token });
    if (error) {
      toast.error(error.message ?? 'Reset failed. Request a new link.');
      return;
    }
    toast.success('Password updated. You can sign in now.');
    router.push('/sign-in');
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
                {form.formState.isSubmitting ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
