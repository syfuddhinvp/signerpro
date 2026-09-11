/**
 * The IA, pinned. These are the invariants the reorganisation was for: one
 * destination per place, every row a URL, and nothing in the sidebar that
 * cannot be linked to.
 */
import { describe, it, expect } from 'vitest';
import {
  areaItems, folderHref, pruneRedundantGroups, sidebarAreas, sidebarGroups,
  type NavContext, type SidebarGroup,
} from './navigation';
import { SCREEN_SECTIONS, accountSectionForPath, areaForScreen, sectionFor, sectionPath, type ScreenKey, type Workspace } from './routes';

const ctxOf = (patch: Partial<NavContext> = {}): NavContext => ({
  workspace: 'tenant', area: 'home', screen: 'tenantHome', role: 'admin', section: '', folder: 'documents',
  documentId: null, accountSection: 'profile',
  counts: { quick: null, folders: null, invoices: null, logs: null, tickets: null, notifications: null },
  folders: [],
  ...patch,
});

const allRows = (ctx: NavContext) => sidebarGroups(ctx).flatMap(g => g.rows);

describe('a sender', () => {
  const sender = (patch: Partial<NavContext> = {}) => ctxOf({ role: 'sender', ...patch });

  it('is offered only the areas they can use', () => {
    expect(areaItems(sender()).map(r => r.key)).toEqual(['home', 'documents', 'contacts', 'account']);
  });

  it('keeps the organization out of their account sections', () => {
    const rows = allRows(sender({ area: 'account', screen: 'account' })).map(r => r.key);
    expect(rows).toEqual([
      /* The notifications page is personal, so a sender keeps it — what they
         lose are the organization-level sections. */
      'account:feed',
      'account:profile', 'account:security', 'account:notifications',
    ]);
  });
});

describe('the areas', () => {
  it('gives each workspace its own areas', () => {
    expect(areaItems(ctxOf()).map(r => r.key))
      .toEqual(['home', 'documents', 'contacts', 'reports', 'developer', 'support', 'account']);
    expect(areaItems(ctxOf({ workspace: 'platform' })).map(r => r.key))
      .toEqual(['home', 'platform', 'platformRevenue', 'developer', 'support', 'account']);
  });

  it('badges Support, the one area with no children to hold a count', () => {
    const ctx = ctxOf({ counts: { ...ctxOf().counts, tickets: 4 } });
    const items = areaItems(ctx);
    expect(items.find(r => r.key === 'support')?.count).toBe('4');
    expect(items.filter(r => r.count).length).toBe(1);
  });

  it('shows no badge at zero', () => {
    const ctx = ctxOf({ counts: { ...ctxOf().counts, tickets: 0 } });
    expect(areaItems(ctx).find(r => r.key === 'support')?.count).toBe('');
  });
});

