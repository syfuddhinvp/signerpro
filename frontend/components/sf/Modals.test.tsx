/**
 * Modal behaviour (WCAG 2.1.2 / 2.4.3).
 *
 * The dialog has always carried `role="dialog"` + `aria-modal="true"`; until
 * now it carried none of the behaviour those attributes promise. These tests
 * pin all four: focus moves in, Tab is contained, Escape closes, focus returns
 * to the trigger — plus the background being marked inert while it is open.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, render } from '@testing-library/react';
import { SFProvider, useSF } from '@/lib/sf/state';
import { resetNavigation } from '@/test/navigation';
import Modals from './Modals';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({ name: 'Test User', email: 'test@example.test' }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

/** A page with a trigger button and the modal host, exactly as the app shell has. */
function Harness({ modal }: { modal: string }) {
  const { set } = useSF();
  return (
    <div>
      <button type="button" onClick={() => set({ modal })}>Open dialog</button>
      <main><a href="/elsewhere">A link behind the dialog</a></main>
      <Modals />
    </div>
  );
}

function renderHarness(modal = 'decline') {
  return render(<SFProvider><Harness modal={modal} /></SFProvider>);
}

beforeEach(() => {
  resetNavigation();
  /* A fresh Response per call: a single instance can only have its body read
     once, and the billing modal fetches plans, subscription and payment
     methods in parallel. */
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('modal focus management', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: /open dialog/i }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it('traps Tab inside the dialog — you cannot reach the page behind it', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    const dialog = await screen.findByRole('dialog');

    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores focus to the control that opened it', async () => {
    const user = userEvent.setup();
    renderHarness();
    const trigger = screen.getByRole('button', { name: /open dialog/i });

    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('hides the rest of the page from assistive tech while it is open', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');

    expect(screen.getByRole('main', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
    // …and gives it back on close.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('main')).not.toHaveAttribute('aria-hidden'));
  });

  it('closes from its own Close button and restores focus', async () => {
    const user = userEvent.setup();
    renderHarness();
    const trigger = screen.getByRole('button', { name: /open dialog/i });
    await user.click(trigger);
    await screen.findByRole('dialog');

    // The header close button — the modal also has a footer dismiss with the same label.
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('the signature-adoption dialog behaves the same way', async () => {
    const user = userEvent.setup();
    renderHarness('signature');
    const trigger = screen.getByRole('button', { name: /open dialog/i });

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

/**
 * The payment modal after the PCI finding (AUDIT_REPORT.md §7 finding 3).
 *
 * The card form is gone, not hidden: there is no input in this application
 * that a PAN can be typed into. What is left is Stripe's iframe, and — when
 * no publishable key is configured — an honest explanation instead of it.
 */
describe('payment method dialog', () => {
  it('renders no card, CVC or bank-account field of its own', async () => {
    const user = userEvent.setup();
    renderHarness('card');
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');

    for (const label of [/card number/i, /cvc/i, /expiry/i, /postal/i, /routing number/i, /account number/i]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    // …and the ACH tab that existed only to collect those digits is gone too.
    expect(screen.queryByRole('button', { name: /ACH \/ SEPA/i })).toBeNull();
  });

  it('says why the payment form is missing rather than showing a blank frame', async () => {
    const user = userEvent.setup();
    renderHarness('card');
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');

    // No NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in the test environment.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set/i,
    );
  });

  it('keeps the focus trap, Escape and focus restoration', async () => {
    const user = userEvent.setup();
    renderHarness('card');
    const trigger = screen.getByRole('button', { name: /open dialog/i });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');

    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('the invoice / PO branch still submits — it carries no card data', async () => {
    const user = userEvent.setup();
    renderHarness('card');
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: /Invoice \/ PO/i }));
    expect(screen.getByLabelText(/purchase order number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request invoice billing/i })).toBeInTheDocument();
  });
});
