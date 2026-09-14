/**
 * Radio groups on the signing surface.
 *
 * A group is a set of `radio` fields, one per button, each drawn where the
 * sender placed it (`lib/sf/radioGroups.ts`). The group's answer is a single
 * value every member carries, which is what makes the choice exclusive and
 * what lets each button's own `required` be satisfied by one pick.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import Signer from './Signer';
import { toSignerFields, toSignValues } from '@/lib/sf/adapters';
import type { FieldResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ pages, renderOverlay }: {
    pages: number[];
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
  }) => (
    <>
      {pages.map(n => (
        <div key={n} data-pdf-page={n}>
          {renderOverlay ? renderOverlay({ page: n, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 }) : null}
        </div>
      ))}
    </>
  ),
}));

const RECIPIENTS = [{ id: 'r1', name: 'Sarah', email: 's@example.com', role: 'sign', color: '#4f46e5', order: 1, status: 'Viewed' }];
const CHOICES = ['Gold', 'Silver', 'Bronze'];

const button = (index: number, value: string | null = null): FieldResponse => ({
  id: 'fld-' + index, document_id: 'doc-7', recipient_id: 'r1', type: 'radio', label: 'Tier',
  required: true, page_number: 1, x: 60, y: 100 + index * 26, width: 20, height: 20,
  placeholder: null, default_value: null, value, is_locked: false,
  options: { kind: 'radio', group: 'rg-1', choice: CHOICES[index], choices: CHOICES, groupLabel: 'Tier' },
  validation: 'none', validation_pattern: null, condition: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

function mount(rows: FieldResponse[], onSaveValue?: (field: { id: string }, value: unknown) => void) {
  cleanup();
  const fields = toSignerFields(rows);
  return render(
    <SFProvider>
      <Signer
        fields={fields}
        initialValues={toSignValues(fields)}
        recipients={RECIPIENTS}
        pageCount={1}
        pdfUrl="/x.pdf"
        onSaveValue={onSaveValue as never}
      />
    </SFProvider>,
  );
}

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[];

describe('a radio group is answered once, wherever its buttons sit', () => {
  it('draws one button per field, named by its own choice', () => {
    mount([0, 1, 2].map(i => button(i)));
    expect(radios().length).toBe(3);
    expect(screen.getByLabelText(/Tier: Silver \(2 of 3\)/i)).toBeTruthy();
    // One question, so one radio group as far as the browser is concerned.
    expect(new Set(radios().map(input => input.name)).size).toBe(1);
  });

  it('picking one button answers the whole group, and only once', () => {
    const saved: [string, unknown][] = [];
    mount([0, 1, 2].map(i => button(i)), (field, value) => { saved.push([field.id, value]); });

    fireEvent.click(screen.getByLabelText(/Tier: Silver/i));

    expect(radios().map(input => input.checked)).toEqual([false, true, false]);
    // Every member is written, because the group's answer *is* the value each
    // of them holds — that is what makes the pick exclusive and what satisfies
    // the `required` each row carries.
    expect(saved).toEqual([['fld-0', 'Silver'], ['fld-1', 'Silver'], ['fld-2', 'Silver']]);
  });

  it('shows the answer already stored for a returning signer', () => {
    mount([button(0, 'Bronze'), button(1, 'Bronze'), button(2, 'Bronze')]);
    expect(radios().map(input => input.checked)).toEqual([false, false, true]);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('still lists every choice in one box for a radio authored before groups', () => {
    mount([Object.assign(button(0), { id: 'legacy', options: ['Yes', 'No'] })]);
    expect(radios().length).toBe(2);
    expect(screen.getByText('Yes')).toBeTruthy();
  });
});
