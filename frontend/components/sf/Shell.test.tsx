/**
 * The shell rendered at real locations.
 *
 * `navigation.test.ts` pins the IA as data; this pins that the shell renders
 * that data faithfully — one sidebar, every row an anchor, the current area
 * expanded and no other. What it replaced was a dark icon rail plus a second
 * contextual panel, whose rows mixed links with buttons that only mutated
 * client state; two of those groups never navigated at all.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation, setPathname, setSearchParams } from '@/test/navigation';
import Shell, { type ShellData } from './Shell';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'Admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: true,
  }),
  signOut: vi.fn(),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const DATA: ShellData = {
  quick: { inbox: 3, outbox: 0, completed: 12, drafts: 2, favorites: 0, expiring: 1, shared: 0, mine: 5 },
  folders: { documents: 40, archive: 4, templates: 6, trash: 1 },
  userFolders: [{ id: 'team-legal', name: 'Legal', count: 7, scope: 'team' }],
  quota: { used: 40, limit: 500, pct: 8 },
  invoiceCount: 9, logCount: 120, openTicketCount: 2,
  notifications: {
    items: [
      { id: 'n1', title: 'Recipient signed', detail: 'Buyer Seller Packet — buyer@example.com signed.', tone: 'good', screen: 'documents', target_id: 'd1', read_at: null, created_at: '2026-09-06T09:00:00Z' },
      { id: 'n2', title: 'Document viewed', detail: 'Mutual NDA — opened by seller@example.com.', tone: 'info', screen: 'documents', target_id: 'd2', read_at: '2026-09-06T08:00:00Z', created_at: '2026-09-06T07:30:00Z' },
    ],
    unread: 1,
    total: 2,
    facets: { tones: { bad: 0, warn: 0, good: 1, info: 1 }, unread: 1, read: 1 },
  },
};

function mount(pathname: string, query = '') {
  cleanup();
  setPathname(pathname);
  setSearchParams(query);
  return render(
    <SFProvider><DialogProvider><Shell data={DATA}><div /></Shell></DialogProvider></SFProvider>,
  );
}

const sidebar = () => document.querySelector('[data-tour="sidebar"]') as HTMLElement;
/** The top-level areas. */
const areaLinks = (): [string, string][] =>
  Array.from(document.querySelectorAll('[data-sf-area]'))
    .map(a => [a.textContent || '', a.getAttribute('href') || '']);
/** The expanded area's own rows — not the areas, the workspace card or the footer. */
const rowLinks = (): [string, string][] =>
  Array.from(document.querySelectorAll('[data-sf-row="1"]'))
    .map(a => [a.textContent || '', a.getAttribute('href') || '']);

beforeEach(() => { resetNavigation(); window.localStorage.clear(); });

describe('the sidebar is the only navigation chrome', () => {
  it('renders exactly one panel', () => {
    mount('/documents');
    expect(document.querySelectorAll('aside').length).toBe(1);
    expect(document.querySelector('[data-tour="rail"]')).toBeNull();
  });

  it('lists the tenant areas', () => {
    mount('/overview');
    const labels = areaLinks().map(([label]) => label);
    expect(labels.some(l => l.includes('Home'))).toBe(true);
    expect(labels.some(l => l.includes('Documents'))).toBe(true);
    /* Support's badge rides on its area row — it is the one area with no
       children for a count to live in. */
    expect(labels.find(l => l.includes('Support'))).toContain('2');
  });

  it('lists the platform areas in the platform workspace', () => {
    mount('/platform');
    const labels = areaLinks().map(([label]) => label);
    expect(labels.some(l => l.includes('Tenants'))).toBe(true);
    expect(labels.some(l => l.includes('Revenue'))).toBe(true);
    expect(labels.some(l => l.includes('Contacts'))).toBe(false);
  });

  it('keeps every area reachable from every location', () => {
    mount('/developer/api');
    expect(areaLinks().length).toBe(7);
    mount('/documents/doc-9/prepare');
    expect(areaLinks().length).toBe(7);
  });
});

