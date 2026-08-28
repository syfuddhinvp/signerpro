/**
 * Entry point. Navigation is the URL now, so `/` only decides which workspace
 * root the visitor belongs in — there is no client-side screen switchboard.
 */
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? '/overview' : '/login');
}
