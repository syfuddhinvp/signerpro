'use client';

/**
 * The tenant record page — everything the platform knows about one tenant,
 * on one screen.
 *
 * Why it exists. The console could list tenants and show a dozen summary
 * fields in an inline rail, and that was all: answering "who is actually in
 * this account, what have they sent, which keys can act on them, and what
 * have they paid us" meant opening the directory filtered by organization,
 * the invoice list filtered by tenant, and impersonating them for the rest —
 * which is a privileged, audited act to answer a read-only question.
 *
 * Three things this screen must not do:
 *
 * - sum money across currencies (the signer-payment totals are per currency,
 *   as the API returns them, for the same reason the tenant's own ledger
 *   refuses to);
 * - present a capped list as a complete one (every list here is the server's
 *   newest-25 and says so);
 * - show a revoked API key as if it were live.
 */

import { useCallback, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useDialogs } from '@/components/sf/DialogProvider';
import { apiCall } from '@/lib/api/browser';
import { tenants as tenantsApi } from '@/lib/api/resources';
import { EMPTY, formatCents, formatDate, formatRelative } from '@/lib/sf/adapters';
import {
  btn, pill, railHead, selectStyle, tabBtn, TEXT_MUTED, TONE_BAD, TONE_GOOD, TONE_NEUTRAL, TONE_WARN,
} from '@/lib/sf/ui';
import { TENANT_RECORD_TABS } from '@/lib/sf/tenantRecord';
import type { TenantProfile } from '@/lib/api/types';
import Icon from '@/components/sf/Icon';

export type TenantRecordProps = {
  profile: TenantProfile;
  /** The open section, driven through `?tab=` so a link lands on it. */
  tab: string;
  /** The platform-wide flag catalogue, so an override can name what it is
   *  overriding — "Inherit (on)" is a different statement from "Force on". */
  flags: { key: string; on: boolean }[];
};

/** The server caps every list at this many rows; the UI says so rather than
 *  letting 25 read as "all there is". */
const PAGE_CAP = 25;

const sectionStyle: CSSProperties = {
  background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '16px', overflow: 'hidden',
};
const sectionHead: CSSProperties = {
  padding: '12px 15px', borderBottom: '1px solid hsl(var(--color-border-hairline))', display: 'flex',
  justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
};
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 15px',
  borderTop: '1px solid hsl(var(--color-border-faint))', flexWrap: 'wrap',
};
const metaStyle: CSSProperties = {
  fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)',
};
const emptyStyle: CSSProperties = { padding: '15px', fontSize: '.78125rem', color: TEXT_MUTED };
const amountStyle: CSSProperties = {
  marginLeft: 'auto', fontSize: '.8125rem', fontWeight: 600, fontFamily: 'var(--font-sans)',
  whiteSpace: 'nowrap',
};

function statusTone(status: string) {
  if (['completed', 'paid', 'succeeded', 'active'].includes(status)) return TONE_GOOD;
  if (['declined', 'voided', 'failed', 'past_due', 'uncollectible', 'suspended'].includes(status)) return TONE_BAD;
  if (['sent', 'viewed', 'partially_completed', 'open', 'processing', 'trialing'].includes(status)) return TONE_WARN;
  return TONE_NEUTRAL;
}

function label(value: string): string {
  return value.replace(/_/g, ' ');
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionHead}>
        <div style={railHead}>{title}</div>
        {note ? <span style={metaStyle}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <div style={emptyStyle}>{what}</div>;
}

