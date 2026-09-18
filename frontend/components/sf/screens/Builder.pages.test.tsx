/**
 * Page-level editing in the builder: copy a field to every page, delete a page,
 * change a page's number.
 *
 * A PDF arrives with a cover sheet nobody signs or with its exhibits in the
 * wrong order, and the API refuses a corrected re-upload — so the pages are
 * edited here, through `PUT /api/documents/{id}/pages`. What is pinned is the
 * order sent for each gesture (the server reads it as "the pages to keep, in
 * this order"), that a page carrying fields is not dropped without a warning,
 * and that pending field edits are flushed before the server renumbers the
 * rows it holds.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';
import type { FieldResponse, RecipientResponse } from '@/lib/api/types';

/* Every case here mounts the whole builder over a three-page document and waits
   on a debounced save, which runs past the 5s default when the suite is sharing
   cores with the rest of the screens. */
vi.setConfig({ testTimeout: 20_000 });

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
  errorMessage: (res: { ok: boolean; error?: { message: string } }) => (res.ok ? '' : res.error?.message ?? ''),
}));

/** Three pages, each rendering its own overlay, so a field can be on any of them. */
vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ pages, renderOverlay, pageBoxProps, onGeometry }: {
    pages: number[];
    onGeometry?: (sizes: { widthPt: number; heightPt: number }[]) => void;
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
    pageBoxProps?: (g: { page: number }) => Record<string, unknown>;
  }) => {
    // The real viewer reports each page's size once it has parsed the PDF.
    React.useEffect(() => {
      if (onGeometry) onGeometry(pages.map(() => ({ widthPt: 612, heightPt: 792 })));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages.length]);
    return (
    <>
      {pages.map(page => {
        const geometry = { page, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 };
        const extra = pageBoxProps ? pageBoxProps(geometry) : {};
        return (
          <div key={page} data-testid={'page-' + page} data-pdf-page={page} {...extra}>
            {renderOverlay ? renderOverlay(geometry) : null}
          </div>
        );
      })}
    </>
    );
  },
}));

const recipient: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const signature = (over: Partial<FieldResponse> = {}): FieldResponse => ({
  id: 'fld-1', document_id: 'doc-7', recipient_id: 'rec-1', type: 'signature', label: 'Signature',
  required: true, page_number: 1, x: 60, y: 300, width: 180, height: 40,
  placeholder: null, default_value: null, value: null, options: null,
  is_locked: false, validation: 'none', validation_pattern: null, condition: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount(fields: FieldResponse[], pageCount = 3) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={pageCount} fields={fields}
        recipients={[recipient]} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const pageCalls = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/pages' && init?.method === 'PUT');
const lastOrder = () => (pageCalls().at(-1)![1].body as { order: number[] }).order;
const addCalls = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/pages' && init?.method === 'POST');
const addBody = () => (addCalls().at(-1)![1].formData as FormData);
const savedFields = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/fields' && init?.method === 'PUT');

const confirmDialog = async (name: string | RegExp) => {
  const button = await screen.findByRole('button', { name });
  fireEvent.click(button);
};

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
  vi.useRealTimers();
});

describe('copying a field to every page', () => {
  it('puts a copy on each other page, at the same place', async () => {
    mount([signature()]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));

    fireEvent.click(within(screen.getByRole('toolbar', { name: /Signature field/i }))
      .getByRole('button', { name: 'Copy to every page' }));

    await waitFor(() => expect(screen.getAllByLabelText(/Signature for Buyer/i).length).toBe(3));
    // One per page, and none of them on top of another.
    expect(within(screen.getByTestId('page-2')).getAllByLabelText(/Signature for Buyer/i).length).toBe(1);
    expect(within(screen.getByTestId('page-3')).getAllByLabelText(/Signature for Buyer/i).length).toBe(1);
  });

  it('does not stack a second copy when pressed twice', async () => {
    mount([signature()]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));
    const press = () => fireEvent.click(within(screen.getByRole('toolbar', { name: /Signature field/i }))
      .getByRole('button', { name: 'Copy to every page' }));

    press();
    await waitFor(() => expect(screen.getAllByLabelText(/Signature for Buyer/i).length).toBe(3));
    press();
    await waitFor(() => expect(screen.getAllByLabelText(/Signature for Buyer/i).length).toBe(3));
  });

  it('is not offered on a one-page document', async () => {
    mount([signature()], 1);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));
    expect(within(screen.getByRole('toolbar', { name: /Signature field/i }))
      .queryByRole('button', { name: 'Copy to every page' })).toBeNull();
  });
});

