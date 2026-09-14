/**
 * The selected field's inline toolbar.
 *
 * Reassigning a field, duplicating it and deleting it used to live only in the
 * inspector rail and the canvas toolbar, a screen's width away from the field
 * they applied to. They now ride on the field itself, so what is pinned here
 * is that the bar acts on the selected field — and that pressing it neither
 * drags the field nor clears the selection out from under the press.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const recipient = (over: Partial<RecipientResponse>): RecipientResponse => ({
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const buyer = recipient({});
const seller = recipient({ id: 'rec-2', name: 'Seller', email: 'seller@example.com', signing_order: 2, color: '#0891b2' });

const signature: FieldResponse = {
  id: 'fld-1', document_id: 'doc-7', recipient_id: 'rec-1', type: 'signature', label: 'Signature',
  required: true, page_number: 1, x: 60, y: 300, width: 180, height: 40,
  placeholder: null, default_value: null, value: null, options: null,
  is_locked: false, validation: 'none', validation_pattern: null, condition: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount(fields: FieldResponse[], recipients: RecipientResponse[] = [buyer, seller]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={fields} recipients={recipients} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const select = () => fireEvent.pointerDown(screen.getByLabelText(/Signature for Buyer/i));
const toolbar = () => screen.getByRole('toolbar', { name: /Signature field/i });

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
  vi.useRealTimers();
});

describe('the selected field carries its own toolbar', () => {
  it('stays hidden until a field is selected', async () => {
    mount([signature]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    expect(screen.queryByRole('toolbar', { name: /Signature field/i })).toBeNull();
    select();
    expect(toolbar()).toBeTruthy();
  });

  it('reassigns the field from the bar, without opening the rail', async () => {
    mount([signature]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    select();
    // The rail carries a picker of its own; this is the one on the page.
    const picker = within(toolbar()).getByRole('combobox', { name: 'Assigned recipient' });
    fireEvent.change(picker, { target: { value: 'rec-2' } });
    await waitFor(() => screen.getByLabelText(/Signature for Seller/i));
  });

  it('duplicates and deletes the selected field', async () => {
    mount([signature]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    select();
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Duplicate field' }));
    await waitFor(() => expect(screen.getAllByLabelText(/Signature for/i).length).toBe(2));

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete field' }));
    await waitFor(() => expect(screen.getAllByLabelText(/Signature for/i).length).toBe(1));
  });

  it('sends Edit to the inspector rather than duplicating the rail', async () => {
    mount([signature]);
    await waitFor(() => screen.getByLabelText(/Signature for Buyer/i));
    select();
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Edit field' }));
    const label = screen.getByRole('textbox', { name: 'Label' });
    expect(document.activeElement).toBe(label);
  });
});