export default function TenantRecord({ profile, tab, flags }: TenantRecordProps) {
  const { flash, initials } = useSF();
  const { askText } = useDialogs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const t = profile.tenant;
  const counts = profile.counts;
  const suspended = Boolean(t.suspended_at);

  const setTab = useCallback((next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? pathname + '?' + qs : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  /* Suspension freezes every envelope the tenant has out, so it asks for a
     reason the audit trail keeps — the API refuses one shorter than three
     characters, and asking here beats a 422 after the fact. */
  const suspend = async () => {
    const reason = await askText({
      title: 'Suspend ' + t.name + '?',
      message: 'Every envelope this tenant has out for signature freezes immediately.',
      label: 'Reason (recorded in the platform audit trail)',
      cta: 'Suspend tenant',
    });
    if (reason === null) return;
    if (reason.trim().length < 3) { flash('A suspension reason of at least 3 characters is required'); return; }
    const res = await tenantsApi.suspend(apiCall, t.id, reason.trim());
    if (!res.ok) { flash('Could not suspend ' + t.name + ' · ' + res.error.message); return; }
    flash(t.name + ' suspended — all envelopes frozen');
    router.refresh();
  };

  const setOverride = (key: string, enabled: boolean | null) => {
    flash(key + ' override for ' + t.name + ' → ' + (enabled === null ? 'cleared' : enabled ? 'on' : 'off'));
    void tenantsApi.setFlagOverride(apiCall, t.id, { key, enabled }).then(res => {
      if (!res.ok) { flash('Could not set override · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const overrideFor = (key: string): boolean | null => {
    const row = t.flag_overrides.find(o => o.key === key);
    return row ? row.enabled : null;
  };

  const reinstate = () => {
    flash(t.name + ' reinstated');
    void tenantsApi.resume(apiCall, t.id).then(res => {
      if (!res.ok) { flash('Could not reinstate ' + t.name + ' · ' + res.error.message); return; }
      router.refresh();
    });
  };

  /* Capped lists get a footnote instead of a page control: the screen that
     owns the full history is one link away in every case. */
  const cap = (shown: number, total: number) =>
    total > shown ? 'newest ' + shown + ' of ' + total.toLocaleString() : shown.toLocaleString() + (shown === 1 ? ' row' : ' rows');

  const tiles: Array<[string, string, string?]> = [
    ['Users', counts.users.toLocaleString(), counts.active_users.toLocaleString() + ' active'],
    ['Seats', t.seats_activated.toLocaleString() + ' / ' + t.seats_licensed.toLocaleString(), 'activated / licensed'],
    ['Documents', counts.documents.toLocaleString(), counts.templates.toLocaleString() + ' templates'],
    ['Envelopes · 30d', t.envelope_volume_30d.toLocaleString()],
    ['MRR', formatCents(t.mrr_cents), t.plan_name],
    ['API keys', counts.active_api_keys.toLocaleString(), counts.api_keys.toLocaleString() + ' total'],
    ['Contacts', counts.contacts.toLocaleString(), counts.folders.toLocaleString() + ' folders'],
    ['Open tickets', String(t.open_ticket_count), t.incidents_90d + ' incidents · 90d'],
  ];

  const facts: Array<[string, string]> = [
    ['Slug', t.slug || EMPTY],
    ['Owner', t.owner_email || EMPTY],
    ['Region', t.region || EMPTY],
    ['Company size', t.company_size || EMPTY],
    ['Plan', t.plan_name],
    ['Subscription', label(t.subscription_status)],
    ['Billing email', t.billing_email || EMPTY],
    ['Billing cycle', t.billing_cycle || EMPTY],
    ['Live mode', t.live_mode_enabled ? 'enabled' : 'test only'],
    ['Teams', counts.teams.toLocaleString()],
    ['Webhooks', counts.webhooks.toLocaleString()],
    ['Created', formatDate(t.created_at)],
    ...(t.suspension_reason ? [['Suspension reason', t.suspension_reason] as [string, string]] : []),
  ];

  const statuses = Object.entries(profile.documents_by_status).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '13px', flexWrap: 'wrap' }}>
        <span style={{ width: '44px', height: '44px', borderRadius: '13px', background: 'hsl(var(--color-bg-panel-dark))', color: 'hsl(var(--color-fg-on-solid))', display: 'grid', placeItems: 'center', fontSize: '.875rem', fontWeight: 700 }}>
          {initials(t.name)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>{t.name}</h1>
            <span style={pill(statusTone(t.status))}>{label(t.status)}</span>
          </div>
          <span style={metaStyle}>{t.slug} · owner {t.owner_email || EMPTY} · tenant since {formatRelative(t.created_at)}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <Link href="/platform/tenants" style={{ ...btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'), textDecoration: 'none' }}>All tenants</Link>
          {suspended ? (
            <button type="button" onClick={reinstate} style={btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-success))', 'hsl(var(--color-border-success))')}><Icon name="check" size={13} />Reinstate</button>
          ) : (
            <button type="button" onClick={() => { void suspend(); }} style={btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-danger))', 'hsl(var(--color-border-danger))')}><Icon name="pause" size={13} />Suspend…</button>
          )}
        </div>
      </div>

      {suspended ? (
        <div style={{ padding: '11px 14px', borderRadius: '12px', background: 'hsl(var(--color-bg-danger-subtle))', border: '1px solid hsl(var(--color-border-danger))', color: 'hsl(var(--color-fg-danger))', fontSize: '.78125rem' }}>
          Suspended {formatRelative(t.suspended_at)} — every envelope is frozen.
          {t.suspension_reason ? ' Reason: ' + t.suspension_reason : ''}
        </div>
      ) : null}

      {/* ── tabs ───────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Tenant record sections" style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', background: 'hsl(var(--color-bg-muted))', padding: '4px', borderRadius: '11px', alignSelf: 'flex-start' }}>
        {TENANT_RECORD_TABS.map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            onClick={() => setTab(id)} style={tabBtn(tab === id)}>{text}</button>
        ))}
      </div>

      {/* ── overview ───────────────────────────────────────────────────── */}
      {tab === 'overview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: '11px' }}>
            {tiles.map(([k, v, sub]) => (
              <div key={k} style={{ background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '14px', padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={railHead}>{k}</span>
                <span style={{ fontSize: '1.0625rem', fontWeight: 700 }}>{v}</span>
                {sub ? <span style={metaStyle}>{sub}</span> : null}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', alignItems: 'start' }}>
            <Section title="Account">
              <div style={{ padding: '4px 15px 13px' }}>
                {facts.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.78125rem', padding: '7px 0', borderTop: '1px solid hsl(var(--color-border-faint))' }}>
                    <span style={{ color: 'hsl(var(--color-fg-muted))' }}>{k}</span>
                    <span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Administrators" note={t.admins.length + ' with org-admin role'}>
              {t.admins.length ? t.admins.map(a => (
                <div key={a.id} style={rowStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{a.name}</span>
                    <span style={metaStyle}>{a.email}</span>
                  </div>
                  <span style={{ ...pill(a.mfa_enabled ? TONE_GOOD : TONE_WARN), marginLeft: 'auto' }}>
                    {a.mfa_enabled ? 'MFA on' : 'No MFA'}
                  </span>
                </div>
              )) : <Empty what="This tenant has no organization administrator." />}
            </Section>

            <Section title="Feature flags" note="an override applies to this tenant only">
              {flags.length ? flags.map(f => {
                const value = overrideFor(f.key);
                return (
                  <div key={f.key} style={rowStyle}>
                    <span style={{ fontSize: '.75rem', fontFamily: 'var(--font-sans)', wordBreak: 'break-all', minWidth: 0 }}>{f.key}</span>
                    <select
                      value={value === null ? 'inherit' : value ? 'on' : 'off'}
                      onChange={e => setOverride(f.key, e.target.value === 'inherit' ? null : e.target.value === 'on')}
                      aria-label={'Override ' + f.key}
                      style={{ ...selectStyle, marginLeft: 'auto' }}
                    >
                      <option value="inherit">Inherit ({f.on ? 'on' : 'off'})</option>
                      <option value="on">Force on</option>
                      <option value="off">Force off</option>
                    </select>
                  </div>
                );
              }) : <Empty what="No feature flags are defined on this platform." />}
            </Section>
          </div>
        </div>
      ) : null}

      {/* ── users ──────────────────────────────────────────────────────── */}
      {tab === 'users' ? (
        <Section title="Members" note={cap(profile.users.length, counts.users)}>
          {profile.users.length ? profile.users.map(u => (
            <div key={u.id} style={rowStyle}>
              <span style={{ width: '30px', height: '30px', borderRadius: '9px', background: 'hsl(var(--color-accent-subtle))', color: 'hsl(var(--color-accent-fg))', display: 'grid', placeItems: 'center', fontSize: '.6875rem', fontWeight: 700 }}>
                {initials(u.name || u.email)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 200px' }}>
                <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{u.name || u.email}</span>
                <span style={metaStyle}>{u.email}</span>
              </div>
              <span style={pill(TONE_NEUTRAL)}>{u.role_label}</span>
              <span style={pill(u.mfa_enabled ? TONE_GOOD : TONE_WARN)}>{u.mfa_enabled ? 'MFA · ' + (u.mfa_method || 'on') : 'No MFA'}</span>
              <span style={pill(statusTone(u.status))}>{label(u.status)}</span>
              <span style={{ ...metaStyle, marginLeft: 'auto', textAlign: 'right' }}>
                last active {formatRelative(u.last_active_at)}
              </span>
            </div>
          )) : <Empty what="No members — the tenant was provisioned but nobody has been invited." />}
        </Section>
      ) : null}

      {/* ── documents ──────────────────────────────────────────────────── */}
      {tab === 'documents' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Section title="By status" note={counts.documents.toLocaleString() + ' documents, deleted excluded'}>
            {statuses.length ? (
              <div style={{ padding: '13px 15px', display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
                {statuses.map(([status, count]) => (
                  <span key={status} style={pill(statusTone(status))}>{label(status)} · {count.toLocaleString()}</span>
                ))}
              </div>
            ) : <Empty what="This tenant has never created a document." />}
          </Section>

          <Section title="Recent documents" note={cap(profile.recent_documents.length, counts.documents)}>
            {profile.recent_documents.length ? profile.recent_documents.map(d => (
              <div key={d.id} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 240px' }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>
                    {d.title}{d.is_template ? ' · template' : ''}
                  </span>
                  <span style={metaStyle}>
                    {d.sender_email || 'unknown sender'} · created {formatRelative(d.created_at)}
                    {d.completed_at ? ' · completed ' + formatRelative(d.completed_at) : ''}
                  </span>
                </div>
                <span style={{ ...pill(statusTone(d.status)), marginLeft: 'auto' }}>{label(d.status)}</span>
              </div>
            )) : <Empty what="No documents yet." />}
          </Section>
        </div>
      ) : null}

      {/* ── billing ────────────────────────────────────────────────────── */}
      {tab === 'billing' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', alignItems: 'start' }}>
            <Section title="Subscription">
              {profile.subscription ? (
                <div style={{ padding: '4px 15px 13px' }}>
                  {([
                    ['Plan', profile.subscription.plan_name || t.plan_name],
                    ['Status', label(profile.subscription.status || t.subscription_status)],
                    ['List price', profile.subscription.price_cents === null ? EMPTY : formatCents(profile.subscription.price_cents)],
                    ['Current period ends', formatDate(profile.subscription.current_period_end)],
                    ['Trial ends', formatDate(profile.subscription.trial_ends_at)],
                    ['Cancels at period end', profile.subscription.cancel_at_period_end ? 'yes' : 'no'],
                    ['Provider', profile.subscription.provider || 'none'],
                  ] as Array<[string, string]>).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.78125rem', padding: '7px 0', borderTop: '1px solid hsl(var(--color-border-faint))' }}>
                      <span style={{ color: 'hsl(var(--color-fg-muted))' }}>{k}</span>
                      <span style={{ fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : <Empty what="No subscription record — this tenant is on the plan tier its organization row carries." />}
            </Section>

            <Section title="Invoiced to date" note="voided and draft invoices excluded">
              <div style={{ padding: '13px 15px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '11px' }}>
                {([
                  ['Invoiced', profile.invoiced_cents],
                  ['Paid', profile.invoice_paid_cents],
                  ['Outstanding', profile.invoice_outstanding_cents],
                ] as Array<[string, number]>).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={railHead}>{k}</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700 }}>{formatCents(v, profile.invoice_currency)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section title="Invoices" note={cap(profile.invoices.length, counts.invoices)}>
            {profile.invoices.length ? profile.invoices.map(i => (
              <div key={i.id} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>{i.number}</span>
                  <span style={metaStyle}>
                    issued {formatDate(i.issued_at)}
                    {i.due_at ? ' · due ' + formatDate(i.due_at) : ''}
                    {i.paid_at ? ' · paid ' + formatDate(i.paid_at) : ''}
                  </span>
                </div>
                <span style={pill(statusTone(i.status))}>{label(i.status)}</span>
                <span style={amountStyle}>
                  {formatCents(i.amount_paid_cents, i.currency)} / {formatCents(i.total_cents, i.currency)}
                </span>
              </div>
            )) : <Empty what="No invoices have been issued to this tenant." />}
          </Section>

          <Section title="Charges" note={cap(profile.charges.length, profile.charges.length)}>
            {profile.charges.length ? profile.charges.map(c => (
              <div key={c.id} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{c.description || c.method_label || 'Charge'}</span>
                  <span style={metaStyle}>
                    {formatRelative(c.occurred_at)}
                    {c.method_label ? ' · ' + c.method_label : ''}
                    {c.decline_code ? ' · declined: ' + c.decline_code : ''}
                  </span>
                </div>
                <span style={pill(statusTone(c.status))}>{label(c.status)}</span>
                <span style={amountStyle}>{formatCents(c.amount_cents, c.currency)}</span>
              </div>
            )) : <Empty what="No charges have been attempted against this tenant." />}
          </Section>
        </div>
      ) : null}

      {/* ── signer payments ────────────────────────────────────────────── */}
      {tab === 'payments' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Section title="Stripe connection" note="how signers pay this tenant">
            {profile.payment_account ? (
              <div style={{ padding: '13px 15px', display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={pill(profile.payment_account.charges_enabled ? TONE_GOOD : TONE_BAD)}>
                  {profile.payment_account.charges_enabled ? 'charges enabled' : 'charges disabled'}
                </span>
                <span style={pill(profile.payment_account.payouts_enabled ? TONE_GOOD : TONE_WARN)}>
                  {profile.payment_account.payouts_enabled ? 'payouts enabled' : 'payouts disabled'}
                </span>
                <span style={pill(profile.payment_account.livemode ? TONE_GOOD : TONE_NEUTRAL)}>
                  {profile.payment_account.livemode ? 'live mode' : 'test mode'}
                </span>
                <span style={metaStyle}>
                  {profile.payment_account.provider}
                  {profile.payment_account.onboarded_at ? ' · onboarded ' + formatDate(profile.payment_account.onboarded_at) : ' · onboarding incomplete'}
                  {profile.payment_account.disabled_reason ? ' · ' + profile.payment_account.disabled_reason : ''}
                </span>
              </div>
            ) : <Empty what="This tenant has not connected a payment account, so no envelope can request money." />}
          </Section>

          <Section title="Collected from signers" note="per currency — amounts in different currencies are never summed">
            {profile.signer_payment_totals.length ? (
              <div style={{ padding: '13px 15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '13px' }}>
                {profile.signer_payment_totals.map(total => (
                  <div key={total.currency} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={railHead}>{total.currency} · net of refunds</span>
                    <span style={{ fontSize: '1.0625rem', fontWeight: 700 }}>{formatCents(total.collected_cents, total.currency)}</span>
                    <span style={metaStyle}>
                      {total.count.toLocaleString()} payments · {formatCents(total.refunded_cents, total.currency)} refunded
                    </span>
                  </div>
                ))}
              </div>
            ) : <Empty what="No signer has paid this tenant yet." />}
          </Section>

          <Section title="Recent signer payments" note={cap(profile.signer_payments.length, counts.signer_payments)}>
            {profile.signer_payments.length ? profile.signer_payments.map(p => (
              <div key={p.id} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 220px' }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{p.document_title || 'Deleted document'}</span>
                  <span style={metaStyle}>
                    {p.paid_at ? 'paid ' + formatRelative(p.paid_at) : 'created ' + formatRelative(p.created_at)}
                    {p.refunded_amount_cents > 0 ? ' · ' + formatCents(p.refunded_amount_cents, p.currency) + ' refunded' : ''}
                  </span>
                </div>
                <span style={pill(statusTone(p.status))}>{label(p.status)}</span>
                <span style={amountStyle}>{formatCents(p.amount_cents, p.currency)}</span>
              </div>
            )) : <Empty what="No signer payments on record." />}
          </Section>
        </div>
      ) : null}

      {/* ── developer ──────────────────────────────────────────────────── */}
      {tab === 'developer' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Section title="API keys" note={cap(profile.api_keys.length, counts.api_keys)}>
            {profile.api_keys.length ? profile.api_keys.map(k => (
              <div key={k.id} style={{ ...rowStyle, opacity: k.revoked_at ? .62 : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: '1 1 260px' }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ ...metaStyle, wordBreak: 'break-all' }}>{k.masked}</span>
                  <span style={metaStyle}>
                    {k.scopes.length ? k.scopes.join(', ') : 'no scopes'}
                    {k.created_by_email ? ' · created by ' + k.created_by_email : ''}
                    {' · last used ' + formatRelative(k.last_used_at)}
                  </span>
                </div>
                <span style={pill(k.mode === 'live' ? TONE_WARN : TONE_NEUTRAL)}>{k.mode}</span>
                <span style={{ ...pill(k.revoked_at ? TONE_BAD : TONE_GOOD), marginLeft: 'auto' }}>
                  {k.revoked_at ? 'revoked ' + formatRelative(k.revoked_at) : 'active'}
                </span>
              </div>
            )) : <Empty what="This tenant has never minted an API key." />}
          </Section>

          <Section title="Webhook endpoints" note={cap(profile.webhooks.length, counts.webhooks)}>
            {profile.webhooks.length ? profile.webhooks.map(w => (
              <div key={w.id} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 300px' }}>
                  <span style={{ fontSize: '.78125rem', fontWeight: 600, fontFamily: 'var(--font-sans)', wordBreak: 'break-all' }}>{w.url}</span>
                  <span style={metaStyle}>
                    {w.event_types && w.event_types.length ? w.event_types.join(', ') : 'every event'}
                    {' · added ' + formatRelative(w.created_at)}
                  </span>
                </div>
                <span style={{ ...pill(w.is_active ? TONE_GOOD : TONE_NEUTRAL), marginLeft: 'auto' }}>
                  {w.is_active ? 'active' : 'paused'}
                </span>
              </div>
            )) : <Empty what="No webhook endpoints registered." />}
          </Section>
        </div>
      ) : null}

      {/* ── activity ───────────────────────────────────────────────────── */}
      {tab === 'activity' ? (
        <Section title="Platform actions on this tenant" note={'newest ' + Math.min(profile.audit.length, PAGE_CAP)}>
          {profile.audit.length ? profile.audit.map(a => (
            <div key={a.id} style={rowStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 260px' }}>
                <span style={{ fontSize: '.8125rem', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>{a.action}</span>
                <span style={metaStyle}>
                  {a.actor_email || 'system'}{a.ip_address ? ' · ' + a.ip_address : ''}
                  {a.detail ? ' · ' + a.detail : ''}
                </span>
              </div>
              <span style={{ ...metaStyle, marginLeft: 'auto', textAlign: 'right' }}>{formatRelative(a.occurred_at)}</span>
            </div>
          )) : <Empty what="No platform administrator has acted on this tenant." />}
        </Section>
      ) : null}
    </div>
  );
}
