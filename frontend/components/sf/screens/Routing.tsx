'use client';

import React, { type CSSProperties } from 'react';
import { reorderRecips, useDocumentTitle, useSF, type Recipient } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { btn, pill, inputStyle, lbl, railHead, TONE_NEUTRAL, TEXT_MUTED_ON_DARK } from '@/lib/sf/ui';
import { useDocumentPersistence } from '@/lib/sf/builderInteractions';
import { newBuilderRecipient, toBuilderRecipients, type BuilderRouting } from '@/lib/sf/adapters';
import AddRecipient from '@/components/sf/parts/AddRecipient';
import { rememberContact } from '@/lib/sf/recipientContacts';
import { useDialogs } from '@/components/sf/DialogProvider';
import type { BrandingThemeResponse, RecipientResponse, RecipientRole } from '@/lib/api/types';
import { apiCall } from '@/lib/api/browser';
import { recipients as recipientsApi } from '@/lib/api/resources';
import Icon from '@/components/sf/Icon';

export type RoutingProps = {
  /** null when the tenant has no draft to route. */
  documentId: string | null;
  /** The envelope's name, for the sidebar's contextual group. */
  title?: string;
  recipients: RecipientResponse[];
  routing: BuilderRouting | null;
  /** The tenant's branding themes (ORG-7), for the picker. Empty when the
   *  tenant has none — the picker then points at where to make one. */
  brandingThemes?: BrandingThemeResponse[];
};

