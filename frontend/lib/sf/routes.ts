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
  | 'platformHome' | 'platform' | 'revenue'
  | 'account';

export type AreaKey =
  | 'home' | 'documents' | 'contacts' | 'reports' | 'developer' | 'support'
  | 'platform' | 'platformRevenue' | 'account';

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
  billing: '/account/billing',
  invoices: '/account/invoices',
  api: '/developer/api',
  sandbox: '/developer/sandbox',
  guides: '/developer/guides',
  logs: '/developer/logs',
  support: '/support',
  platformHome: '/platform',
  platform: '/platform/tenants',
  revenue: '/platform/revenue',
  /* The account area's landing section. Its other sections are `/account/<id>`
     and resolve to this screen key — see `screenForPath`. */
  account: '/account/profile',
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
  /* Exact table hits first: `/account/billing` and `/account/invoices` are
     account sections that are their own screens, so the catch-all below must
     not swallow them. */
  if (BY_PATH[pathname]) return BY_PATH[pathname];
  /* Every other `/account/<section>` is the one account screen. Prefix
     matching cannot do this on its own: the table's entry is
     `/account/profile`, which is not a prefix of `/account/teams`. */
  if (pathname === '/account' || pathname.startsWith('/account/')) return 'account';
  const hit = Object.keys(BY_PATH)
    .filter((p) => pathname === p || pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return (hit ? BY_PATH[hit] : 'tenantHome');
}

export function workspaceForPath(pathname: string): Workspace {
  return pathname === '/platform' || pathname.startsWith('/platform/') ? 'platform' : 'tenant';
}

/**
 * Which sidebar area owns each screen, per workspace.
 *
 * Two maps, not one, because five screens are shared: `invoices`, `support`,
 * `logs`, `api` and `reports` exist in both workspaces and belong to a
 * different area in each. The single map this replaced filed the platform
 * copies under `platform`, which is why Revenue, Invoices, Support and Logs
 * were each reachable from two areas with both highlighted.
 */
const TENANT_AREA: Record<ScreenKey, AreaKey> = {
  tenantHome: 'home',
  dashboard: 'documents', builder: 'documents', routing: 'documents', sign: 'documents', audit: 'documents',
  contacts: 'contacts', reports: 'reports',
  /* Billing and invoices are account sections — see ACCOUNT_SECTIONS. */
  billing: 'account', invoices: 'account',
  api: 'developer', logs: 'developer', sandbox: 'developer', guides: 'developer',
  support: 'support',
  account: 'account',
  /* Not reachable in the tenant workspace; mapped so the record is total. */
  platformHome: 'platform', platform: 'platform', revenue: 'platformRevenue',
};

const PLATFORM_AREA: Record<ScreenKey, AreaKey> = {
  platformHome: 'home', platform: 'platform',
  revenue: 'platformRevenue', invoices: 'platformRevenue', billing: 'platformRevenue',
  reports: 'reports', support: 'support',
  api: 'developer', logs: 'developer', sandbox: 'developer', guides: 'developer',
  account: 'account',
  /* Tenant-only screens, mapped so the record is total. */
  tenantHome: 'home', dashboard: 'documents', builder: 'documents', routing: 'documents',
  sign: 'documents', audit: 'documents', contacts: 'contacts',
};

export function areaForScreen(screen: ScreenKey, workspace: Workspace): AreaKey {
  return workspace === 'platform' ? PLATFORM_AREA[screen] : TENANT_AREA[screen];
}

/* ────────────────────────────────────────────────────────────────────────────
   In-screen sections.

   Reports, the developer API screen and the platform console each hold several
   sub-views. They used to be held in client state and driven from two places
   at once — a sidebar group *and* an in-screen tab strip bound to the same
   key — so the two could disagree and neither was linkable. They are a query
   parameter now: one control, one source of truth, shareable.
   ──────────────────────────────────────────────────────────────────────────── */

export const SECTION_PARAM = 'section';

export const SCREEN_SECTIONS: Partial<Record<ScreenKey, readonly [string, string][]>> = {
  reports: [
    ['analytics', 'My analytics'], ['all', 'All reports'], ['documents', 'By document'],
    ['templates', 'By template'], ['recipients', 'By recipient'], ['custom', 'Custom report'],
  ],
  api: [
    ['overview', 'Overview'], ['endpoints', 'Endpoints & keys'],
    ['webhooks', 'Webhooks'], ['usage', 'Plan usage'], ['resources', 'Developer tools'],
  ],
  platform: [
    ['tenants', 'Tenants'], ['users', 'Users & roles'], ['flags', 'Feature flags'],
    ['billing', 'Plans & usage'], ['security', 'Security & compliance'],
  ],
};

/** The section a screen lands on when the URL names none. */
export function defaultSection(screen: ScreenKey): string {
  const sections = SCREEN_SECTIONS[screen];
  return sections && sections.length ? sections[0][0] : '';
}

/** A raw `?section=` value narrowed to one the screen actually has. */
export function sectionFor(screen: ScreenKey, raw: string | null | undefined): string {
  const sections = SCREEN_SECTIONS[screen];
  if (!sections) return '';
  const hit = sections.find(([id]) => id === (raw || '').trim());
  return hit ? hit[0] : defaultSection(screen);
}

/** Path for one section of a screen. The default section carries no param. */
export function sectionPath(screen: ScreenKey, workspace: Workspace, section: string): string {
  const base = pathFor(screen, workspace);
  if (!section || section === defaultSection(screen)) return base;
  return base + '?' + SECTION_PARAM + '=' + encodeURIComponent(section);
}

/** `/account/teams` → `teams`; the landing section for anything else. */
export function accountSectionForPath(pathname: string): string {
  const hit = /^\/account\/([^/]+)/.exec(pathname);
  const section = hit ? hit[1] : '';
  return (ACCOUNT_SECTIONS as readonly string[]).indexOf(section) > -1 ? section : 'profile';
}

export const ACCOUNT_SECTIONS = [
  'profile', 'billing', 'invoices', 'security',
  'notifications', 'email', 'integrations', 'cloud', 'teams', 'orgs', 'audit',
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

/**
 * The sections `AccountArea` itself renders. Billing and invoices are account
 * sections in the sidebar and in the URL, but they are full screens of their
 * own with their own server pages at `/account/billing` and
 * `/account/invoices`, so the `[section]` route must not claim them.
 */
export const ACCOUNT_AREA_SECTIONS = ACCOUNT_SECTIONS
  .filter((s) => s !== 'billing' && s !== 'invoices');
export type AccountAreaSection = Exclude<AccountSection, 'billing' | 'invoices'>;

export const AUTH_PATHS = {
  signin: '/login',
  signup: '/register',
  mfa: '/login/verify',
  forgot: '/login/forgot',
} as const;
