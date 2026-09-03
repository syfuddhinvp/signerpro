/**
 * The prepare screen on an envelope that has no recipients yet.
 *
 * This is the state a freshly uploaded PDF is in the moment its first field is
 * placed, and the state the builder sees whenever `GET /recipients` fails.
 * `recipIn` used to fall back to `R[0]` — `undefined` on an empty list — and
 * the next `.name` read threw, so the whole view was replaced by the in-app
 * error boundary ("This view failed to load").
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Builder from './Builder';
import type { FieldResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const field = (id: string): FieldResponse => ({
  id, document_id: 'doc-7', recipient_id: 'r-gone', page: 1, type: 'signature',
  x: 100, y: 120, width: 180, height: 44, required: true, read_only: false,
  label: 'Signature', placeholder: '', validation_regex: null, merge_tag: null,
  conditional_field_id: null, conditional_operator: null, conditional_value: null,
  value: null, options: null, font_size: null, sort_order: 0,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
} as unknown as FieldResponse);

function mount(fields: FieldResponse[]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="Upload flow probe" pageCount={1} fields={fields} recipients={[]} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

beforeEach(() => resetNavigation());

describe('Builder with no recipients', () => {
  it('renders instead of throwing when fields reference nobody', () => {
    expect(() => mount([field('f1'), field('f2')])).not.toThrow();
    expect(screen.getByText('Prepare')).toBeTruthy();
  });

  it('renders with no fields and no recipients either', () => {
    expect(() => mount([])).not.toThrow();
  });

  it('offers the file picker when the envelope has no PDF', () => {
    cleanup();
    render(
      <SFProvider><DialogProvider>
        <Builder documentId="doc-7" hasFile={false} title="No PDF" pageCount={1} fields={[]} recipients={[]} routing={null} />
      </DialogProvider></SFProvider>,
    );
    expect(screen.getByLabelText('Choose a PDF to upload')).toBeTruthy();
  });
});
