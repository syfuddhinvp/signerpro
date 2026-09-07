/**
 * The sender's marks, on the signing surface (ANN-1).
 *
 * A recipient sees an annotation drawn on the page whoever it happens to be
 * assigned to — it is the document's content — and is never offered it as
 * something to fill in.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import Signer, { type PageAnnotation } from './Signer';
import type { SignerField } from '@/lib/sf/adapters';

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

const signable: SignerField = {
  id: 'f1', to: 'r1', type: 'text', label: 'Full name', page: 1,
  x: 100, y: 100, w: 180, h: 28, required: true, readOnly: false,
  placeholder: '', validation: 'none', cond: null,
  apiType: 'text', options: [], savedValue: null, defaultValue: null,
};

const RECIPIENTS = [{ id: 'r1', name: 'Sarah', email: 's@example.com', role: 'sign', color: '#4f46e5', order: 1, status: 'Viewed' }];

const note: PageAnnotation = {
  id: 'a1', type: 'textbox', page_number: 1, x: 60, y: 40, width: 240, height: 60,
  default_value: 'Countersigned in escrow',
  options: { kind: 'textbox', font: 'times', size: 14, bold: true, italic: false, color: '#1d4ed8' },
};

const doodle: PageAnnotation = {
  id: 'a2', type: 'drawing', page_number: 1, x: 60, y: 300, width: 120, height: 60,
  options: { kind: 'drawing', color: '#dc2626', stroke: 2, strokes: [[[0, 0], [1, 1]]] },
};

function mount(annotations: PageAnnotation[]) {
  return render(
    <SFProvider>
      <Signer fields={[signable]} recipients={RECIPIENTS} pageCount={1} annotations={annotations} pdfUrl="/x.pdf" />
    </SFProvider>,
  );
}

describe('page annotations on the signing surface', () => {
  it('draws the sender text in the face and size it was authored with', () => {
    mount([note]);
    const drawn = screen.getByText('Countersigned in escrow');
    expect(drawn.style.fontWeight).toBe('700');
    expect(drawn.style.fontSize).toBe('14px');
    expect(drawn.style.color).toBe('rgb(29, 78, 216)');
    // Inert: it must never swallow a tap meant for a field beneath it.
    expect(drawn.style.pointerEvents).toBe('none');
  });

  it('draws a pen stroke as a path, not as a box to fill in', () => {
    const { container } = mount([doodle]);
    const path = container.querySelector('svg path');
    expect(path).toBeTruthy();
    expect(path!.getAttribute('stroke')).toBe('#dc2626');
    expect(path!.getAttribute('d')).toBe('M0.00 0.00L120.00 60.00');
    // The signer is asked for one thing: the field that is actually theirs.
    expect(screen.getAllByLabelText(/Text Input/i).length).toBe(1);
  });

  it('draws nothing for an annotation with no mark on it yet', () => {
    const { container } = mount([{ ...note, default_value: '' }, { ...doodle, options: { kind: 'drawing', strokes: [] } }]);
    expect(container.querySelector('svg path')).toBeNull();
    expect(screen.queryByText('Countersigned in escrow')).toBeNull();
  });
});
