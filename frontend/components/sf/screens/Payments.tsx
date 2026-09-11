'use client';

/**
 * Payments settings — where a tenant connects their OWN Stripe account so
 * signers can pay them during signing (a deposit or invoice field on the
 * envelope). The money goes straight to the tenant's Stripe account; nothing
 * here ever routes it through SignerPro or takes a cut of it.
 *
 * `charges_enabled` / `payouts_enabled` / `details_submitted` are shown as
 * three separate facts, not folded into one "Connected" badge: Stripe hands
 * back a linked account that cannot yet take a charge all the time (an
 * onboarding step still open, a review in progress), and that is exactly the
 * state a sender needs to see before they attach a payment field to an
 * envelope and send it.
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { payments as paymentsApi } from '@/lib/api/resources';
import { useDialogs } from '@/components/sf/DialogProvider';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { btn, cardStyle, pill, railHead, TEXT_MUTED, TONE_BAD, TONE_GOOD, TONE_WARN } from '@/lib/sf/ui';
import type { PaymentAccountResponse } from '@/lib/api/types';

export type PaymentsProps = {
  /** `GET /api/payments/account`, fetched by the server component. `null`
   *  before the tenant has ever started onboarding. */
  account: PaymentAccountResponse | null;
  /** `ApiError.message` when that call failed, so a `null` account is not
   *  rendered as "not connected yet" when it might just be unreachable. */
  loadError?: string | null;
};

const noteStyle: CSSProperties = { fontSize: '.78125rem', color: '#475569', lineHeight: 1.6 };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 0', borderTop: '1px solid #f2f4f8' };
const labelStyle: CSSProperties = { fontSize: '.78125rem', color: '#334155' };
const testModeStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '10px',
  border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', fontSize: '.78125rem', fontWeight: 600,
};
const fieldLabelStyle: CSSProperties = { fontSize: '.75rem', color: '#334155', fontWeight: 600 };
const selectStyle: CSSProperties = {
  padding: '7px 10px', borderRadius: '8px', border: '1px solid #dbe1ea', fontSize: '.8125rem', color: '#1f2937',
  background: '#fff',
};

/**
 * A curated subset of countries Stripe Connect is commonly available in —
 * NOT a global ISO-3166 list. Extend this array as SignerPro's tenant base
 * grows into more of Stripe's supported countries; see Stripe's own
 * "Connect supported countries" page for the full set.
 */
