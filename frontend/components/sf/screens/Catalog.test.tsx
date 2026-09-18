/**
 * The platform form catalog.
 *
 * The property worth pinning hardest is the publish gate: an entry with no
 * PDF behind it must not reach tenants, because importing it would produce an
 * empty template. The rest is about being honest — a failed load is not an
 * empty catalog, and deleting says what it does and does not affect.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { router, resetNavigation } from '@/test/navigation';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import type { CatalogTemplateResponse } from '@/lib/api/types';
import { useSF } from '@/lib/sf/state';
import Catalog from './Catalog';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
const apiDownload = vi.fn();
vi.mock('@/lib/api/browser', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
  apiDownload: (...args: unknown[]) => apiDownload(...args),
}));

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
  has_file: false,
  published: false,
  sort_order: 10,
  imported: false,
  created_at: '2026-09-06T09:00:00Z',
  updated_at: '2026-09-06T09:00:00Z',
  ...over,
});

/* `flash` writes to `s.toast`, which the app Shell renders — not this screen.
   The probe surfaces it here so a test can assert what the curator is told,
   rather than only that nothing was sent. */
function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

function mount(items: CatalogTemplateResponse[], loadError: string | null = null) {
  return render(
    <SFProvider>
      <DialogProvider>
        <Catalog items={items} loadError={loadError} />
        <Toast />
      </DialogProvider>
    </SFProvider>,
  );
}

const toast = () => screen.getByTestId('toast').textContent ?? '';

/** Drive the hidden file input the way a real pick does. */
function choose(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'w9.pdf', { type: 'application/pdf' });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetNavigation();
  apiCall.mockResolvedValue(ok({}));
});

