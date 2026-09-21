'use client';

/**
 * The tenant-wide payments ledger (PAY-2) — every payment a signer has made
 * to this organization, across every envelope.
 *
 * Why it exists. Money collected during signing was only ever visible from
 * inside one envelope's audit page, and refunding was only reachable there
 * too. So a tenant with payments spread across dozens of envelopes had
 * nowhere to see what they had actually taken, nowhere to reconcile it
 * against their books, and no way to find a payment they needed to return
 * without already knowing which envelope it was on. It read, reasonably, as
 * though the application kept no record of payments at all.
 *
 * Three things this screen must never do, each of which was a real failure
 * mode of the thing it replaces:
 *
 * - show a payment as collected when it has been refunded;
 * - sum amounts across currencies into one number;
 * - present a receipt whose stored row no longer matches its checksum as if
 *   it were intact.
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, apiDownload, saveBlob } from '@/lib/api/browser';
import { payments as paymentsApi } from '@/lib/api/resources';
import { useDialogs } from '@/components/sf/DialogProvider';
import { useOptionalSession } from '@/components/sf/SessionProvider';
import { useSF } from '@/lib/sf/state';
import { formatCents } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import {
  btn, cardStyle, pill, railHead, TEXT_MUTED, TONE_BAD, TONE_GOOD, TONE_NEUTRAL, TONE_WARN,
} from '@/lib/sf/ui';
import Icon from '@/components/sf/Icon';
import type {
  PaymentLedgerEntry, PaymentLedgerPage, PaymentReceiptResponse, SignerPaymentStatus,
} from '@/lib/api/types';

export type PaymentsLedgerProps = {
  /** `GET /api/payments/ledger`, fetched by the server page. */
  page: PaymentLedgerPage | null;
  /** `ApiError.message` when that call failed, so an empty ledger is not
   *  rendered as "no payments yet" when it might just be unreachable. */
  loadError?: string | null;
  /** The active `status` filter, driven through the URL so the server page
   *  renders the already-filtered list. */
  filter?: SignerPaymentStatus | 'all';
};

const FILTERS: Array<[SignerPaymentStatus | 'all', string]> = [
  ['all', 'All'],
  ['succeeded', 'Collected'],
  ['refunded', 'Refunded'],
  ['failed', 'Failed'],
  ['processing', 'In flight'],
];

function statusTone(status: SignerPaymentStatus) {
  if (status === 'succeeded') return TONE_GOOD;
  if (status === 'failed') return TONE_BAD;
  if (status === 'refunded') return TONE_NEUTRAL;
  return TONE_WARN;
}

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
  padding: '11px 0', borderTop: '1px solid hsl(var(--color-border-faint))', flexWrap: 'wrap',
};
const metaStyle: CSSProperties = {
  fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)', lineHeight: 1.6,
};