describe('the expanded area', () => {
  it('opens one branch and no other', () => {
    mount('/documents');
    const current = document.querySelectorAll('[data-sf-area][aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('data-sf-area')).toBe('documents');
    /* Every row on screen belongs to that branch. */
    expect(rowLinks().every(([, href]) => href.startsWith('/documents'))).toBe(true);
    mount('/documents/doc-9/prepare');
    expect(rowLinks().every(([, href]) => href.startsWith('/documents/doc-9'))).toBe(true);
  });

  it('renders every row as a link', () => {
    mount('/developer/api');
    const buttons = Array.from(sidebar().querySelectorAll('button')).map(b => b.textContent);
    /* The workspace switcher, the fold toggle and sign-out are the only
       buttons left; nothing that navigates is one. */
    expect(buttons.filter(b => b && !/Tenant|Platform|⏎|«|»/.test(b))).toEqual([]);
    expect(rowLinks().length).toBeGreaterThan(4);
  });

  /* The document views and folders are chips on the library screen now — the
     sidebar carries no copy of them. */
  it('keeps the documents area free of view and folder rows', () => {
    mount('/documents');
    expect(rowLinks()).toEqual([]);
  });

  it('shows no children for areas with one destination', () => {
    mount('/overview');
    expect(rowLinks()).toEqual([]);
    mount('/support');
    expect(rowLinks()).toEqual([]);
  });

  it('shows the developer sections as section links', () => {
    mount('/developer/api');
    const hrefs = rowLinks().map(([, href]) => href);
    expect(hrefs).toContain('/developer/api?section=webhooks');
    expect(hrefs).toContain('/developer/sandbox');
  });

  it('shows the envelope group only on a document route, scoped to it', () => {
    mount('/documents');
    expect(rowLinks().some(([, h]) => h.includes('/prepare'))).toBe(false);

    /* The builder opens folded, so unfold before reading the rows. */
    mount('/documents/doc-9/prepare');
    fireEvent.click(screen.getByLabelText('Expand sidebar'));
    const hrefs = rowLinks().map(([, href]) => href);
    expect(hrefs).toContain('/documents/doc-9/workflow');
    expect(hrefs).toContain('/documents/doc-9/audit');
  });

  it('does not offer the platform console twice', () => {
    mount('/platform/revenue');
    expect(rowLinks().map(([, href]) => href)).toEqual(['/platform/revenue', '/platform/invoices']);
  });
});

describe('folding', () => {
  it('starts expanded and collapses to an icon strip', () => {
    mount('/documents/doc-9/workflow');
    const aside = () => document.querySelector('aside') as HTMLElement;
    expect(aside().getAttribute('data-folded')).toBe('0');
    expect(rowLinks().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(aside().getAttribute('data-folded')).toBe('1');
    /* Every area is still reachable; only its children and the labels go. */
    expect(areaLinks().length).toBe(7);
    expect(rowLinks()).toEqual([]);
    expect(document.querySelector('[data-sf-area="documents"]')?.getAttribute('title')).toBe('Documents');
  });

  it('remembers the fold across mounts', () => {
    mount('/documents');
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(window.localStorage.getItem('sf.sidebar.folded')).toBe('1');

    mount('/documents');
    expect((document.querySelector('aside') as HTMLElement).getAttribute('data-folded')).toBe('1');
    fireEvent.click(screen.getByLabelText('Expand sidebar'));
    expect(window.localStorage.getItem('sf.sidebar.folded')).toBe('0');
  });

  it('folds itself on the builder and restores what you had on the way out', () => {
    const aside = () => document.querySelector('aside') as HTMLElement;
    mount('/documents');
    expect(aside().getAttribute('data-folded')).toBe('0');

    /* The builder wants the width. */
    mount('/documents/doc-9/prepare');
    expect(aside().getAttribute('data-folded')).toBe('1');
    /* And it did so without rewriting the preference. */
    expect(window.localStorage.getItem('sf.sidebar.folded')).toBe(null);

    mount('/documents');
    expect(aside().getAttribute('data-folded')).toBe('0');
  });

  it('lets you unfold on the builder for that visit only', () => {
    const aside = () => document.querySelector('aside') as HTMLElement;
    mount('/documents/doc-9/prepare');
    fireEvent.click(screen.getByLabelText('Expand sidebar'));
    expect(aside().getAttribute('data-folded')).toBe('0');
    expect(window.localStorage.getItem('sf.sidebar.folded')).toBe(null);

    mount('/documents/doc-9/prepare');
    expect(aside().getAttribute('data-folded')).toBe('1');
  });

  it('renders expanded when storage is unreadable', () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      mount('/documents');
      expect((document.querySelector('aside') as HTMLElement).getAttribute('data-folded')).toBe('0');
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});

describe('the header actions belong to one envelope', () => {
  const sendBtn = () => screen.queryByRole('button', { name: 'Send for signature' });
  const builderLink = () => screen.queryByRole('link', { name: 'Open builder' });

  it('offers them on a document route', () => {
    mount('/documents/doc-7/prepare');
    expect(sendBtn()).toBeTruthy();
    expect(builderLink()?.getAttribute('href')).toBe('/documents/doc-7/prepare');
  });

  it.each([
    ['/documents'], ['/contacts'], ['/reports'], ['/billing'], ['/overview'],
    ['/developer/api'], ['/support'], ['/platform/tenants'],
  ])('hides them at %s — there is no envelope to send', pathname => {
    mount(pathname);
    /* "Send for signature" used to render on every screen in the app and
       answered "No document to send" when pressed. */
    expect(sendBtn()).toBeNull();
    expect(builderLink()).toBeNull();
  });
});
