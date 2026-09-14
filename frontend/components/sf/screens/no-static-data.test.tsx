/**
 * Screen-level static-data guard — the regression net for the ~37 fabricated
 * values wave 1 removed.
 *
 * Every screen here is rendered with *empty* data: no documents, no contacts,
 * no invoices, no tickets. Whatever it prints in that state can only come from
 * the component itself, so if any of the prototype's seed strings appears, a
 * screen is showing the demo's workspace as the tenant's own.
 *
 * Not covered here: `Builder` and `Signer` (their fake document canvas is C2,
 * owned by another lane this wave) and `Guides`, whose static content is
 * legitimate API documentation rather than the user's data.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import { EMPTY_ORG_OVERVIEW, toOverviewStats, LIBRARY_FILTER_DEFAULTS } from '@/lib/sf/adapters';

import TenantHome from './TenantHome';
import Library from './Library';
import Invoices from './Invoices';
import Logs from './Logs';
import Contacts from './Contacts';
import Audit from './Audit';
import ApiScreen from './ApiScreen';
import Support from './Support';
import Revenue from './Revenue';
import PlatformHome from './PlatformHome';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Strings that only ever existed in the prototype. None of them may reach the
 * DOM of a screen rendered with no data.
 */
const FABRICATED = [
  'ENV-2291-KD',
  'acme.io',
  'Alex Rivera',
  '4.1M of 10M',
  'Northwind Analytics',
  'INV-2026-0841',
  'SF-4471',
  'Acme Corporation',
  'Priya Raman',
  'Marcus Bell',
  '100% uptime',
];

/**
 * Visible text only — a placeholder attribute is a hint, not a claim.
 *
 * `exclude` drops a subtree before reading: the developer screen's `<pre>` is
 * a canned API-reference payload rather than the caller's data (see the skipped
 * spec at the bottom of this file, which asks for it to be labelled as one).
 */
function visibleText(exclude?: string): string {
  if (exclude) document.querySelectorAll(exclude).forEach(node => node.remove());
  return document.body.textContent ?? '';
}

const p = <T,>(value: unknown) => value as T;

const SCREENS: [string, () => React.ReactElement, string?][] = [
  ['TenantHome', () => (
    <TenantHome {...p<React.ComponentProps<typeof TenantHome>>({
      banner: { name: 'Your organization', initials: 'YO', meta: '' },
      stats: toOverviewStats(EMPTY_ORG_OVERVIEW),
      series: EMPTY_ORG_OVERVIEW.series,
      seriesLabels: EMPTY_ORG_OVERVIEW.series.map((_, i) => `W${i + 1}`),
      attention: [],
      spend: { total: '$0.00', lines: [] },
      team: [],
      nextInvoiceMeta: '—',
    })} />
  )],
  ['Library', () => (
    <Library {...p<React.ComponentProps<typeof Library>>({
      rows: [], total: 0, templates: [], templateTotal: 0, folderOptions: [],
      initialFilters: LIBRARY_FILTER_DEFAULTS,
    })} />
  )],
  ['Invoices', () => (
    <Invoices {...p<React.ComponentProps<typeof Invoices>>({
      rows: [], filter: 'all', platform: false, scopeName: 'Your organization',
    })} />
  )],
  ['Logs', () => (
    <Logs {...p<React.ComponentProps<typeof Logs>>({
      page: { items: [], total: 0, sources: [], levels: [] },
      scope: 'tenant', sinceDays: 30, orgSlug: '',
    })} />
  )],
  ['Contacts', () => (
    <Contacts {...p<React.ComponentProps<typeof Contacts>>({
      contacts: [], groupLabels: {}, counts: {},
    })} />
  )],
  ['Audit', () => (
    <Audit {...p<React.ComponentProps<typeof Audit>>({
      entries: [], certificate: null, chain: null, attestations: [],
      documentTitle: null, verifyUrl: '',
    })} />
  )],
  ['ApiScreen', () => (
    <ApiScreen {...p<React.ComponentProps<typeof ApiScreen>>({
      keys: [], scopeCatalogue: [], usage: null, apiSettings: null, embedContacts: [],
    })} />
  ), 'pre'],
  ['Support', () => (
    <Support {...p<React.ComponentProps<typeof Support>>({
      page: { items: [], total: 0, counts: {} }, detail: null, agents: [],
      stats: [], quickReplies: [], scope: undefined,
    })} />
  )],
  ['Revenue', () => (
    <Revenue {...p<React.ComponentProps<typeof Revenue>>({
      stats: [], balanceTiles: [], subsByPlan: [], churnRows: [], events: [],
      payoutDestination: '—', deliveredPct: '0%', availableLabel: '$0.00', liveMode: false,
    })} />
  )],
  ['PlatformHome', () => (
    <PlatformHome {...p<React.ComponentProps<typeof PlatformHome>>({
      stats: [], mrrSeries: [], mrrTicks: ['—', '—', '—'], nrrLabel: '—',
      tenantCount: '0', seatsLabel: '0', topTenants: [], dunning: [], health: [], audit: [],
    })} />
  )],
];

beforeEach(() => {
  resetNavigation();
  // A fresh Response per call: a single instance can only be read once.
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('screens render no fabricated data when given none', () => {
  it.each(SCREENS)('%s', (name, element, exclude) => {
    render(<SFProvider><DialogProvider>{element()}</DialogProvider></SFProvider>);
    const text = visibleText(exclude);
    for (const fabricated of FABRICATED) {
      expect(text, `${name} rendered "${fabricated}" with no data behind it`)
        .not.toContain(fabricated);
    }
  });

  it('an empty library says it is empty rather than showing seed rows', () => {
    render(
      <SFProvider>
       <DialogProvider>
        <Library {...p<React.ComponentProps<typeof Library>>({
          rows: [], total: 0, templates: [], templateTotal: 0, folderOptions: [],
          initialFilters: LIBRARY_FILTER_DEFAULTS,
        })} />
       </DialogProvider>
      </SFProvider>,
    );
    expect(screen.queryByText(/master services agreement/i)).toBeNull();
  });

  /**
   * `ApiScreen` used to render `API_DEFS[tab].sample` under a heading reading
   * `Response · 200` with no marker that it was an example, and the payload
   * carried `Priya Raman` / `priya@acme.io` / `Acme Corporation` / `ENV-2291-KD`
   * — so a developer reading `GET /v1/users` saw what looked like their own
   * directory. The block is now headed "Example response", carries an explicit
   * "not your workspace" note, and every identity in it is an `example.com`
   * documentation placeholder.
   */
  it('the developer reference does not present a canned payload as live data', () => {
    render(
      <SFProvider>
       <DialogProvider>
        <ApiScreen {...p<React.ComponentProps<typeof ApiScreen>>({
          keys: [], scopeCatalogue: [], usage: null, apiSettings: null, embedContacts: [],
        })} />
       </DialogProvider>
      </SFProvider>,
    );
    expect(visibleText()).not.toContain('acme.io');
  });
});
