/**
 * The signing surface's guide: where the next required field is, and getting
 * there.
 *
 * Scrolling used to be `element.offsetTop`, but a field is absolutely
 * positioned inside its own page box, so that number is its offset *within
 * that page*. "Next required field" therefore barely moved the document for
 * anything past page 1 — the signer was told to go somewhere and then left
 * looking at the same paper.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import Signer from './Signer';
import type { SignerField } from '@/lib/sf/adapters';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

/* pdf.js cannot draw in jsdom; every page still mounts, which is what makes a
   field on page 3 scrollable-to in the first place. */
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

const field = (over: Partial<SignerField> & { id: string }): SignerField => ({
  id: over.id, to: 'r1', type: 'text', label: 'Field', page: 1,
  x: 100, y: 100, w: 180, h: 28, required: true, readOnly: false,
  ...over,
} as SignerField);

const RECIPIENTS = [{ id: 'r1', name: 'Sarah', role: 'sign', color: '#4f46e5' }];

function mount(fields: SignerField[]) {
  cleanup();
  return render(
    <SFProvider>
      <Signer fields={fields} recipients={RECIPIENTS as never} pageCount={3} pdfUrl="/sign/tok/pdf" />
    </SFProvider>,
  );
}

beforeEach(() => cleanup());

describe('the signing surface guide', () => {
  it('names the next required field and the page it is on', () => {
    mount([
      field({ id: 'f2', label: 'Job title', page: 3, y: 400 }),
      field({ id: 'f1', label: 'Full name', page: 1, y: 200 }),
    ]);
    // Reading order, not authoring order: page 1 comes before page 3.
    expect(screen.getByText('Next: Full name · page 1')).toBeTruthy();
  });

  it('points at the next field on the page itself', () => {
    mount([field({ id: 'f1', label: 'Full name' }), field({ id: 'f2', label: 'Job title', y: 300 })]);
    const tags = screen.getAllByText(/Text/);
    expect(tags[0].textContent).toMatch(/^➜/);
    expect(tags[1].textContent).not.toMatch(/^➜/);
  });

  it('scrolls the document — not the page box — to reach a field on a later page', () => {
    mount([field({ id: 'f1', label: 'Signature date', page: 3, y: 500 })]);
    const box = document.querySelector('[data-sf-scroll="1"]') as HTMLElement;
    const scrollTo = vi.fn();
    box.scrollTo = scrollTo as never;
    // jsdom lays nothing out, so the field's position is asserted directly.
    const target = screen.getByLabelText(/Signature date/).closest('div') as HTMLElement;
    box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600 }) as DOMRect;
    target.getBoundingClientRect = () => ({ top: 2400, height: 28, bottom: 2428 }) as DOMRect;
    Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });

    fireEvent.click(screen.getByRole('button', { name: 'Start signing' }));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    // 2400 down the scroll box, less the centring inset — not ~340 (y*scale).
    expect((scrollTo.mock.calls[0][0] as { top: number }).top).toBeCloseTo(2400 - 286, 0);
  });

  it('says nothing is left once every required field is done', () => {
    mount([field({ id: 'f1', label: 'Full name', required: false })]);
    expect(screen.getByText('Nothing left to complete')).toBeTruthy();
  });
});
