'use client';
/* The notifications page — everything the header bell only shows the newest of.
 *
 * The bell is a peek; this is the record. So the two differ in what they can
 * do rather than in what they say: the same rows, the same vocabulary, plus
 * the filters and the bulk actions that only make sense over a long list.
 *
 * Filtering belongs to the API (`status` / `tone` / `q` / `since_days`), so a
 * filter change re-queries rather than narrowing a client array — otherwise
 * every count on the page would describe the page size instead of the feed.
 * The counts on the filter controls come from the server's facets for the same
 * reason.
 */
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { notifications as notificationsApi } from '@/lib/api/resources';
import type { ApiResult } from '@/lib/api/result';
import type {
  NotificationBulkAction,
  NotificationFeed,
  NotificationRow,
  NotificationStatusFilter,
  NotificationTone,
  NotificationWriteResponse,
} from '@/lib/api/types';
import { formatDateTimeShort, formatRelative } from '@/lib/sf/adapters';
import { notificationHref, PAGE_SIZE } from '@/lib/sf/notifications';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import Icon from '@/components/sf/Icon';
import { btn, cardStyle, inputStyle, panelStyle, pill, selectStyle, tabBtn, TEXT_MUTED, TONE_BAD, TONE_GOOD, TONE_INFO, TONE_WARN } from '@/lib/sf/ui';

const STATUSES: [NotificationStatusFilter, string][] = [
  ['all', 'All'], ['unread', 'Unread'], ['read', 'Read'],
];

/** Tones in the order the API offers them — worst first, so the thing most
 *  likely to need action is the first filter under the reader's cursor. */
const TONES: [NotificationTone, string][] = [
  ['bad', 'Problems'], ['warn', 'Warnings'], ['good', 'Completions'], ['info', 'Updates'],
];

const TONE_PILL = { bad: TONE_BAD, warn: TONE_WARN, good: TONE_GOOD, info: TONE_INFO };
const TONE_DOT: Record<NotificationTone, string> = {
  bad: 'hsl(var(--color-bg-danger-solid))', warn: 'hsl(var(--color-bg-warning-solid))', good: 'hsl(var(--color-highlight-solid))', info: 'hsl(var(--color-fg-muted))',
};
const TONE_LABEL: Record<NotificationTone, string> = {
  bad: 'Problem', warn: 'Warning', good: 'Completion', info: 'Update',
};

