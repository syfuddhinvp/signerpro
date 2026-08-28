/**
 * Platform workspace guard. `middleware.ts` already bounces non-platform
 * sessions, but the check is repeated here so the guarantee holds even for
 * requests that bypass middleware (RSC payload fetches, direct server renders).
 */
import { requirePlatformSession } from '@/lib/auth/session';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformSession();
  return <>{children}</>;
}
