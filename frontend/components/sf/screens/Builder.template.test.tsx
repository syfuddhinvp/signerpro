/**
 * "Save as template" in the builder header.
 *
 * The documents index has offered this from a row menu for a while, but the
 * screen where a sender actually finishes placing the fields — the builder —
 * had no way to keep that work as a blueprint. Making a template copies the
 * envelope, so the draft on screen is untouched and the sender can still send
 * it; a document that already *is* a template has nothing to make.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetNavigation } from '@/test/navigation';
import { SFProvider, useSF } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
  errorMessage: (res: { ok: boolean; error?: { message?: string } }) => (res.ok ? '' : res.error?.message ?? ''),
}));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

function mount(isTemplate = false) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder
        documentId="doc_1"
        title="MSA"
        pageCount={1}
        fields={[]}
        recipients={[]}
        routing={null}
        isTemplate={isTemplate}
      />
      <Toast />
    </DialogProvider></SFProvider>,
  );
}

const toast = () => screen.getByTestId('toast').textContent ?? '';
const templateButton = () => screen.getByRole('button', { name: 'Save as template' });
const confirmDialog = async () => {
  const cta = await screen.findByRole('button', { name: 'Save template' });
  fireEvent.click(cta);
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNavigation();
  apiCall.mockResolvedValue(ok({}));
});

describe('saving a draft as a template from the builder', () => {
  it('offers the action on an ordinary draft', () => {
    mount();
    expect(templateButton()).toBeTruthy();
  });

  it('hides it on a document that is already a template', () => {
    mount(true);
    expect(screen.queryByRole('button', { name: 'Save as template' })).toBeNull();
  });

  it('names the new template after the document by default', async () => {
    mount();
    fireEvent.click(templateButton());
    const input = await screen.findByDisplayValue('MSA (Template)');
    expect(input).toBeTruthy();
    await confirmDialog();

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/documents/doc_1/make-template', expect.anything()),
    );
    await waitFor(() => expect(toast()).toMatch(/MSA \(Template\) saved to your templates/));
  });

  it('says when the copy failed rather than implying it saved', async () => {
    mount();
    apiCall.mockResolvedValue(fail('Monthly document limit reached'));
    fireEvent.click(templateButton());
    await confirmDialog();
    await waitFor(() => expect(toast()).toMatch(/Monthly document limit reached/));
  });
});