/** Windows worth offering. `undefined` is "everything we still keep". */
const WINDOWS: [string, number | undefined][] = [
  ['All time', undefined], ['Last 24 hours', 1], ['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90],
];

export type NotificationsProps = {
  /** `GET /api/notifications`, fetched by the server component. */
  feed: NotificationFeed;
  /** `ApiError.message` when that call failed, so an empty `feed` is not
   *  rendered as a quiet inbox. */
  loadError?: string | null;
};

export default function Notifications({ feed, loadError = null }: NotificationsProps) {
  const router = useRouter();

  const [data, setData] = useState<NotificationFeed>(feed);
  /* The last good feed stays on screen under an error: replacing it with an
     empty one renders an outage as "nothing has happened", which is a much
     more reassuring claim than the one that is true. */
  const [fetchError, setFetchError] = useState<string | null>(loadError);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState<NotificationStatusFilter>('all');
  const [tone, setTone] = useState<NotificationTone | null>(null);
  const [query, setQuery] = useState('');
  const [sinceDays, setSinceDays] = useState<number | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => { setData(feed); setFetchError(loadError); }, [feed, loadError]);

  /* The server render already answered the default filter, so the first pass
     of the effect below would repeat it for nothing. */
  const firstLoad = useRef(!loadError);

  const params = useMemo(() => ({
    status, tone: tone ?? undefined, q: query.trim() || undefined, since_days: sinceDays, limit,
  }), [status, tone, query, sinceDays, limit]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    let cancelled = false;
    /* Debounced because the search box is a filter like any other, and every
       keystroke would otherwise be a request. */
    const timer = setTimeout(() => {
      void notificationsApi.list(apiCall, params).then(res => {
        if (cancelled) return;
        if (res.ok) { setData(res.data); setFetchError(null); }
        else setFetchError(res.error.message);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [params, reloadNonce]);

  const reload = useCallback(() => { firstLoad.current = false; setReloadNonce(n => n + 1); }, []);

  /** Every write ends the same way: refetch the page, and refresh the server
   *  tree so the header bell's badge agrees with what just happened here. */
  const afterWrite = useCallback((ok: boolean, message?: string) => {
    setBusy(false);
    if (!ok) { setFetchError(message ?? 'That action did not go through.'); return; }
    setSelected([]);
    reload();
    router.refresh();
  }, [reload, router]);

  const run = useCallback((call: Promise<ApiResult<NotificationWriteResponse>>) => {
    setBusy(true);
    void call.then(res => afterWrite(res.ok, res.ok ? undefined : res.error.message));
  }, [afterWrite]);

  const applyBulk = (action: NotificationBulkAction) => {
    if (!selected.length) return;
    run(notificationsApi.bulk(apiCall, selected, action));
  };

  const openRow = (row: NotificationRow) => {
    const href = notificationHref(row);
    if (!row.read_at) {
      /* Read it on the way out, so the badge is settled before the
         destination renders. */
      void notificationsApi.markRead(apiCall, row.id).then(() => { reload(); router.refresh(); });
    }
    if (href) router.push(href);
  };

  const rows = data.items;
  const facets = data.facets;
  const statusCount = (key: NotificationStatusFilter) =>
    key === 'all' ? facets.unread + facets.read : key === 'unread' ? facets.unread : facets.read;

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map(row => row.id));
  const toggleOne = (id: string) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  /* "No rows" has three different meanings here, and collapsing them into one
     empty state is how an outage gets read as a quiet week. */
  const filtered = status !== 'all' || tone !== null || !!query.trim() || sinceDays !== undefined;

  /* Centred on the same column the account sections use, so moving between
     the notification feed and its preferences does not shift the page. */
  const wrap: CSSProperties = { padding:'20px 22px', maxWidth:'1180px', margin:'0 auto', width:'100%', display:'flex', flexDirection:'column', gap:'13px' };
  const headRow: CSSProperties = { display:'flex', alignItems:'center', gap:'9px', flexWrap:'wrap' };
  const groupStyle: CSSProperties = { display:'flex', gap:'3px', background:'hsl(var(--color-bg-muted))', padding:'3px', borderRadius:'9px' };
  const countStyle: CSSProperties = { marginLeft:'5px', fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' };
  const rowStyle = (read: boolean, isSelected: boolean): CSSProperties => ({
    display:'flex', alignItems:'flex-start', gap:'11px', padding:'12px 14px',
    borderTop:'1px solid hsl(var(--color-border-faint))',
    background: isSelected ? 'hsl(var(--color-accent-subtle))' : read ? 'hsl(var(--color-bg-surface))' : '#f7f9ff',
  });
  const iconAction: CSSProperties = {
    height:'26px', padding:'0 9px', borderRadius:'8px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))',
    cursor:'pointer', fontSize:'.71875rem', color:'hsl(var(--color-fg-subtle))',
    display:'inline-flex', alignItems:'center', gap:'5px',
  };

  return (
    <div style={wrap}>
      {fetchError ? (
        <ApiUnavailable what="Your notifications" detail={fetchError} />
      ) : null}

      {/* ── filters ─────────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, gap:'11px' }}>
        <div style={headRow}>
          <div role="group" aria-label="Read state" style={groupStyle}>
            {STATUSES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setStatus(key); setLimit(PAGE_SIZE); }}
                aria-pressed={status === key}
                style={tabBtn(status === key, '28px', '0 11px', '.75rem')}
              >{label}<span style={countStyle}>{statusCount(key)}</span></button>
            ))}
          </div>

          <div role="group" aria-label="Kind" style={groupStyle}>
            {/* A tone chip carries the count it *would* select, from the
                server's facets — a count computed after its own filter would
                only ever echo the current selection. */}
            <button
              type="button"
              onClick={() => { setTone(null); setLimit(PAGE_SIZE); }}
              aria-pressed={tone === null}
              style={tabBtn(tone === null, '28px', '0 11px', '.75rem')}
            >Any kind</button>
            {TONES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTone(tone === key ? null : key); setLimit(PAGE_SIZE); }}
                aria-pressed={tone === key}
                style={tabBtn(tone === key, '28px', '0 11px', '.75rem')}
              >{label}<span style={countStyle}>{facets.tones[key] ?? 0}</span></button>
            ))}
          </div>

          <label style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'7px' }}>
            <span style={{ fontSize:'.71875rem', color:TEXT_MUTED }}>Period</span>
            <select
              aria-label="Time window"
              value={String(sinceDays ?? '')}
              onChange={event => {
                const raw = event.target.value;
                setSinceDays(raw ? Number(raw) : undefined);
                setLimit(PAGE_SIZE);
              }}
              style={selectStyle}
            >
              {WINDOWS.map(([label, days]) => (
                <option key={label} value={days === undefined ? '' : String(days)}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display:'flex', gap:'9px', alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 240px', minWidth:'180px' }}>
            <input
              type="search"
              aria-label="Search notifications"
              placeholder="Search by envelope, invoice or ticket…"
              value={query}
              onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
              style={inputStyle}
            />
          </div>
          {/* Feed-wide actions, as distinct from the selection actions that
              appear once rows are ticked. */}
          <button
            type="button"
            onClick={() => run(notificationsApi.markAllRead(apiCall))}
            disabled={busy || facets.unread === 0}
            style={{ ...btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'), opacity: facets.unread === 0 ? .5 : 1 }}
          ><Icon name="check" size={13} />Mark all read</button>
          <button
            type="button"
            onClick={() => run(notificationsApi.clearRead(apiCall))}
            disabled={busy || facets.read === 0}
            title="Deletes read notifications. Unread ones are kept."
            style={{ ...btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'), opacity: facets.read === 0 ? .5 : 1 }}
          ><Icon name="trash" size={13} />Clear read</button>
        </div>
      </div>

      {/* ── selection actions ───────────────────────────────────────────── */}
      {selected.length ? (
        <div role="group" aria-label="Selection actions" style={{ ...cardStyle, flexDirection:'row', alignItems:'center', gap:'9px', padding:'11px 14px' }}>
          <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{selected.length} selected</span>
          <button type="button" onClick={() => applyBulk('read')} disabled={busy} style={iconAction}><Icon name="check" size={12} />Mark read</button>
          {/* Undo, because reading is otherwise final and a bulk misclick is easy. */}
          <button type="button" onClick={() => applyBulk('unread')} disabled={busy} style={iconAction}><Icon name="undo" size={12} />Mark unread</button>
          <button
            type="button"
            onClick={() => applyBulk('delete')}
            disabled={busy}
            style={{ ...iconAction, marginLeft:'auto', borderColor:'hsl(var(--color-border-danger))', color:'hsl(var(--color-fg-danger))' }}
          ><Icon name="trash" size={12} />Delete</button>
          <button type="button" onClick={() => setSelected([])} style={iconAction}><Icon name="close" size={12} />Clear selection</button>
        </div>
      ) : null}

      {/* ── the feed ────────────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:'11px', padding:'11px 14px' }}>
          <input
            type="checkbox"
            aria-label={allSelected ? 'Deselect all' : 'Select all on this page'}
            checked={allSelected}
            onChange={toggleAll}
            disabled={rows.length === 0}
          />
          <span style={{ fontSize:'.71875rem', color:TEXT_MUTED }}>
            {data.total === 0
              ? 'No notifications'
              : `Showing ${rows.length} of ${data.total}${filtered ? ' matching' : ''}`}
          </span>
        </div>

        {rows.length === 0 ? (
          <div style={{ borderTop:'1px solid hsl(var(--color-border-faint))', padding:'34px 16px', textAlign:'center', fontSize:'.78125rem', color:TEXT_MUTED }}>
            {fetchError
              ? 'We could not load your notifications.'
              : filtered
                ? 'No notifications match these filters.'
                : 'Nothing yet. Activity on your envelopes, billing and support shows up here.'}
          </div>
        ) : rows.map(row => {
          const isSelected = selected.includes(row.id);
          const href = notificationHref(row);
          return (
            <div key={row.id} style={rowStyle(!!row.read_at, isSelected)}>
              <input
                type="checkbox"
                aria-label={`Select "${row.title}"`}
                checked={isSelected}
                onChange={() => toggleOne(row.id)}
                style={{ marginTop:'3px' }}
              />
              <span style={{ width:'8px', height:'8px', borderRadius:'99px', marginTop:'6px', flex:'0 0 8px', background: TONE_DOT[row.tone] ?? TONE_DOT.info }}></span>

              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:'1 1 auto', minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  {href ? (
                    <button
                      type="button"
                      onClick={() => openRow(row)}
                      style={{ border:'none', background:'transparent', padding:0, cursor:'pointer', fontSize:'.8125rem', fontWeight: row.read_at ? 500 : 600, color:'hsl(var(--color-fg-default))', textAlign:'left' }}
                    >{row.title}</button>
                  ) : (
                    <span style={{ fontSize:'.8125rem', fontWeight: row.read_at ? 500 : 600 }}>{row.title}</span>
                  )}
                  <span style={{ ...pill(TONE_PILL[row.tone] ?? TONE_INFO), fontSize:'.625rem' }}>{TONE_LABEL[row.tone] ?? row.tone}</span>
                  {row.read_at ? null : (
                    <span style={{ ...pill(TONE_INFO), fontSize:'.625rem' }}>New</span>
                  )}
                </div>
                {row.detail ? (
                  <span style={{ fontSize:'.75rem', color:'hsl(var(--color-fg-subtle))' }}>{row.detail}</span>
                ) : null}
                <span title={formatDateTimeShort(row.created_at)} style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>
                  {formatRelative(row.created_at)}
                </span>
              </div>

              <div style={{ display:'flex', gap:'6px', flex:'0 0 auto', alignItems:'center' }}>
                {row.read_at ? (
                  <button type="button" onClick={() => run(notificationsApi.markUnread(apiCall, row.id))} disabled={busy} style={iconAction}><Icon name="undo" size={12} />Unread</button>
                ) : (
                  <button type="button" onClick={() => run(notificationsApi.markRead(apiCall, row.id))} disabled={busy} style={iconAction}><Icon name="check" size={12} />Read</button>
                )}
                <button
                  type="button"
                  onClick={() => run(notificationsApi.remove(apiCall, row.id))}
                  disabled={busy}
                  aria-label={`Delete "${row.title}"`}
                  style={{ ...iconAction, padding:'0 7px', borderColor:'hsl(var(--color-border-danger))', color:'hsl(var(--color-fg-danger))' }}
                ><Icon name="close" size={12} /></button>
              </div>
            </div>
          );
        })}

        {rows.length < data.total ? (
          <div style={{ borderTop:'1px solid hsl(var(--color-border-faint))', padding:'11px 14px', display:'flex', justifyContent:'center' }}>
            <button
              type="button"
              onClick={() => setLimit(value => value + PAGE_SIZE)}
              style={btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))')}
            ><Icon name="caretDown" size={13} />Show more</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
