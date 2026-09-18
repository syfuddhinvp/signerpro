/**
 * The tenant record page.
 *
 * What these pin: the sections an operator came for actually render the
 * tenant's own rows, the API-key mask is all that is ever shown, a revoked key
 * is not presented as live, and signer-payment money is reported per currency
 * rather than summed into one misleading figure.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation, router } from '@/test/navigation';
import type { TenantProfile } from '@/lib/api/types';
import TenantRecord from './TenantRecord';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn(async (..._args: never[]) => ({ ok: true as const, data: [] }));
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: (...args: never[]) => apiCall(...args) };
});

function profile(over: Partial<TenantProfile> = {}): TenantProfile {
  return {
    tenant: {
      id: 'org-1', name: 'Acme Realty', slug: 'acme-realty', region: 'us-east',
      company_size: '51-200', owner_email: 'priya@acme.io', owner_name: 'Priya Rao',
      plan_code: 'growth', plan_name: 'Growth', subscription_tier: 'growth',
      subscription_status: 'active', status: 'active', suspended_at: null,
      suspension_reason: null, seats_licensed: 25, seats_activated: 11,
      envelope_volume_30d: 42, documents_count: 120, users_count: 11, mrr_cents: 49_900,
      subscription_expires_at: null, created_at: '2026-01-04T10:00:00Z',
      accent_color: null, logo_url: null, billing_email: 'ap@acme.io', billing_cycle: 'monthly',
      live_mode_enabled: true, open_ticket_count: 2, incidents_90d: 0,
      flag_overrides: [], admins: [],
    },
    counts: {
      users: 11, active_users: 9, documents: 120, templates: 4, contacts: 87, folders: 6,
      teams: 2, api_keys: 2, active_api_keys: 1, webhooks: 1, invoices: 9, signer_payments: 30,
    },
    documents_by_status: { completed: 100, sent: 20 },
    users: [{
      id: 'u-1', name: 'Priya Rao', email: 'priya@acme.io', role: 'admin', role_key: 'orgadmin',
      role_label: 'Organization admin', is_platform_admin: false, organization_id: 'org-1',
      organization_name: 'Acme Realty', organization_slug: 'acme-realty', status: 'active',
      mfa_enabled: true, mfa_method: 'totp', last_active_at: '2026-09-16T10:00:00Z',
      created_at: '2026-01-04T10:00:00Z',
    }],
    recent_documents: [{
      id: 'doc-1', title: 'Listing Agreement', status: 'completed', is_template: false,
      sender_email: 'priya@acme.io', created_at: '2026-09-10T10:00:00Z',
      sent_at: '2026-09-10T11:00:00Z', completed_at: '2026-09-11T09:00:00Z',
    }],
    api_keys: [
      {
        id: 'k-1', label: 'Production integration', mode: 'live',
        masked: 'sk_live_••••••••••••••••••••ab12', scopes: ['documents:read'],
        created_by_email: 'priya@acme.io', last_used_at: '2026-09-16T08:00:00Z',
        revoked_at: null, created_at: '2026-02-01T10:00:00Z',
      },
      {
        id: 'k-2', label: 'Retired laptop key', mode: 'test',
        masked: 'sk_test_••••••••••••••••••••cd34', scopes: [],
        created_by_email: null, last_used_at: null,
        revoked_at: '2026-06-01T10:00:00Z', created_at: '2026-03-01T10:00:00Z',
      },
    ],
    invoices: [{
      id: 'inv-1', number: 'INV-2026-0009', status: 'open', currency: 'USD',
      total_cents: 49_900, amount_paid_cents: 0, issued_at: '2026-09-01T10:00:00Z',
      due_at: '2026-09-15T10:00:00Z', paid_at: null,
    }],
    charges: [],
    signer_payments: [],
    signer_payment_totals: [
      /* `collected_cents` is already net of refunds — the API subtracts them
         there rather than leaving the UI to. */
      { currency: 'USD', collected_cents: 115_000, refunded_cents: 5_000, count: 12 },
      { currency: 'EUR', collected_cents: 40_000, refunded_cents: 0, count: 3 },
    ],
    webhooks: [],
    subscription: null,
    payment_account: null,
    audit: [],
    invoiced_cents: 449_100,
    invoice_paid_cents: 399_200,
    invoice_outstanding_cents: 49_900,
    invoice_currency: 'USD',
    ...over,
  };
}

