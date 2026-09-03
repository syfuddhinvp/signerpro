/**
 * The app's information architecture, as data.
 *
 * `Shell` used to build the rail and four different sidebars inline, each with
 * its own click handler, and the groups below the first one were `<button>`s
 * that mutated client state rather than links. Two of those four (the library
 * tree and the reports list) never navigated at all, so clicking them from any
 * other screen was a dead click that silently changed hidden state.
 *
 * The rule here is: **every sidebar row is a URL.** Rows that select a filter
 * or a sub-view carry it as a query parameter, so each one is linkable,
 * refreshable and back-button-able, and there is exactly one control per
 * destination. This module is pure — it takes the counts and the current
 * location and returns the model to render — which is what makes the IA
 * testable without mounting the shell.
 */
import {
  type ScreenKey, type Workspace, type AreaKey,
  SCREEN_SECTIONS, pathFor, sectionPath, documentPathFor,
} from './routes';
import { ACCOUNT_NAV } from './data';
import { BORDER_STRONG } from './ui';

export type AreaItem = {
  key: AreaKey;
  label: string;
  icon: string;
  /** The screen the area lands on when it is entered. */
  screen: ScreenKey;
  /** Trailing figure — an unread-style count, blank when there is none. */
  count?: string;
};

export type SidebarRow = {
  key: string;
  label: string;
  href: string;
  /** Right-aligned figure. Blank renders nothing — a bare "0" reads worse. */
  count?: string;
  /** Bullet colour for the document views, which are colour-coded. */
  tone?: string;
  active: boolean;
};

export type SidebarGroup = {
  key: string;
  /** Group heading. Empty for the first, unlabelled group. */
  title: string;
  rows: SidebarRow[];
  /** Optional trailing action, e.g. "+ Create team". */
  action?: { label: string; id: string };
};

/* ── the areas ────────────────────────────────────────────────────────────
   Seven tenant areas and six platform ones, each owning a disjoint set of
   screens. Overview is its own area rather than the first row under
   Documents, and in the platform workspace Revenue, Support, Developer and
   Reports are reachable from exactly one place each.

   These used to be a separate dark icon rail beside the sidebar. Two levels
   of chrome for one navigation tree meant the second level's heading only
   made sense if you had noticed which icon was lit; they are the top level of
   a single sidebar now, with the current area's own rows nested under it. */

const TENANT_AREAS: AreaItem[] = [
  { key: 'home', label: 'Home', icon: '⌂', screen: 'tenantHome' },
  { key: 'documents', label: 'Documents', icon: '▤', screen: 'dashboard' },
  { key: 'contacts', label: 'Contacts', icon: '◍', screen: 'contacts' },
  { key: 'reports', label: 'Reports', icon: '▥', screen: 'reports' },
  { key: 'developer', label: 'Developer', icon: '‹›', screen: 'api' },
  { key: 'support', label: 'Support', icon: '☎', screen: 'support' },
  { key: 'account', label: 'My account', icon: '⚙', screen: 'account' },
];

const PLATFORM_AREAS: AreaItem[] = [
  { key: 'home', label: 'Overview', icon: '⌂', screen: 'platformHome' },
  { key: 'platform', label: 'Tenants', icon: '⌘', screen: 'platform' },
  { key: 'platformRevenue', label: 'Revenue', icon: '◈', screen: 'revenue' },
  { key: 'reports', label: 'Reports', icon: '▥', screen: 'reports' },
  { key: 'developer', label: 'Developer', icon: '‹›', screen: 'api' },
  { key: 'support', label: 'Support', icon: '☎', screen: 'support' },
  { key: 'account', label: 'My account', icon: '⚙', screen: 'account' },
];

/** Everything the sidebar needs to know about where the user is and what the
 *  numbers are. All of it is derived from the URL and the layout's fetch. */
export type NavContext = {
  workspace: Workspace;
  area: AreaKey;
  screen: ScreenKey;
  /** Current `?section=`, already narrowed by `sectionFor`. */
  section: string;
  /** Current `?folder=` on the library. */
  folder: string;
  /** The envelope in the path, when the route is document-scoped. */
  documentId: string | null;
  /** The `/account/<section>` the route is about, when it is an account route. */
  accountSection: string;
  /** True when that envelope is sealed — completed, voided, declined, expired.
   *  Its authoring stages redirect to the audit trail, so they are not offered. */
  documentSealed?: boolean;
  counts: {
    quick: Record<string, number> | null;
    folders: Record<string, number> | null;
    invoices: number | null;
    logs: number | null;
    tickets: number | null;
  };
  /** The caller's real folders (`GET /api/folders/tree`), flattened. Personal
   *  ones join the Folders group; team-scoped ones make up Team folders. */
  folders: { id: string; name: string; count: number; scope: string }[];
};