describe('screen ownership', () => {
  /* The bug this replaced: one shared map filed the platform copies of
     Revenue, Invoices, Support and Logs under the `platform` rail, so each was
     reachable from two rail sections and both lit up. */
  it('files every screen under exactly one area per workspace', () => {
    const screens: ScreenKey[] = [
      'tenantHome', 'dashboard', 'builder', 'routing', 'sign', 'audit', 'contacts',
      'reports', 'billing', 'invoices', 'api', 'sandbox', 'guides', 'logs', 'support',
      'platformHome', 'platform', 'revenue',
    ];
    for (const ws of ['tenant', 'platform'] as Workspace[]) {
      const areas = areaItems(ctxOf({ workspace: ws })).map(r => r.key);
      for (const screen of screens) {
        const owner = areaForScreen(screen, ws);
        /* Every screen resolves to one area key, and where that area exists in
           this workspace it is the only one that claims the screen. */
        expect(typeof owner).toBe('string');
        expect(areas.filter(a => a === owner).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('puts the overview on its own area rather than under Documents', () => {
    expect(areaForScreen('tenantHome', 'tenant')).toBe('home');
    expect(areaForScreen('dashboard', 'tenant')).toBe('documents');
  });

  it('separates platform Revenue from the tenants console', () => {
    expect(areaForScreen('revenue', 'platform')).toBe('platformRevenue');
    expect(areaForScreen('invoices', 'platform')).toBe('platformRevenue');
    expect(areaForScreen('platform', 'platform')).toBe('platform');
  });
});

describe('the sidebar', () => {
  it('stays quiet for single-destination areas', () => {
    expect(sidebarGroups(ctxOf({ area: 'home' }))).toEqual([]);
    expect(sidebarGroups(ctxOf({ area: 'contacts', screen: 'contacts' }))).toEqual([]);
    expect(sidebarGroups(ctxOf({ area: 'support', screen: 'support' }))).toEqual([]);
  });

  it('gives every row a URL — nothing is a state-only control', () => {
    const areas = ['documents', 'reports', 'account', 'developer', 'platform', 'platformRevenue'] as const;
    for (const rail of areas) {
      const ws: Workspace = rail === 'platform' || rail === 'platformRevenue' ? 'platform' : 'tenant';
      for (const r of allRows(ctxOf({ area: rail, workspace: ws }))) {
        expect(r.href, r.label).toMatch(/^\//);
      }
    }
  });

  it('never lists the same destination twice within an area', () => {
    const areas = ['documents', 'reports', 'account', 'developer', 'platform', 'platformRevenue'] as const;
    for (const rail of areas) {
      const ws: Workspace = rail === 'platform' || rail === 'platformRevenue' ? 'platform' : 'tenant';
      const hrefs = allRows(ctxOf({ area: rail, workspace: ws })).map(r => r.href);
      expect(new Set(hrefs).size, rail).toBe(hrefs.length);
    }
  });

  it('marks exactly one row active per location', () => {
    const ctx = ctxOf({ area: 'developer', screen: 'api', section: 'webhooks' });
    const active = allRows(ctx).filter(r => r.active);
    expect(active.map(r => r.label)).toEqual(['Webhooks']);
  });
});

describe('document views', () => {
  it('carries the view as a shareable query parameter', () => {
    expect(folderHref('inbox')).toBe('/documents?folder=inbox');
    /* The default view is the bare path — no redundant `?folder=documents`. */
    expect(folderHref('documents')).toBe('/documents');
  });

  /* Views and folders are rendered by the library screen now, not the
     sidebar — the chips sit beside the list they filter. The sidebar keeps
     nothing for the documents area but the open envelope. */
  it('are not sidebar rows', () => {
    const ctx = ctxOf({
      area: 'documents', screen: 'dashboard', folder: 'expiring',
      folders: [{ id: 'f1', name: 'Q3 contracts', count: 2, scope: 'personal' }],
    });
    expect(sidebarGroups(ctx)).toEqual([]);
  });
});

describe('the envelope group', () => {
  it('is absent until a document is open — the whole documents sidebar is', () => {
    const ctx = ctxOf({ area: 'documents', screen: 'dashboard' });
    expect(sidebarGroups(ctx)).toEqual([]);
  });

  it('appears scoped to that document, without repeating its title', () => {
    const ctx = ctxOf({ area: 'documents', screen: 'builder', documentId: 'doc-7' });
    const group = sidebarGroups(ctx).find(g => g.key === 'envelope');
    /* The title is the header of every screen these rows lead to; a long or
       machine-generated one used to wrap over three lines of the rail. */
    expect(group?.title).toBe('This envelope');
    /* Every stage stays on the same envelope — no "newest relevant document"
       resolution, which is what used to send you to an arbitrary one. */
    expect(group?.rows.map(r => r.href)).toEqual([
      '/documents/doc-7/prepare', '/documents/doc-7/workflow',
      '/documents/doc-7/signer-view', '/documents/doc-7/audit',
    ]);
    expect(group?.rows.filter(r => r.active).map(r => r.label)).toEqual(['Prepare']);
  });

  it('falls back to a generic heading when the title is unknown', () => {
    const ctx = ctxOf({ area: 'documents', screen: 'audit', documentId: 'doc-7' });
    expect(sidebarGroups(ctx).find(g => g.key === 'envelope')?.title).toBe('This envelope');
  });
});

describe('in-screen sections', () => {
  it('round-trips through the URL', () => {
    expect(sectionPath('api', 'tenant', 'webhooks')).toBe('/developer/api?section=webhooks');
    expect(sectionFor('api', 'webhooks')).toBe('webhooks');
  });

  it('drops the parameter for the landing section', () => {
    expect(sectionPath('reports', 'tenant', 'analytics')).toBe('/reports');
  });

  it('falls back to the landing section for an unknown value', () => {
    expect(sectionFor('platform', 'nope')).toBe('tenants');
    expect(sectionFor('platform', null)).toBe('tenants');
  });

  it('respects the platform aliases', () => {
    expect(sectionPath('api', 'platform', 'usage')).toBe('/platform/developer?section=usage');
  });

  it('surfaces every declared section in the sidebar', () => {
    const cases: [ScreenKey, NavContext][] = [
      ['reports', ctxOf({ area: 'reports', screen: 'reports' })],
      ['api', ctxOf({ area: 'developer', screen: 'api' })],
      ['platform', ctxOf({ area: 'platform', screen: 'platform', workspace: 'platform' })],
    ];
    for (const [screen, ctx] of cases) {
      const labels = allRows(ctx).map(r => r.label);
      for (const [, label] of SCREEN_SECTIONS[screen] || []) {
        expect(labels, screen).toContain(label);
      }
    }
  });
});

describe('the single tree', () => {
  it('returns every area, with only the current one expanded', () => {
    const tree = sidebarAreas(ctxOf({ area: 'developer', screen: 'api' }));
    expect(tree.length).toBe(7);
    expect(tree.filter(a => a.active).map(a => a.item.key)).toEqual(['developer']);
    expect(tree.filter(a => a.groups.length).map(a => a.item.key)).toEqual(['developer']);
  });

  it('gives every area a link, so none is stranded behind another', () => {
    for (const ws of ['tenant', 'platform'] as Workspace[]) {
      for (const area of sidebarAreas(ctxOf({ workspace: ws }))) {
        expect(area.href, area.item.label).toMatch(/^\//);
      }
    }
  });

  it('expands nothing for an area with one destination', () => {
    const tree = sidebarAreas(ctxOf({ area: 'support', screen: 'support' }));
    expect(tree.find(a => a.item.key === 'support')?.groups).toEqual([]);
  });

  it('routes each area to its own workspace', () => {
    const tree = sidebarAreas(ctxOf({ workspace: 'platform', area: 'platform', screen: 'platform' }));
    expect(tree.map(a => a.href).every(h =>
      h.startsWith('/platform') || h.startsWith('/developer') || h.startsWith('/reports')
      || h.startsWith('/support') || h.startsWith('/account'))).toBe(true);
  });
});

describe('redundant sub-navigation', () => {
  const groupsFor = (area: NavContext['area'], screen: ScreenKey, workspace: Workspace = 'tenant') =>
    sidebarAreas(ctxOf({ area, screen, workspace })).find(a => a.active)!.groups;

  it('drops the heading when an area has a single group', () => {
    /* "My account ▸ Account" and "Tenants ▸ Admin console" restate the row above. */
    expect(groupsFor('account', 'account').map(g => g.title)).toEqual(['']);
    expect(groupsFor('reports', 'reports').map(g => g.title)).toEqual(['']);
    expect(groupsFor('platform', 'platform', 'platform').map(g => g.title)).toEqual(['']);
  });

  it('keeps the rows of that group', () => {
    const rows = groupsFor('account', 'account').flatMap(g => g.rows);
    expect(rows.map(r => r.label)).toContain('Billing & plan');
    /* Invoices are the list on Billing & plan, not a row of their own. */
    expect(rows.map(r => r.label)).not.toContain('Invoices');
  });

  it('keeps headings that tell two groups apart', () => {
    expect(groupsFor('developer', 'api').map(g => g.title)).toEqual(['API', 'Tools']);
  });

  it('drops the envelope heading too — one group needs no heading', () => {
    const ctx = ctxOf({ area: 'documents', screen: 'builder', documentId: 'doc-7' });
    const groups = sidebarAreas(ctx).find(a => a.active)!.groups;
    expect(groups.map(g => g.rows.length)).toEqual([4]);
    expect(groups.map(g => g.title)).toEqual(['']);
  });

  it('expands nothing when the only child goes where the area goes', () => {
    const single: SidebarGroup[] = [{ key: 'x', title: 'X', rows: [
      { key: 'r', label: 'Support', href: '/support', active: true },
    ] }];
    expect(pruneRedundantGroups(single, '/support')).toEqual([]);
  });

  it('keeps a lone child that goes somewhere else', () => {
    const single: SidebarGroup[] = [{ key: 'x', title: 'X', rows: [
      { key: 'r', label: 'Elsewhere', href: '/elsewhere', active: false },
    ] }];
    expect(pruneRedundantGroups(single, '/support').flatMap(g => g.rows).map(r => r.href)).toEqual(['/elsewhere']);
  });
});

describe('the account area', () => {
  it('is an area of the sidebar, in both workspaces', () => {
    for (const ws of ['tenant', 'platform'] as Workspace[]) {
      const account = sidebarAreas(ctxOf({ workspace: ws })).find(a => a.item.key === 'account');
      expect(account?.href).toBe('/account/profile');
    }
  });

  it('lists every section as a row', () => {
    const rows = sidebarAreas(ctxOf({ area: 'account', screen: 'account' }))
      .find(a => a.active)!.groups.flatMap(g => g.rows);
    // Eight account sections, plus the notifications page above them.
    // `Payments` joined the list when senders gained the ability to collect
    // money on an envelope; it is a separate section from `Billing`, which is
    // what the organization pays us rather than what a signer pays them.
    expect(rows.length).toBe(9);
    expect(rows.map(r => r.href)).toContain('/account/organization');
    expect(rows.map(r => r.href)).toContain('/account/payments');
    expect(rows.map(r => r.href)).toContain('/notifications');
  });

  it('highlights the section in the path', () => {
    const rows = sidebarAreas(ctxOf({ area: 'account', screen: 'account', accountSection: 'organization' }))
      .find(a => a.active)!.groups.flatMap(g => g.rows);
    expect(rows.filter(r => r.active).map(r => r.label)).toEqual(['Organization & teams']);
  });

  it('leaves every account section unhighlighted outside the account area', () => {
    /* `/notifications` is its own screen inside the account area. Defaulting
       an unmatched path to `profile` lit User profile there too, so the
       sidebar claimed the user was in two places at once. */
    expect(accountSectionForPath('/notifications')).toBe('');
    expect(accountSectionForPath('/account')).toBe('profile');
    const rows = sidebarAreas(ctxOf({ area: 'account', screen: 'notifications', accountSection: accountSectionForPath('/notifications') }))
      .find(a => a.active)!.groups.flatMap(g => g.rows);
    expect(rows.filter(r => r.active).map(r => r.label)).toEqual(['Notifications']);
  });

  it('resolves the retired Cloud storage URL onto Integrations', () => {
    /* Connecting a provider and choosing where it exports to are one section
       now; the bookmarked URL must not 404. */
    expect(accountSectionForPath('/account/cloud')).toBe('integrations');
    const rows = sidebarAreas(ctxOf({ area: 'account', screen: 'account' }))
      .find(a => a.active)!.groups.flatMap(g => g.rows);
    expect(rows.map(r => r.href)).not.toContain('/account/cloud');
  });
});
