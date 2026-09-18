/**
 * The cloud storage panel.
 *
 * What it replaced could not be trusted: "Connect" flipped a boolean on the
 * server without any grant ever happening, and the export toggle could read
 * "Exporting" on a card that in the same breath said "no export path set".
 * These tests pin the states that fiction hid — a provider this deployment
 * holds no credentials for, tokens that have stopped working, and an export
 * that cannot be switched on until it has somewhere to write — plus the
 * export log, which is the only place an envelope that never arrived can be
 * told apart from one that was never sent.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import type { CloudExportItem, CloudTargetItem, IntegrationResponse } from '@/lib/api/types';
import AccountArea from './AccountArea';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/SessionProvider', () => ({
  useSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: (...args: unknown[]) => apiCall(...args) };
});

const ok = <T,>(data: T) => ({ ok: true as const, data });

function integration(over: Partial<IntegrationResponse> = {}): IntegrationResponse {
  return {
    provider: 'google_drive', label: 'Google Drive', detail: null,
    connected: true, connected_at: '2026-09-01T10:00:00Z',
    configured: true, account_email: 'ada@northwind.test',
    needs_reauth: false, last_error: null, ...over,
  };
}

function exportRow(over: Partial<CloudExportItem> = {}): CloudExportItem {
  return {
    id: 'ex-1', provider: 'google_drive', document_id: 'doc-1', document_title: 'Buyer Packet',
    status: 'succeeded', attempts: 1, remote_path: '/SignerPro/Buyer Packet.pdf',
    remote_file_id: 'f1', last_error: null,
    created_at: '2026-09-02T10:00:00Z', completed_at: '2026-09-02T10:00:05Z', ...over,
  };
}

/** The four reads the panel makes, answered from one fixture. */
function serve(opts: {
  integrations: IntegrationResponse[];
  targets?: CloudTargetItem[];
  exports?: CloudExportItem[];
}) {
  apiCall.mockImplementation((path: string) => {
    if (path === '/api/integrations') return Promise.resolve(ok(opts.integrations));
    if (path === '/api/integrations/cloud-targets') return Promise.resolve(ok(opts.targets ?? []));
    if (path === '/api/integrations/exports') return Promise.resolve(ok(opts.exports ?? []));
    if (path === '/api/me') return Promise.resolve(ok({ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }));
    return Promise.resolve(ok(null));
  });
}

function renderPanel() {
  return render(
    <SFProvider>
      <DialogProvider>
        <AccountArea section="integrations" />
      </DialogProvider>
    </SFProvider>,
  );
}

beforeEach(() => {
  cleanup();
  apiCall.mockReset();
  resetNavigation();
});

describe('a connector this deployment cannot offer', () => {
  it('disables Connect and says why, instead of offering a dead button', async () => {
    serve({ integrations: [integration({ configured: false, connected: false, connected_at: null, account_email: null })] });
    renderPanel();

    const connect = await screen.findByRole('button', { name: /Connect/i });
    expect(connect).toBeDisabled();
    expect(screen.getByText(/Not configured/)).toBeTruthy();
    /* The reason is on the page, and the disabled button points at it. */
    const noteId = connect.getAttribute('aria-describedby');
    expect(noteId).toBeTruthy();
    expect(document.getElementById(noteId!)?.textContent).toMatch(/credentials/i);
  });
});

describe('a connector whose tokens have stopped working', () => {
  it('surfaces the error and offers Reconnect rather than claiming a connection', async () => {
    serve({
      integrations: [integration({ needs_reauth: true, last_error: 'Refresh token was revoked by the account owner.' })],
    });
    renderPanel();

    expect(await screen.findByText(/Needs re-authentication/)).toBeTruthy();
    expect(screen.getByText(/revoked by the account owner/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reconnect/i })).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
  });
});

describe('the export destination', () => {
  it('cannot be switched on while the folder is empty', async () => {
    serve({
      integrations: [integration()],
      targets: [{ provider: 'google_drive', path: null, enabled: false }],
    });
    renderPanel();

    const toggle = await screen.findByRole('button', { name: /Turn on/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Set an export folder first/)).toBeTruthy();
    /* And it cannot read "Exporting" while there is nowhere to export to. */
    expect(screen.queryByText('Exporting')).toBeNull();
  });

  it('cannot be switched on from an unsaved folder, only from a saved one', async () => {
    serve({
      integrations: [integration()],
      targets: [{ provider: 'google_drive', path: null, enabled: false }],
    });
    renderPanel();

    const input = await screen.findByLabelText(/Export folder/i);
    fireEvent.change(input, { target: { value: '/SignerPro' } });

    expect(screen.getByRole('button', { name: /Turn on/i })).toBeDisabled();
    expect(screen.getByText(/Save the export folder first/)).toBeTruthy();

    apiCall.mockImplementation((path: string, init: { method?: string }) => {
      if (path === '/api/integrations/cloud-targets' && init?.method === 'PUT') {
        return Promise.resolve(ok([{ provider: 'google_drive', path: '/SignerPro', enabled: false }]));
      }
      if (path === '/api/integrations') return Promise.resolve(ok([integration()]));
      if (path === '/api/integrations/exports') return Promise.resolve(ok([]));
      return Promise.resolve(ok([{ provider: 'google_drive', path: '/SignerPro', enabled: false }]));
    });
    fireEvent.click(screen.getByRole('button', { name: /Save folder/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Turn on/i })).not.toBeDisabled());
  });
});

describe('the export log', () => {
  it('names the document, the reason a failure failed, and offers a retry', async () => {
    serve({
      integrations: [integration()],
      targets: [{ provider: 'google_drive', path: '/SignerPro', enabled: true }],
      exports: [
        exportRow({ id: 'ex-2', status: 'failed', document_title: 'Mutual NDA', attempts: 3, completed_at: null, last_error: 'Insufficient permission on that folder.' }),
        exportRow(),
      ],
    });
    renderPanel();

    expect(await screen.findByText('Mutual NDA')).toBeTruthy();
    expect(screen.getByText(/Insufficient permission/)).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    /* Only the failed row can be retried. */
    const retries = screen.getAllByRole('button', { name: /Retry/i });
    expect(retries).toHaveLength(1);

    fireEvent.click(retries[0]);
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/integrations/exports/ex-2/retry', expect.objectContaining({ method: 'POST' })),
    );
  });
});
