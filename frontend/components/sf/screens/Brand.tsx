'use client';

/**
 * Branding themes (ORG-7) — the logo, colours and wording a *recipient* sees.
 *
 * This is deliberately not the same thing as the tenant's accent colour on the
 * Organization section: that one is the workspace's own identity, seen by
 * people who have logged in. A theme is what leaves the building — the
 * invitation email and the signing page — and a tenant that sends under more
 * than one brand needs more than one of them, which is why this screen edits a
 * list rather than a single set of fields.
 *
 * The preview beside the editor renders from the same values the API will be
 * sent, so what it shows is what a recipient gets. It is a plain-text email in
 * production (`services/email_service.py` builds the body), so the preview
 * shows the wording in the order the body assembles it, not a fictional HTML
 * layout the sender would never actually send.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { apiCall } from '@/lib/api/browser';
import { brandingThemes as brandingApi } from '@/lib/api/resources';
import { useDialogs } from '@/components/sf/DialogProvider';
import { useSession } from '@/components/sf/SessionProvider';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import Icon from '@/components/sf/Icon';
import {
  btn, cardStyle, inputStyle, lbl, pill, railHead,
  BORDER_STRONG, TEXT_MUTED, TEXT_SUBTLE, TONE_INDIGO, TONE_NEUTRAL,
} from '@/lib/sf/ui';
import { SCREEN_PATH } from '@/lib/sf/routes';
import type { BrandingThemeResponse, BrandingThemeUpdate, LogoPosition } from '@/lib/api/types';

export type BrandProps = {
  /** `GET /api/branding-themes`, fetched by the server component. */
  themes: BrandingThemeResponse[];
  /** `ApiError.message` when that call failed, so an empty list is not shown
   *  as "no themes yet" when it might just be unreachable. */
  loadError?: string | null;
  /** Whether the plan includes `custom_branding`. Reads are open on every
   *  plan, so without this the screen looks available and 402s on first save.
   *  Defaults to `true`: the API is the authority, and a screen that cannot
   *  read the subscription must not lock out a tenant who has paid. */
  entitled?: boolean;
  /** The plan's display name, to say which plan is the one without it. */
  planName?: string | null;
};

/** The editable half of a theme. `name` and `is_default` are handled apart:
 *  one is the row's identity, the other an invariant the server owns. */
type Draft = {
  name: string;
  logo_position: LogoPosition;
  primary_color: string;
  primary_text_color: string;
  headline: string;
  message: string;
  contact_sender_email: string;
  footer_signature: string;
};

/** What the invitation email falls back to with nothing filled in. Kept in
 *  step with `SignFlowEmailService.invitation_body`. */
const STOCK_HEADLINE = 'You were invited to review and sign a document';
const DEFAULT_BUTTON = '#4f46e5';
const DEFAULT_BUTTON_TEXT = '#ffffff';

function toDraft(theme: BrandingThemeResponse): Draft {
  return {
    name: theme.name,
    logo_position: theme.logo_position,
    primary_color: theme.primary_color ?? '',
    primary_text_color: theme.primary_text_color ?? '',
    headline: theme.headline ?? '',
    message: theme.message ?? '',
    contact_sender_email: theme.contact_sender_email ?? '',
    footer_signature: theme.footer_signature ?? '',
  };
}

/** An empty field means "clear it", which the API spells as an explicit null —
 *  sending `''` would store a blank string and the email would print it. */
function toPayload(draft: Draft): BrandingThemeUpdate {
  const blankToNull = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: draft.name.trim(),
    logo_position: draft.logo_position,
    primary_color: blankToNull(draft.primary_color),
    primary_text_color: blankToNull(draft.primary_text_color),
    headline: blankToNull(draft.headline),
    message: blankToNull(draft.message),
    contact_sender_email: blankToNull(draft.contact_sender_email),
    footer_signature: blankToNull(draft.footer_signature),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
}

/** `#abc` → `#aabbcc`, so the native colour input accepts a short hex. */
function widenHex(value: string): string {
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value);
  if (!short) return value;
  return '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const layout: CSSProperties = { padding: '22px', display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' };