describe('the platform form catalog', () => {
  it('says which entries still need a PDF before they can be published', () => {
    mount([entry(), entry({ id: 'c2', title: 'Mutual NDA', has_file: true })]);
    expect(screen.getByText('Needs a PDF')).toBeTruthy();
    expect(screen.getByText('Ready to publish')).toBeTruthy();
    // The summary is built from several expressions, so it is matched against
    // the line's whole text rather than a single text node.
    expect(screen.getByTestId('catalog-summary').textContent)
      .toMatch(/2 forms · 0 published · 1 waiting for a PDF/);
  });

  it('refuses to publish an entry that has no PDF, and says why', async () => {
    mount([entry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    // Nothing was sent, and the curator is told what to do first.
    expect(apiCall).not.toHaveBeenCalled();
    await waitFor(() => expect(toast()).toMatch(/Upload the form’s PDF before publishing/));
  });

  it('publishes an entry once its PDF is attached', async () => {
    mount([entry({ has_file: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith(
        '/api/platform/catalog-templates/c1/publish',
        expect.objectContaining({ query: { published: true } }),
      ),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('withdraws a published entry from every tenant', async () => {
    mount([entry({ has_file: true, published: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith(
        '/api/platform/catalog-templates/c1/publish',
        expect.objectContaining({ query: { published: false } }),
      ),
    );
  });

  it('uploads a chosen PDF against the right entry', async () => {
    mount([entry({ id: 'c2', title: 'Mutual NDA' }), entry({ id: 'c1' })]);
    // The second row's button, to prove the upload is not hardwired to the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload PDF' })[1]);
    choose(pdf());

    await waitFor(() => {
      const call = apiCall.mock.calls.find(c => String(c[0]).endsWith('/file'));
      expect(call?.[0]).toBe('/api/platform/catalog-templates/c1/file');
      expect((call?.[1] as { formData?: FormData }).formData).toBeInstanceOf(FormData);
    });
  });

  it('offers to replace a PDF that is already attached', () => {
    mount([entry({ has_file: true })]);
    expect(screen.getByRole('button', { name: 'Replace PDF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).toBeNull();
  });

  it('rejects an unsupported file locally rather than spending the upload', async () => {
    mount([entry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }));
    choose(new File([new Uint8Array([1, 2])], 'form.zip', { type: 'application/zip' }));

    await waitFor(() => expect(toast()).toMatch(/cannot be uploaded/));
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit locally', async () => {
    mount([entry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }));
    const big = new File([new Uint8Array([1])], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    choose(big);

    await waitFor(() => expect(toast()).toMatch(/too large/));
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('reports a failed upload instead of implying it worked', async () => {
    mount([entry()]);
    apiCall.mockResolvedValue(fail('PDF could not be read'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' }));
    choose(pdf());

    await waitFor(() => expect(toast()).toMatch(/PDF could not be read/));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('confirms a delete and tells the curator what it does not affect', async () => {
    mount([entry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/keep their own copy/)).toBeTruthy();
    expect(apiCall).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/platform/catalog-templates/c1', expect.objectContaining({ method: 'DELETE' })),
    );
  });

  it('seeds the built-in blueprints from an empty catalog', async () => {
    mount([]);
    expect(screen.getByText('No forms in the catalog yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add built-in blueprints' })[0]);
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/platform/catalog-templates/seed', expect.anything()),
    );
  });

  it('opens the builder on a draft template to place fields', async () => {
    mount([entry({ has_file: true, field_count: 0 })]);
    apiCall.mockResolvedValue(ok({ id: 'tpl_1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Place fields' }));

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/platform/catalog-templates/c1/draft-template', expect.anything()),
    );
    // Placement is authored in the ordinary builder, not a second editor.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/documents/tpl_1/prepare'));
  });

  it('says "Edit fields" once an entry already has placement', () => {
    mount([entry({ has_file: true, field_count: 6 })]);
    expect(screen.getByRole('button', { name: 'Edit fields' })).toBeTruthy();
  });

  it('stays put when the draft cannot be opened', async () => {
    mount([entry({ field_count: 0 })]);
    apiCall.mockResolvedValue(fail('no draft for you'));
    fireEvent.click(screen.getByRole('button', { name: 'Place fields' }));

    await waitFor(() => expect(toast()).toMatch(/Could not open the builder/));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the details dialog on the entry that was clicked', async () => {
    mount([entry({ id: 'c2', title: 'Mutual NDA' }), entry({ id: 'c1', title: 'IRS Form W-9' })]);
    // The second row, to prove the dialog is not hardwired to the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit details' })[1]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Form details')).toBeTruthy();
    expect((within(dialog).getByDisplayValue('IRS Form W-9') as HTMLInputElement).value).toBe('IRS Form W-9');
  });

  it('reports a failed load instead of showing an empty catalog', () => {
    mount([], 'gateway down');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No forms in the catalog yet')).toBeNull();
  });
});

describe('viewing the PDF behind an entry', () => {
  it('offers View only once a file is attached, and opens it in a tab', async () => {
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origOpen = window.open;
    URL.createObjectURL = vi.fn(() => { created.push('blob:catalog'); return 'blob:catalog'; }) as never;
    URL.revokeObjectURL = vi.fn() as never;
    const open = vi.fn(() => ({}) as Window);
    window.open = open as never;
    apiDownload.mockResolvedValue(ok({ blob: new Blob(['%PDF']), filename: 'irs-w9.pdf' }));

    try {
      mount([entry({ has_file: false })]);
      expect(screen.queryByRole('button', { name: 'View' })).toBeNull();

      cleanup();
      mount([entry({ has_file: true })]);
      fireEvent.click(screen.getByRole('button', { name: 'View' }));

      await waitFor(() => expect(open).toHaveBeenCalled());
      expect(apiDownload.mock.calls[0][0]).toBe('/api/platform/catalog-templates/c1/pdf');
      expect(open.mock.calls[0]).toEqual(['blob:catalog', '_blank']);
      expect(created).toHaveLength(1);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      window.open = origOpen;
    }
  });

  it('says so when the entry has no PDF on the server', async () => {
    apiDownload.mockResolvedValue({ ok: false as const, status: 404, error: { kind: 'client', status: 404, message: 'Nothing to download' } });
    mount([entry({ has_file: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(toast()).toContain('has no PDF yet'));
  });
});
