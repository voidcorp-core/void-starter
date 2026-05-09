'use server';

import { signOut } from '@void/auth';
import { redirect } from 'next/navigation';

export async function signOutAction() {
  await signOut();
  redirect('/');
}