export default function PaymentsLedger({
  page, loadError = null, filter = 'all',
}: PaymentsLedgerProps) {
  const { flash, accent } = useSF();
  const { askText, askConfirm } = useDialogs();
  const router = useRouter();
  const session = useOptionalSession();
  const A = accent();
  /* Refunding is org-admin only, matching `require_org_admin` on the route.
     A button that 4xxes on click is worse than no button. */
  const isAdmin = session?.role === 'admin';
  const [busyId, setBusyId] = useState('');

  const entries = page?.entries ?? [];

  const downloadReceipt = (receipt: PaymentReceiptResponse) => {
    const filename = receipt.number + '.pdf';
    flash('Preparing ' + filename + '…');
    void apiDownload(paymentsApi.receiptPdfPath(receipt.id), { filename }).then(res => {
      if (!res.ok) { flash('Could not download receipt · ' + res.error.message); return; }
      saveBlob(res.data);
      flash('Receipt ' + receipt.number + ' downloaded');
    });
  };

  /* Deliberately the same flow as the per-envelope panel: an explicit amount
     prompt, then a confirm naming the payer and the amount. Refunds move real
     money out of the tenant's account and cannot be undone, so a one-click
     button here would be a footgun sitting in a list. */
  const refund = async (entry: PaymentLedgerEntry) => {
    const payment = entry.payment;
    if (!isAdmin || busyId) return;
    const remaining = payment.amount_cents - payment.refunded_amount_cents;
    const who = entry.payer_name || entry.payer_email || 'the payer';
    const entered = await askText({
      title: 'Refund amount',
      message: `Leave blank to refund the full ${formatCents(remaining, payment.currency)} remaining. Enter a smaller amount for a partial refund.`,
      label: 'Amount (' + payment.currency.toUpperCase() + ')',
      placeholder: (remaining / 100).toFixed(2),
    });
    if (entered === null) return;
    let amountCents: number | undefined;
    if (entered.trim() !== '') {
      const parsed = Math.round(parseFloat(entered) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining) {
        flash('Enter an amount between 0.01 and ' + (remaining / 100).toFixed(2));
        return;
      }
      amountCents = parsed;
    }
    const amount = amountCents ?? remaining;
    const ok = await askConfirm({
      title: 'Refund ' + formatCents(amount, payment.currency) + '?',
      message: `This refunds ${who} ${formatCents(amount, payment.currency)} via Stripe and updates receipt ${entry.receipt?.number ?? '(none)'}. This cannot be undone.`,
      cta: 'Refund',
      danger: true,
    });
    if (!ok) return;
    setBusyId(payment.id);
    const res = await paymentsApi.refund(apiCall, payment.id, amountCents);
    setBusyId('');
    if (!res.ok) { flash('Not refunded · ' + res.error.message); return; }
    flash('Refunded ' + formatCents(amount, payment.currency) + ' to ' + who);
    router.refresh();
  };

  const setFilter = (next: SignerPaymentStatus | 'all') => {
    router.replace(next === 'all' ? '/account/payments' : '/account/payments?status=' + next);
  };

  /* One tile per currency. A tenant taking both USD and EUR has two cash
     positions; a single summed figure would be a number someone might file a
     tax return against. */
  const currencies = Object.keys(page?.collected_cents_by_currency ?? {}).sort();

  return (
    /* The same 760px centred column `Payments` uses, so the two panels on
       `/account/payments` read as one screen. No top padding: `Payments`
       above already carries the screen's gap. */
    <section style={{ padding: '0 22px 40px', maxWidth: '760px', margin: '0 auto', width: '100%' }}>
    <div style={cardStyle} data-testid="payments-ledger">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={railHead}>Payments received</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              style={{
                height: '26px', padding: '0 10px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                fontSize: '.75rem', fontWeight: filter === id ? 600 : 500,
                background: filter === id ? 'hsl(var(--color-accent-subtle))' : 'transparent',
                color: filter === id ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div style={{ fontSize: '.75rem', color: 'hsl(var(--color-fg-danger))', background: 'hsl(var(--color-bg-danger-subtle))', border: '1px solid hsl(var(--color-border-danger))', borderRadius: '10px', padding: '9px 11px' }}>
          Could not load the ledger · {loadError}
        </div>
      ) : null}

      {currencies.length ? (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {currencies.map(currency => (
            <div key={currency} style={{ border: '1px solid hsl(var(--color-border-hairline))', borderRadius: '11px', padding: '9px 12px', minWidth: '140px' }}>
              <div style={{ fontSize: '.6875rem', color: TEXT_MUTED, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Net collected · {currency}
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))' }}>
                {formatCents(page?.collected_cents_by_currency?.[currency] ?? 0, currency)}
              </div>
              {page?.refunded_cents_by_currency?.[currency] ? (
                <div style={{ fontSize: '.6875rem', color: 'hsl(var(--color-fg-warning))' }}>
                  {formatCents(page.refunded_cents_by_currency[currency], currency)} refunded
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {page ? (
        <div style={metaStyle}>
          {page.succeeded_count} collected · {page.refunded_count} refunded · {page.failed_count} failed
          {page.total > entries.length ? ` · showing ${entries.length} of ${page.total}` : ''}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.length ? entries.map(entry => {
          const p = entry.payment;
          const remaining = p.amount_cents - p.refunded_amount_cents;
          const canRefund = isAdmin && (p.status === 'succeeded' || p.status === 'refunded') && remaining > 0;
          return (
            <div key={p.id} style={rowStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                <span style={{ fontSize: '.78125rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))' }}>
                  {entry.payer_name || entry.payer_email || 'Unknown payer'}
                  {' · '}
                  {formatCents(p.amount_cents, p.currency)}
                </span>
                <a
                  href={documentPathFor('audit', entry.document_id)}
                  style={{ fontSize: '.71875rem', color: A, textDecoration: 'none' }}
                >
                  {entry.document_title || entry.document_id} →
                </a>
                <span style={metaStyle}>
                  {p.paid_at ? new Date(p.paid_at).toLocaleString() : 'not settled'}
                  {p.refunded_amount_cents > 0
                    ? ' · ' + formatCents(p.refunded_amount_cents, p.currency) + ' refunded'
                    : ''}
                  {p.provider_payment_intent_id ? ' · ' + p.provider_payment_intent_id : ''}
                </span>
                <span style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {entry.receipt ? (
                    <button
                      type="button"
                      onClick={() => downloadReceipt(entry.receipt!)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '.6875rem', color: A, fontFamily: 'var(--font-sans)' }}
                    >
                      {entry.receipt.number}<Icon name="download" size={11} />
                    </button>
                  ) : (
                    /* Said plainly rather than left blank: a settled payment
                       with no receipt predates receipts and needs the
                       backfill run, which is a different problem from a
                       payment that never settled. */
                    <span style={metaStyle}>
                      {p.status === 'succeeded' ? 'no receipt — needs backfill' : 'no receipt'}
                    </span>
                  )}
                  {entry.receipt && !entry.receipt.verified ? (
                    <span style={{ fontSize: '.6875rem', color: 'hsl(var(--color-fg-danger))', fontWeight: 600 }}>
                      checksum mismatch
                    </span>
                  ) : null}
                  {p.receipt_url ? (
                    <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: '.6875rem', color: TEXT_MUTED, textDecoration: 'none' }}>
                      Stripe receipt →
                    </a>
                  ) : null}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={pill(statusTone(p.status))}>{p.status}</span>
                {canRefund ? (
                  <button
                    type="button"
                    onClick={() => void refund(entry)}
                    disabled={busyId === p.id}
                    style={btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-danger))', 'hsl(var(--color-border-danger))')}
                  >
                    <Icon name="undo" size={13} />{busyId === p.id ? 'Refunding…' : 'Refund'}
                  </button>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, paddingTop: '10px' }}>
            {loadError ? 'Ledger unavailable.' : 'No signer payments yet.'}
          </span>
        )}
      </div>
    </div>
    </section>
  );
}
