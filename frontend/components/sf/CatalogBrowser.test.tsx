/**
 * The form catalog browser.
 *
 * The properties worth pinning are the ones that keep the dialog honest about
 * a catalog it does not own: filtering re-queries the server rather than
 * narrowing a client array, a stale in-flight response cannot overwrite newer
 * results, a form already in the library offers no second "add", and a failed
 * load is not rendered as an empty catalog.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { router, resetNavigation } from '@/test/navigation';
import { SFProvider } from '@/lib/sf/state';
import type { CatalogListResponse, CatalogTemplateResponse } from '@/lib/api/types';
import CatalogBrowser from './CatalogBrowser';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

const entry = (over: Partial<CatalogTemplateResponse> = {}): CatalogTemplateResponse => ({
  id: 'c1',
  slug: 'irs-w9',
  title: 'IRS Form W-9',
  description: 'Taxpayer identification and certification.',
  category: 'government',
  authority: 'IRS',
  jurisdiction: 'US',
  form_revision: null,
  tags: ['tax'],
  page_count: 1,
  role_count: 1,
  field_count: 6,
  has_file: true,
  published: true,
  sort_order: 10,
  imported: false,
  created_at: '2026-09-06T09:00:00Z',
  updated_at: '2026-09-06T09:00:00Z',
  ...over,
});

const list = (over: Partial<CatalogListResponse> = {}): CatalogListResponse => ({
  items: [entry(), entry({ id: 'c2', slug: 'mutual-nda', title: 'Mutual NDA', category: 'legal', authority: null })],
  total: 2,
  categories: ['government', 'legal'],
  ...over,
});

const onClose = vi.fn();

function mount() {
  return render(
    <SFProvider>
      <CatalogBrowser onClose={onClose} />
    </SFProvider>,
  );
}

/** The query params of the last catalog GET the component made. */
function lastBrowseQuery(): Record<string, unknown> {
  const calls = apiCall.mock.calls.filter(call => String(call[0]).includes('/templates/catalog'));
  const init = calls[calls.length - 1][1] as { query?: Record<string, unknown> } | undefined;
  return init?.query ?? {};
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetNavigation();
  apiCall.mockResolvedValue(ok(list()));
});

describe('the form catalog browser', () => {
  it('lists the published forms with what a sender needs to choose between them', async () => {
    mount();
    expect(await screen.findByText('IRS Form W-9')).toBeTruthy();
    expect(screen.getByText('Mutual NDA')).toBeTruthy();
    // Category, publisher, jurisdiction and shape, in one line.
    expect(screen.getByText(/Government · IRS · US · 1 signer · 6 fields/)).toBeTruthy();
  });

  it('filters by category on the server rather than narrowing the rows on screen', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    apiCall.mockResolvedValue(ok(list({ items: [entry({ id: 'c2', title: 'Mutual NDA', category: 'legal' })], total: 1, categories: ['legal'] })));

    fireEvent.change(screen.getByLabelText('Filter the catalog by category'), { target: { value: 'legal' } });

    await waitFor(() => expect(lastBrowseQuery()).toMatchObject({ category: 'legal' }));
    await waitFor(() => expect(screen.queryByText('IRS Form W-9')).toBeNull());
  });

  it('keeps every category option when a category filter narrows the result', async () => {
    /* The filtered response reports only the category that was selected. If
       the control took its options from that, choosing "Legal" would delete
       "Government" from the list and strand the user in one category. */
    mount();
    await screen.findByText('IRS Form W-9');
    apiCall.mockResolvedValue(ok(list({ items: [], total: 0, categories: ['legal'] })));

    fireEvent.change(screen.getByLabelText('Filter the catalog by category'), { target: { value: 'legal' } });
    await waitFor(() => expect(lastBrowseQuery()).toMatchObject({ category: 'legal' }));

    const options = Array.from(
      screen.getByLabelText('Filter the catalog by category').querySelectorAll('option'),
    ).map(option => option.textContent);
    expect(options).toContain('Government');
    expect(options).toContain('Legal');
  });

  it('searches the catalog, debounced, and sends the query to the server', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'w-9' } });
    await waitFor(() => expect(lastBrowseQuery()).toMatchObject({ q: 'w-9' }));
  });

  it('adds a form to the library and marks it as already added', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    apiCall.mockResolvedValue(ok({ id: 't1', title: 'IRS Form W-9' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Add to my templates' })[0]);

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/templates/catalog/c1/import', expect.anything()),
    );
    // The row flips in place, and the list behind the dialog is re-fetched.
    expect(await screen.findByText('In your templates')).toBeTruthy();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('offers no add button for a form the organization already has', async () => {
    apiCall.mockResolvedValue(ok(list({ items: [entry({ imported: true })], total: 1 })));
    mount();
    expect(await screen.findByText('In your templates')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to my templates' })).toBeNull();
  });

  it('does not import the same form twice when the button is double clicked', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    // Never resolves: the button must already be disabled by the second click.
    apiCall.mockReturnValue(new Promise(() => {}));

    const add = screen.getAllByRole('button', { name: 'Add to my templates' })[0];
    fireEvent.click(add);
    fireEvent.click(await screen.findByRole('button', { name: 'Adding…' }));

    const imports = apiCall.mock.calls.filter(call => String(call[0]).endsWith('/import'));
    expect(imports).toHaveLength(1);
  });

  it('reports a failed load instead of showing an empty catalog', async () => {
    apiCall.mockResolvedValue(fail('gateway down'));
    mount();
    expect(await screen.findByText('The catalog could not be loaded')).toBeTruthy();
    expect(screen.getByText('gateway down')).toBeTruthy();
    expect(screen.queryByText('The form catalog is empty')).toBeNull();
  });

  it('says a failed add failed, and leaves the row addable', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    apiCall.mockResolvedValue(fail('quota reached'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Add to my templates' })[0]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add to my templates' }).length).toBe(2));
    expect(screen.queryByText('In your templates')).toBeNull();
  });

  it('distinguishes an empty catalog from a filter that matched nothing', async () => {
    apiCall.mockResolvedValue(ok(list({ items: [], total: 0, categories: [] })));
    mount();
    expect(await screen.findByText('The form catalog is empty')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No forms match those filters')).toBeTruthy();
  });

  it('closes on Escape and on the close button', async () => {
    mount();
    await screen.findByText('IRS Form W-9');
    fireEvent.click(screen.getByRole('button', { name: 'Close the form catalog' }));
    expect(onClose).toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose.mock.calls.length).toBeGreaterThan(1);
  });
});
