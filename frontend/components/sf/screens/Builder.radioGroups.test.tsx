/**
 * Radio groups: one field per button.
 *
 * A radio group used to be a single field whose `options` listed every choice,
 * drawn as one box. The buttons could not be positioned — which is what a form
 * actually needs, because each button sits beside the line it answers — and the
 * only way to get them apart was to author one "group" per button, which the
 * API then treats as separate questions the signer answers all at once.
 *
 * So the group is now a set of `radio` fields tied together by their `options`
 * (`lib/sf/radioGroups.ts`), and this pins what the inspector does with it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';
import { radioOptions } from '@/lib/sf/radioGroups';
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

const CHOICES = ['Radio Button 1', 'Radio Button 2', 'Radio Button 3'];

/** One button of a three-button group, as the API stores it. */
const button = (index: number): FieldResponse => ({
  id: 'fld-' + index, document_id: 'doc-7', recipient_id: 'rec-1', type: 'radio', label: 'Radio Group',
  required: true, page_number: 1, x: 40, y: 40 + index * 26, width: 20, height: 20,
  placeholder: null, default_value: null, value: null, is_locked: false,
  options: { kind: 'radio', group: 'rg-1', choice: CHOICES[index], choices: CHOICES, groupLabel: 'Radio Group' },
  validation: 'none', validation_pattern: null, condition: null, read_only: false,
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

type SavedField = {
  label: string; required: boolean; recipient_id: string; default_value: unknown;
  x: number; y: number; options: Record<string, unknown> | unknown[] | null;
};
const lastSaved = () => (savedFields().at(-1)![1].body as { fields: SavedField[] }).fields;
const choicesOf = (rows: SavedField[]) => rows.map(row => radioOptions(row.options)?.choice ?? null);

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ok([]));
  vi.useRealTimers();
});

const select = (index: number) =>
  fireEvent.pointerDown(screen.getByLabelText(new RegExp('Radio Group — ' + CHOICES[index] + ' for Buyer', 'i')));