/** Thousands-separated, and blank at zero or unknown. */
export function badge(value: number | null | undefined): string {
  return value === null || value === undefined || value === 0 ? '' : value.toLocaleString('en-US');
}

export function areaItems(ctx: NavContext): AreaItem[] {
  const base = ctx.workspace === 'platform' ? PLATFORM_AREAS : TENANT_AREAS;
  /* Support carries the only area-level badge: it is the one area with no
     rows of its own, so its count has nowhere else to live. */
  return base.map(item =>
    item.key === 'support' ? { ...item, count: badge(ctx.counts.tickets) } : item);
}

/* ── document views ───────────────────────────────────────────────────────
   These were the "Quick access" buttons, then sidebar rows. They are `?folder=`
   links rendered by the library itself now — the screen they filter — so the
   sidebar stays a list of areas and every view is still a shareable URL. */

export const DOCUMENT_VIEWS: [string, string, string][] = [
  ['inbox', 'Waiting for me', '#4f46e5'],
  ['outbox', 'Waiting for others', '#0ea5e9'],
  ['drafts', 'Drafts', BORDER_STRONG],
  ['completed', 'Completed', '#10b981'],
  ['expiring', 'Expiring soon', '#f59e0b'],
  ['favorites', 'Favourites', '#f43f5e'],
  ['shared', 'Shared with me', '#8b5cf6'],
  ['mine', 'Owned by me', '#64748b'],
];

export const DOCUMENT_FOLDERS: [string, string][] = [
  ['documents', 'All documents'], ['templates', 'Templates'],
  ['archive', 'Archive'], ['trash', 'Trash'],
];

/** `/account/<section>` — the account sections are paths, not a parameter. */
export function accountHref(section: string): string {
  return '/account/' + section;
}

/** `/documents?folder=…`; the default folder carries no parameter. */
export function folderHref(folder: string): string {
  const base = pathFor('dashboard', 'tenant');
  return folder === 'documents' ? base : base + '?folder=' + encodeURIComponent(folder);
}

/** The stages of one envelope, in the order they happen. */
const DOCUMENT_STAGES: [ScreenKey, string][] = [
  ['builder', 'Prepare'], ['routing', 'Workflow'], ['sign', 'Signer view'], ['audit', 'Audit trail'],
];

function sectionRows(screen: ScreenKey, ctx: NavContext): SidebarRow[] {
  const sections = SCREEN_SECTIONS[screen] || [];
  return sections.map(([id, label]) => ({
    key: screen + ':' + id,
    label,
    href: sectionPath(screen, ctx.workspace, id),
    active: ctx.screen === screen && ctx.section === id,
  }));
}

function row(key: string, label: string, href: string, active: boolean, count?: string): SidebarRow {
  return { key, label, href, active, count };
}

/**
 * The sidebar for wherever the user is.
 *
 * Areas with a single destination — Home, Contacts, Support — return no
 * groups at all. They used to render a one-row group whose row repeated the
 * rail label above it, which was pure noise; the sidebar keeps its workspace
 * card and quota and stays quiet.
 */
