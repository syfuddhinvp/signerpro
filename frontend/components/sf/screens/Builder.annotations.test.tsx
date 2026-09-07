/**
 * The sender's own marks on the page (ANN-1): a pen drawing and a text box.
 *
 * These are the two palette entries that are not a recipient's obligation, so
 * what is pinned here is the authoring path — a gesture becomes a stroke, a
 * face and a size become the text's — and the fact that the inspector stops
 * offering an annotation the settings that only mean something for a field
 * somebody has to fill in.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';
import type { FieldResponse, RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ renderOverlay, pageBoxProps }: {
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
    pageBoxProps?: (g: { page: number }) => Record<string, unknown>;
  }) => {
    const geometry = { page: 1, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 };
    const extra = pageBoxProps ? pageBoxProps(geometry) : {};
    return <div data-testid="page-1" data-pdf-page={1} {...extra}>{renderOverlay ? renderOverlay(geometry) : null}</div>;
  },
}));

const recipient: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const field = (over: Partial<FieldResponse>): FieldResponse => ({
  id: 'fld-1', document_id: 'doc-7', recipient_id: 'rec-1', type: 'textbox', label: 'Text Box',
  required: false, page_number: 1, x: 40, y: 40, width: 220, height: 44,
  placeholder: null, default_value: null, value: null,
  options: { kind: 'textbox', font: 'helvetica', size: 12, bold: false, italic: false, color: '#0f172a' },
  is_locked: false, validation: 'none', validation_pattern: null, condition: null, read_only: true,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount(fields: FieldResponse[]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={fields} recipients={[recipient]} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

type SavedField = {
  type: string; read_only: boolean; required: boolean;
  default_value: unknown; options: Record<string, unknown>;
};

const savedFields = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/fields' && init?.method === 'PUT');

const lastSaved = () => (savedFields().at(-1)![1].body as { fields: SavedField[] }).fields;

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
  vi.useRealTimers();
});

describe('a text box is authored with its own text, face and size', () => {
  it('saves the text and the chosen font and size', async () => {
    mount([field({})]);
    fireEvent.pointerDown(screen.getByLabelText(/Text Box for Buyer/i));

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Countersigned in escrow' } });
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'times' } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: 'B' }));

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const saved = lastSaved()[0];
    expect(saved.type).toBe('textbox');
    expect(saved.default_value).toBe('Countersigned in escrow');
    expect(saved.options).toMatchObject({ font: 'times', size: 18, bold: true });
    // Whatever else changes, an annotation is never somebody's obligation.
    expect(saved.read_only).toBe(true);
    expect(saved.required).toBe(false);
  });

  it('draws its text on the page rather than its label', () => {
    mount([field({ default_value: 'Schedule 2 applies' })]);
    expect(screen.getByText('Schedule 2 applies')).toBeTruthy();
  });

  it('offers none of the settings that only mean something for an input', () => {
    mount([field({})]);
    fireEvent.pointerDown(screen.getByLabelText(/Text Box for Buyer/i));
    expect(screen.queryByLabelText('Validation')).toBeNull();
    expect(screen.queryByRole('switch', { name: /Required/i })).toBeNull();
    expect(screen.queryByLabelText('Trigger field')).toBeNull();
    expect(screen.queryByLabelText('Assigned recipient')).toBeNull();
  });
});

describe('the pen draws a stroke onto the page', () => {
  it('turns a drag into a drawing field, stored relative to its own box', async () => {
    mount([]);
    const pen = screen.getByLabelText(/Pick the pen up/i);
    fireEvent.click(pen);
    expect(screen.getByLabelText(/Put the pen down/i)).toBeTruthy();

    const page = screen.getByTestId('page-1');
    fireEvent.pointerDown(page, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 180 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 180, clientY: 100 });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const saved = lastSaved()[0];
    expect(saved.type).toBe('drawing');
    expect(saved.read_only).toBe(true);
    expect(saved.required).toBe(false);
    const strokes = saved.options.strokes as [number, number][][];
    expect(strokes).toHaveLength(1);
    // Normalised into the stroke's own box: the gesture's extremes land on the
    // box's edges whatever the zoom it was drawn at.
    expect(Math.min(...strokes[0].map(p => p[0]))).toBeCloseTo(0.025, 2);
    expect(Math.max(...strokes[0].map(p => p[1]))).toBeCloseTo(0.975, 2);
  });

  it('stays put until the pen is picked up', () => {
    mount([]);
    const page = screen.getByTestId('page-1');
    fireEvent.pointerDown(page, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 180 });
    fireEvent.pointerUp(window, { clientX: 180, clientY: 180 });
    // That was a lasso, not a stroke: no field was authored.
    expect(savedFields().length).toBe(0);
  });
});
