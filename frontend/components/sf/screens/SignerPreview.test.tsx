/**
 * The preview frame around the signer surface.
 *
 * The thing worth pinning here is that it is a *frame*: the surface inside is
 * whatever it was handed, unaltered, so a preview cannot drift from what the
 * recipient is actually sent. Everything else — the recipient switch, the
 * viewport, the way back — is chrome, and all of it addressable.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { resetNavigation } from '@/test/navigation';
import SignerPreview from './SignerPreview';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const RECIPIENTS = [
  { id: 'r1', name: 'Sarah Mitchell', role: 'sign', fieldCount: 3 },
  { id: 'r2', name: 'Dev Patel', role: 'sign', fieldCount: 1 },
];

function mount(selectedId: string | null = 'r1') {
  cleanup();
  return render(
    <SFProvider>
      <SignerPreview documentId="doc-7" recipients={RECIPIENTS} selectedId={selectedId}>
        <div data-testid="surface">the signer surface</div>
      </SignerPreview>
    </SFProvider>,
  );
}

const hrefOf = (label: string | RegExp) =>
  (screen.getByRole('link', { name: label }) as HTMLAnchorElement).getAttribute('href');

beforeEach(() => resetNavigation());

describe('SignerPreview', () => {
  it('renders the surface it is given, untouched', () => {
    mount();
    expect(screen.getByTestId('surface').textContent).toBe('the signer surface');
  });

  it('says nothing typed here is kept', () => {
    mount();
    /* A preview of the real thing, against the real document, is exactly the
       thing a sender would assume saves. It has to say that it does not. */
    expect(screen.getByRole('status').textContent).toMatch(/not saved/i);
  });

  it('offers the way back to the prepare step for this envelope', () => {
    mount();
    expect(hrefOf(/Back to editing/)).toBe('/documents/doc-7/prepare');
  });

  it('switches recipient by URL, staying on this envelope', () => {
    mount();
    expect(hrefOf(/Dev Patel/)).toBe('/documents/doc-7/signer-view?recipient=r2');
  });

  it('marks the recipient being previewed', () => {
    mount('r2');
    const current = document.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain('Dev Patel');
  });

  it('shows how much each recipient is being asked to do', () => {
    mount();
    expect(screen.getByRole('link', { name: /Sarah Mitchell/ }).textContent).toContain('3 fields');
  });

  it('starts on desktop and constrains the same surface for mobile', () => {
    mount();
    const viewport = () => document.querySelector('[data-preview-viewport]');
    expect(viewport()?.getAttribute('data-preview-viewport')).toBe('desktop');

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(viewport()?.getAttribute('data-preview-viewport')).toBe('mobile');
    /* Still one surface, now inside a narrower frame — not a second rendering
       that could disagree with the first. */
    expect(screen.getAllByTestId('surface').length).toBe(1);
  });

  it('copes with an envelope that has no recipients yet', () => {
    cleanup();
    render(
      <SFProvider>
        <SignerPreview documentId="doc-7" recipients={[]} selectedId={null}>
          <div data-testid="surface" />
        </SignerPreview>
      </SFProvider>,
    );
    expect(screen.queryByText('PREVIEW AS')).toBeNull();
    expect(hrefOf(/Back to editing/)).toBe('/documents/doc-7/prepare');
  });
});
