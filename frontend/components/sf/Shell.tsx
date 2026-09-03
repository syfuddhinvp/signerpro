'use client';
/* SignForge app shell — one sidebar, top header, popovers, trial banner, ghost + toast.

   The navigation is a single tree: product areas at the top level, the current
   area's own rows nested under it. The prototype's dark icon rail beside a
   second contextual panel is gone — two panels for one tree meant the second
   one's heading only made sense once you had spotted which icon was lit.
   `lib/sf/navigation.ts` owns the model; this file only renders it. */
import type { CSSProperties } from 'react';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { type ScreenKey, SECTION_PARAM, accountSectionForPath, isDocumentScreen, sectionFor } from '@/lib/sf/routes';
import { type NavContext, sidebarAreas } from '@/lib/sf/navigation';
import { useSession, signOut as endSession } from '@/components/sf/SessionProvider';
import { TOUR } from '@/lib/sf/data';
import { btn, railHead, TITLES, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';

/** Where the fold preference is remembered. Per browser, per device — it is a
 *  viewing preference, not account state, so it never leaves the machine. */
const FOLD_KEY = 'sf.sidebar.folded';

/** Real numbers for the shell's own badges, fetched by `app/(app)/layout.tsx`.
 *  `null` anywhere means "that endpoint failed" — the badge renders blank. */
export type ShellData = {
  quick: {
    inbox: number; outbox: number; completed: number; drafts: number;
    favorites: number; expiring: number; shared: number; mine: number;
  } | null;
  folders: { documents: number; archive: number; templates: number; trash: number } | null;
  /** Real folders from `GET /api/folders/tree`, flattened, in sidebar order. */
  userFolders: { id: string; name: string; count: number; scope: string }[];
  quota: { used: number; limit: number | null; pct: number } | null;
  invoiceCount: number | null;
  logCount: number | null;
  openTicketCount: number | null;
};

const EMPTY_SHELL_DATA: ShellData = {
  quick: null, folders: null, userFolders: [], quota: null,
  invoiceCount: null, logCount: null, openTicketCount: null,
};

export default function Shell({ children, data = EMPTY_SHELL_DATA }: { children?: React.ReactNode; data?: ShellData }) {
  const sf = useSF();
  const { s, set, flash, initials } = sf;
  const A = sf.accent();
  const nav = useNav();
  const { screen, href, go, switchWorkspace } = nav;
  const isPlat = nav.isPlat;
  const session = useSession();
  const router = useRouter();
  const areaActive = nav.area;
  const userName = session.name;
  const userRole = session.role;
  /* The workspace name is the caller's real organization. It was hardcoded to
     "Acme Corporation", so every tenant saw Acme as its own workspace. */
  const orgName = session.organizationName;
  const orgChip = initials(orgName || '—');

  /* ── the navigation model ──────────────────────────────────────────────
     Rail and sidebar both come out of `lib/sf/navigation.ts`. Everything the
     model needs is read off the URL, so what is highlighted is always what the
     address bar says — there is no second copy of "where am I" in the store to
     drift out of sync. */
  const searchParams = useSearchParams();
  const section = sectionFor(screen, searchParams.get(SECTION_PARAM));
  const folder = (searchParams.get('folder') || 'documents').trim();

  const navCtx: NavContext = {
    workspace: isPlat ? 'platform' : 'tenant',
    area: areaActive,
    screen,
    section,
    folder,
    documentId: nav.documentId,
    accountSection: accountSectionForPath(nav.pathname),
    documentSealed: s.docSealed,
    counts: {
      quick: data.quick as unknown as Record<string, number> | null,
      folders: data.folders as unknown as Record<string, number> | null,
      invoices: data.invoiceCount,
      logs: data.logCount,
      tickets: data.openTicketCount,
    },
    folders: data.userFolders,
  };

  /* ── folding ────────────────────────────────────────────────────────────
     The sidebar collapses to an icon strip. The preference is per-browser and
     read after mount, never during render: reading `localStorage` while
     rendering would make the server's HTML and the client's first paint
     disagree, and React would throw away the whole tree to reconcile it. So
     the first paint is always the expanded sidebar, and a stored fold applies
     on the effect that follows. */
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try { setFolded(window.localStorage.getItem(FOLD_KEY) === '1'); } catch { /* private mode, blocked storage */ }
  }, []);
  const toggleFold = () => {
    setFolded(prev => {
      const next = !prev;
      try { window.localStorage.setItem(FOLD_KEY, next ? '1' : '0'); } catch { /* nothing to do */ }
      return next;
    });
  };

  const areas = sidebarAreas(navCtx).map(area => ({
    ...area,
    style: {
      display:'flex', alignItems:'center', gap:'10px', width:'100%', borderRadius:'10px',
      padding: folded ? '8px 0' : '8px 10px', justifyContent: folded ? 'center' : 'flex-start',
      border:'none', cursor:'pointer', textAlign:'left', textDecoration:'none',
      background: area.active ? '#eef2ff' : 'transparent',
      color: area.active ? '#0f172a' : '#334155',
      fontSize:'.8125rem', fontWeight: area.active ? 600 : 500,
      position:'relative',
    } as CSSProperties,
    glyph: {
      width:'22px', height:'22px', borderRadius:'7px', display:'grid', placeItems:'center', fontSize:'.75rem', flex:'0 0 22px',
      background: area.active ? A : '#f1f3f7', color: area.active ? '#fff' : '#64748b',
    } as CSSProperties,
    /* Folded, the count has no room beside the label, so it becomes a small
       marker on the corner of the glyph — still visible, still countable. */
    countStyle: (folded
      ? { position:'absolute', top:'2px', right:'6px', minWidth:'15px', height:'15px', padding:'0 4px' }
      : { marginLeft:'auto', minWidth:'18px', height:'17px', padding:'0 5px' }) as CSSProperties,
  }));

  /** Shared look of the area badge; `countStyle` supplies only its placement,
   *  which differs folded and unfolded. */
  const areaCountBase: CSSProperties = {
    borderRadius:'99px', background:'#f43f5e', color:'#fff', fontSize:'.625rem', fontWeight:700,
    display:'grid', placeItems:'center', fontFamily:"'Inter', 'Google Sans Flex', sans-serif",
  };

  /** One row style for every row in the tree, whichever group it is in — the
   *  shell this replaced styled each group differently, which made rows that
   *  behaved the same look like different kinds of control. Children sit on an
   *  indent guide so the tree reads as a tree without a second panel. */
  const rowStyle = (active: boolean): CSSProperties => ({
    display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'6px 9px', borderRadius:'8px',
    border:'none', cursor:'pointer', textAlign:'left', textDecoration:'none',
    background: active ? '#eef2ff' : 'transparent', color: active ? '#0f172a' : '#475569',
    fontSize:'.78125rem', fontWeight: active ? 600 : 500,
  });
  const rowDot = (active: boolean, tone?: string): CSSProperties => ({
    width: tone ? '8px' : '7px', height: tone ? '8px' : '7px', borderRadius:'99px',
    background: tone || (active ? A : BORDER_STRONG), flex:'0 0 auto',
  });
  const rowCountStyle: CSSProperties = { marginLeft:'auto', fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
  /** The expanded area's children, indented under it against a guide rule. */
  const childrenStyle: CSSProperties = {
    display:'flex', flexDirection:'column', gap:'10px',
    margin:'2px 0 6px 20px', paddingLeft:'11px', borderLeft:'1px solid #e9edf3',
  };

  /* ── envelope quota card — the `max_documents_per_month` metering row ── */
  const quota = data.quota;
  const quotaUsed = quota ? quota.used.toLocaleString('en-US') : '';
  /* The slash lives in the string so a missing/unmetered quota prints nothing
     rather than a stranded "/". */
  const quotaLimit = !quota
    ? ''
    : quota.limit === null
      ? '/ unlimited'
      : '/ ' + quota.limit.toLocaleString('en-US');
  const quotaWidth = (quota ? Math.max(0, Math.min(100, quota.pct)) : 0) + '%';

  /* ── help / org menu ──
     There is no notification-feed endpoint, so there is no notification tray.
     The prototype's tray hardcoded five alerts — a signature, an invoice due
     date, a failed payment and an escalation — none of which were real. */
  const helpItems = ([
    ['Start product tour', 'tour'], ['Support centre', 'support'], ['Contact support', 'support'],
    ['Guides & docs', 'guides'], ['API console', 'sandbox']
  ] as [string, string | null][]).map(([label, target]) => ({ label,
    onClick: () => {
      if (target === 'tour') { const st0 = TOUR[0]; set({ tourStep: 0, helpOpen: false }); go(st0.screen as ScreenKey, { workspace: st0.ws }); return; }
      set({ helpOpen: false });
      if (target) go(target as ScreenKey);
    },
    style: { display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'8px', border:'none', background:'transparent', cursor:'pointer', fontSize:'.78125rem', color:'#334155' } as CSSProperties }));

  /* ── header / chrome styles ── */
  const titles = TITLES(s.fields.length, isPlat);
  const pageTitle = titles[screen] ? titles[screen][0] : '';
  const pageSub = titles[screen] ? titles[screen][1] : '';

  const logoStyle: CSSProperties = { width:'30px', height:'30px', borderRadius:'9px', background: A, color:'#fff', display:'grid', placeItems:'center', fontSize:'.75rem', fontWeight:700, letterSpacing:'-.5px' };
  const openBuilderBtn: CSSProperties = Object.assign({}, btn('#fff', '#475569', '#e3e7ee'), { display: s.wide ? 'inline-flex' : 'none' });
  const primaryBtn: CSSProperties = btn(A, '#fff', A);
  const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1 };
  const orgRowStyle: CSSProperties = { display:'flex', alignItems:'center', gap:'8px', width:'100%', padding:'7px 8px', borderRadius:'9px', border:'1px solid #e3e7ee', background:'#fbfcfd' };
  const orgChipStyle: CSSProperties = { width:'22px', height:'22px', borderRadius:'7px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'.5625rem', fontWeight:700, flex:'0 0 22px' };
  const helpStyle: CSSProperties = { width:'32px', height:'32px', borderRadius:'9px', border:'1px solid #e3e7ee', background: s.helpOpen ? '#eef2ff' : '#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem' };
  const wsTenantStyle: CSSProperties = { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.75rem', fontWeight: isPlat ? 500 : 600,
    background: isPlat ? 'transparent' : '#fff', color: isPlat ? '#64748b' : '#0f172a', boxShadow: isPlat ? 'none' : '0 1px 2px rgba(15,23,42,.12)' };
  const wsPlatformStyle: CSSProperties = { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.75rem', fontWeight: isPlat ? 600 : 500,
    background: isPlat ? '#fff' : 'transparent', color: isPlat ? '#92400e' : '#64748b', boxShadow: isPlat ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const wsScopeLabel = isPlat ? 'Super admin · all tenants' : 'Organization scope';

  /* ── embedded-session bar ── */
  const embed = s.embedSession;
  const hasEmbed = !!embed;
  const embedBarStyle: CSSProperties = { flex:'0 0 auto', display:'flex', alignItems:'center', gap:'12px', padding:'9px 22px', background:'#eef2ff', borderBottom:'1px solid #c7d2fe' };
  const embedChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background: A, color:'#fff', fontSize:'.625rem', fontWeight:700, letterSpacing:'.06em', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' };
  const embedTitle = embed ? embed.title : '';
  const embedMeta = embed ? embed.host + ' · session ' + embed.id + ' · external_id ' + embed.externalId : '';
  const embedContacts = embed ? embed.contacts.join(' · ') : '';
  const embedContactsChip: CSSProperties = { padding:'4px 9px', borderRadius:'99px', background:'#fff', border:'1px solid #c7d2fe', fontSize:'.65625rem', color:'#3730a3', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', flex:'0 0 auto' };

  /* ── ghost + toast ── */
  const gt = s.dragTool ? sf.meta(s.dragTool) : null;
  const hasGhost = !!(s.dragTool && s.ghost);
  const ghostLabel = gt ? gt.label : '';
  const ghostStyle: CSSProperties = s.ghost ? { position:'fixed', left:(s.ghost.x - (gt ? gt.w : 80) / 2) + 'px', top:(s.ghost.y - (gt ? gt.h : 20) / 2) + 'px',
    width:(gt ? gt.w : 80) + 'px', height:(gt ? gt.h : 20) + 'px', border:'1.5px dashed ' + sf.recip(s.activeRecipient).color,
    background: sf.recip(s.activeRecipient).color + '26', borderRadius:'6px', display:'grid', placeItems:'center',
    fontSize:'.6875rem', fontWeight:600, color:'#0f172a', pointerEvents:'none', zIndex:70 } : {};

  /* ── handlers ── */
  const signOut = async () => { await endSession(); router.replace('/login'); };
  const setTenantWs = () => { set({ menuDoc: null }); switchWorkspace('tenant'); };
  const setPlatformWs = () => { set({ menuDoc: null }); switchWorkspace('platform'); };
  const toggleHelp = () => set({ helpOpen: !s.helpOpen });
  const openSend = () => set({ modal: 'send' });

  /** Whether the header's envelope actions apply to where we are. */
  const envelopeActions = !isPlat && !!nav.documentId && isDocumentScreen(screen) && !s.docSealed;
  const embedReturn = () => { set({ embedSession: null }); go('api'); flash('Returned to ' + s.embedReturnUrl); };
  const embedEnd = () => set({ embedSession: null });

  return (
    <div style={{ display:'flex', height:'100vh', width:'100%', overflow:'hidden', fontFamily:"'Google Sans Flex', 'Helvetica Neue', Arial, sans-serif", color:'#0f172a', background:'#f5f6f8', WebkitFontSmoothing:'antialiased' } as CSSProperties}>

      <aside
        data-tour="sidebar"
        data-sf-scroll="1"
        data-folded={folded ? '1' : '0'}
        style={{ width: folded ? '62px' : '252px', flex: folded ? '0 0 62px' : '0 0 252px', background:'#fff', borderRight:'1px solid #e3e7ee', display:'flex', flexDirection:'column', gap:'14px', padding: folded ? '14px 9px' : '14px', overflowY:'auto', overflowX:'hidden', minHeight:0, transition:'width .16s ease, flex-basis .16s ease' }}
      >

        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <div style={{ display:'flex', flexDirection: folded ? 'column' : 'row', alignItems:'center', gap:'9px' }}>
            <span style={logoStyle}>SF</span>
            {folded ? null : <span style={{ fontSize:'.875rem', fontWeight:700, letterSpacing:'-.3px' }}>SignForge</span>}
            <button
              type="button"
              onClick={toggleFold}
              aria-label={folded ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!folded}
              title={folded ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{ ...iconBtn, marginLeft: folded ? '0' : 'auto', flex:'0 0 28px' }}
            >{folded ? '»' : '«'}</button>
          </div>
          {folded ? null : (
            <>
              <div data-tour="workspace" style={{ display:'flex', gap:'3px', background:'#f1f3f7', padding:'3px', borderRadius:'9px' }}>
                <button type="button" onClick={setTenantWs} style={wsTenantStyle}>Tenant</button>
                {session.isPlatformAdmin ? (
                  <button type="button" onClick={setPlatformWs} style={wsPlatformStyle}>Platform</button>
                ) : null}
              </div>
              <div style={orgRowStyle}>
                <span style={orgChipStyle}>{orgChip}</span>
                <span style={{ display:'flex', flexDirection:'column', minWidth:0, lineHeight:1.2, textAlign:'left' }}>
                  <span style={{ fontSize:'.75rem', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{orgName}</span>
                  <span style={{ fontSize:'.625rem', color:TEXT_MUTED }}>{wsScopeLabel}</span>
                </span>
              </div>
            </>
          )}
        </div>

        <nav data-tour="areas" data-sf-nav="1" aria-label="Sections" style={{ display:'flex', flexDirection:'column', gap:'1px' }}>
          {areas.map(area => (
            <React.Fragment key={area.item.key}>
              <Link
                data-sf-area={area.item.key}
                href={area.href}
                aria-current={area.active ? 'page' : undefined}
                aria-label={folded ? area.item.label : undefined}
                title={folded ? area.item.label : undefined}
                style={area.style}
              >
                <span style={area.glyph}>{area.item.icon}</span>
                {folded ? null : (
                  <span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{area.item.label}</span>
                )}
                {area.item.count ? <span style={{ ...areaCountBase, ...area.countStyle }}>{area.item.count}</span> : null}
              </Link>
              {!folded && area.groups.length ? (
                <div style={childrenStyle}>
                  {area.groups.map(g => (
                    <div key={g.key} style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                      {g.title ? <span style={railHead}>{g.title}</span> : null}
                      {g.rows.map(r => (
                        <Link key={r.key} data-sf-row="1" href={r.href} aria-current={r.active ? 'page' : undefined} style={rowStyle(r.active)}>
                          <span style={rowDot(r.active, r.tone)}></span>
                          <span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.label}</span>
                          {r.count ? <span style={rowCountStyle}>{r.count}</span> : null}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </nav>

        <div style={{ marginTop:'auto', display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #eef1f6', paddingTop:'12px', alignItems: folded ? 'center' : 'stretch' }}>
          {folded ? null : (
          <div style={{ border:'1px solid #eef1f6', borderRadius:'11px', padding:'11px', background:'#fbfcfd' }}>
            <div style={{ fontSize:'.625rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", letterSpacing:'.04em' }}>ENVELOPE QUOTA</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:'6px', marginTop:'5px' }}>
              <span style={{ color:'#0f172a', fontSize:'1.0625rem', fontWeight:700 }}>{quotaUsed}</span>
              <span style={{ color:TEXT_MUTED, fontSize:'.6875rem' }}>{quotaLimit}</span>
            </div>
            <div style={{ height:'4px', borderRadius:'99px', background:'#eef1f6', marginTop:'8px', overflow:'hidden' }}>
              <div style={{ width:quotaWidth, height:'100%', background:'#10b981', borderRadius:'99px' }}></div>
            </div>
          </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:'9px', flexDirection: folded ? 'column' : 'row' }}>
            <span title={folded ? userName + ' · ' + userRole : undefined} style={{ width:'26px', height:'26px', borderRadius:'99px', background:'#eef1f6', color:'#475569', display:'grid', placeItems:'center', fontSize:'.625rem', fontWeight:700, flex:'0 0 26px' }}>{initials(userName)}</span>
            {folded ? null : (
            <div style={{ display:'flex', flexDirection:'column', lineHeight:1.25, minWidth:0 }}>
              <span style={{ color:'#0f172a', fontSize:'.75rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userName}</span>
              <span style={{ color:TEXT_MUTED, fontSize:'.65625rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userRole}</span>
            </div>
            )}
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" style={{ ...iconBtn, marginLeft: folded ? '0' : 'auto', flex:'0 0 28px' }}>⏎</button>
          </div>
        </div>
      </aside>

      <main style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>

        <header style={{ height:'60px', flex:'0 0 60px', borderBottom:'1px solid #e3e7ee', background:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 22px', gap:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px', flex:'1 1 220px', minWidth:'180px' }}>
            <h1 style={{ margin:0, fontSize:'.9375rem', fontWeight:600, letterSpacing:'-0.2px', whiteSpace:'nowrap', flex:'0 0 auto' }}>{pageTitle}</h1>
            <span style={{ width:'1px', height:'18px', background:'#e3e7ee', flex:'0 0 1px' }}></span>
            <span style={{ fontSize:'.78125rem', color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:'1 1 auto', minWidth:0 }}>{pageSub}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:'0 1 auto', minWidth:0, justifyContent:'flex-end' }}>
            {/* Both actions are about one envelope, so they only belong on a
                document route. The header used to render them everywhere —
                Contacts, Reports, Billing, the whole platform workspace — where
                "Send for signature" had no envelope to send and answered
                "No document to send", and on a sealed one, where sending again
                is not a thing that can happen. */}
            {envelopeActions ? (
              <>
                <Link href={href('builder')} style={{ ...openBuilderBtn, textDecoration:'none' }}>Open builder</Link>
                <button type="button" onClick={openSend} style={primaryBtn}>Send for signature</button>
              </>
            ) : null}
            <div style={{ position:'relative', display:'flex', gap:'6px', alignItems:'center' }}>
              <button type="button" aria-label="Help" aria-expanded={s.helpOpen} onClick={toggleHelp} style={helpStyle}>?</button>
              {s.helpOpen ? (
                <div role="menu" style={{ position:'absolute', right:0, top:'40px', width:'212px', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'13px', boxShadow:'0 22px 50px -20px rgba(15,23,42,.4)', padding:'6px', zIndex:40, animation:'sfIn .12s ease' }}>
                  {helpItems.map((h, i) => (
                    <button key={h.label + i} type="button" role="menuitem" onClick={h.onClick} style={h.style}>{h.label}</button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {hasEmbed ? (
          <div style={embedBarStyle}>
            <span style={embedChip}>EMBEDDED</span>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
              <span style={{ fontSize:'.78125rem', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{embedTitle}</span>
              <span style={{ fontSize:'.6875rem', color:'#475569', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{embedMeta}</span>
            </div>
            <div style={{ display:'flex', gap:'6px', marginLeft:'auto', flex:'0 0 auto', alignItems:'center' }}>
              <span style={embedContactsChip}>{embedContacts}</span>
              <button type="button" onClick={embedReturn} style={ghostBtn}>Return to host app</button>
              <button type="button" onClick={embedEnd} style={iconBtn}>✕</button>
            </div>
          </div>
        ) : null}

        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', position:'relative' }}>
          {children}
        </div>
      </main>

      {hasGhost ? (
        <div style={ghostStyle}>{ghostLabel}</div>
      ) : null}

      {s.toast ? (
        <div role="status" style={{ position:'fixed', bottom:'20px', left:'50%', transform:'translateX(-50%)', zIndex:90, background:'#0f172a', color:'#f1f5f9', padding:'11px 16px', borderRadius:'11px', fontSize:'.78125rem', boxShadow:'0 18px 40px -18px rgba(15,23,42,.6)', animation:'sfIn .16s ease' }}>{s.toast}</div>
      ) : null}
    </div>
  );
}
