/**
 * The platform mail outbox screen.
 *
 * The claims worth pinning are the ones that would quietly stop being true:
 *
 *  - the list omits bodies, so opening a row must fetch the full message —
 *    a preview rendered from the list row would be permanently blank;
 *  - the HTML preview is sandboxed, because it renders tenant-authored copy;
 *  - a message stored without a body (a one-time passcode) says so, rather
 *    than rendering as an empty preview that reads like a broken send;
 *  - a partial send is reported as partial, so nobody re-sends to the
 *    recipients who already received it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { resetNavigation } from '@/test/navigation';
import type { MailLogPage, MailLogRow } from '@/lib/api/types';
import Mail from './Mail';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ROW: MailLogRow = {
  id: 'm1',
  created_at: '2026-09-12T14:02:00Z',
  to_email: 'dana@example.com',
  from_email: 'no-reply@signerpro.test',
  subject: 'Signature requested: Purchase agreement',
  category: 'invitation',
  status: 'sent',
  provider: 'smtp',
  error: null,
  /* As the list endpoint returns it: a snippet, but no bodies. */
  body_text: null,
  body_html: null,
  snippet: 'Hello Dana Reed, you have been invited to sign…',
  document_id: 'd1',
  organization_id: 'o1',
  organization_name: 'Acme Realty',
  sent_by_email: null,
};

const PAGE: MailLogPage = {
  items: [ROW],
  total: 1,
  categories: ['invitation', 'custom', 'verification'],
  statuses: ['sent', 'failed', 'suppressed'],
};

const mount = (page: MailLogPage = PAGE) =>
  render(
    <SFProvider>
      <Mail page={page} sinceDays={90} />
    </SFProvider>,
  );

beforeEach(() => {
  cleanup();
  apiCall.mockReset();
  resetNavigation();
});

describe('the preview', () => {
  it('fetches the full message, because the list carries no body', async () => {
    apiCall.mockResolvedValue({
      ok: true,
      data: { ...ROW, body_text: 'Open your link: /sign/[redacted]', body_html: '<p>Review and sign</p>' },
    });
    mount();

    fireEvent.click(screen.getByRole('button', { name: /Signature requested/ }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/saas/mail/m1', expect.anything()));
    const frame = await screen.findByTitle(/Message:/);
    /* Framed from our own origin, not `srcdoc`: a srcdoc frame inherits the
       app's page CSP and renders blank under it. */
    expect(frame.getAttribute('src')).toBe('/platform/mail/m1/preview');
    /* Empty, not absent: an iframe with no `sandbox` attribute runs scripts. */
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('explains a message that was stored without a body', async () => {
    const otp = { ...ROW, id: 'm2', category: 'verification', subject: 'SignFlow Verification Code' };
    apiCall.mockResolvedValue({ ok: true, data: otp });
    mount({ ...PAGE, items: [otp] });

    fireEvent.click(screen.getByRole('button', { name: /Verification Code/ }));

    expect(await screen.findByText(/one-time passcode/)).toBeTruthy();
    expect(screen.queryByTitle(/Message:/)).toBeNull();
  });
});

describe('composing', () => {
  /** A send answers `/send`; the reload it triggers answers with a real page.
   *  One mock for both would feed the send's own payload back into the list. */
  const respond = (sendResult: unknown) => {
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(
        String(path).endsWith('/send')
          ? { ok: true, data: sendResult }
          : { ok: true, data: PAGE },
      ),
    );
  };

  const compose = async (to: string) => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Back shortly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  const sendCall = () =>
    apiCall.mock.calls.find(([p]) => p === '/api/saas/mail/send')?.[1] as
      | { body: { to: string[]; cc: string[]; bcc: string[] } }
      | undefined;

  it('splits a pasted recipient list on commas, semicolons and newlines', async () => {
    respond({ sent: 3, failed: 0, items: [] });
    await compose('one@example.com, two@example.com;three@example.com');

    await waitFor(() => {
      expect(sendCall()?.body.to)
        .toEqual(['one@example.com', 'two@example.com', 'three@example.com']);
    });
  });

  it('refuses to send with no recipient rather than calling the API', async () => {
    await compose('   ');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Add at least one recipient.');
    expect(apiCall.mock.calls.some(([p]) => p === '/api/saas/mail/send')).toBe(false);
  });

  it('keeps a partial send on screen instead of announcing success', async () => {
    respond({ sent: 1, failed: 1, items: [] });
    await compose('one@example.com, two@example.com');

    expect((await screen.findByRole('alert')).textContent).toContain('Sent to 1. Failed for 1');
    /* Still open, still holding the message: re-sending to everyone would
       double-mail whoever was reached on the first attempt. */
    expect((screen.getByLabelText('To') as HTMLInputElement).value)
      .toBe('one@example.com, two@example.com');
  });

  it('clears the composer only when every recipient was reached', async () => {
    respond({ sent: 2, failed: 0, items: [] });
    await compose('one@example.com, two@example.com');
    await waitFor(() => expect(screen.queryByLabelText('To')).toBeNull());
  });

  /* Cc and Bcc start hidden, as they do in every mail client: three address
     fields on open read as three fields that want filling in. */
  it('reveals Cc and Bcc only when asked, and sends what was typed into them', async () => {
    respond({ sent: 1, failed: 0, items: [] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));

    expect(screen.queryByLabelText('Cc')).toBeNull();
    expect(screen.queryByLabelText('Bcc')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bcc' }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'lead@example.com' } });
    fireEvent.change(screen.getByLabelText('Bcc'), { target: { value: 'audit@example.com; ops@example.com' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Back shortly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sendCall()?.body.cc).toEqual(['lead@example.com']);
      expect(sendCall()?.body.bcc).toEqual(['audit@example.com', 'ops@example.com']);
    });
  });

  it('carries an attachment as base64 with its name and type', async () => {
    respond({ sent: 1, failed: 0, items: [] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));

    const file = new File(['hello'], 'notice.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('compose-file-input'), { target: { files: [file] } });
    /* The chip proves the read finished; sending before it would post nothing. */
    expect(await screen.findByText('notice.txt')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Back shortly.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const body = sendCall()?.body as unknown as { attachments: { filename: string; content_type: string; content: string }[] };
      /* Base64 only: the `data:` prefix restates a content type the request
         already carries, and the API rejects it as invalid base64. */
      expect(body.attachments).toEqual([
        { filename: 'notice.txt', content_type: 'text/plain', content: btoa('hello') },
      ]);
    });
  });

  it('refuses a file over the API\'s own limit instead of posting it', async () => {
    respond({ sent: 1, failed: 0, items: [] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));

    const huge = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('compose-file-input'), { target: { files: [huge] } });

    expect((await screen.findByRole('alert')).textContent).toContain('larger than 5 MB');
    expect(screen.queryByLabelText('Remove scan.pdf')).toBeNull();
  });
});
