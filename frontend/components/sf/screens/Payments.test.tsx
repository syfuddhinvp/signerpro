/**
 * The Payments settings screen — a tenant connecting their own Stripe
 * account so signers can pay them during signing.
 *
 * `charges_enabled` / `payouts_enabled` / `details_submitted` are checked
 * separately: a linked account that cannot yet charge must read as a warning,
 * not as "Connected", because that is exactly the gap a sender needs to see
 * before sending an envelope with a payment field on it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import type { PaymentAccountResponse } from '@/lib/api/types';
import Payments from './Payments';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

function mount(props: React.ComponentProps<typeof Payments>) {
  return render(
    <SFProvider>
      <DialogProvider>
        <Payments {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

const account = (over: Partial<PaymentAccountResponse> = {}): PaymentAccountResponse => ({
  id: 'acct-1',
  organization_id: 'org-1',
  provider: 'stripe',
  provider_account_id: 'acct_123',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  default_currency: 'usd',
  livemode: true,
  onboarded_at: '2026-01-01T00:00:00Z',
  last_synced_at: '2026-01-01T00:00:00Z',
  disabled_reason: null,
  ...over,
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
});

describe('Payments · not connected', () => {
  it('explains the deal and offers to connect Stripe', () => {
    mount({ account: null });
    expect(screen.getByText(/connect your own stripe account/i)).toBeInTheDocument();
    expect(screen.getByText(/signers pay you directly/i)).toBeInTheDocument();
    expect(screen.getByText(/signerpro takes no cut/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect stripe/i })).toBeInTheDocument();
  });

  it('opens the hosted onboarding link the API hands back', async () => {
    apiCall.mockResolvedValue(ok({ url: 'https://connect.stripe.com/setup/abc', expires_at: '2026-01-01T00:00:00Z' }));
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, href: '', origin: 'https://app.example.com' }, writable: true });

    mount({ account: null });
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'US' } });
    fireEvent.click(screen.getByRole('button', { name: /connect stripe/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/payments/account/link', expect.objectContaining({
      body: expect.objectContaining({
        return_url: expect.any(String),
        refresh_url: expect.any(String),
        country: 'US',
        entity_type: 'company',
      }),
    })));
    await waitFor(() => expect(window.location.href).toBe('https://connect.stripe.com/setup/abc'));
    void assign;
  });

  it('disables Connect Stripe until country and business type are both chosen', () => {
    mount({ account: null });
    const connectButton = screen.getByRole('button', { name: /connect stripe/i });
    expect(connectButton).toBeDisabled();

    // Business type already defaults to Company, so picking a country is
    // enough to satisfy both fields.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'GB' } });
    expect(connectButton).not.toBeDisabled();
  });
});

describe('Payments · connected', () => {
  it('shows charges/payouts/onboarding as distinct states, not one badge', () => {
    mount({ account: account({ charges_enabled: false, payouts_enabled: true, details_submitted: true }) });
    expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
    expect(screen.getByText('Not yet enabled')).toBeInTheDocument();
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
  });

  it('renders charges-disabled as a warning rather than a success state', () => {
    mount({ account: account({ charges_enabled: false }) });
    const chargesRow = screen.getByText('Accepting payments').closest('div');
    const badge = chargesRow?.parentElement?.querySelector('span:last-child');
    expect(badge?.textContent).toBe('Not yet enabled');
    expect(screen.getByText(/cannot collect a payment yet/i)).toBeInTheDocument();
  });

  it('surfaces disabled_reason when present', () => {
    mount({ account: account({ charges_enabled: false, disabled_reason: 'Stripe needs a government ID before charges resume.' }) });
    expect(screen.getByText('Stripe needs a government ID before charges resume.')).toBeInTheDocument();
  });

  it('does not surface a disabled_reason banner when there is none', () => {
    mount({ account: account() });
    expect(screen.queryByText('Restricted')).not.toBeInTheDocument();
  });

  it('warns plainly when the account is in test mode', () => {
    mount({ account: account({ livemode: false }) });
    expect(screen.getByText(/test mode/i)).toBeInTheDocument();
    expect(screen.getByText(/no real money moves/i)).toBeInTheDocument();
  });

  it('shows no test-mode warning for a live account', () => {
    mount({ account: account({ livemode: true }) });
    expect(screen.queryByText(/test mode/i)).not.toBeInTheDocument();
  });

  it('does not ask for country or business type once an account already exists', () => {
    mount({ account: account() });
    expect(screen.queryByLabelText(/country/i)).not.toBeInTheDocument();
  });

  it('refreshes status against the API', async () => {
    apiCall.mockResolvedValue(ok(account()));
    mount({ account: account() });
    fireEvent.click(screen.getByRole('button', { name: /refresh status/i }));
    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/payments/account/refresh', expect.anything()));
  });

  it('asks for confirmation before disconnecting, and says Stripe itself is untouched', async () => {
    mount({ account: account() });
    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    const dialogText = await screen.findByText(/does not delete your stripe account/i);
    expect(dialogText).toBeInTheDocument();
    // Not yet called — only the confirmation dialog is open.
    expect(apiCall).not.toHaveBeenCalledWith('/api/payments/account', expect.anything());
  });

  it('disconnects only after the confirmation is accepted', async () => {
    apiCall.mockResolvedValue(ok(undefined));
    mount({ account: account() });
    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    // The dialog's own confirm button ("Disconnect") is distinct from the row
    // button of the same name; wait for the dialog to appear, then click the
    // last-rendered one of the two.
    await screen.findByRole('dialog');
    const buttons = screen.getAllByRole('button', { name: /^disconnect$/i });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/payments/account', expect.objectContaining({ method: 'DELETE' })));
  });
});

describe('Payments · errors', () => {
  it('reports a failed account load', () => {
    mount({ account: null, loadError: 'Backend unreachable' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('surfaces a failed connect action', async () => {
    apiCall.mockResolvedValue(fail('Stripe is not reachable right now.'));
    mount({ account: null });
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'US' } });
    fireEvent.click(screen.getByRole('button', { name: /connect stripe/i }));
    await waitFor(() => expect(screen.getByText('Stripe is not reachable right now.')).toBeInTheDocument());
  });
});
