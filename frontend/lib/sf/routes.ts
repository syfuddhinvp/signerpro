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

const BY_PATH: Record<string, ScreenKey> = (() => {
  const m: Record<string, ScreenKey> = {};
  (Object.keys(SCREEN_PATH) as ScreenKey[]).forEach((k) => { m[SCREEN_PATH[k]] = k; });
  (Object.keys(PLATFORM_ALIAS) as ScreenKey[]).forEach((k) => { m[PLATFORM_ALIAS[k] as string] = k; });
  return m;
})();

/** Longest-prefix match, so nested routes still resolve to their screen. */
export function screenForPath(pathname: string): ScreenKey {
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
