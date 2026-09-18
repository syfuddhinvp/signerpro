/**
 * "Print" and "Download" on a library card.
 *
 * `final-pdf` only exists once every signer has completed — the backend refuses
 * to build it earlier, deliberately, because that file is the sealed executed
 * record. Before then the card used to refuse outright ("No executed PDF yet"),
 * which is not what "Print" means to a sender looking at a draft. It now falls
 * back to the uploaded original and says so.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider, useSF } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Library, { type LibraryProps } from './Library';
import type { LibraryRow } from '@/lib/sf/adapters';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiDownload = vi.fn();
const saveBlob = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return {
    ...actual,
    apiCall: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    apiDownload: (...args: unknown[]) => apiDownload(...args),
    saveBlob: (...args: unknown[]) => saveBlob(...args),
  };
});

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'ENV-A1D07FDE',
  title: '5T3M796X loan options',
  pages: 10,
  status: 'draft',
  rawStatus: 'draft',
  signed: 0,
  total: 1,
  updated: '1 hour ago',
  to: [],
  documentId: 'doc-1',
  ownerName: 'Ada Lovelace',
  isFavorite: false,
  ...over,
});

/* `flash` writes to `s.toast`, which the app Shell renders — not this screen. */
function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

const toast = () => screen.getByTestId('toast').textContent ?? '';

function mount(props: Partial<LibraryProps> = {}) {
  const defaults: LibraryProps = {
    rows: [row()],
    total: 1,
    templates: [],
    templateTotal: 0,
    folderOptions: [],
    counts: {},
    initialFilters: {} as LibraryProps['initialFilters'],
  };
  return render(
    <SFProvider>
      <DialogProvider>
        <Library {...defaults} {...props} />
        <Toast />
      </DialogProvider>
    </SFProvider>,
  );
}

const blob = () => ({ ok: true as const, status: 200, data: { blob: new Blob(['%PDF']), filename: 'x.pdf' } });
const missing = () => ({ ok: false as const, status: 404, error: { kind: 'client', status: 404, message: 'Nothing to download' } });

/** Open the row's overflow menu and click one of its entries. */
function menu(label: string) {
  fireEvent.click(screen.getByLabelText('More actions'));
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiDownload.mockReset();
  saveBlob.mockReset();
  vi.spyOn(window, 'open').mockReturnValue({ addEventListener: vi.fn(), print: vi.fn() } as unknown as Window);
});

describe('Library · Print and Download', () => {
  it('falls back to the original PDF when nothing has been executed yet', async () => {
    apiDownload.mockImplementation(async (path: string) =>
      (path.includes('final-pdf') ? missing() : blob()));
    mount();

    menu('Download');

    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    const paths = apiDownload.mock.calls.map(c => c[0]);
    expect(paths).toEqual(['/api/documents/doc-1/final-pdf', '/api/documents/doc-1/pdf']);
    await waitFor(() => expect(toast()).toMatch(/not signed yet/));
  });

  it('prints the executed PDF without touching the original', async () => {
    apiDownload.mockResolvedValue(blob());
    mount({ rows: [row({ status: 'completed', rawStatus: 'completed', signed: 1 })] });

    menu('Print');

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(apiDownload.mock.calls.map(c => c[0])).toEqual(['/api/documents/doc-1/final-pdf']);
    expect(toast()).not.toMatch(/not signed yet/);
  });

  it('reports a document with no PDF at all rather than a missing signature', async () => {
    apiDownload.mockResolvedValue(missing());
    mount();

    menu('Print');

    await waitFor(() => expect(toast()).toMatch(/nothing has been uploaded yet/));
    expect(window.open).not.toHaveBeenCalled();
  });
});
