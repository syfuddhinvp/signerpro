'use client';

/**
 * The platform mail outbox, as a mailbox: a list pane beside a reading pane.
 *
 * Every message the product sends is recorded by the email gateway itself, so
 * this screen is a read model over that record plus the one place a human
 * composes mail by hand -- which opens as its own window (`MailComposer`)
 * rather than as a panel above the list, so the mailbox stays on screen while
 * a message is being written.
 *
 * Two things about the reading pane are deliberate. The stored body has had
 * its bearer links masked by the backend, so what is shown is the message's
 * wording and layout rather than a working signing link — the note under the
 * body says so, because an admin comparing this against a signer's complaint
 * needs to know the difference is ours and not the mail client's. And the body
 * is framed from `/platform/mail/<id>/preview` rather than dropped into a
 * `srcdoc`: that route serves it same-origin under a policy of its own, which
 * both satisfies this app's `frame-src 'self'` and stops a remote tracking
 * pixel from telling a sender that an admin read their mail.
 */

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSF } from '@/lib/sf/state';
import { apiCall } from '@/lib/api/browser';
import { mail as mailApi } from '@/lib/api/resources';
import { btn, inputStyle, pill, TEXT_MUTED, TONE_BAD, TONE_GOOD, TONE_MUTED, TONE_NEUTRAL } from '@/lib/sf/ui';
import type { MailLogPage, MailLogRow } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import MailComposer from '@/components/sf/MailComposer';
import Icon from '@/components/sf/Icon';

export type MailProps = {
  /** `GET /api/saas/mail` as the server render saw it. */
  page: MailLogPage;
  /** The retention window the page asked for, echoed back as `since_days`. */
  sinceDays: number;
  /** `ApiError.message` when that server render failed, so `page` above is a
   *  substituted empty page rather than an empty outbox. */
  loadError?: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  invitation: 'Signing invitations',
  auth: 'Account & auth',
  verification: 'Verification codes',
  member_invite: 'Team invites',
  custom: 'Composed',
  system: 'System',
};

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent', failed: 'Failed', suppressed: 'Suppressed',
};

const STATUS_TONE = {
  sent: TONE_GOOD,
  failed: TONE_BAD,
  /* Not a failure: a sandbox tenant never emits real mail, by design. */
  suppressed: TONE_MUTED,
};

/** `14:02` today, `12 Sep` this year, `12/09/25` before that — a mailbox shows
 *  the least that still identifies when a message arrived. */
function listDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getDate()} ${date.toLocaleString('en-GB', { month: 'short' })}`;
  }
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(2)}`;
}

/** The full stamp the reading pane prints, where there is room to be exact. */
function fullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const CARD: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px' };
/** The panes scroll inside the viewport rather than growing the page, which is
 *  what makes this read as a mailbox and not as a very long table. */
const PANE_HEIGHT = 'calc(100vh - 210px)';