export function sidebarGroups(ctx: NavContext): SidebarGroup[] {
  const { area, workspace, screen, counts } = ctx;

  if (area === 'documents') {
    /* The library's own views, folders and team folders used to hang here as
       twenty-odd rows — a second, taller copy of the filters the library
       already renders. They live on the documents index now (`Library`), where
       the counts sit beside the rows they filter. The sidebar keeps only what
       the index cannot show: where you are inside the envelope you have open. */
    if (!ctx.documentId) return [];
    return [{
      key: 'envelope',
      /* Not the document's own name: the title is already the header of every
         screen this group links to, and a long or machine-generated one (a
         hashed export name, a template id) wrapped over three lines of the
         rail and pushed the stages out of view. The group only has to say
         which envelope these rows belong to. */
      title: 'This envelope',
      rows: (ctx.documentSealed
        ? DOCUMENT_STAGES.filter(([stage]) => stage === 'audit')
        : DOCUMENT_STAGES
      ).map(([stage, label]) => ({
        key: 'stage:' + stage, label,
        href: documentPathFor(stage as 'builder', ctx.documentId),
        active: screen === stage,
      })),
    }];
  }

  if (area === 'reports') {
    return [{ key: 'dashboards', title: 'Dashboards', rows: sectionRows('reports', ctx) }];
  }

  if (area === 'platformRevenue') {
    return [{
      key: 'revenue', title: 'Revenue',
      rows: [
        row('revenue', 'Revenue & payouts', pathFor('revenue', workspace), screen === 'revenue'),
        row('invoices', 'Invoices · all tenants', pathFor('invoices', workspace), screen === 'invoices', badge(counts.invoices)),
      ],
    }];
  }

  if (area === 'developer') {
    return [
      { key: 'api', title: 'API', rows: sectionRows('api', ctx) },
      {
        key: 'tools', title: 'Tools',
        rows: [
          row('sandbox', 'API console', pathFor('sandbox', workspace), screen === 'sandbox'),
          row('guides', 'Guides & docs', pathFor('guides', workspace), screen === 'guides'),
          row('logs', 'Activity logs', pathFor('logs', workspace), screen === 'logs', badge(counts.logs)),
        ],
      },
    ];
  }

  if (area === 'platform') {
    return [{ key: 'console', title: 'Admin console', rows: sectionRows('platform', ctx) }];
  }

  if (area === 'account') {
    /* The account sections used to be a sidebar of their own inside a
       full-screen overlay — a second navigation system for one branch of the
       same tree. They are rows here like any other. */
    return [{
      key: 'account', title: 'Account',
      rows: ACCOUNT_NAV.map(([id, label]) => ({
        key: 'account:' + id, label, href: accountHref(id),
        /* Keyed off the section alone, not the screen: billing and invoices
           are account sections served by screens of their own. */
        active: ctx.accountSection === id,
        count: id === 'invoices' ? badge(counts.invoices) : undefined,
      })),
    }];
  }

  /* home, contacts, support — a single destination each. */
  return [];
}

/* ── the single sidebar ───────────────────────────────────────────────────── */

export type SidebarArea = {
  item: AreaItem;
  href: string;
  active: boolean;
  /** The area's own rows, grouped. Only ever populated for the active area:
   *  the sidebar is a tree that opens one branch at a time, so the list of
   *  areas stays scannable at a glance instead of unrolling every child. */
  groups: SidebarGroup[];
};

/**
 * The whole navigation tree for one location: every area, with the current
 * one expanded. This is the entire sidebar — there is no second level of
 * chrome beside it.
 */
export function sidebarAreas(ctx: NavContext): SidebarArea[] {
  return areaItems(ctx).map(item => {
    const active = item.key === ctx.area;
    const href = pathFor(item.screen, ctx.workspace);
    return { item, href, active, groups: active ? pruneRedundantGroups(sidebarGroups(ctx), href) : [] };
  });
}

/**
 * Drops sub-navigation that says nothing the area row above it has not
 * already said.
 *
 * Two cases, both of them a single child restating its parent:
 *
 *  - **A lone group keeps its rows but loses its heading.** "Billing ▸
 *    Billing" and "Tenants ▸ Admin console" are the parent's own name a second
 *    time. A heading earns its place only when it distinguishes one group from
 *    another, as "API" and "Tools" do under Developer.
 *  - **A lone row that goes where the area already goes is dropped entirely**,
 *    and with it the empty expansion. Clicking the area gets you there.
 *
 * A single row pointing somewhere *else* is kept: hiding it would leave that
 * destination with no way in.
 */
export function pruneRedundantGroups(groups: SidebarGroup[], areaHref: string): SidebarGroup[] {
  const rows = groups.flatMap(g => g.rows);
  const actions = groups.filter(g => g.action).length;
  if (rows.length <= 1 && !actions && (!rows.length || rows[0].href === areaHref)) return [];
  /* One row needs no heading above it — that includes the envelope group,
     which on a sealed document is just "Audit trail". */
  if (groups.length === 1) return [{ ...groups[0], title: '' }];
  return groups;
}