describe('a radio group is one field per button', () => {
  it('names each button in its own box, and says which one is selected', () => {
    mount([0, 1, 2].map(button));
    select(2);
    const boxes = [0, 1, 2].map(i => screen.getByLabelText('Radio button ' + (i + 1) + ' label') as HTMLInputElement);
    expect(boxes.map(box => box.value)).toEqual(CHOICES);
    // The inspector is about the group, but it is a single button that is
    // selected on the page — the header says which.
    expect(screen.getByText(/button 3 of 3/i)).toBeTruthy();
  });

  it('renames one button without disturbing the group it belongs to', async () => {
    mount([0, 1, 2].map(button));
    select(0);
    fireEvent.change(screen.getByLabelText('Radio button 1 label'), { target: { value: 'Gold' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const rows = lastSaved();
    expect(choicesOf(rows)).toEqual(['Gold', 'Radio Button 2', 'Radio Button 3']);
    // The closed set the API enforces is the group's, so every button carries
    // the whole list — all three have to see the rename.
    for (const row of rows) expect(radioOptions(row.options)!.choices).toEqual(['Gold', 'Radio Button 2', 'Radio Button 3']);
  });

  it('adds a button to the group, below the last one', async () => {
    mount([0, 1, 2].map(button));
    select(0);
    fireEvent.click(screen.getByText('Add option'));

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const rows = lastSaved();
    expect(rows.length).toBe(4);
    const added = rows.find(row => radioOptions(row.options)?.choice === 'Radio Button 4')!;
    expect(added).toBeTruthy();
    expect(radioOptions(added.options)!.group).toBe('rg-1');
    // Placed where it can be seen and dragged from, not on top of button 3.
    expect(Number(added.y)).toBeGreaterThan(Number(rows[2].y));
    for (const row of rows) expect(radioOptions(row.options)!.choices).toEqual(CHOICES.concat(['Radio Button 4']));
  });

  it('removes one button and leaves the rest a group', async () => {
    mount([0, 1, 2].map(button));
    select(1);
    fireEvent.click(screen.getByLabelText('Remove Radio Button 2'));

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const rows = lastSaved();
    expect(choicesOf(rows)).toEqual(['Radio Button 1', 'Radio Button 3']);
    for (const row of rows) expect(radioOptions(row.options)!.choices).toEqual(['Radio Button 1', 'Radio Button 3']);
  });

  it('pre-selects a button for the recipient, as the whole group\'s answer', async () => {
    mount([0, 1, 2].map(button));
    select(0);
    fireEvent.change(screen.getByLabelText('Pre-selected option'), { target: { value: 'Radio Button 2' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    // The group's answer is a value every button carries, so the pre-selection
    // is stored on all of them — each one then draws itself filled or not by
    // comparing that value with its own choice.
    for (const row of lastSaved()) expect(row.default_value).toBe('Radio Button 2');
  });

  it('applies the label, the recipient and required to every button', async () => {
    mount([0, 1, 2].map(button));
    select(0);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Payment terms' } });
    fireEvent.click(screen.getByRole('switch', { name: /required/i }));

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const rows = lastSaved();
    for (const row of rows) {
      expect(row.label).toBe('Payment terms');
      expect(radioOptions(row.options)!.groupLabel).toBe('Payment terms');
      // A group half of whose buttons demand an answer is not a question.
      expect(row.required).toBe(false);
    }
  });

  it('places three buttons, not one box, when the group is dropped on the page', async () => {
    mount([]);
    fireEvent.click(screen.getByLabelText(/^Place Radio Group/i));

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const rows = lastSaved();
    expect(choicesOf(rows)).toEqual(CHOICES);
    // One question: the same group id on all three, and the same list.
    expect(new Set(rows.map(row => radioOptions(row.options)!.group)).size).toBe(1);
    // Stacked down the page, each one draggable from where it landed.
    expect(Number(rows[1].y)).toBeGreaterThan(Number(rows[0].y));
    expect(Number(rows[1].x)).toBe(Number(rows[0].x));
  });

  it('outlines the group on the page, so its buttons read as one question', () => {
    mount([0, 1, 2].map(button));
    const outline = document.querySelector('[data-radio-group="rg-1"]') as HTMLElement;
    expect(outline).toBeTruthy();
    expect(outline.textContent).toBe('Radio Group');
    /* Around every button of the group and nothing else: the three buttons run
       from (40, 40) to (60, 112) in points, and at zoom 1 the outline is that
       box with a 7px margin of chrome around it. */
    expect(outline.style.left).toBe('33px');
    expect(outline.style.top).toBe('33px');
    expect(outline.style.width).toBe('34px');
    expect(outline.style.height).toBe('86px');
  });

  it('grows the outline when a button is dragged out of the group’s block', () => {
    const spread = [0, 1, 2].map(button);
    spread[2] = Object.assign({}, spread[2], { x: 300, y: 400 });
    mount(spread);
    const outline = document.querySelector('[data-radio-group="rg-1"]') as HTMLElement;
    // Still one outline, now reaching the button that was moved away.
    expect(document.querySelectorAll('[data-radio-group]').length).toBe(1);
    expect(outline.style.width).toBe('294px');
    expect(outline.style.height).toBe('394px');
  });

  it('draws no outline for a radio field that is not in a group', () => {
    mount([Object.assign(button(0), { id: 'legacy', options: ['Yes', 'No'] })]);
    expect(document.querySelectorAll('[data-radio-group]').length).toBe(0);
  });

  it('leaves a radio field authored before groups existed as it was', () => {
    mount([Object.assign(button(0), { id: 'legacy', options: ['Yes', 'No'] })]);
    fireEvent.pointerDown(screen.getByLabelText(/Radio Group for Buyer/i));
    // The choice-list editor, not the group's per-button one: a legacy radio is
    // one box holding every choice, so it has no buttons to list.
    expect(screen.getByRole('group', { name: 'Choices' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Radio buttons in this group/i })).toBeNull();
  });
});