const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '16px' };
const themeRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 11px', border: '1px solid #eef1f6', borderRadius: '12px', background: '#fbfcfd', textAlign: 'left', width: '100%', cursor: 'pointer' };
const themeRowActive: CSSProperties = { borderColor: '#c7d2fe', background: '#eef2ff' };
const textareaStyle: CSSProperties = { border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '.78125rem', resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a', fontFamily: 'inherit' };
const swatchStyle: CSSProperties = { width: '32px', height: '32px', padding: 0, border: '1px solid #e3e7ee', borderRadius: '9px', background: '#fff', cursor: 'pointer', flex: '0 0 32px' };
const noteStyle: CSSProperties = { fontSize: '.75rem', color: TEXT_SUBTLE, lineHeight: 1.6 };
const emptyBox: CSSProperties = { border: '1px dashed ' + BORDER_STRONG, borderRadius: '12px', padding: '18px', textAlign: 'center', fontSize: '.75rem', color: TEXT_MUTED, lineHeight: 1.6 };
const previewShell: CSSProperties = { border: '1px solid #e3e7ee', borderRadius: '12px', overflow: 'hidden', background: '#f5f6f8' };
const previewBody: CSSProperties = { background: '#fff', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '11px' };
const logoWellStyle: CSSProperties = {
  width: '108px', height: '56px', flex: '0 0 108px', display: 'grid', placeItems: 'center',
  border: '1px solid #e3e7ee', borderRadius: '10px', background: '#fbfcfd', padding: '6px',
  overflow: 'hidden',
};
const errorBannerStyle: CSSProperties = {
  padding: '11px 13px', borderRadius: '11px', border: '1px solid #fecaca',
  background: '#fef2f2', color: '#7f1d1d', fontSize: '.78125rem', lineHeight: 1.5,
};
const upgradeStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  padding: '11px 13px', borderRadius: '11px', border: '1px solid #fcd34d',
  background: '#fffbeb', color: '#92400e', fontSize: '.78125rem', lineHeight: 1.5,
};
const upgradeLinkStyle: CSSProperties = {
  height: '30px', padding: '0 12px', borderRadius: '9px', border: '1px solid #fcd34d',
  background: '#fff', color: '#92400e', fontSize: '.75rem', fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto',
  textDecoration: 'none',
};

