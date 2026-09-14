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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  to: 'r1', type: 'text', label: 'Field', page: 1,
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
    expect(tags[0].getAttribute('data-mark')).toBe('arrowRight');
    expect(tags[1].getAttribute('data-mark')).not.toBe('arrowRight');
  });

  it('scrolls the document — not the page box — to reach a field on a later page', () => {
    mount([field({ id: 'f1', label: 'Signature date', page: 3, y: 500 })]);
    const box = document.querySelector('[data-sf-scroll="1"]') as HTMLElement;
    const scrollTo = vi.fn();
    box.scrollTo = scrollTo as never;
    // jsdom lays nothing out, so the field's position is asserted directly.
    // Matched on the field's own label, not a bare name: the corner guide is
    // labelled with the same field name and would match too.
    const target = screen.getByLabelText(/— Signature date/).closest('div') as HTMLElement;
    box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600 }) as DOMRect;
    target.getBoundingClientRect = () => ({ top: 2400, height: 28, bottom: 2428 }) as DOMRect;
    Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });

    fireEvent.click(screen.getByRole('button', { name: 'Start signing' }));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    // 2400 down the scroll box, less the centring inset — not ~340 (y*scale).
    expect((scrollTo.mock.calls[0][0] as { top: number }).top).toBeCloseTo(2400 - 286, 0);
  });

  /**
   * Opening a part-finished 25-page envelope used to land on page 1, with the
   * guide naming a field a dozen pages away and no movement until the signer
   * found and pressed "Next required field".
   */
  it('lands on the first outstanding field when the envelope opens', async () => {
    vi.useFakeTimers();
    try {
      mount([
        field({ id: 'f2', label: 'Job title', page: 3, y: 400 }),
        field({ id: 'f1', label: 'Full name', page: 1, y: 200 }),
      ]);
      const box = document.querySelector('[data-sf-scroll="1"]') as HTMLElement;
      const scrollTo = vi.fn();
      box.scrollTo = scrollTo as never;
      box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600 }) as DOMRect;
      Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(box, 'scrollHeight', { value: 5000, configurable: true });
      // Reading order puts `f1` first, so that is what it must land on.
      const target = document.querySelector('[data-sf-field="f1"]') as HTMLElement;
      target.getBoundingClientRect = () => ({ top: 900, height: 28, bottom: 928 }) as DOMRect;

      await vi.advanceTimersByTimeAsync(300);

      expect(scrollTo).toHaveBeenCalledTimes(1);
      const call = scrollTo.mock.calls[0][0] as { top: number; behavior: string };
      expect(call.top).toBeCloseTo(900 - 286, 0);
      // Instant, not smooth: a 25-page jump animated is seconds of scenery
      // before the signer can act.
      expect(call.behavior).toBe('auto');

      // Once only — it must not re-land and fight the signer later.
      await vi.advanceTimersByTimeAsync(3000);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the document alone if the signer scrolls before it can land', async () => {
    vi.useFakeTimers();
    try {
      mount([field({ id: 'f1', label: 'Full name', page: 3, y: 200 })]);
      const box = document.querySelector('[data-sf-scroll="1"]') as HTMLElement;
      const scrollTo = vi.fn();
      box.scrollTo = scrollTo as never;
      box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600 }) as DOMRect;
      Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(box, 'scrollHeight', { value: 5000, configurable: true });
      const target = document.querySelector('[data-sf-field="f1"]') as HTMLElement;
      target.getBoundingClientRect = () => ({ top: 900, height: 28, bottom: 928 }) as DOMRect;

      // The signer got there first. Arriving to find the page yanked out from
      // under you is worse than arriving at the top.
      fireEvent.wheel(box);
      await vi.advanceTimersByTimeAsync(3000);

      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the corner guide up even when the field is already in view', async () => {
    mount([field({ id: 'f1', label: 'Full name', type: 'signature' })]);
    const box = document.querySelector('[data-sf-scroll="1"]') as HTMLElement;
    const target = screen.getByLabelText(/— Full name/).closest('div') as HTMLElement;
    box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600 }) as DOMRect;
    target.getBoundingClientRect = () => ({ top: 120, height: 28, bottom: 148 }) as DOMRect;
    fireEvent.scroll(box);
    // Not hidden because the field happens to be on screen — it says so.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign here · Full name' })).toBeTruthy());
  });

  it('says nothing is left once every required field is done', () => {
    mount([field({ id: 'f1', label: 'Full name', required: false })]);
    expect(screen.getByText('Nothing left to complete')).toBeTruthy();
  });
});
