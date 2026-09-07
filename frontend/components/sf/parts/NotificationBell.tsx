'use client';
/* The header bell.
 *
 * The prototype had a tray hardcoded with five invented alerts, and it was
 * removed for saying things that were not true. This one reads
 * `GET /api/notifications`, whose rows are produced from the audit trail — so
 * every line in the tray corresponds to an event the trail also records.
 *
 * The first paint comes from the server (the app layout fetches the feed with
 * the rest of the shell's numbers), so the badge is right before any client
 * JS runs and there is no empty-then-populated flicker. After that the tray
 * owns its own state: opening it refetches, and marking read updates the
 * badge from the count the server returns rather than by guessing locally.
 */
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { notifications as notificationsApi } from '@/lib/api/resources';
import type { NotificationFacets, NotificationFeed, NotificationRow, NotificationTone } from '@/lib/api/types';
import { formatRelative } from '@/lib/sf/adapters';
import { pathFor } from '@/lib/sf/routes';
import { notificationHref } from '@/lib/sf/notifications';
import Icon from '@/components/sf/Icon';
import { TEXT_MUTED } from '@/lib/sf/ui';

/** Dot colour per tone. `info` is the accent-neutral slate the chrome uses. */
const TONE_COLOR: Record<NotificationTone, string> = {
  info: '#64748b',
  good: '#10b981',
  warn: '#f59e0b',
  bad: '#f43f5e',
};

const NO_FACETS: NotificationFacets = { tones: { bad: 0, warn: 0, good: 0, info: 0 }, unread: 0, read: 0 };
const EMPTY_FEED: NotificationFeed = { items: [], unread: 0, total: 0, facets: NO_FACETS };

/** A badge past 9 stops being a number worth reading precisely. */
function badgeText(unread: number): string {
  return unread > 9 ? '9+' : String(unread);
}

