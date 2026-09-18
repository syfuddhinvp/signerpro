'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF, type Contact } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { ROLE_WORDS, type Dict } from '@/lib/sf/data';
import { btn, inputStyle, lbl, pill, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { contacts as contactsApi } from '@/lib/api/resources';
import { documentPathFor } from '@/lib/sf/routes';
import type { ContactHistoryEntry } from '@/lib/api/types';
import { EMPTY } from '@/lib/sf/adapters';
import Icon from '@/components/sf/Icon';

/**
 * One contact's record, at `/contacts/<id>`.
 *
 * This is the screen the address-book modal used to stand in for: the record
 * gets its own URL (shareable, linkable from an envelope) and splits into the
 * two tabs the CRM shape asks for — the documents this contact appears on, and
 * the editable detail fields.
 *
 * Server data arrives as props; the screen owns only the tab and the edit
 * form. `router.refresh()` after a save is what re-reads the record — there is
 * no client mirror of the contact to keep in step.
 */
export type ContactRecordProps = {
  contact: Contact;
  /** `GET /api/contacts/{id}/history`, fetched on the server with the record. */
  history: ContactHistoryEntry[];
  /** Group key → label, so the detail tab can name the group the API keyed. */
  groupLabels: Dict<string>;
  /** The draft envelope "Add as recipient" targets; null when there is none. */
  draftDocumentId: string | null;
  /** True when the history call failed — the tab says so instead of "none". */
  historyFailed?: boolean;
};

type TabKey = 'documents' | 'details';

/** `2026-08-14T…` → `14 Aug 2026`; an absent timestamp stays absent. */
function historyDate(iso: string | null): string {
  if (!iso) return 'no date recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'no date recorded' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One label/value pair on the record. `wide` spans the grid — an address or
 *  a description is a sentence, not a word, and wrapping it inside a 200px
 *  column costs more lines than the row it saves. */
type DetailPair = { label: string; value: string; href?: string | null; wide?: boolean };

/** A titled block of the record. The title carries the one action that belongs
 *  to it, so "Edit contact" sits beside the fields it edits rather than
 *  stranded under the last row of the page. */
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingBottom: '10px', marginBottom: '14px', borderBottom: '1px solid #eef1f6' }}>
        <span style={{ ...railHead, fontWeight: 600 }}>{title}</span>
        {action ? <span style={{ marginLeft: 'auto' }}>{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Pairs laid out in as many columns as the width allows, value under label.
 *  An unset field says so in muted text instead of leaving a lone dash at the
 *  far edge of the screen with nothing near it to explain what it answers. */
function PairGrid({ rows }: { rows: DetailPair[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px 24px' }}>
      {rows.map(r => {
        const unset = r.value === EMPTY || r.value === '';
        return (
          <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, gridColumn: r.wide ? '1 / -1' : undefined }}>
            <span style={railHead}>{r.label}</span>
            {unset ? (
              <span style={{ fontSize: '.8125rem', color: '#94a3b8' }}>Not set</span>
            ) : r.href ? (
              <a href={r.href} style={{ fontSize: '.8125rem', fontWeight: 500, color: '#0f172a', wordBreak: 'break-word' }}>{r.value}</a>
            ) : (
              <span style={{ fontSize: '.8125rem', fontWeight: 500, color: '#0f172a', wordBreak: 'break-word', lineHeight: 1.55 }}>{r.value}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** `—` is the adapter's stand-in for an empty field; forms want a real blank. */
const formValue = (v: string) => (v === EMPTY ? '' : v);

export default function ContactRecord({ contact: ct, history, groupLabels, draftDocumentId, historyFailed = false }: ContactRecordProps) {
  const { set, flash, accent, initials, recips } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();
  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const [tab, setTab] = useState<TabKey>('details');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: formValue(ct.name),
    email: formValue(ct.email),
    phone: formValue(ct.phone),
    company: formValue(ct.company),
    title: formValue(ct.title),
    address: formValue(ct.address),
    description: formValue(ct.description),
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  const save = () => {
    if (!form.name.trim()) { flash('A name is required'); return; }
    if (form.email.indexOf('@') < 1) { flash('Enter a valid email'); return; }
    setSaving(true);
    void contactsApi
      .update(apiCall, ct.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        /* An emptied field clears the value rather than keeping the old one,
           which is the difference between `null` and an omitted key here. */
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        title: form.title.trim() || null,
        address: form.address.trim() || null,
        description: form.description.trim() || null,
      })
      .then(res => {
        setSaving(false);
        if (!res.ok) { flash('Could not save ' + form.name + ' · ' + res.error.message); return; }
        setEditing(false);
        flash(res.data.name + ' saved');
        router.refresh();
      });
  };

  const addAsRecipient = () => {
    const list = recips();
    if (list.some(r => r.email === ct.email)) { flash(ct.name + ' is already a recipient on this envelope'); return; }
    set({ recipients: list.concat([{ id: 'r' + (list.length + 1), name: ct.name, email: ct.email, role: ct.role, color: ct.color, order: list.length + 1, status: 'Pending' } as never]) });
    flash(ct.name + ' added as recipient ' + (list.length + 1) + ' · assign fields in the builder');
    if (!draftDocumentId) return;
    void contactsApi.addAsRecipients(apiCall, { document_id: draftDocumentId, contact_ids: [ct.id] }).then(res => {
      if (!res.ok) { flash('Could not add ' + ct.name + ' · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const avatar: CSSProperties = { width: '44px', height: '44px', borderRadius: '99px', background: ct.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '.9375rem', fontWeight: 700, flex: '0 0 44px' };
  const card: CSSProperties = { background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', overflow: 'hidden' };

  const tabs: [TabKey, string, string][] = [
    ['documents', 'Documents', String(history.length)],
    ['details', 'Contact details', ''],
  ];

  /* The record used to be thirteen rows of label-left / value-right stretched
     across the full page: on a wide screen the eye had to travel a thousand
     pixels from "Phone number" to the dash that answered it, and the fields
     that matter (how to reach this person) sat in the same undifferentiated
     list as bookkeeping like Source and Owner. They are three groups of pairs
     now — how to reach them, how they default onto an envelope, what they have
     signed — each pair reading top-to-bottom so the value is under its label
     at any width. */
  const reachRows: DetailPair[] = [
    { label: 'Email', value: ct.email, href: ct.email === EMPTY ? null : 'mailto:' + ct.email },
    { label: 'Phone number', value: ct.phone, href: ct.phone === EMPTY ? null : 'tel:' + ct.phone.replace(/\s+/g, '') },
    { label: 'Company', value: ct.company },
    { label: 'Job title', value: ct.title },
    { label: 'Address', value: ct.address, wide: true },
    { label: 'Description', value: ct.description, wide: true },
  ];

  const defaultRows: DetailPair[] = [
    { label: 'Default role', value: ROLE_WORDS[ct.role] ?? ct.role },
    { label: 'Group', value: groupLabels[ct.group] ?? ct.group },
    { label: 'Source', value: ct.source },
    { label: 'Owner', value: ct.owner },
  ];

  const activityRows: DetailPair[] = [
    { label: 'Envelopes', value: String(ct.envelopes) },
    { label: 'Last signed', value: ct.lastSigned },
  ];

  return (
    <section data-screen-label="Contact" style={{ padding: '22px 22px 40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header — breadcrumb back to the address book, then the record. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '.71875rem', color: TEXT_MUTED }}>
          <Link href="/contacts" style={{ color: TEXT_MUTED, textDecoration: 'none', fontWeight: 600 }}>Contacts</Link>
          <span> / {ct.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={avatar}>{initials(ct.name)}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-.3px', margin: 0 }}>{ct.name}</h1>
            <span style={{ fontSize: '.75rem', color: '#64748b' }}>{ct.email}{ct.company === EMPTY ? '' : ' · ' + ct.company}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={addAsRecipient} style={primaryBtn}><Icon name="addUser" size={13} />Add as recipient</button>
            <button type="button" onClick={() => go('routing', { documentId: draftDocumentId })} style={ghostBtn}><Icon name="send" size={13} />Send envelope</button>
          </div>
        </div>
      </div>

      <div style={card}>
        <div role="tablist" aria-label="Contact sections" style={{ display: 'flex', gap: '4px', padding: '10px 14px 0', borderBottom: '1px solid #eef1f6', flexWrap: 'wrap' }}>
          {tabs.map(([key, label, count]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(key)}
                style={{ height: '34px', padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: '.8125rem', fontWeight: on ? 700 : 500, color: on ? '#0f172a' : '#64748b',
                  borderBottom: '2px solid ' + (on ? A : 'transparent'), marginBottom: '-1px' }}
              >
                {label}{count ? <span style={{ color: TEXT_MUTED, fontWeight: 500 }}> ({count})</span> : null}
              </button>
            );
          })}
        </div>

        {tab === 'documents' ? (
          <div style={{ padding: '6px 14px 14px' }}>
            {history.length === 0 ? (
              <div style={{ padding: '18px 0', fontSize: '.78125rem', color: '#64748b', lineHeight: 1.6 }}>
                {historyFailed ? 'This contact’s documents could not be loaded.' : 'No envelopes involving this contact yet.'}
              </div>
            ) : history.map((h, i) => {
              const done = h.status === 'completed';
              return (
                <div key={h.document_id + i} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '11px 0', borderTop: i ? '1px solid #f2f4f8' : 'none', flexWrap: 'wrap' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '99px', background: done ? '#10b981' : A, flex: '0 0 8px' }} />
                  <Link href={documentPathFor('audit', h.document_id)} style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 200px', minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ fontSize: '.8125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.title}</span>
                    <span style={{ fontSize: '.6875rem', color: '#64748b' }}>{h.event} · {historyDate(h.occurred_at)}</span>
                  </Link>
                  <span style={pill(done ? { bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' } : { bg: '#eef2ff', fg: '#4338ca', bd: '#c7d2fe' })}>{h.status}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '14px' }}>
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px 18px', alignItems: 'start' }}>
                <label style={lbl}>Full name<input style={inputStyle} {...field('name')} /></label>
                <label style={lbl}>Email<input style={inputStyle} type="email" {...field('email')} /></label>
                <label style={lbl}>Phone number<input style={inputStyle} {...field('phone')} /></label>
                <label style={lbl}>Company<input style={inputStyle} {...field('company')} /></label>
                <label style={lbl}>Job title<input style={inputStyle} {...field('title')} /></label>
                <label style={lbl}>Address<input style={inputStyle} {...field('address')} /></label>
                <label style={{ ...lbl, gridColumn: '1 / -1' }}>
                  Description
                  <textarea rows={3} style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }} {...field('description')} />
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}><Icon name="save" size={13} />{saving ? 'Saving…' : 'Save changes'}</button>
                  <button type="button" onClick={() => setEditing(false)} style={ghostBtn}><Icon name="close" size={13} />Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                <Section
                  title="How to reach them"
                  action={<button type="button" onClick={() => setEditing(true)} style={ghostBtn}><Icon name="pencil" size={13} /> Edit contact</button>}
                >
                  <PairGrid rows={reachRows} />
                </Section>

                <Section title="On an envelope">
                  <PairGrid rows={defaultRows} />
                  {ct.tags.length ? (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '14px' }}>
                      <span style={{ ...railHead, marginRight: '2px' }}>Tags</span>
                      {ct.tags.map((t, i) => (
                        <span key={t + i} style={{ padding: '4px 9px', borderRadius: '99px', border: '1px solid #e3e7ee', background: '#fbfcfd', fontSize: '.65625rem', color: '#475569' }}>{t}</span>
                      ))}
                    </div>
                  ) : null}
                </Section>

                <Section title="Activity">
                  <PairGrid rows={activityRows} />
                </Section>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
