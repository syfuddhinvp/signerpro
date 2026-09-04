/** THROWAWAY QA PROBE - delete after the audit. */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from '@/components/sf/screens/Builder';
import type { FieldResponse, RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...a: unknown[]) => apiCall(...a) }));

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ renderOverlay, pageBoxProps }: {
    renderOverlay?: (g: Record<string, number>) => React.ReactNode;
    pageBoxProps?: (g: { page: number }) => Record<string, unknown>;
  }) => {
    const g = { page: 1, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 };
    const extra = pageBoxProps ? pageBoxProps(g) : {};
    return <div data-pdf-page={1} {...extra}>{renderOverlay ? renderOverlay(g) : null}</div>;
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
  id: 'fld-1', document_id: 'doc-7', recipient_id: 'rec-1', type: 'formula', label: 'Total',
  required: true, page_number: 1, x: 40, y: 40, width: 180, height: 40,
  placeholder: null, default_value: null, value: null, options: null, is_locked: false,
  validation: 'none', validation_pattern: null, condition: null, merge_tag: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', ...over,
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

const savedFields = () =>
  apiCall.mock.calls.filter(([p, i]) => p === '/api/documents/doc-7/fields' && i?.method === 'PUT');

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
});

describe('PROBE: Builder calculated-field UI', () => {
  it('shows the Expression input for a formula field', () => {
    mount([field({})]);
    fireEvent.pointerDown(screen.getByLabelText(/Calculated for Buyer/i));
    expect(screen.getByLabelText(/Expression/i)).toBeTruthy();
    expect(screen.getAllByText(/No expression yet/i).length).toBeGreaterThan(0);
  });

  it('does NOT show Expression for a non-formula field', () => {
    mount([field({ type: 'text', label: 'Name' })]);
    fireEvent.pointerDown(screen.getByLabelText(/Text Input for Buyer/i));
    expect(screen.queryByLabelText(/Expression/i)).toBeNull();
  });

  it('persists the typed expression as options.expression', async () => {
    mount([field({})]);
    fireEvent.pointerDown(screen.getByLabelText(/Calculated for Buyer/i));
    fireEvent.change(screen.getByLabelText(/Expression/i), { target: { value: '{{subtotal}} * 0.2' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const body = savedFields().at(-1)![1].body as { fields: { options: unknown }[] };
    // eslint-disable-next-line no-console
    console.log('PROBE saved options =', JSON.stringify(body.fields.map(f => f.options)));
    expect(body.fields.some(f => JSON.stringify(f.options).includes('subtotal'))).toBe(true);
  });

  it('reads an existing expression back out of options', () => {
    mount([field({ options: { expression: '{{a}} + {{b}}' } as never })]);
    fireEvent.pointerDown(screen.getByLabelText(/Calculated for Buyer/i));
    const input = screen.getByLabelText(/Expression/i) as HTMLInputElement;
    // eslint-disable-next-line no-console
    console.log('PROBE roundtrip value =', JSON.stringify(input.value));
    expect(input.value).toBe('{{a}} + {{b}}');
  });

  it('merge-tag buttons append to the expression', async () => {
    mount([field({}), field({ id: 'fld-2', type: 'number', label: 'Sub', merge_tag: '{{sub}}' })]);
    fireEvent.pointerDown(screen.getByLabelText(/Calculated for Buyer/i));
    const btn = screen.queryByRole('button', { name: '{{sub}}' });
    // eslint-disable-next-line no-console
    console.log('PROBE merge button present =', !!btn);
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    await waitFor(() => {
      expect((screen.getByLabelText(/Expression/i) as HTMLInputElement).value).toBe('{{sub}}');
    });
  });

  it('an array options value does not crash the formula inspector', () => {
    mount([field({ options: ['a', 'b'] as never })]);
    fireEvent.pointerDown(screen.getByLabelText(/Calculated for Buyer/i));
    const input = screen.getByLabelText(/Expression/i) as HTMLInputElement;
    // eslint-disable-next-line no-console
    console.log('PROBE array-options fallback value =', JSON.stringify(input.value));
    expect(input.value).toBe('');
  });
});