export default function Mail({ page, sinceDays, loadError = null }: MailProps) {
  const { accent } = useSF();
  const A = accent();

  const [mailPage, setMailPage] = useState<MailLogPage>(page);
  /* Non-null while the most recent query failed. The last good page stays on
     screen underneath it — a failed refetch must never render as an outbox
     with nothing in it, which is a far more reassuring claim than the truth. */
  const [fetchError, setFetchError] = useState<string | null>(loadError);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');

  /* The list omits bodies, so the row that is open is fetched in full. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailLogRow | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [asHtml, setAsHtml] = useState(true);

  const [composing, setComposing] = useState(false);

  /* A page that already has rows was fetched by the server render; re-querying
     it immediately would be the same request twice. */
  const firstLoad = useRef(page.items.length > 0 && !loadError);

  useEffect(() => { setMailPage(page); setFetchError(loadError); }, [page, loadError]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void mailApi.list(apiCall, {
        category: category === 'all' ? undefined : category,
        status: status === 'all' ? undefined : status,
        q: query.trim() || undefined,
        since_days: sinceDays,
        limit: 200,
      }).then(res => {
        if (cancelled) return;
        if (res.ok) { setMailPage(res.data); setFetchError(null); }
        else setFetchError(res.error.message);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [category, status, query, sinceDays, reloadNonce]);

  const reload = () => { firstLoad.current = false; setReloadNonce(n => n + 1); };

  const openRow = (row: MailLogRow) => {
    setOpenId(row.id);
    setDetail(null);
    setDetailError(null);
    setAsHtml(true);
    void mailApi.detail(apiCall, row.id).then(res => {
      if (res.ok) setDetail(res.data);
      else setDetailError(res.error.message);
    });
  };

  const chip = (on: boolean): CSSProperties => ({
    height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer',
    fontSize:'.75rem', fontWeight: on ? 600 : 500, whiteSpace:'nowrap',
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
    boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
  });

  const categories: [string, string][] = [['all', 'All mail'], ...mailPage.categories.map(
    c => [c, CATEGORY_LABEL[c] ?? c] as [string, string],
  )];
  const statuses: [string, string][] = [['all', 'Any status'], ...mailPage.statuses.map(
    st => [st, STATUS_LABEL[st] ?? st] as [string, string],
  )];

  const rows = mailPage.items;

  return (
    <section data-screen-label="Mail" style={{ padding:'18px 22px 26px', display:'flex', flexDirection:'column', gap:'12px' }}>
      {fetchError ? <ApiUnavailable what="The mail outbox" detail={fetchError} onRetry={reload} /> : null}

      {/* toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
        <button type="button" onClick={() => setComposing(true)} style={btn(A, '#fff', A)}>Compose</button>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search mail"
          placeholder="Search recipient or subject…"
          style={{ ...inputStyle, flex:1, minWidth:'180px', width:'auto' }} />
        <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px', overflowX:'auto' }}>
          {statuses.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)} style={chip(status === id)}>{label}</button>
          ))}
        </div>
        <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, flex:'0 0 auto' }}>
          {rows.length} of {mailPage.total}
        </span>
      </div>

      <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px', overflowX:'auto' }}>
        {categories.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)} style={chip(category === id)}>{label}</button>
        ))}
      </div>

      {composing ? (
        <MailComposer onClose={() => setComposing(false)} onSent={reload} />
      ) : null}

      {/* the mailbox: list pane + reading pane */}
      <div style={{ display:'grid', gridTemplateColumns:'minmax(280px, 380px) minmax(0, 1fr)', gap:'12px', alignItems:'stretch' }}>
        <div style={{ ...CARD, overflow:'auto', height:PANE_HEIGHT }}>
          {rows.map((row, i) => {
            const open = openId === row.id;
            const tone = STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? TONE_NEUTRAL;
            return (
              <button key={row.id} type="button" onClick={() => openRow(row)} aria-current={open ? 'true' : undefined}
                style={{ display:'flex', gap:'10px', width:'100%', textAlign:'left', padding:'11px 13px',
                  border:'none', cursor:'pointer', alignItems:'flex-start',
                  borderTop: i ? '1px solid #eef1f6' : 'none',
                  borderLeft: '3px solid ' + (open ? A : 'transparent'),
                  background: open ? '#f4f6fb' : '#fff' }}>
                <span aria-hidden="true" style={{ width:'30px', height:'30px', borderRadius:'50%', flex:'0 0 auto',
                  background: tone.bg, color: tone.fg, border:'1px solid ' + tone.bd,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.75rem', fontWeight:700 }}>
                  {row.to_email.charAt(0).toUpperCase()}
                </span>
                <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                  <span style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
                    <span style={{ flex:1, minWidth:0, fontSize:'.75rem', fontWeight:600, color:'#0f172a',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.to_email}</span>
                    <span style={{ flex:'0 0 auto', fontSize:'.65625rem', color:TEXT_MUTED }}>{listDate(row.created_at)}</span>
                  </span>
                  <span style={{ fontSize:'.78125rem', color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {row.subject}
                  </span>
                  <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {row.snippet ?? 'No stored body.'}
                  </span>
                  <span style={{ display:'flex', alignItems:'center', gap:'6px', marginTop:'2px' }}>
                    {row.status === 'sent' ? null : (
                      <span style={{ ...pill(tone), padding:'1px 7px', fontSize:'.625rem' }}>{STATUS_LABEL[row.status] ?? row.status}</span>
                    )}
                    <span style={{ fontSize:'.625rem', color:TEXT_MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {CATEGORY_LABEL[row.category] ?? row.category}
                      {row.organization_name ? ' · ' + row.organization_name : ''}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          {rows.length === 0 ? (
            <div style={{ padding:'26px 15px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED }}>
              No messages in this window.
            </div>
          ) : null}
        </div>

        <div style={{ ...CARD, height:PANE_HEIGHT, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {!openId ? (
            <div style={{ margin:'auto', textAlign:'center', padding:'20px' }}>
              <p style={{ margin:'0 0 4px', fontSize:'.84375rem', color:'#0f172a', fontWeight:600 }}>No message selected</p>
              <p style={{ margin:0, fontSize:'.75rem', color:TEXT_MUTED }}>Pick a message on the left to read it as it was delivered.</p>
            </div>
          ) : detailError ? (
            <p role="alert" style={{ margin:'auto', fontSize:'.75rem', color:'#b91c1c' }}>{detailError}</p>
          ) : !detail ? (
            <p style={{ margin:'auto', fontSize:'.75rem', color:TEXT_MUTED }}>Loading message…</p>
          ) : (
            <>
              <header style={{ padding:'16px 18px 12px', borderBottom:'1px solid #eef1f6', flex:'0 0 auto' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:'10px', marginBottom:'10px' }}>
                  <h2 style={{ margin:0, flex:1, minWidth:0, fontSize:'1rem', lineHeight:1.4, color:'#0f172a' }}>{detail.subject}</h2>
                  <span style={{ ...pill(STATUS_TONE[detail.status as keyof typeof STATUS_TONE] ?? TONE_NEUTRAL), flex:'0 0 auto' }}>
                    {STATUS_LABEL[detail.status] ?? detail.status}
                  </span>
                  <button type="button" onClick={() => setOpenId(null)} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Close</button>
                </div>
                <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
                  <span aria-hidden="true" style={{ width:'34px', height:'34px', borderRadius:'50%', flex:'0 0 auto',
                    background:'#eef2ff', color:'#3730a3', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'.8125rem', fontWeight:700 }}>
                    {detail.to_email.charAt(0).toUpperCase()}
                  </span>
                  <div style={{ flex:1, minWidth:0, fontSize:'.71875rem', color:'#334155', lineHeight:1.6 }}>
                    <div><strong style={{ fontWeight:600 }}>{detail.from_email ?? 'unknown sender'}</strong> → {detail.to_email}</div>
                    <div style={{ color:TEXT_MUTED }}>
                      {fullDate(detail.created_at)} · {CATEGORY_LABEL[detail.category] ?? detail.category} · via {detail.provider}
                      {detail.organization_name ? ' · ' + detail.organization_name : ''}
                      {detail.sent_by_email ? ' · composed by ' + detail.sent_by_email : ''}
                    </div>
                  </div>
                  {detail.body_html ? (
                    <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px', flex:'0 0 auto' }}>
                      <button type="button" aria-pressed={asHtml} onClick={() => setAsHtml(true)} style={chip(asHtml)}>HTML</button>
                      <button type="button" aria-pressed={!asHtml} onClick={() => setAsHtml(false)} style={chip(!asHtml)}>Plain text</button>
                    </div>
                  ) : null}
                </div>
                {detail.error ? (
                  <p role="alert" style={{ margin:'10px 0 0', padding:'8px 10px', borderRadius:'9px', background:'#fef2f2',
                    border:'1px solid #fecaca', color:'#b91c1c', fontSize:'.71875rem', lineHeight:1.6 }}>
                    {detail.error}
                  </p>
                ) : null}
              </header>

              <div style={{ flex:1, minHeight:0, background:'#f5f6f8' }}>
                {detail.body_html && asHtml ? (
                  /* Same-origin under its own `default-src 'none'` policy, and
                     sandboxed on top of it: no scripts, no remote images, so
                     opening a message cannot report the read back to a sender. */
                  <iframe title={`Message: ${detail.subject}`} src={`/platform/mail/${detail.id}/preview`}
                    sandbox="" style={{ width:'100%', height:'100%', border:'none', display:'block' }} />
                ) : detail.body_text ? (
                  <pre style={{ margin:0, padding:'16px 18px', height:'100%', overflow:'auto', background:'#fff',
                    fontSize:'.75rem', lineHeight:1.75, color:'#0f172a', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                    {detail.body_text}
                  </pre>
                ) : (
                  <div style={{ padding:'18px', background:'#fff', height:'100%' }}>
                    <p style={{ margin:0, fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.7, maxWidth:'52ch' }}>
                      This message was a one-time passcode. Its body <em>is</em> the code, so none of it is stored —
                      the recipient, subject and delivery result above are the whole record.
                    </p>
                  </div>
                )}
              </div>

              <footer style={{ flex:'0 0 auto', padding:'9px 18px', borderTop:'1px solid #eef1f6',
                fontSize:'.65625rem', color:TEXT_MUTED, lineHeight:1.6 }}>
                Signing, invitation and reset links are masked in the stored copy. The recipient received working links.
              </footer>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