describe('deleting a page', () => {
  it('sends the pages that are kept, in order', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Delete page 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete page 2' }));
    await confirmDialog('Delete page');

    await waitFor(() => expect(pageCalls().length).toBe(1));
    expect(lastOrder()).toEqual([1, 3]);
  });

  it('says what a page is taking with it before it goes', async () => {
    mount([signature({ page_number: 2 })]);
    await waitFor(() => screen.getByRole('button', { name: 'Delete page 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete page 2' }));

    expect(await screen.findByText(/1 field on this page will be deleted with it/i)).toBeTruthy();
    // Abandoning the confirm leaves the document alone.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(pageCalls().length).toBe(0));
  });

  it('cannot take the last page of a document', async () => {
    mount([], 1);
    await waitFor(() => screen.getByRole('button', { name: 'Delete page 1' }));
    expect(screen.getByRole('button', { name: 'Delete page 1' })).toBeDisabled();
  });
});

describe('dragging a page to a new position', () => {
  /* jsdom has no drag implementation, so the rows are driven through the same
     event sequence a browser fires. Which half of the target row the pointer is
     in tells "before it" from "after it" — and jsdom reports no geometry for
     the rows and drops mouse coordinates from DragEvent, so these plain drags
     all read as "before". The lower-half case is fired as a MouseEvent below.*/
  const row = (n: number) => screen.getByRole('button', { name: 'Go to page ' + n }).parentElement!;
  const drag = (from: number, onto: number) => {
    fireEvent.dragStart(row(from));
    fireEvent.dragOver(row(onto));
    fireEvent.drop(row(onto));
  };

  it('drops a page into the slot it was dragged onto', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 3' }));
    drag(3, 1);

    await waitFor(() => expect(pageCalls().length).toBe(1));
    // Page 3 pulled out and put back at the front, the rest in order behind it.
    expect(lastOrder()).toEqual([3, 1, 2]);
  });

  it('moves a page down the document as well as up it', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 1' }));
    drag(1, 3);

    await waitFor(() => expect(pageCalls().length).toBe(1));
    expect(lastOrder()).toEqual([2, 1, 3]);
  });

  it('drops a page after the row when the pointer is in its lower half', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 3' }));
    const last = row(3);
    // The only way to reach "put it last" is the underside of the last row, so
    // the row has to report a height for the halves to exist.
    vi.spyOn(last, 'getBoundingClientRect').mockReturnValue(
      { top: 100, bottom: 160, height: 60, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) } as DOMRect,
    );
    fireEvent.dragStart(row(1));
    // jsdom's DragEvent drops mouse coordinates, so the pointer position is
    // fired as the MouseEvent the handler actually reads.
    fireEvent(last, new MouseEvent('dragover', { clientY: 150, bubbles: true, cancelable: true }));
    fireEvent.drop(last);

    await waitFor(() => expect(pageCalls().length).toBe(1));
    expect(lastOrder()).toEqual([2, 3, 1]);
  });

  it('does nothing when a page is dropped back on itself', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 2' }));
    drag(2, 2);

    await waitFor(() => expect(pageCalls().length).toBe(0));
  });

  it('abandons the drag without a rewrite', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 3' }));
    fireEvent.dragStart(row(3));
    fireEvent.dragOver(row(1));
    fireEvent.dragEnd(row(3));
    fireEvent.drop(row(1));

    await waitFor(() => expect(pageCalls().length).toBe(0));
  });

  it('is not offered on a one-page document', async () => {
    mount([], 1);
    await waitFor(() => screen.getByRole('button', { name: 'Go to page 1' }));
    expect(row(1).getAttribute('draggable')).toBe('false');
  });
});

