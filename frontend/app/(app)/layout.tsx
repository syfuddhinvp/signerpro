/**
 * The authenticated application layout: rail + sidebar + header chrome around
 * every in-app route, plus the globally mounted modal and product-tour hosts.
 *
 * Server component on purpose — the session guard has to run before any screen
 * renders, so an unauthenticated request never ships app markup. The identity
 * is handed to the client tree as data only; the token stays in its httpOnly
 * cookie and is never serialised into the page.
 */
import { requireSession } from '@/lib/auth/session';
import { SessionProvider, type ClientSession } from '@/components/sf/SessionProvider';
import Shell from '@/components/sf/Shell';
import Modals from '@/components/sf/Modals';
import Tour from '@/components/sf/Tour';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  const clientSession: ClientSession = {
    userId: session.userId,
    name: session.name,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    organizationName: (session as { organizationName?: string }).organizationName ?? '',
    isPlatformAdmin: session.isPlatformAdmin,
  };

  return (
    <SessionProvider session={clientSession}>
      <Shell>{children}</Shell>
      <Modals />
      <Tour />
    </SessionProvider>
  );
}
