/**
 * Canonical route table. This is the single source of truth that ties the
 * design's screen keys to real URLs, so navigation is the URL — never a
 * `screen` value held in a client store.
 */

export type Workspace = 'tenant' | 'platform';

export type ScreenKey =
  | 'tenantHome' | 'dashboard' | 'builder' | 'routing' | 'sign' | 'audit'
  | 'contacts' | 'reports' | 'billing' | 'invoices'
  | 'api' | 'sandbox' | 'guides' | 'logs' | 'support'
  | 'platformHome' | 'platform' | 'revenue';

export type RailKey = 'documents' | 'contacts' | 'reports' | 'billing' | 'developer' | 'support' | 'platform';

/** Path for each screen key. Tenant screens live at the root; platform screens under /platform. */
export const SCREEN_PATH: Record<ScreenKey, string> = {
  tenantHome: '/overview',
  dashboard: '/documents',
  builder: '/documents/prepare',
  routing: '/documents/workflow',
  sign: '/documents/signer-view',
  audit: '/documents/audit',
  contacts: '/contacts',
  reports: '/reports',
  billing: '/billing',
  invoices: '/billing/invoices',
  api: '/developer/api',
  sandbox: '/developer/sandbox',
  guides: '/developer/guides',
  logs: '/developer/logs',
  support: '/support',
  platformHome: '/platform',
  platform: '/platform/tenants',
  revenue: '/platform/revenue',
};

/** Platform workspace serves some shared screens from its own subtree. */
export const PLATFORM_ALIAS: Partial<Record<ScreenKey, string>> = {
  invoices: '/platform/invoices',
  support: '/platform/support',
  logs: '/platform/logs',
  api: '/platform/developer',
  reports: '/platform/reports',
};

export function pathFor(screen: ScreenKey, workspace: Workspace = 'tenant'): string {
  if (workspace === 'platform' && PLATFORM_ALIAS[screen]) return PLATFORM_ALIAS[screen] as string;
  return SCREEN_PATH[screen];
}

/* ────────────────────────────────────────────────────────────────────────────
   Document-scoped screens.

   Prepare, workflow, signer view and audit are all about *one* envelope, so
   the document id belongs in the path: `/documents/<id>/prepare`. The flat
   paths in SCREEN_PATH above stay as entry points — they resolve the newest
   relevant document server-side and redirect to the parameterised URL — which
   is what keeps `ScreenKey` usable for the rail and sidebar.
   ──────────────────────────────────────────────────────────────────────────── */

export const DOCUMENT_SCREENS = ['builder', 'routing', 'sign', 'audit'] as const;
export type DocumentScreenKey = (typeof DOCUMENT_SCREENS)[number];

/** The trailing segment each document screen owns under `/documents/<id>/`. */
export const DOCUMENT_SEGMENT: Record<DocumentScreenKey, string> = {
  builder: 'prepare',
  routing: 'workflow',
  sign: 'signer-view',
  audit: 'audit',
};

const SCREEN_BY_SEGMENT: Record<string, DocumentScreenKey> = (() => {
  const m: Record<string, DocumentScreenKey> = {};
  DOCUMENT_SCREENS.forEach((k) => { m[DOCUMENT_SEGMENT[k]] = k; });
  return m;
})();

export function isDocumentScreen(screen: ScreenKey): screen is DocumentScreenKey {
  return (DOCUMENT_SCREENS as readonly ScreenKey[]).indexOf(screen) > -1;
}

/**
 * URL for a document screen. With an id it is the parameterised route; without
 * one it falls back to the flat entry point, which resolves a document itself.
 */
export function documentPathFor(screen: DocumentScreenKey, documentId?: string | null): string {
  if (!documentId) return SCREEN_PATH[screen];
  return '/documents/' + encodeURIComponent(documentId) + '/' + DOCUMENT_SEGMENT[screen];
}

const DOCUMENT_ROUTE = /^\/documents\/([^/]+)\/([^/]+)\/?$/;

/** Splits `/documents/<id>/prepare` into its id and screen; null otherwise. */
function parseDocumentPath(pathname: string): { documentId: string; screen: DocumentScreenKey } | null {
  const hit = DOCUMENT_ROUTE.exec(pathname);
  if (!hit) return null;
  const screen = SCREEN_BY_SEGMENT[hit[2]];
  if (!screen) return null;
  return { documentId: decodeURIComponent(hit[1]), screen };
}

/** The document a parameterised route is about, or null on any other route. */
export function documentIdForPath(pathname: string): string | null {
  const parsed = parseDocumentPath(pathname);
  return parsed ? parsed.documentId : null;
}

const BY_PATH: Record<string, ScreenKey> = (() => {
  const m: Record<string, ScreenKey> = {};
  (Object.keys(SCREEN_PATH) as ScreenKey[]).forEach((k) => { m[SCREEN_PATH[k]] = k; });
  (Object.keys(PLATFORM_ALIAS) as ScreenKey[]).forEach((k) => { m[PLATFORM_ALIAS[k] as string] = k; });
  return m;
})();

/** Longest-prefix match, so nested routes still resolve to their screen. */
export function screenForPath(pathname: string): ScreenKey {
  const parsed = parseDocumentPath(pathname);
  if (parsed) return parsed.screen;
  if (BY_PATH[pathname]) return BY_PATH[pathname];
  const hit = Object.keys(BY_PATH)
    .filter((p) => pathname === p || pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return (hit ? BY_PATH[hit] : 'tenantHome');
}

export function workspaceForPath(pathname: string): Workspace {
  return pathname === '/platform' || pathname.startsWith('/platform/') ? 'platform' : 'tenant';
}

/** Which rail section owns each screen (drives the dark icon rail's active state). */
export const SCREEN_RAIL: Record<ScreenKey, RailKey> = {
  tenantHome: 'documents', dashboard: 'documents', builder: 'documents',
  routing: 'documents', sign: 'documents', audit: 'documents',
  contacts: 'contacts', reports: 'reports', billing: 'billing', invoices: 'billing',
  api: 'developer', logs: 'developer', sandbox: 'developer', guides: 'developer',
  support: 'support', platformHome: 'platform', platform: 'platform', revenue: 'platform',
};

export const ACCOUNT_SECTIONS = [
  'profile', 'subscription', 'security', 'payment', 'notifications',
  'email', 'integrations', 'cloud', 'teams', 'orgs', 'audit',
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const AUTH_PATHS = {
  signin: '/login',
  signup: '/register',
  mfa: '/login/verify',
  forgot: '/login/forgot',
} as const;
