'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ScreenKey, type Workspace, pathFor, screenForPath, workspaceForPath, SCREEN_RAIL,
} from './routes';

/**
 * Navigation for the app shell. Screens call `go('builder')` instead of
 * writing a `screen` key into client state, so the URL stays authoritative
 * and every view is deep-linkable, refreshable and shareable.
 */
export function useNav() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const workspace = workspaceForPath(pathname);
  const screen = screenForPath(pathname);

  const go = useCallback(
    (target: ScreenKey, opts?: { workspace?: Workspace; replace?: boolean }) => {
      const ws = opts?.workspace ?? workspace;
      const href = pathFor(target, ws);
      if (opts?.replace) router.replace(href);
      else router.push(href);
    },
    [router, workspace],
  );

  const switchWorkspace = useCallback(
    (ws: Workspace) => router.push(ws === 'platform' ? pathFor('platformHome', ws) : pathFor('tenantHome', ws)),
    [router],
  );

  return {
    screen,
    workspace,
    isPlat: workspace === 'platform',
    rail: SCREEN_RAIL[screen],
    pathname,
    go,
    switchWorkspace,
    href: (target: ScreenKey, ws: Workspace = workspace) => pathFor(target, ws),
    push: router.push,
    replace: router.replace,
  };
}