describe('changing a page’s number', () => {
  it('swaps the page with the one it moves past', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Move page 1 down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 down' }));

    await waitFor(() => expect(pageCalls().length).toBe(1));
    // Page 2's content becomes page 1, page 1's becomes page 2, page 3 unmoved.
    expect(lastOrder()).toEqual([2, 1, 3]);
  });

  it('will not move a page off either end', async () => {
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Move page 1 up' }));
    expect(screen.getByRole('button', { name: 'Move page 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move page 3 down' })).toBeDisabled();
  });

  it('flushes pending field edits before the server renumbers them', async () => {
    mount([signature()]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));
    // An edit that has not been autosaved yet.
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Sign here' } });

    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    await waitFor(() => expect(pageCalls().length).toBe(1));

    const order = apiCall.mock.calls.map(([p, init]) => p + ':' + (init?.method ?? 'GET'));
    expect(order.indexOf('/api/documents/doc-7/fields:PUT'))
      .toBeLessThan(order.indexOf('/api/documents/doc-7/pages:PUT'));
    expect(savedFields().length).toBeGreaterThan(0);
  });

  it('leaves the document alone when the rewrite is refused', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'PUT') {
        return { ok: false, error: { kind: 'conflict', status: 409, message: 'Document cannot be edited in its current status' } };
      }
      return ok([]);
    });
    mount([]);
    await waitFor(() => screen.getByRole('button', { name: 'Move page 1 down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 down' }));

    await waitFor(() => expect(pageCalls().length).toBe(1));
    // The rail still shows three pages: nothing was renumbered locally on the
    // strength of a call the server refused. (The refusal itself reaches the
    // sender as a toast, which lives in the shell rather than this screen.)
    expect(screen.getByRole('button', { name: 'Delete page 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move page 1 up' })).toBeDisabled();
  });
});

/* Growing a document — `POST /api/documents/{id}/pages`. A late exhibit or a
   missing signature sheet has no other route in: the API refuses a second
   original, so before this the only fix was to start the envelope again. */
