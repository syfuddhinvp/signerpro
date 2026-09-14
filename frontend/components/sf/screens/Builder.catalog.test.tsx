/**
 * The builder, when what it is editing is a platform catalog form.
 *
 * Placement for a catalog form is authored in this same builder rather than in
 * a second field editor, so the only thing the screen adds is the one action
 * it otherwise has no concept of: writing the placement back to the catalog
 * entry. The banner must appear for a curator's draft and for nothing else —
 * a document *sent* from a catalog form inherits the same slug, and offering
 * to overwrite the catalog from it would let one envelope rewrite the
 * blueprint every tenant imports.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetNavigation } from '@/test/navigation';
import { SFProvider, useSF } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

function mount(catalogSlug: string | null) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder
        documentId="tpl_1"
        title="IRS Form W-9"
        pageCount={1}
        fields={[]}
        recipients={[]}
        routing={null}
        catalogSlug={catalogSlug}
      />
      <Toast />
    </DialogProvider></SFProvider>,
  );
}

const toast = () => screen.getByTestId('toast').textContent ?? '';
const saveButton = () => screen.getByRole('button', { name: 'Save to catalog' });

beforeEach(() => {
  vi.clearAllMocks();
  resetNavigation();
  apiCall.mockResolvedValue(ok({}));
});

describe('the builder editing a catalog form', () => {
  it('shows no catalog banner on an ordinary document', () => {
    mount(null);
    expect(screen.queryByRole('button', { name: 'Save to catalog' })).toBeNull();
    expect(screen.queryByText(/Catalog form/)).toBeNull();
  });

  it('names the form it is authoring', () => {
    mount('irs-w9');
    expect(screen.getByText(/Catalog form · irs-w9/)).toBeTruthy();
  });

  it('saves the placement back to that form', async () => {
    mount('irs-w9');
    fireEvent.click(saveButton());

    // Addressed by slug: the document records the slug, never the entry id.
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/platform/catalog-templates/irs-w9/adopt/tpl_1', expect.anything()),
    );
    await waitFor(() => expect(toast()).toMatch(/Saved to the catalog/));
  });

  it('says when saving back failed rather than implying it saved', async () => {
    mount('irs-w9');
    apiCall.mockResolvedValue(fail('Fields placed beyond page 1: Sign here'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast()).toMatch(/Could not save to the catalog · Fields placed beyond page 1/));
  });
});