export default function Routing({ documentId, title, recipients, routing, brandingThemes = [] }: RoutingProps) {
  const { s, set, flash, accent, recips } = useSF();
  const { go } = useNav();
  const { askConfirm } = useDialogs();
  const A = accent();
  useDocumentTitle(title);

  const seededRecipients = React.useMemo<Recipient[]>(() => toBuilderRecipients(recipients), [recipients]);

  /* This screen never touches fields, so the persistence hook is given the
     store's current set as its own baseline — that keeps its field autosave
     inert here while still providing the recipient, routing and send calls. */
  const P = useDocumentPersistence({
    documentId,
    serverFields: [],
    serverRecipients: recipients,
    seededFields: s.fields,
    autosaveFields: false,
  });

  React.useEffect(() => {
    if (!documentId) return;
    set({
      recipients: seededRecipients,
      routing: routing ? routing.routing : 'sequential',
      cadence: routing ? routing.cadence : '48h',
      expiry: routing ? routing.expiry : '14',
      message: routing ? routing.message : '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, seededRecipients, routing]);

  const [sending, setSending] = React.useState(false);

  /* `SFState` has no slot for the branding choice (same as the invite
     subject), so the screen holds it. '' means "use the tenant's default". */
  const [brandingThemeId, setBrandingThemeId] = React.useState<string>(routing ? routing.brandingThemeId : '');
  React.useEffect(() => {
    setBrandingThemeId(routing ? routing.brandingThemeId : '');
  }, [documentId, routing]);

  const defaultTheme = brandingThemes.find(t => t.is_default) ?? null;
  const effectiveTheme = brandingThemes.find(t => t.id === brandingThemeId) ?? defaultTheme;

  const changeBranding = (value: string) => {
    setBrandingThemeId(value);
    /* Immediate rather than debounced: this is a discrete pick, and it is the
       one routing setting whose effect a sender goes and checks elsewhere. */
    P.saveRouting({ brandingThemeId: value }, true);
  };

  const reorderRecipient = (id: string, dir: number) => {
    const next = reorderRecips(s, id, dir);
    if (!next) return;
    set({ recipients: next });
    P.saveRecipientOrder(next);
  };
  const changeRole = (id: string, role: string) => {
    set({ recipients: recips().map(x => (x.id === id ? Object.assign({}, x, { role }) : x)) });
    P.patchRecipient(id, { role: role as RecipientRole });
  };

  /* Recipients used to be add-only from the prepare screen, which this screen's
     own empty state pointed at — and which had no picker either. Same list, so
     the same control belongs here. */
  const addRecipient = async (name: string, email: string): Promise<boolean> => {
    if (!documentId) { flash('Open a document first'); return false; }
    const current = recips();
    const normalized = email.trim().toLowerCase();
    if (current.some(r => r.email.trim().toLowerCase() === normalized)) {
      flash(name + ' is already on this envelope');
      return false;
    }
    const created = newBuilderRecipient(name, email, current);
    const next = current.concat([created]);
    set({ recipients: next });
    const saved = await P.saveRecipients(next);
    if (!saved) { set({ recipients: current }); return false; }
    // Same address-book rule as the prepare screen; never fails the add.
    const remembered = await rememberContact(created.name, created.email);
    flash(created.name + ' added as signer ' + created.order + (
      remembered === 'created' ? ' · saved to contacts'
        : remembered === 'failed' ? ' · not saved to contacts' : ''
    ));
    return true;
  };

  const removeRecipient = async (id: string) => {
    const current = recips();
    const target = current.find(r => r.id === id);
    if (!target) return;
    const ok = await askConfirm({
      title: 'Remove ' + target.name + '?',
      message: 'Any fields assigned to them are deleted with them.',
      cta: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const next = current.filter(r => r.id !== id).map((r, i) => Object.assign({}, r, { order: i + 1 }));
    set({ recipients: next });
    // `set_all` refuses an empty list, so the last row goes through DELETE.
    const saved = next.length ? await P.saveRecipients(next) : await P.deleteRecipient(id);
    if (!saved) { set({ recipients: current }); return; }
    flash(target.name + ' removed');
  };
  /* Per-signer link actions.
     Both go through `POST .../resend`, which supersedes that recipient's
     previous link — so there is never more than one live URL per signer, and
     "copy link" (`notify=false`) does not also drop a second copy of it in
     their inbox. A recipient the server has never seen has no link to issue. */
  const [busyRecipient, setBusyRecipient] = React.useState('');
  const knownToServer = (id: string) => recipients.some(r => r.id === id);

  const resendTo = (r: Recipient) => {
    if (!documentId) { flash('Open a document first'); return; }
    if (!knownToServer(r.id)) { flash('Send the envelope before resending to ' + r.name); return; }
    setBusyRecipient(r.id);
    void recipientsApi.resend(apiCall, documentId, r.id).then(res => {
      setBusyRecipient('');
      if (!res.ok) { flash('Not resent · ' + res.error.message); return; }
      flash('Signing link resent to ' + res.data.email + ' · their previous link no longer works');
    });
  };

  const copyLinkFor = (r: Recipient) => {
    if (!documentId) { flash('Open a document first'); return; }
    if (!knownToServer(r.id)) { flash('Send the envelope before copying a link for ' + r.name); return; }
    setBusyRecipient(r.id);
    void recipientsApi.signingLink(apiCall, documentId, r.id).then(async res => {
      setBusyRecipient('');
      if (!res.ok) { flash('No link · ' + res.error.message); return; }
      const url = res.data.signing_link;
      if (typeof navigator === 'undefined' || !navigator.clipboard) { flash('Copy is unavailable here · ' + url); return; }
      try {
        await navigator.clipboard.writeText(url);
        flash(r.name + '\u2019s signing link copied · it replaces any link they were sent');
      } catch {
        flash('Could not copy · ' + url);
      }
    });
  };

  const changeRouting = (patch: Partial<BuilderRouting>) => {
    const local: { [k: string]: string } = {};
    if (patch.routing !== undefined) local.routing = patch.routing;
    if (patch.cadence !== undefined) local.cadence = patch.cadence;
    if (patch.expiry !== undefined) local.expiry = patch.expiry;
    if (patch.message !== undefined) local.message = patch.message;
    if (Object.keys(local).length) set(local);
    P.saveRouting(patch);
  };

  /** `POST /api/documents/{id}/send` — the real thing, then the signer view. */
  const send = () => {
    if (sending) return;
    setSending(true);
    void P.sendEnvelope().then(ok => {
      setSending(false);
      if (ok) go('sign', { documentId });
    });
  };

  const list = recips();

  const routingRows = list.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    order: s.routing === 'parallel' ? '=' : String(r.order),
    status: r.status,
    rowStyle: { display: 'flex', alignItems: 'center', gap: '11px', padding: '11px', border: '1px solid #eef1f6', borderRadius: '12px', background: '#fbfcfd' } as CSSProperties,
    orderStyle: { width: '26px', height: '26px', borderRadius: '8px', background: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '.71875rem', fontWeight: 700, flex: '0 0 26px' } as CSSProperties,
    selectStyle: Object.assign({}, inputStyle, { width: '160px' }) as CSSProperties,
    pill: pill(TONE_NEUTRAL),
    onRole: (e: React.ChangeEvent<HTMLSelectElement>) => changeRole(r.id, e.target.value),
    onUp: () => reorderRecipient(r.id, -1),
    onDown: () => reorderRecipient(r.id, 1),
    onRemove: () => { void removeRecipient(r.id); },
    onResend: () => resendTo(r),
    onCopyLink: () => copyLinkFor(r),
    linkBusy: busyRecipient === r.id,
    /** A row the API has never seen has no signing link to issue yet. */
    linkReady: knownToServer(r.id),
  }));

  const cadences = ['24h', '48h', '7 days', 'none'].map(c => ({
    key: c,
    label: c === 'none' ? 'No reminders' : 'Every ' + c,
    onClick: () => changeRouting({ cadence: c }),
    style: btn(s.cadence === c ? '#eef2ff' : '#fff', s.cadence === c ? '#3730a3' : '#475569', s.cadence === c ? '#c7d2fe' : '#e3e7ee')
  }));

  const timeline = ([
    ['Envelope queued', 'now · ' + s.routing + ' · ' + list.length + (list.length === 1 ? ' recipient' : ' recipients')],
    ['Signer 1 notified', '+0s · ' + (list.length ? list[0].email : 'no recipients yet')],
    ['Reminder scheduled', s.cadence === 'none' ? 'disabled' : '+' + s.cadence + ' cadence'],
    ['Expires', 'in ' + s.expiry + ' days · auto-void']
  ] as [string, string][]).map(([label, meta], i) => ({
    label, meta,
    dot: { width: '8px', height: '8px', borderRadius: '99px', marginTop: '5px', flex: '0 0 8px', background: i === 0 ? '#10b981' : '#334155' } as CSSProperties
  }));

  const seqStyle: CSSProperties = { height: '28px', padding: '0 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '.78125rem', fontWeight: s.routing === 'sequential' ? 600 : 500, background: s.routing === 'sequential' ? '#fff' : 'transparent', color: s.routing === 'sequential' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'sequential' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const parStyle: CSSProperties = { height: '28px', padding: '0 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '.78125rem', fontWeight: s.routing === 'parallel' ? 600 : 500, background: s.routing === 'parallel' ? '#fff' : 'transparent', color: s.routing === 'parallel' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'parallel' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const routeNote = s.routing === 'sequential'
    ? 'Each recipient is notified only after the previous one completes. Signer 1 → Signer 2 → Signer 3.'
    : 'All recipients are notified simultaneously and may sign in any order.';
  const routeNoteStyle: CSSProperties = { fontSize: '.75rem', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 };
  const iconBtn: CSSProperties = { width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee', background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '.8125rem', lineHeight: 1 };
  const linkActionBtn: CSSProperties = { height: '28px', padding: '0 9px', borderRadius: '8px', border: '1px solid #e3e7ee', background: '#fff', cursor: 'pointer', color: '#334155', fontSize: '.71875rem', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' };
  const disabledBtn: CSSProperties = { opacity: .45, cursor: 'not-allowed' };
  const textarea: CSSProperties = { border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '.78125rem', resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a' };
  const primaryBtnWide: CSSProperties = Object.assign(btn(A, '#fff', A), { flex: '1', justifyContent: 'center', height: '36px' });

  if (!documentId) {
    return (
      <section data-screen-label="Routing" style={{ padding: '22px', display: 'grid', placeItems: 'center' }}>
        <div style={{ maxWidth: '420px', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
          <span style={{ fontSize: '.84375rem', fontWeight: 600, color: '#0f172a' }}>No envelope to route</span>
          <span style={{ fontSize: '.75rem', lineHeight: 1.6, color: '#64748b' }}>Create a draft from the documents list, add its recipients, then set the signing order here.</span>
          <button type="button" onClick={() => go('dashboard')} style={Object.assign({}, btn(A, '#fff', A), { justifyContent: 'center' })}><Icon name="documents" size={13} />Go to documents</button>
        </div>
      </section>
    );
  }

  return (
    <section data-screen-label="Routing" style={{ padding: '22px', display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
      <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={railHead}>Signing order</div>
          <div style={{ display: 'flex', gap: '4px', background: '#f5f6f8', padding: '4px', borderRadius: '10px' }}>
            <button type="button" onClick={() => changeRouting({ routing: 'sequential' })} style={seqStyle}>Sequential</button>
            <button type="button" onClick={() => changeRouting({ routing: 'parallel' })} style={parStyle}>Parallel</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {!routingRows.length ? (
            <div style={{ fontSize: '.75rem', color: '#64748b', background: '#fbfcfd', border: '1px solid #eef1f6', borderRadius: '12px', padding: '14px', lineHeight: 1.6 }}>
              No recipients on this envelope yet — it cannot be sent until it has at least one.
            </div>
          ) : null}
          {routingRows.map(r => (
            <div key={r.id} style={r.rowStyle}>
              <span style={r.orderStyle}>{r.order}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: '.71875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{r.email}</span>
              </div>
              <select value={r.role} onChange={r.onRole} aria-label="Role" style={r.selectStyle}>
                <option value="sign">Needs to sign</option>
                <option value="inperson">In-person signer</option>
                <option value="copy">Receives a copy</option>
                <option value="approve">Approver</option>
              </select>
              <span style={r.pill}>{r.status}</span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {/* Per-signer link actions. Disabled until the envelope has
                    been sent, because there is no token to issue before that. */}
                <button
                  type="button"
                  onClick={r.onResend}
                  disabled={!r.linkReady || r.linkBusy}
                  title={r.linkReady ? 'Email ' + r.name + ' a fresh signing link' : 'Send the envelope first'}
                  aria-label={'Resend the signing email to ' + r.name}
                  style={Object.assign({}, linkActionBtn, r.linkReady && !r.linkBusy ? null : disabledBtn)}
                ><Icon name="mail" size={12} />Resend email</button>
                <button
                  type="button"
                  onClick={r.onCopyLink}
                  disabled={!r.linkReady || r.linkBusy}
                  title={r.linkReady ? 'Copy ' + r.name + '\u2019s signing link without emailing them' : 'Send the envelope first'}
                  aria-label={'Copy the signing link for ' + r.name}
                  style={Object.assign({}, linkActionBtn, r.linkReady && !r.linkBusy ? null : disabledBtn)}
                ><Icon name="link" size={12} />Copy link</button>
                <button type="button" aria-label="Move up" onClick={r.onUp} style={iconBtn}><Icon name="arrowUp" size={13} /></button>
                <button type="button" aria-label="Move down" onClick={r.onDown} style={iconBtn}><Icon name="arrowDown" size={13} /></button>
                <button type="button" aria-label={'Remove ' + r.name} title={'Remove ' + r.name} onClick={r.onRemove}
                  style={Object.assign({}, iconBtn, { color: '#b91c1c' })}><Icon name="close" size={13} /></button>
              </div>
            </div>
          ))}
          <AddRecipient accent={A} onAdd={addRecipient} variant="row" />
        </div>
        <div style={routeNoteStyle}>{routeNote}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={railHead}>Branding</div>
            <button type="button" onClick={() => go('brand')} style={linkActionBtn}><Icon name="settings" size={12} />Manage themes</button>
          </div>
          {brandingThemes.length ? (
            <>
              <label style={lbl}>Theme
                <select value={brandingThemeId} onChange={(e) => changeBranding(e.target.value)} style={inputStyle}>
                  <option value="">
                    {defaultTheme ? 'Organization default · ' + defaultTheme.name : 'Organization default'}
                  </option>
                  {brandingThemes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span aria-hidden style={{ width: '20px', height: '20px', borderRadius: '6px', flex: '0 0 20px', border: '1px solid #e3e7ee', background: (effectiveTheme && effectiveTheme.primary_color) || A }} />
                <span style={{ fontSize: '.71875rem', color: '#64748b', lineHeight: 1.55 }}>
                  {effectiveTheme
                    ? 'Recipients see ' + effectiveTheme.name + ' on the invitation email and while signing.'
                    : 'No default theme set, so invitations go out with SignerPro\u2019s stock wording.'}
                </span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '.75rem', color: '#64748b', background: '#fbfcfd', border: '1px solid #eef1f6', borderRadius: '12px', padding: '12px', lineHeight: 1.6 }}>
              No branding themes yet \u2014 invitations go out with SignerPro\u2019s stock logo and wording.
            </div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={railHead}>Reminders &amp; expiration</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {cadences.map(c => (
              <button key={c.key} type="button" onClick={c.onClick} style={c.style}>{c.label}</button>
            ))}
          </div>
          <label style={lbl}>Expires after
            <select value={s.expiry} onChange={(e) => changeRouting({ expiry: e.target.value })} style={inputStyle}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label style={lbl}>Email message
            <textarea onChange={(e) => changeRouting({ message: e.target.value })} value={s.message} rows={4} style={textarea} />
          </label>
          <button type="button" onClick={send} disabled={sending} style={primaryBtnWide}><Icon name="send" size={13} />Send envelope &amp; preview signer view</button>
        </div>
        <div style={{ background: '#0f172a', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '.6875rem', letterSpacing: '.08em', color: TEXT_MUTED_ON_DARK, fontFamily: 'var(--font-sans)' }}>DELIVERY SIMULATION</div>
          {timeline.map(t => (
            <div key={t.label} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={t.dot}></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontSize: '.78125rem', color: '#e2e8f0', fontWeight: 500 }}>{t.label}</span>
                <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{t.meta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
