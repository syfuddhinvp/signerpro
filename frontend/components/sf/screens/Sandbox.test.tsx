/**
 * The API console's Live/Test switch.
 *
 * The prototype's Test/Live toggle was client-side only: it relabelled the
 * screen and changed nothing about the request, so a "test" call still wrote
 * production records. Now the sandbox is a real paired organization and the
 * switch is the thing that addresses it, which makes these the claims worth
 * pinning:
 *
 *  - live is the default, and a store with no value for the flag must read as
 *    live rather than as sandbox;
 *  - test mode sends `X-SignerPro-Sandbox`, live mode sends no such header;
 *  - a write in live mode is confirmed first; in the sandbox it is not, so the
 *    confirmation keeps meaning something;
 *  - the copied snippet carries the mode, so it cannot be pasted elsewhere and
 *    silently run against live;
 *  - seed and reset are offered only in test mode, and reset is confirmed.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Sandbox from './Sandbox';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const SANDBOX_HEADER = 'X-SignerPro-Sandbox';

function mount() {
  return render(
    <SFProvider>
      <DialogProvider>
        <Sandbox />
      </DialogProvider>
    </SFProvider>,
  );
}

/** The `init` the screen passed to `apiCall` for a given path. */
function initFor(path: string): Record<string, unknown> | undefined {
  const call = apiCall.mock.calls.find(([p]) => String(p) === path);
  return call?.[1] as Record<string, unknown> | undefined;
}

function headersFor(path: string): Record<string, string> {
  return (initFor(path)?.headers as Record<string, string>) ?? {};
}

const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

async function confirmDialog(name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  fireEvent.click(button);
}

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  apiCall.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
});

describe('the API console environment switch', () => {
  it('starts in live mode, and says so', () => {
    mount();
    expect(screen.getByText('Live workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Test' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('sends no sandbox header in live mode', async () => {
    mount();
    send();
    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(headersFor('/api/me')[SANDBOX_HEADER]).toBeUndefined();
  });

  it('sends the sandbox header in test mode', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByText('Sandbox — a separate organization')).toBeTruthy();

    send();
    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(headersFor('/api/me')[SANDBOX_HEADER]).toBe('1');
  });

  it('confirms a live write, and does not send it when declined', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    send();

    await confirmDialog(/cancel/i);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('sends a sandbox write without a confirmation', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    send();

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(headersFor('/api/me')[SANDBOX_HEADER]).toBe('1');
    expect(initFor('/api/me')?.method).toBe('POST');
  });

  it('puts the mode in the snippet, so a copied call cannot drift to live', () => {
    mount();
    expect(screen.queryByText(new RegExp(SANDBOX_HEADER))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByText(new RegExp(SANDBOX_HEADER))).toBeTruthy();
  });

  it('offers seed and reset only in the sandbox', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Seed data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seed data' }));

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(initFor('/api/sandbox/seed')?.method).toBe('POST');
    expect(headersFor('/api/sandbox/seed')[SANDBOX_HEADER]).toBe('1');
  });

  it('confirms a sandbox reset before clearing it', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await confirmDialog(/reset sandbox/i);
    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(initFor('/api/sandbox/reset')?.method).toBe('POST');
  });
});