const FLAGS = [{ key: 'signing.passkey_reuse', on: true }];

function view(p: TenantProfile = profile(), tab = 'overview') {
  return render(
    <SFProvider><DialogProvider>
      <TenantRecord profile={p} tab={tab} flags={FLAGS} />
    </DialogProvider></SFProvider>,
  );
}

beforeEach(() => { cleanup(); resetNavigation(); apiCall.mockClear(); });

describe('TenantRecord', () => {
  it('leads with the tenant, its status and the counts an operator came for', () => {
    view();
    expect(screen.getByRole('heading', { name: 'Acme Realty' })).toBeTruthy();
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    expect(screen.getByText('11 / 25')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
  });

  it('lists the tenant’s members with their role and MFA state', () => {
    view(profile(), 'users');
    expect(screen.getByText('Priya Rao')).toBeTruthy();
    expect(screen.getByText('priya@acme.io')).toBeTruthy();
    expect(screen.getByText('Organization admin')).toBeTruthy();
    expect(screen.getByText('MFA · totp')).toBeTruthy();
  });

  it('shows the document status histogram and the recent envelopes', () => {
    view(profile(), 'documents');
    expect(screen.getByText('completed · 100')).toBeTruthy();
    expect(screen.getByText('Listing Agreement')).toBeTruthy();
  });

  it('shows only the masked API key, and marks a revoked key revoked', () => {
    view(profile(), 'developer');
    expect(screen.getByText('sk_live_••••••••••••••••••••ab12')).toBeTruthy();
    /* A revoked credential presented as live is the failure that matters here:
       it invites an operator to go on trusting a key that cannot act. */
    expect(screen.getByText(/^revoked /)).toBeTruthy();
    expect(screen.getByText('Retired laptop key')).toBeTruthy();
  });

  it('reports signer money per currency and never as one total', () => {
    view(profile(), 'payments');
    expect(screen.getByText('$1,150.00')).toBeTruthy();  // USD net of refunds
    expect(screen.getByText('USD · net of refunds')).toBeTruthy();
    expect(screen.getByText('EUR · net of refunds')).toBeTruthy();
    /* USD and EUR are never added into one figure. */
    expect(screen.queryByText('$1,550.00')).toBeNull();
  });

  it('says a list is capped rather than letting it read as the whole history', () => {
    view(profile(), 'documents');
    expect(screen.getByText('newest 1 of 120')).toBeTruthy();
  });

  it('switching section is a URL change, so the section can be linked to', () => {
    view();
    fireEvent.click(screen.getByRole('tab', { name: 'Billing' }));
    expect(router.replace).toHaveBeenCalledWith('/?tab=billing', { scroll: false });
  });

  it('offers a per-tenant flag override against what the flag resolves to', () => {
    view();
    const select = screen.getByLabelText('Override signing.passkey_reuse') as HTMLSelectElement;
    expect(select.value).toBe('inherit');
    expect(screen.getByText('Inherit (on)')).toBeTruthy();
    fireEvent.change(select, { target: { value: 'off' } });
    expect(apiCall).toHaveBeenCalled();
  });

  it('names the suspension instead of quietly dimming the page', () => {
    view(profile({
      tenant: { ...profile().tenant, status: 'suspended', suspended_at: '2026-09-01T10:00:00Z', suspension_reason: 'Non-payment' },
    }));
    expect(screen.getAllByText(/Non-payment/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Reinstate' })).toBeTruthy();
  });
});
