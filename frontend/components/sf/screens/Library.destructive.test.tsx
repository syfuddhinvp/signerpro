/**
 * Archive and Delete ask before they run.
 *
 * Both used to fire straight off the menu entry, so a mis-aimed click in a
 * dense row list silently moved a document out of the folder the user was
 * looking at — and in Trash, `purge` erased it for good with no way back. The
 * entries now go through `askConfirm`, and dismissing the dialog must leave the
 * API untouched. Restoring the other way (Unarchive, Restore) is not
 * destructive and deliberately stays one click.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Library, { type LibraryProps } from './Library';
import type { LibraryFilters, LibraryRow } from '@/lib/sf/adapters';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCall(...args),
    apiDownload: vi.fn(async () => ({ ok: false, status: 404, error: { kind: 'client', status: 404, message: 'x' } })),
    saveBlob: vi.fn(),
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

function mount(props: Partial<LibraryProps> = {}) {
  const defaults: LibraryProps = {
    rows: [row()],
    total: 1,
    templates: [],
    templateTotal: 0,
    folderOptions: [],
    counts: {},
    initialFilters: {} as LibraryFilters,
  };
  return render(
    <SFProvider>
      <DialogProvider>
        <Library {...defaults} {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

/** Open the row's overflow menu and click one of its entries. The folder chips
 *  carry the same words, so the entry is picked by its menu role. */
function menu(label: string) {
  fireEvent.click(screen.getByLabelText('More actions'));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

/** The paths the screen asked for, in order. */
const paths = () => apiCall.mock.calls.map(c => c[0]);

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  apiCall.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe('Library · archive and delete confirmation', () => {
  it('archives a document only once the dialog is confirmed', async () => {
    mount();

    menu('Archive');

    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive this document?');
    expect(apiCall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));

    await waitFor(() => expect(paths()).toEqual(['/api/documents/doc-1/archive']));
  });

  it('leaves the document alone when the archive dialog is dismissed', async () => {
    mount();

    menu('Archive');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('asks before moving a document to Trash', async () => {
    mount();

    menu('Delete');

    expect(await screen.findByRole('dialog')).toHaveTextContent('Move this document to Trash?');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => expect(paths()).toEqual(['/api/documents/doc-1/trash']));
  });

  it('warns that a purge from Trash cannot be undone', async () => {
    mount({ initialFilters: { folder: 'trash' } as LibraryFilters });

    menu('Delete');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete this document permanently?');
    expect(dialog).toHaveTextContent('cannot be undone');

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(paths()).toEqual(['/api/documents/bulk']));
    expect(apiCall.mock.calls[0][1]).toMatchObject({ body: { document_ids: ['doc-1'], action: 'purge' } });
  });

  it('restores from the Archive folder without asking', async () => {
    mount({ initialFilters: { folder: 'archive' } as LibraryFilters });

    menu('Archive');

    await waitFor(() => expect(paths()).toEqual(['/api/documents/doc-1/unarchive']));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks once for a whole selection before archiving it', async () => {
    mount({ rows: [row(), row({ documentId: 'doc-2', title: 'Second' })], total: 2 });

    fireEvent.click(screen.getAllByLabelText('Select')[0]);
    fireEvent.click(screen.getAllByLabelText('Select')[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive 2 documents?');
    expect(apiCall).not.toHaveBeenCalled();

    // The bulk bar's button and the dialog's CTA share a label; the dialog's is last.
    const confirm = screen.getAllByRole('button', { name: /^Archive$/ });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() => expect(paths()).toEqual(['/api/documents/bulk']));
    expect(apiCall.mock.calls[0][1]).toMatchObject({ body: { document_ids: ['doc-1', 'doc-2'], action: 'archive' } });
  });
});
