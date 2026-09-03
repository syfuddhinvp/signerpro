'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ScreenKey, type Workspace, pathFor, screenForPath, workspaceForPath, areaForScreen,
  documentIdForPath, documentPathFor, isDocumentScreen,
} from './routes';

export type NavOptions = {
  workspace?: Workspace;
  replace?: boolean;
  /**
   * The envelope the target screen is about. Only the document screens
   * (`builder`, `routing`, `sign`, `audit`) read it; it becomes a path segment,
   * never a query param. Omitted, the document already in the URL is carried
   * over, so moving between the four screens stays on one envelope. Pass
   * `null` to deliberately drop it and land on the flat entry point.
   */
  documentId?: string | null;
};

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
  /** The envelope the current route is about, when it is a document route. */
  const documentId = documentIdForPath(pathname);

  const hrefFor = useCallback(
    (target: ScreenKey, ws: Workspace, docId: string | null | undefined) => {
      if (isDocumentScreen(target) && ws !== 'platform') {
        return documentPathFor(target, docId === undefined ? documentId : docId);
      }
      return pathFor(target, ws);
    },
    [documentId],
  );

  const go = useCallback(
    (target: ScreenKey, opts?: NavOptions) => {
      const ws = opts?.workspace ?? workspace;
      const href = hrefFor(target, ws, opts ? opts.documentId : undefined);
      if (opts?.replace) router.replace(href);
      else router.push(href);
    },
    [router, workspace, hrefFor],
  );

  const switchWorkspace = useCallback(
    (ws: Workspace) => router.push(ws === 'platform' ? pathFor('platformHome', ws) : pathFor('tenantHome', ws)),
    [router],
  );

  return {
    screen,
    documentId,
    workspace,
    isPlat: workspace === 'platform',
    area: areaForScreen(screen, workspace),
    pathname,
    go,
    switchWorkspace,
    href: (target: ScreenKey, ws: Workspace = workspace, docId?: string | null) => hrefFor(target, ws, docId),
    push: router.push,
    replace: router.replace,
  };
}