export default function NotificationBell({ initial = EMPTY_FEED }: { initial?: NotificationFeed }) {
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed>(initial);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* The server's feed is the source of truth for the closed badge: when a
     navigation re-renders the layout with fresher numbers, adopt them. */
  useEffect(() => { setFeed(initial); }, [initial]);

  const refresh = useCallback(() => {
    void notificationsApi.list(apiCall, { limit: 20 }).then(res => {
      if (res.ok) { setFeed(res.data); setFailed(false); } else { setFailed(true); }
    });
  }, []);

  /* Opening refetches, so a tray opened on a page that has been sitting there
     for an hour is not an hour stale. */
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  };

  /* Dismissal: a click outside, or Escape. Without both, the tray stays open
     over whatever the user clicked next. */
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = useCallback((id: string) => {
    /* Optimistic on the row, authoritative on the count: the row greys out at
       once, but `unread` comes back from the server, which knows about rows
       this page never fetched. */
    setFeed(prev => ({
      ...prev,
      items: prev.items.map(item => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)),
    }));
    void notificationsApi.markRead(apiCall, id).then(res => {
      if (res.ok) setFeed(prev => ({ ...prev, unread: res.data.unread }));
      else refresh();
    });
  }, [refresh]);

  const markAllRead = () => {
    void notificationsApi.markAllRead(apiCall).then(res => {
      if (!res.ok) { refresh(); return; }
      const stamp = new Date().toISOString();
      setFeed(prev => ({
        ...prev,
        unread: res.data.unread,
        items: prev.items.map(item => (item.read_at ? item : { ...item, read_at: stamp })),
      }));
    });
  };

  /* Following a row reads it first, so the badge is already settled by the
     time the destination renders. */
  const openRow = (row: NotificationRow) => {
    if (!row.read_at) markRead(row.id);
    const href = notificationHref(row);
    setOpen(false);
    if (href) router.push(href);
  };

  const unread = feed.unread;

  const buttonStyle: CSSProperties = {
    position:'relative', width:'32px', height:'32px', borderRadius:'9px',
    border:'1px solid #e3e7ee', background: open ? '#eef2ff' : '#fff', cursor:'pointer',
    color:'#475569', display:'grid', placeItems:'center', padding:0, lineHeight:1,
  };
  const badgeStyle: CSSProperties = {
    position:'absolute', top:'-4px', right:'-4px', minWidth:'16px', height:'16px', padding:'0 4px',
    borderRadius:'99px', background:'#f43f5e', color:'#fff', fontSize:'.625rem', fontWeight:700,
    display:'grid', placeItems:'center', border:'1.5px solid #fff',
    fontFamily:'var(--font-sans)',
  };
  const trayStyle: CSSProperties = {
    position:'absolute', right:0, top:'40px', width:'320px', background:'#fff',
    border:'1px solid #e3e7ee', borderRadius:'13px', boxShadow:'0 22px 50px -20px rgba(15,23,42,.4)',
    zIndex:40, animation:'sfIn .12s ease', overflow:'hidden',
  };
  const headStyle: CSSProperties = {
    display:'flex', alignItems:'center', gap:'8px', padding:'10px 12px',
    borderBottom:'1px solid #eef1f6',
  };
  const listStyle: CSSProperties = { maxHeight:'340px', overflowY:'auto', padding:'6px' };
  const rowStyle = (read: boolean): CSSProperties => ({
    display:'flex', gap:'9px', width:'100%', textAlign:'left', padding:'9px 10px',
    borderRadius:'9px', border:'none', cursor:'pointer',
    background: read ? 'transparent' : '#f7f9ff',
  });

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        style={buttonStyle}
      >
        <Icon name="bell" size={16} />
        {unread ? <span style={badgeStyle}>{badgeText(unread)}</span> : null}
      </button>

      {open ? (
        <div role="dialog" aria-label="Notifications" style={trayStyle}>
          <div style={headStyle}>
            <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Notifications</span>
            {unread ? (
              <button
                type="button"
                onClick={markAllRead}
                style={{ marginLeft:'auto', border:'none', background:'transparent', cursor:'pointer', fontSize:'.71875rem', color:'#4f46e5', padding:0 }}
              >Mark all read</button>
            ) : null}
          </div>

          {/* Three distinct states, because "nothing to show" and "we could
              not ask" are not the same thing to a user waiting on a signature. */}
          {failed ? (
            <div style={{ padding:'18px 14px', fontSize:'.75rem', color:TEXT_MUTED }}>
              Notifications are unavailable right now.
            </div>
          ) : feed.items.length === 0 ? (
            <div style={{ padding:'18px 14px', fontSize:'.75rem', color:TEXT_MUTED }}>
              Nothing yet. Activity on your envelopes shows up here.
            </div>
          ) : (
            <div style={listStyle}>
              {feed.items.map(row => (
                <button key={row.id} type="button" onClick={() => openRow(row)} style={rowStyle(!!row.read_at)}>
                  <span style={{ width:'7px', height:'7px', borderRadius:'99px', marginTop:'5px', flex:'0 0 7px', background: TONE_COLOR[row.tone] ?? TONE_COLOR.info }}></span>
                  <span style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', fontWeight: row.read_at ? 500 : 600, color:'#0f172a' }}>{row.title}</span>
                    {row.detail ? (
                      <span style={{ fontSize:'.71875rem', color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.detail}</span>
                    ) : null}
                    <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{formatRelative(row.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* The tray is a peek at the newest rows; the page is the record,
              with the filters and bulk actions a long list needs. */}
          <div style={{ borderTop:'1px solid #eef1f6', padding:'8px 12px' }}>
            <Link
              href={pathFor('notifications')}
              onClick={() => setOpen(false)}
              style={{ fontSize:'.71875rem', color:'#4f46e5', textDecoration:'none' }}
            >{feed.total > feed.items.length ? `See all ${feed.total} notifications` : 'See all notifications'}</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
