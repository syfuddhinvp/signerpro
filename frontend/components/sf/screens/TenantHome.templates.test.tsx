/**
 * "Start from a template" on the tenant overview.
 *
 * The strip's promise is one click to a prepared envelope, so the card must go
 * through `POST /api/templates/{id}/use` — the call that mints a *new*
 * document — and open the builder on that document, never on the template
 * itself. Editing the blueprint is a separate, deliberate choice behind the
 * card's menu.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation, router } from '@/test/navigation';
import { EMPTY_ORG_OVERVIEW, toOverviewStats, type TemplateCard } from '@/lib/sf/adapters';
import TenantHome, { type TenantHomeProps } from './TenantHome';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: (...args: unknown[]) => apiCall(...args) };
});

const card = (over: Partial<TemplateCard> = {}): TemplateCard => ({
  templateId: 'tpl-1',
  title: 'Mutual NDA',
  meta: '2 pages · 6 fields · 2 signers',
  docType: 'nda',
  pages: 2,
  fields: 6,
  uses: 9,
  ...over,
});

function mount(templates: TemplateCard[]) {
  const props: TenantHomeProps = {
    banner: { name: 'Your organization', initials: 'YO', meta: '' },
    stats: toOverviewStats(EMPTY_ORG_OVERVIEW),
    series: EMPTY_ORG_OVERVIEW.series,
    seriesLabels: EMPTY_ORG_OVERVIEW.series.map((_, i) => `W${i + 1}`),
    attention: [],
    spend: { total: '$0.00', lines: [] },
    team: [],
    nextInvoiceMeta: '—',
    templates,
  };
  return render(
    <SFProvider>
      <DialogProvider>
        <TenantHome {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

beforeEach(() => {
  cleanup();
  apiCall.mockReset();
  resetNavigation();
});

describe('overview · start from a template', () => {
  it('says so plainly when the organization has no templates', () => {
    mount([]);
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
  });

  it('renders a card per template with its shape', () => {
    mount([card(), card({ templateId: 'tpl-2', title: 'Offer letter' })]);
    expect(screen.getByText('Mutual NDA')).toBeTruthy();
    expect(screen.getByText('Offer letter')).toBeTruthy();
    expect(screen.getAllByText('2 pages · 6 fields · 2 signers').length).toBe(2);
  });

  it('uses the template and opens the builder on the document it mints', async () => {
    apiCall.mockResolvedValue({ ok: true, data: { id: 'doc-9' } });
    mount([card()]);

    fireEvent.click(screen.getByTitle('Start an envelope from Mutual NDA'));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(apiCall.mock.calls[0][0]).toBe('/api/templates/tpl-1/use');
    expect(String(router.push.mock.calls[0][0])).toContain('doc-9');
  });

  it('leaves the builder closed when the template cannot be used', async () => {
    apiCall.mockResolvedValue({ ok: false, error: { kind: 'server', status: 500, message: 'boom' } });
    mount([card()]);

    fireEvent.click(screen.getByRole('button', { name: /^Use$/ }));

    /* The toast lives in the shell, not this subtree — what matters here is
       that a failed `use` never navigates to a document that was not made. */
    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(router.push).not.toHaveBeenCalled();
  });

  it('offers editing the blueprint itself behind the card menu', async () => {
    mount([card()]);
    expect(screen.queryByRole('menuitem', { name: /Edit the template/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Mutual NDA' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit the template/ }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(String(router.push.mock.calls[0][0])).toContain('tpl-1');
    expect(apiCall).not.toHaveBeenCalled();
  });
});
