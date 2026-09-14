/**
 * Walking a multi-page envelope: after each signature the surface must carry
 * the signer *down* the document to the next required field and come to rest
 * there — the real documents this is for are 25 pages with one signature per
 * page, so a guide that stalls leaves the signer hunting.
 *
 * The subtlety this file exists to pin: `Signer` tracks the current field in
 * SF state (`activeSignField`, which the auto-advance effect moves), while
 * `SignSurface` tracks it in its own `activeField` ref, written only by
 * `openSignature`. If the advance moves one and not the other, the *next*
 * signature is written back against the previous field's id — the signer
 * sees "Signature applied", the count never rises, and the guide never leaves
 * the field it is already on.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import type { SignerField } from '@/lib/sf/adapters';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

/* pdf.js cannot draw in jsdom; every page still mounts its overlay, which is
   what the real `PdfPages` does too (only the canvas bitmap is lazy). */
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

const saveSignature = vi.fn().mockResolvedValue({ ok: true, message: 'Signature applied' });
vi.mock('@/app/sign/[token]/actions', () => ({
  markViewed: vi.fn().mockResolvedValue({ ok: true, message: 'Envelope opened' }),
  completeSigning: vi.fn().mockResolvedValue({ ok: true, message: 'Done' }),
  declineSigning: vi.fn(),
  reassignSigning: vi.fn(),
  saveFieldValue: vi.fn().mockResolvedValue({ ok: true, message: 'Saved' }),
  saveSignature: (...args: unknown[]) => saveSignature(...args),
  uploadAttachment: vi.fn(),
  createPaymentIntent: vi.fn(),
  refreshPayment: vi.fn(),
  getPayment: vi.fn().mockResolvedValue({ ok: true, data: null }),
  getPaymentFieldConfig: vi.fn().mockResolvedValue({ ok: true, data: null }),
}));

const RECIPIENTS = [{ id: 'r1', name: 'Arefin', email: 'a@example.com', role: 'sign', color: '#4f46e5', order: 1, status: 'Viewed' }];

/* One signature per page, exactly as the real envelope places them: identical
   x/y on every page, so page number is the only thing ordering them. */
const sig = (id: string, page: number): SignerField => ({
  id, to: 'r1', type: 'signature', label: 'Signature', page,
  x: 224, y: 512, w: 200, h: 56, required: true, readOnly: false,
  placeholder: '', validation: 'none', cond: null,
  apiType: 'signature', options: [], savedValue: null, defaultValue: null,
} as unknown as SignerField);

async function mountSurface(fields: SignerField[]) {
  cleanup();
  const { default: SignSurface } = await import('@/app/sign/[token]/SignSurface');
  return render(
    <React.StrictMode>
    <SFProvider>
      <SignSurface
        token="tok1"
        fields={fields}
        recipients={RECIPIENTS as never}
        initialValues={{}}
        pageCount={fields.length}
        readOnly={false}
        canDecline
        canReassign
        signerName="Arefin"
        documentTitle="Vehicle Data Sheet"
        pdfHref="/sign/tok1/pdf"
        consentVersion="1.0"
        otherPlacements={[]}
        annotations={[]}
      />
    </SFProvider>
    </React.StrictMode>,
  );
}

/** Type a signature into the open modal and adopt it. */
function adoptTyped() {
  fireEvent.click(screen.getByRole('tab', { name: 'Type' }));
  fireEvent.change(screen.getByLabelText('Typed signature text'), { target: { value: 'Arefin' } });
  fireEvent.click(screen.getByRole('button', { name: /Adopt and sign/i }));
}

beforeEach(() => { cleanup(); saveSignature.mockClear(); });

describe('walking a signature per page', () => {
  it('writes each signature against its own field, not the one before it', async () => {
    await mountSurface([sig('sig1', 1), sig('sig2', 2), sig('sig3', 3)]);

    // Page 1 is the topmost outstanding field, so the guide starts there.
    expect(screen.getByText('Next: Signature · page 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start signing' }));
    adoptTyped();
    await waitFor(() => expect(saveSignature).toHaveBeenCalledTimes(1));
    expect(saveSignature.mock.calls[0][1]).toBe('sig1');

    // The advance must now have moved the guide to page 2 and left focus on
    // that field, so the signer can simply sign again.
    await waitFor(() => expect(screen.getByText('Next: Signature · page 2')).toBeTruthy());
    await waitFor(() => {
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.closest('[data-sf-field="sig2"]')).toBeTruthy();
    });

    // Sign again from exactly where the advance left them: pressing the
    // focused field, without hunting for it. This is the step that regresses
    // if only one of the two "current field" trackers moved.
    fireEvent.click(document.activeElement as HTMLElement);
    adoptTyped();
    await waitFor(() => expect(saveSignature).toHaveBeenCalledTimes(2));
    expect(saveSignature.mock.calls[1][1]).toBe('sig2');

    await waitFor(() => expect(screen.getByText('Next: Signature · page 3')).toBeTruthy());
    expect(screen.getByText(/2 of 3 required fields completed/)).toBeTruthy();
  });
});
