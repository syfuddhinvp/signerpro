/**
 * The branding picker on the workflow screen (ORG-7).
 *
 * The choice is per envelope, and "none" is a real choice meaning "whatever
 * the tenant's default is when this goes out" — so it has to reach the API as
 * an explicit null. Omitting the key would silently leave the previous theme
 * on the envelope, and the sender would find out when a recipient opened the
 * wrong brand's email.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import type { BrandingThemeResponse, RecipientResponse } from '@/lib/api/types';
import type { BuilderRouting } from '@/lib/sf/adapters';
import Routing from './Routing';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const theme = (id: string, name: string, isDefault: boolean): BrandingThemeResponse => ({
  id, organization_id: 'org-1', name, is_default: isDefault,
  logo_url: null, logo_uploaded: false, logo_position: 'left', primary_color: '#0777CF', primary_text_color: '#FFFFFF',
  headline: null, message: null, contact_sender_email: null, footer_signature: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', document_count: 0,
});

const recipient: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'sent',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null,
  otp_enabled: false, phone_number: null, otp_verified: false, consent_accepted: false,
  consent_accepted_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const routing = (brandingThemeId: string): BuilderRouting => ({
  routing: 'sequential', cadence: '48h', expiry: '14', message: '', subject: '', brandingThemeId,
});

function mount(themes: BrandingThemeResponse[], chosen = '') {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Routing
        documentId="doc-7"
        title="MSA"
        recipients={[recipient]}
        routing={routing(chosen)}
        brandingThemes={themes}
      />
    </DialogProvider></SFProvider>,
  );
}

const routingBodies = () =>
  apiCall.mock.calls
    .filter(([p]) => String(p) === '/api/documents/doc-7/routing')
    .map(([, init]) => (init as { body: Record<string, unknown> }).body);

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async (path: string) => {
    if (String(path).startsWith('/api/contacts')) return { ok: true, status: 200, data: { items: [], total: 0, counts: { all: 0 } } };
    return { ok: true, status: 200, data: {} };
  });
});

describe('the branding picker on the workflow screen', () => {
  it('names the default theme on the "no choice" option', () => {
    mount([theme('th-1', 'House brand', true), theme('th-2', 'Partner brand', false)]);
    expect(screen.getByRole('option', { name: 'Organization default · House brand' })).toBeTruthy();
  });

  it('saves a chosen theme against the envelope', async () => {
    mount([theme('th-1', 'House brand', true), theme('th-2', 'Partner brand', false)]);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'th-2' } });

    await waitFor(() => expect(routingBodies().length).toBe(1));
    expect(routingBodies()[0].branding_theme_id).toBe('th-2');
  });

  it('sends an explicit null when the sender goes back to the default', async () => {
    mount([theme('th-1', 'House brand', true), theme('th-2', 'Partner brand', false)], 'th-2');
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: '' } });

    await waitFor(() => expect(routingBodies().length).toBe(1));
    expect(routingBodies()[0].branding_theme_id).toBeNull();
  });

  it('says what a recipient will actually see', () => {
    mount([theme('th-1', 'House brand', true), theme('th-2', 'Partner brand', false)], 'th-2');
    expect(screen.getByText(/Recipients see Partner brand/)).toBeTruthy();
  });

  it('falls back to the default theme in that summary when none is chosen', () => {
    mount([theme('th-1', 'House brand', true)]);
    expect(screen.getByText(/Recipients see House brand/)).toBeTruthy();
  });

  it('says invitations go out unbranded when the tenant has no themes', () => {
    mount([]);
    expect(screen.getByText(/No branding themes yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Theme')).toBeNull();
  });
});