export default function Brand({ themes, loadError, entitled = true, planName }: BrandProps) {
  const session = useSession();
  const { askConfirm, askText } = useDialogs();
  /* Writes are org-admin only server-side, and `custom_branding` is a paid
     entitlement. Saying either up front beats letting someone fill the form in
     and meet a 403 or a 402 on submit. */
  const canEdit = session.role === 'admin' && entitled;

  const [list, setList] = useState<BrandingThemeResponse[]>(themes);
  const [selectedId, setSelectedId] = useState<string>(themes.length ? themes[0].id : '');
  const [draft, setDraft] = useState<Draft | null>(themes.length ? toDraft(themes[0]) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setList(themes);
  }, [themes]);

  const selected = useMemo(
    () => list.find((t) => t.id === selectedId) ?? null,
    [list, selectedId],
  );

  /* Selecting another theme discards nothing silently: the Save button is the
     only thing that writes, and the draft is reset to what the server holds. */
  const select = useCallback((theme: BrandingThemeResponse) => {
    setSelectedId(theme.id);
    setDraft(toDraft(theme));
    setError(null);
  }, []);

  useEffect(() => {
    if (selected || !list.length) return;
    select(list[0]);
  }, [selected, list, select]);

  const dirty = !!(selected && draft && !sameDraft(draft, toDraft(selected)));

  const patch = (part: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...part } : d));
    setError(null);
  };

  const invalidColor =
    !!draft &&
    [draft.primary_color, draft.primary_text_color].some((v) => v.trim() !== '' && !HEX.test(v.trim()));

  const fileRef = useRef<HTMLInputElement | null>(null);

  /* The same limits the API enforces, checked here only so the reader is told
     before a megabyte goes over the wire. The server is still the authority. */
  const pickLogo = (file: File | null) => {
    if (!file || !selected) return;
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
      setError('A logo must be a PNG, JPEG or GIF image.');
      return;
    }
    if (file.size > 1024 * 1024) { setError('A logo must be 1 MB or smaller.'); return; }

    const reader = new FileReader();
    reader.onerror = () => setError('That image could not be read.');
    reader.onload = () => {
      setBusy(true);
      void brandingApi.uploadLogo(apiCall, selected.id, String(reader.result)).then((res) => {
        setBusy(false);
        if (!res.ok) { setError(res.error.message); return; }
        setList((rows) => rows.map((row) => (row.id === res.data.id ? res.data : row)));
        setError(null);
      });
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await brandingApi.removeLogo(apiCall, selected.id);
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    setList((rows) => rows.map((row) => (row.id === result.data.id ? result.data : row)));
  };

  const createTheme = async () => {
    const name = await askText({
      title: 'New branding theme',
      label: 'Theme name',
      message: 'Only you see this name — recipients see the logo, colours and wording you set next.',
      cta: 'Create theme',
    });
    if (!name) return;
    setBusy(true);
    const result = await brandingApi.create(apiCall, { name });
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    setList((rows) => rows.concat(result.data));
    select(result.data);
  };

  const save = async () => {
    if (!selected || !draft) return;
    if (!draft.name.trim()) { setError('A theme needs a name.'); return; }
    if (invalidColor) { setError('Colours must be a hex value such as #0777CF.'); return; }
    setBusy(true);
    const result = await brandingApi.update(apiCall, selected.id, toPayload(draft));
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    const saved = result.data;
    setList((rows) => rows.map((t) => (t.id === saved.id ? saved : t)));
    setDraft(toDraft(saved));
  };

  const makeDefault = async () => {
    if (!selected || selected.is_default) return;
    setBusy(true);
    const result = await brandingApi.update(apiCall, selected.id, { is_default: true });
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    /* The server demoted the previous default; mirror that here rather than
       re-fetching, so the list cannot show two defaults for a frame. */
    setList((rows) => rows.map((t) => ({ ...t, is_default: t.id === selected.id })));
  };

  const remove = async () => {
    if (!selected) return;
    const used = selected.document_count;
    const ok = await askConfirm({
      title: 'Delete ' + selected.name + '?',
      message: used
        ? used + (used === 1 ? ' envelope uses' : ' envelopes use') +
          ' this theme. They keep sending — they fall back to your default theme.'
        : 'No envelope uses this theme.',
      cta: 'Delete theme',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const result = await brandingApi.remove(apiCall, selected.id);
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    const rest = list.filter((t) => t.id !== selected.id);
    setList(rest);
    if (rest.length) select(rest[0]); else { setSelectedId(''); setDraft(null); }
  };

  const button = (draft?.primary_color.trim() && HEX.test(draft.primary_color.trim()))
    ? draft.primary_color.trim() : DEFAULT_BUTTON;
  const buttonText = (draft?.primary_text_color.trim() && HEX.test(draft.primary_text_color.trim()))
    ? draft.primary_text_color.trim() : DEFAULT_BUTTON_TEXT;
  const logoAlign = draft
    ? ({ left: 'flex-start', center: 'center', right: 'flex-end' } as const)[draft.logo_position]
    : 'flex-start';

  return (
    <section data-screen-label="Brand" style={layout}>
      <div style={stack}>
        {loadError ? <ApiUnavailable what="Your branding themes" detail={loadError} /> : null}

        {!entitled ? (
          <div role="status" style={upgradeStyle}>
            <span>
              <strong>Branding is not included in {planName ? 'the ' + planName + ' plan' : 'your plan'}.</strong>{' '}
              You can see how themes work here, but saving one needs a plan with custom branding.
              Invitations go out with SignerPro&rsquo;s stock logo and wording until then.
            </span>
            <a href={SCREEN_PATH.billing} style={upgradeLinkStyle}>View plans</a>
          </div>
        ) : null}

        {/* Screen level, not inside the editor card: a tenant with no themes
            has no card, and a failed "New theme" used to set this and render
            it nowhere. */}
        {error ? <div role="alert" style={errorBannerStyle}>{error}</div> : null}

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={railHead}>Themes</div>
            {canEdit ? (
              <button type="button" onClick={createTheme} disabled={busy} style={btn('#fff', '#334155', '#e3e7ee')}>
                <Icon name="plus" size={13} /> New theme
              </button>
            ) : null}
          </div>

          {!list.length ? (
            <div style={emptyBox}>
              {loadError
                ? 'Themes could not be loaded, so none can be listed here.'
                : !entitled
                  ? 'No branding themes. Adding one needs a plan that includes custom branding.'
                  : canEdit
                    ? 'No branding themes yet. Invitations go out with SignerPro’s stock wording until you add one.'
                    : 'No branding themes yet. An organization administrator can add one.'}
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {list.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => select(theme)}
                aria-current={theme.id === selectedId ? 'true' : undefined}
                style={theme.id === selectedId ? { ...themeRow, ...themeRowActive } : themeRow}
              >
                <span
                  aria-hidden
                  style={{
                    width: '26px', height: '26px', borderRadius: '8px', flex: '0 0 26px',
                    background: theme.primary_color || DEFAULT_BUTTON, border: '1px solid #e3e7ee',
                  }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600, color: '#0f172a' }}>{theme.name}</span>
                  <span style={{ fontSize: '.71875rem', color: TEXT_MUTED }}>
                    {theme.document_count
                      ? theme.document_count + (theme.document_count === 1 ? ' envelope' : ' envelopes')
                      : 'No envelope uses it yet'}
                  </span>
                </span>
                {theme.is_default ? <span style={pill(TONE_INDIGO)}>Default</span> : null}
              </button>
            ))}
          </div>
        </div>

        {selected && draft ? (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={railHead}>{selected.name}</div>
              <span style={pill(selected.is_default ? TONE_INDIGO : TONE_NEUTRAL)}>
                {selected.is_default ? 'Used when an envelope picks none' : 'Chosen per envelope'}
              </span>
            </div>

            <fieldset disabled={!canEdit || busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={lbl}>Theme name
                <input
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  style={inputStyle}
                  maxLength={80}
                />
              </label>

              <div style={lbl}>Logo
                <div style={{ display: 'flex', alignItems: 'center', gap: '11px', flexWrap: 'wrap' }}>
                  <span style={logoWellStyle}>
                    {selected.logo_url ? (
                      <img src={selected.logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span style={{ fontSize: '.6875rem', color: TEXT_MUTED }}>No logo</span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                    {/* The input is the control; the button labels it, so the
                        file chooser is reachable by keyboard and by name. */}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      onChange={(e) => { pickLogo(e.target.files?.[0] ?? null); e.target.value = ''; }}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy}
                      style={btn('#fff', '#334155', '#e3e7ee')}
                    >
                      <Icon name="upload" size={13} /> {selected.logo_url ? 'Replace logo' : 'Upload logo'}
                    </button>
                    {selected.logo_uploaded ? (
                      <button type="button" onClick={removeLogo} disabled={busy} style={btn('#fff', '#b91c1c', '#fecaca')}>
                        <Icon name="trash" size={13} />Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <p style={noteStyle}>
                PNG, JPEG or GIF, up to 1 MB. It is hosted for you and fetched by the recipient’s
                mail client. With none set, the invitation carries no logo rather than SignerPro’s.
              </p>

              <label style={lbl}>Logo position
                <select
                  value={draft.logo_position}
                  onChange={(e) => patch({ logo_position: e.target.value as LogoPosition })}
                  style={inputStyle}
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '11px' }}>
                <label style={lbl}>Button colour
                  <span style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
                    <input
                      type="color"
                      aria-label="Pick the button colour"
                      value={widenHex(draft.primary_color || DEFAULT_BUTTON)}
                      onChange={(e) => patch({ primary_color: e.target.value })}
                      style={swatchStyle}
                    />
                    <input
                      value={draft.primary_color}
                      onChange={(e) => patch({ primary_color: e.target.value })}
                      placeholder={DEFAULT_BUTTON}
                      style={inputStyle}
                    />
                  </span>
                </label>
                <label style={lbl}>Button text colour
                  <span style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
                    <input
                      type="color"
                      aria-label="Pick the button text colour"
                      value={widenHex(draft.primary_text_color || DEFAULT_BUTTON_TEXT)}
                      onChange={(e) => patch({ primary_text_color: e.target.value })}
                      style={swatchStyle}
                    />
                    <input
                      value={draft.primary_text_color}
                      onChange={(e) => patch({ primary_text_color: e.target.value })}
                      placeholder={DEFAULT_BUTTON_TEXT}
                      style={inputStyle}
                    />
                  </span>
                </label>
              </div>

              <label style={lbl}>Invitation headline
                <input
                  value={draft.headline}
                  onChange={(e) => patch({ headline: e.target.value })}
                  placeholder={STOCK_HEADLINE}
                  style={inputStyle}
                  maxLength={255}
                />
              </label>

              <label style={lbl}>Standing message
                <textarea
                  value={draft.message}
                  onChange={(e) => patch({ message: e.target.value })}
                  rows={3}
                  style={textareaStyle}
                  maxLength={4000}
                />
              </label>
              <p style={noteStyle}>
                Carried on every invitation sent with this theme. A message typed on the workflow
                screen is about one envelope and is printed after this one, not instead of it.
              </p>

              <label style={lbl}>Contact sender email
                <input
                  type="email"
                  value={draft.contact_sender_email}
                  onChange={(e) => patch({ contact_sender_email: e.target.value })}
                  placeholder="processing@example.com"
                  style={inputStyle}
                />
              </label>

              <label style={lbl}>Footer signature
                <textarea
                  value={draft.footer_signature}
                  onChange={(e) => patch({ footer_signature: e.target.value })}
                  rows={2}
                  style={textareaStyle}
                  maxLength={2000}
                />
              </label>
            </fieldset>

            {canEdit ? (
              <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !dirty}
                  style={{ ...btn(button, buttonText, button), opacity: busy || !dirty ? 0.55 : 1 }}
                >
                  <Icon name={dirty ? 'save' : 'check'} size={13} />{dirty ? 'Save changes' : 'Saved'}
                </button>
                <button
                  type="button"
                  onClick={makeDefault}
                  disabled={busy || selected.is_default}
                  style={{ ...btn('#fff', '#334155', '#e3e7ee'), opacity: selected.is_default ? 0.55 : 1 }}
                >
                  <Icon name="star" size={13} />Make default
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  style={btn('#fff', '#b91c1c', '#fecaca')}
                >
                  <Icon name="trash" size={13} />Delete theme
                </button>
              </div>
            ) : (
              <p style={noteStyle}>
                {!entitled
                  ? 'Upgrade to a plan with custom branding to change these settings.'
                  : 'Only an organization administrator can change branding.'}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div style={stack}>
        <div style={cardStyle}>
          <div style={railHead}>Invitation preview</div>
          {!draft ? (
            <div style={emptyBox}>Pick a theme to see what its invitations look like.</div>
          ) : (
            <>
              <div style={previewShell}>
                <div style={previewBody}>
                  <div style={{ display: 'flex', justifyContent: logoAlign }}>
                    {selected?.logo_url ? (
                      <img
                        src={selected.logo_url}
                        alt=""
                        style={{ maxHeight: '34px', maxWidth: '160px', objectFit: 'contain' }}
                      />
                    ) : (
                      <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
                        no logo set
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '.84375rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.45 }}>
                    {draft.headline.trim() || STOCK_HEADLINE}
                  </div>
                  {draft.message.trim() ? (
                    <div style={{ fontSize: '.78125rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {draft.message.trim()}
                    </div>
                  ) : null}
                  <div style={{ fontSize: '.78125rem', color: '#334155', lineHeight: 1.6 }}>
                    You have been invited to sign “Mutual NDA”.
                  </div>
                  <span
                    style={{
                      alignSelf: 'flex-start', padding: '9px 15px', borderRadius: '8px',
                      background: button, color: buttonText, fontSize: '.78125rem', fontWeight: 600,
                    }}
                  >
                    Review and sign
                  </span>
                  <div style={{ fontSize: '.71875rem', color: TEXT_MUTED, lineHeight: 1.6 }}>
                    This link is unique to you and expires automatically.
                  </div>
                  {draft.contact_sender_email.trim() ? (
                    <div style={{ fontSize: '.71875rem', color: TEXT_MUTED, lineHeight: 1.6 }}>
                      Questions about this document? Reply to {draft.contact_sender_email.trim()}.
                    </div>
                  ) : null}
                  {draft.footer_signature.trim() ? (
                    <div style={{ fontSize: '.71875rem', color: TEXT_MUTED, lineHeight: 1.6, whiteSpace: 'pre-wrap', borderTop: '1px solid #f2f4f8', paddingTop: '9px' }}>
                      {draft.footer_signature.trim()}
                    </div>
                  ) : null}
                </div>
              </div>
              <p style={noteStyle}>
                Invitations are delivered as plain text, so this shows the wording and its order
                rather than a rendered layout. The button colour is what a signer sees on the
                signing page itself.
              </p>
            </>
          )}
        </div>

        <div style={cardStyle}>
          <div style={railHead}>Where a theme applies</div>
          <p style={noteStyle}>
            An envelope uses the theme picked on its workflow screen. One that picks none uses your
            default theme, resolved when the invitation goes out — so editing the default re-brands
            every envelope that never chose its own, including drafts already prepared.
          </p>
          <p style={noteStyle}>
            Deleting a theme never blocks an envelope: those pointing at it fall back to the default.
          </p>
        </div>
      </div>
    </section>
  );
}
