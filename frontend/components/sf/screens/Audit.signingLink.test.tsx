/**
 * "Copy link" on the Audit trail's "Signer attestations" card. Email delivery
 * is not always available (local dev, a bounced address), so the sender needs
 * a way to hand a signer their link directly — but minting a new one
 * invalidates whatever was already emailed to them, so the action must warn
 * before it fires and never be offered for a recipient who has no signing
 * link to give out.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Audit, { type AuditProps, type PayerRef } from './Audit';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: (...args: unknown[]) => apiCall(...args) };
});

function mount(props: Partial<AuditProps> = {}) {
  const defaults: AuditProps = {
    documentId: 'doc-1',
    documentStatus: 'sent',
    entries: [],
    certificate: null,
    chain: null,
    attestations: [],
    documentTitle: 'Buyer Seller Packet',
    verifyUrl: '',
    sealed: false,
    paymentSummary: null,
    payments: [],
    payers: [],
  };
  return render(
    <SFProvider>
      <DialogProvider>
        <Audit {...defaults} {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

const attestation = (over: Partial<import('@/lib/sf/adapters').AttestationRow> = {}) => ({
  name: 'Alice Signer', email: 'alice@example.com', meta: 'alice@example.com · waiting', color: '#4f46e5',
  ...over,
});

const signerPayer: PayerRef = { id: 'r1', name: 'Alice Signer', email: 'alice@example.com', role: 'sign', status: 'waiting' };

async function setupClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
}

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  // Default: clipboard works, so tests that don't care don't have to set it up.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true, writable: true });
});

describe('Audit · copy signing link', () => {
  it('warns that copying invalidates the previously emailed link, before minting anything', async () => {
    mount({ attestations: [attestation()], payers: [signerPayer] });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    const dialog = await screen.findByRole('dialog', { name: /copy alice signer.?s signing link/i });
    expect(within(dialog).getByText(/invalidates the link already emailed/i)).toBeInTheDocument();
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('confirming mints the link and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await setupClipboard(writeText);
    apiCall.mockResolvedValue(ok({ url: 'https://app.example.com/sign/tok123', expires_at: '2026-01-01T00:00:00Z' }));
    mount({ attestations: [attestation()], payers: [signerPayer] });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const dialog = await screen.findByRole('dialog', { name: /copy alice signer.?s signing link/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /issue new link/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith(
      '/api/documents/doc-1/recipients/r1/signing-link',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example.com/sign/tok123'));
  });

  it('cancelling the warning calls nothing', async () => {
    mount({ attestations: [attestation()], payers: [signerPayer] });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const dialog = await screen.findByRole('dialog', { name: /copy alice signer.?s signing link/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('shows the URL in a selectable form when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    apiCall.mockResolvedValue(ok({ url: 'https://app.example.com/sign/tok123', expires_at: '2026-01-01T00:00:00Z' }));
    mount({ attestations: [attestation()], payers: [signerPayer] });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const confirmDialog = await screen.findByRole('dialog', { name: /copy alice signer.?s signing link/i });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /issue new link/i }));

    const linkDialog = await screen.findByRole('dialog', { name: /alice signer.?s signing link/i });
    expect(within(linkDialog).getByDisplayValue('https://app.example.com/sign/tok123')).toBeInTheDocument();
  });

  it('shows the URL in a selectable form when the clipboard write throws', async () => {
    await setupClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    apiCall.mockResolvedValue(ok({ url: 'https://app.example.com/sign/tok999', expires_at: '2026-01-01T00:00:00Z' }));
    mount({ attestations: [attestation()], payers: [signerPayer] });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    const confirmDialog = await screen.findByRole('dialog', { name: /copy alice signer.?s signing link/i });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /issue new link/i }));

    const linkDialog = await screen.findByRole('dialog', { name: /alice signer.?s signing link/i });
    expect(within(linkDialog).getByDisplayValue('https://app.example.com/sign/tok999')).toBeInTheDocument();
  });

  it('is absent for a copy (CC) recipient', () => {
    mount({
      attestations: [attestation({ name: 'Observer', email: 'observer@example.com', meta: 'observer@example.com · notified' })],
      payers: [{ id: 'r2', name: 'Observer', email: 'observer@example.com', role: 'copy', status: 'notified' }],
    });
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('is absent once the recipient has completed', () => {
    mount({
      attestations: [attestation()],
      payers: [{ ...signerPayer, status: 'completed' }],
    });
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('is absent for a draft document', () => {
    mount({ documentStatus: 'draft', attestations: [attestation()], payers: [signerPayer] });
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });
});