const STRIPE_CONNECT_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'IE', label: 'Ireland' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'BE', label: 'Belgium' },
  { code: 'AT', label: 'Austria' },
  { code: 'DK', label: 'Denmark' },
  { code: 'SE', label: 'Sweden' },
  { code: 'NO', label: 'Norway' },
  { code: 'FI', label: 'Finland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'PL', label: 'Poland' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'SG', label: 'Singapore' },
  { code: 'JP', label: 'Japan' },
  { code: 'HK', label: 'Hong Kong' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'IN', label: 'India' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
];

const ENTITY_TYPES: Array<{ value: string; label: string }> = [
  { value: 'company', label: 'Company' },
  { value: 'individual', label: 'Individual / sole trader' },
  { value: 'non_profit', label: 'Non-profit' },
  { value: 'government_entity', label: 'Government entity' },
];

export default function Payments({ account, loadError = null }: PaymentsProps) {
  const router = useRouter();
  const { askConfirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Only asked for the first time — they decide what Stripe requires during
  // onboarding and cannot be changed afterwards without recreating the
  // account, so we never ask again once `account` exists.
  const [country, setCountry] = useState('');
  const [entityType, setEntityType] = useState('company');

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn('#635bff', '#fff', '#635bff');
  const dangerBtn = btn('#fff', '#b91c1c', '#fecaca');

  const connect = () => {
    if (!account && (!country || !entityType)) return;
    setBusy(true);
    setActionError(null);
    const origin = window.location.origin;
    void paymentsApi.accountLink(apiCall, {
      return_url: origin + '/account/payments',
      refresh_url: origin + '/account/payments',
      ...(account ? {} : { country, entity_type: entityType }),
    }).then(res => {
      if (!res.ok) { setBusy(false); setActionError(res.error.message); return; }
      window.location.href = res.data.url;
    });
  };

  const refresh = () => {
    setBusy(true);
    setActionError(null);
    void paymentsApi.refreshAccount(apiCall).then(res => {
      setBusy(false);
      if (!res.ok) { setActionError(res.error.message); return; }
      router.refresh();
    });
  };

  const disconnect = async () => {
    const ok = await askConfirm({
      title: 'Disconnect Stripe',
      message: 'Envelopes with a payment field will no longer be able to collect payment until you reconnect. This does not delete your Stripe account or its payment history — that stays with Stripe.',
      cta: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    void paymentsApi.disconnectAccount(apiCall).then(res => {
      setBusy(false);
      if (!res.ok) { setActionError(res.error.message); return; }
      router.refresh();
    });
  };

  return (
    <section data-screen-label="Payments" style={{ padding: '22px 22px 40px', maxWidth: '760px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {loadError ? <ApiUnavailable what="Your payment account" detail={loadError} /> : null}
      {actionError ? (
        <div role="alert" style={{ ...cardStyle, borderColor: '#fecaca', background: '#fef2f2', color: '#7f1d1d' }}>
          {actionError}
        </div>
      ) : null}

      {!account ? (
        <div style={cardStyle}>
          <div style={railHead}>Get paid on signing</div>
          <div style={noteStyle}>
            Connect your own Stripe account to collect a deposit or invoice payment as part of an
            envelope. Signers pay you directly, on signing — the money goes straight into your
            Stripe account, and SignerPro takes no cut of it.
          </div>
          <div style={noteStyle}>
            Tell us your country and business type below. Stripe uses these to decide what it
            requires during onboarding, and they cannot be changed afterwards without recreating
            the account — so we ask once, up front.
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={fieldLabelStyle}>Country</span>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                style={selectStyle}
              >
                <option value="">Select a country…</option>
                {STRIPE_CONNECT_COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={fieldLabelStyle}>Business type</span>
              <select
                value={entityType}
                onChange={e => setEntityType(e.target.value)}
                style={selectStyle}
              >
                {ENTITY_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <button type="button" onClick={connect} disabled={busy || !country || !entityType} style={primaryBtn}>
              {busy ? 'Opening Stripe…' : 'Connect Stripe'}
            </button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div style={railHead}>Stripe account</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/*
                * Without this there is no way back into onboarding. A Stripe
                * account link is single-use and expires in minutes, so a
                * tenant who closes the tab half-way, or whose account comes
                * back restricted, is stuck: the only other action here is
                * Disconnect, which abandons the Stripe account and starts a
                * brand new one. `connect` already reuses the existing
                * account when there is one, so re-entering onboarding is
                * just a fresh link -- no country/entity needed second time.
                */}
              {!account.charges_enabled ? (
                <button type="button" onClick={connect} disabled={busy} style={primaryBtn}>
                  {busy ? 'Opening Stripe…' : 'Finish onboarding'}
                </button>
              ) : null}
              <button type="button" onClick={refresh} disabled={busy} style={ghostBtn}>Refresh status</button>
              <button type="button" onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
            </div>
          </div>

          {account.livemode === false ? (
            <div style={testModeStyle}>
              TEST MODE · this account is not live — no real money moves through it.
            </div>
          ) : null}

          <div>
            <div style={rowStyle}>
              <span style={labelStyle}>Accepting payments</span>
              <span style={pill(account.charges_enabled ? TONE_GOOD : TONE_WARN)}>
                {account.charges_enabled ? 'Enabled' : 'Not yet enabled'}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Payouts</span>
              <span style={pill(account.payouts_enabled ? TONE_GOOD : TONE_WARN)}>
                {account.payouts_enabled ? 'Enabled' : 'Not yet enabled'}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Onboarding</span>
              <span style={pill(account.details_submitted ? TONE_GOOD : TONE_WARN)}>
                {account.details_submitted ? 'Details submitted' : 'Incomplete'}
              </span>
            </div>
          </div>

          {account.disabled_reason ? (
            <div style={{ ...cardStyle, borderColor: '#fecaca', background: '#fef2f2', padding: '10px 12px', gap: '3px' }}>
              <span style={{ ...pill(TONE_BAD), alignSelf: 'flex-start' }}>Restricted</span>
              <span style={{ fontSize: '.75rem', color: '#7f1d1d' }}>{account.disabled_reason}</span>
            </div>
          ) : null}

          {!account.charges_enabled ? (
            <div style={noteStyle}>
              This account cannot collect a payment yet. Finish Stripe&rsquo;s onboarding before
              sending an envelope with a payment field on it.
            </div>
          ) : null}

          <div style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
            {account.default_currency ? account.default_currency.toUpperCase() + ' · ' : ''}
            {account.provider_account_id ?? '—'}
          </div>
        </div>
      )}
    </section>
  );
}
