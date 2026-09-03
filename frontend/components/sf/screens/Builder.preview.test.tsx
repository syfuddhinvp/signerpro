/**
 * The Preview affordance on the prepare step.
 *
 * Preparing an envelope is placing fields on someone else's behalf, and until
 * now the only way to see the result was to send it. The button opens the real
 * recipient surface for this envelope, as the recipient whose fields are being
 * placed — previewing as somebody else while you work on Sarah's signature
 * block answers the wrong question.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Builder from './Builder';
import type { RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const recipient = (id: string, name: string, order: number): RecipientResponse => ({
  id, document_id: 'doc-7', name, email: `${id}@example.com`, role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: order, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null,
  otp_enabled: false, phone_number: null, otp_verified: false, consent_accepted: false,
  consent_accepted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

const RECIPIENTS = [recipient('r1', 'Sarah Mitchell', 1), recipient('r2', 'Dev Patel', 2)];

function mount(documentId: string | null, recipients: RecipientResponse[] = RECIPIENTS) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId={documentId} title="OX 1000082026" pageCount={1} fields={[]} recipients={recipients} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const previewLink = () => screen.queryByRole('link', { name: 'Preview' });

beforeEach(() => resetNavigation());

describe('Preview on the prepare step', () => {
  it('opens the signer view for this envelope', () => {
    mount('doc-7');
    expect(previewLink()?.getAttribute('href')).toBe('/documents/doc-7/signer-view?recipient=r1');
  });

  it('previews as the recipient whose fields are being placed', () => {
    mount('doc-7');
    fireEvent.click(screen.getByText('Dev Patel'));
    expect(previewLink()?.getAttribute('href')).toBe('/documents/doc-7/signer-view?recipient=r2');
  });

  it('is absent before there is a document to preview', () => {
    /* The flat `/documents/prepare` entry resolves nothing when the tenant has
       no draft; a Preview link would have nowhere to go. */
    mount(null);
    expect(previewLink()).toBeNull();
  });

  it('does not leave the prepare step to get there', () => {
    mount('doc-7');
    /* A link, not a wizard step: previewing is a detour, and Back to editing
       returns you to exactly this screen. */
    expect(previewLink()?.tagName).toBe('A');
    expect(screen.getByText('Prepare')).toBeTruthy();
  });
});