describe('adding a page', () => {
  const openAdd = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Add page' }));
  };

  it('appends a blank page by default', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.click(screen.getByRole('button', { name: 'Blank page' }));

    await waitFor(() => expect(addCalls().length).toBe(1));
    expect(addBody().get('blank_count')).toBe('1');
    // No `at` — the server appends.
    expect(addBody().get('at')).toBeNull();
    expect(addBody().get('upload')).toBeNull();
  });

  it('inserts after the page that was chosen', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /position/i }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Blank page' }));

    await waitFor(() => expect(addCalls().length).toBe(1));
    // "After page 2" is the page number the new page takes.
    expect(addBody().get('at')).toBe('3');
  });

  it('sends an image or a document as the pages to splice in', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 5 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    const picker = screen.getByLabelText('Choose a file to add as pages') as HTMLInputElement;
    const file = new File(['x'], 'exhibit.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file] });
    fireEvent.change(picker);

    await waitFor(() => expect(addCalls().length).toBe(1));
    expect(addBody().get('upload')).toBeInstanceOf(File);
    expect(addBody().get('blank_count')).toBeNull();
    // An image has no page size of its own; the default lays the whole of it
    // on a page the size of the one it joins.
    expect(addBody().get('fit')).toBe('fit');
  });

  it('sends the image fit the sender chose', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /image fit/i }), { target: { value: 'fill' } });
    const picker = screen.getByLabelText('Choose a file to add as pages') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'wide.png', { type: 'image/png' })] });
    fireEvent.change(picker);

    await waitFor(() => expect(addCalls().length).toBe(1));
    expect(addBody().get('fit')).toBe('fill');
  });

  /* "Choose the area…" holds the file back until a rectangle is picked: a
     photographed page otherwise brings the desk it was lying on with it. */
  it('sends the area chosen in the crop dialog, and nothing on a dismissal', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /image fit/i }), { target: { value: 'custom' } });
    const pickImage = () => {
      const picker = screen.getByLabelText('Choose a file to add as pages') as HTMLInputElement;
      Object.defineProperty(picker, 'files', { value: [new File(['x'], 'desk.png', { type: 'image/png' })], configurable: true });
      fireEvent.change(picker);
    };

    pickImage();
    const dialog = await screen.findByRole('dialog', { name: /choose the area/i });
    // Nothing is uploaded while the sender is still choosing.
    expect(addCalls().length).toBe(0);

    // The box starts on the whole image; shrink it from the bottom-right.
    const box = within(dialog).getByRole('group', { name: /selected area/i });
    box.focus();
    fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.click(within(dialog).getByRole('button', { name: /add this area/i }));

    await waitFor(() => expect(addCalls().length).toBe(1));
    const [x, y, width, height] = (addBody().get('crop') as string).split(',').map(Number);
    expect([x, y, height]).toEqual([0, 0, 1]);
    expect(width).toBeCloseTo(0.95, 5);
    // A crop is a rectangle plus a real fit — the API has no "custom".
    expect(addBody().get('fit')).toBe('fit');

    // Dismissing leaves the document alone. (A successful add closes the
    // popover, so the picker has to be opened again.)
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /image fit/i }), { target: { value: 'custom' } });
    pickImage();
    fireEvent.click(within(await screen.findByRole('dialog', { name: /choose the area/i }))
      .getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /choose the area/i })).toBeNull());
    expect(addCalls().length).toBe(1);
  });

  it('does not offer the whole image as a crop', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /image fit/i }), { target: { value: 'custom' } });
    const picker = screen.getByLabelText('Choose a file to add as pages') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'desk.png', { type: 'image/png' })] });
    fireEvent.change(picker);

    const dialog = await screen.findByRole('dialog', { name: /choose the area/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /add this area/i }));

    await waitFor(() => expect(addCalls().length).toBe(1));
    // An untouched box is not a crop; sending one would be a needless resample.
    expect(addBody().get('crop')).toBeNull();
  });

  it('leaves a PDF alone — only an image has an area to choose', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 6 });
      }
      return ok([]);
    });
    mount([]);
    await openAdd();
    fireEvent.change(screen.getByRole('combobox', { name: /image fit/i }), { target: { value: 'custom' } });
    const picker = screen.getByLabelText('Choose a file to add as pages') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'addendum.pdf', { type: 'application/pdf' })] });
    fireEvent.change(picker);

    await waitFor(() => expect(addCalls().length).toBe(1));
    expect(screen.queryByRole('dialog', { name: /choose the area/i })).toBeNull();
  });

  it('flushes pending field edits before the server renumbers them', async () => {
    apiCall.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/documents/doc-7/pages' && init?.method === 'POST') {
        return ok({ document: { id: 'doc-7' }, sha256: 'a', page_count: 4 });
      }
      return ok([]);
    });
    mount([signature()]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Sign here' } });

    await openAdd();
    fireEvent.click(screen.getByRole('button', { name: 'Blank page' }));
    await waitFor(() => expect(addCalls().length).toBe(1));

    const order = apiCall.mock.calls.map(([p, init]) => p + ':' + (init?.method ?? 'GET'));
    expect(order.indexOf('/api/documents/doc-7/fields:PUT'))
      .toBeLessThan(order.indexOf('/api/documents/doc-7/pages:POST'));
  });

  it('is not offered before the document has a PDF', async () => {
    cleanup();
    render(
      <SFProvider><DialogProvider>
        <Builder documentId="doc-7" hasFile={false} title="MSA" pageCount={1} fields={[]}
          recipients={[recipient]} routing={null} />
      </DialogProvider></SFProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Add page' })).toBeDisabled();
  });
});
