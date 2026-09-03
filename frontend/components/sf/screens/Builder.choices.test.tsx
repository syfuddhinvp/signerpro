/**
 * Authoring a dropdown / radio group's choices.
 *
 * `options` round-tripped through the API all along, but nothing in the
 * builder could ever set it: a sender could place a Dropdown or a Radio Group
 * and the signing surface then told the recipient "No choices were set for this
 * field — ask the sender to add them", with no way for the sender to comply.
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

/* pdf.js cannot draw in jsdom, so the page box is stubbed and the builder's own
   overlay — the field boxes and their labels — is what the test drives. */
vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ renderOverlay, pageBoxProps }: {
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
    pageBoxProps?: (g: { page: number }) => Record<string, unknown>;
  }) => {
    const geometry = { page: 1, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 };
    const extra = pageBoxProps ? pageBoxProps(geometry) : {};
    return <div data-pdf-page={1} {...extra}>{renderOverlay ? renderOverlay(geometry) : null}</div>;
  },
}));

const recipient: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const field = (type: FieldResponse['type']): FieldResponse => ({
  id: 'fld-1', document_id: 'doc-7', recipient_id: 'rec-1', type, label: 'Pick one',
  required: true, page_number: 1, x: 40, y: 40, width: 180, height: 40,
  placeholder: null, default_value: null, value: null, options: null, is_locked: false,
  validation: 'none', validation_pattern: null, condition: null, merge_tag: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
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
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/fields' && init?.method === 'PUT');

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
  vi.useRealTimers();
});

describe('the inspector authors the choices a dropdown offers', () => {
  it('writes the typed lines back as the field options', async () => {
    mount([field('dropdown')]);
    fireEvent.pointerDown(screen.getByLabelText(/Dropdown for Buyer/i));

    const box = screen.getByLabelText(/Choices/i);
    fireEvent.change(box, { target: { value: 'Yes\nNo\n\n Not applicable ' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const body = savedFields().at(-1)![1].body as { fields: { options: unknown }[] };
    expect(body.fields[0].options).toEqual(['Yes', 'No', 'Not applicable']);
  });

  it('says so while the field still has nothing to offer', () => {
    mount([field('radio')]);
    fireEvent.pointerDown(screen.getByLabelText(/Radio Group for Buyer/i));
    // Both the inspector and the field's own preview on the page say so.
    expect(screen.getAllByText(/No choices yet/i).length).toBe(2);
  });

  it('offers no choice box for a field type that has no choices', () => {
    mount([field('text')]);
    fireEvent.pointerDown(screen.getByLabelText(/Text Input for Buyer/i));
    expect(screen.queryByLabelText(/Choices/i)).toBeNull();
  });

  it('pre-fills a default value the signer will see', async () => {
    mount([field('text')]);
    fireEvent.pointerDown(screen.getByLabelText(/Text Input for Buyer/i));
    fireEvent.change(screen.getByLabelText('Default value'), { target: { value: 'Acme Corp' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const body = savedFields().at(-1)![1].body as { fields: { default_value: unknown }[] };
    expect(body.fields[0].default_value).toBe('Acme Corp');
  });
});
