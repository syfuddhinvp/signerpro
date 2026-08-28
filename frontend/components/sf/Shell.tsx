'use client';
/* SignForge app shell — icon rail, contextual sidebar, top header, popovers, trial banner, ghost + toast.
   Ported verbatim from the prototype template (lines 1–214, 2337–2352) and app.js renderVals(). */
import type { CSSProperties } from 'react';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { ScreenKey } from '@/lib/sf/routes';
import { useSession, signOut as endSession } from '@/components/sf/SessionProvider';
import { AUDIT, INVOICES, LOGS, TEMPLATES, TENANTS, TOUR } from '@/lib/sf/data';
import { btn, railHead, linkBtn, TITLES, subTitleFor } from '@/lib/sf/ui';

type NavRow = {
  label: string; count?: string; href: string;
  style: CSSProperties; dot?: CSSProperties; glyph?: CSSProperties; countStyle?: CSSProperties;
};

export default function Shell({ children }: { children?: React.ReactNode }) {
  const sf = useSF();
  const { s, set, flash, initials } = sf;
  const A = sf.accent();
  const nav = useNav();
  const { screen, href, go, switchWorkspace } = nav;
  const isPlat = nav.isPlat;
  const session = useSession();
  const router = useRouter();
  const railActive = nav.rail;
  const userName = session.name || s.user.name;
  const userRole = session.role || s.user.role;
  const orgName = s.org || session.organizationName;

  /* ── icon rail ── */
  const railDefs: [string, string, string, ScreenKey][] = isPlat
    ? [['platform','Platform','⌘','platformHome'], ['billing','Revenue','◈','revenue'], ['support','Support','☎','support'], ['developer','Developer','‹›','api'], ['reports','Reports','▥','reports']]
    : [['documents','Documents','▤','tenantHome'], ['contacts','Contacts','◍','contacts'], ['reports','Reports','▥','reports'], ['billing','Billing','◈','billing'], ['developer','Developer','‹›','api'], ['support','Support','☎','support']];
  const rail = railDefs.map(([id, label, icon, target]) => {
    const on = railActive === id;
    return { id, label, icon, href: href(target),
      style: { display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', width:'100%', padding:'9px 4px', borderRadius:'11px',
        border:'none', cursor:'pointer', background: on ? 'rgba(99,102,241,.2)' : 'transparent', color: on ? '#e0e7ff' : '#8ea0b8' } as CSSProperties,
      glyph: { width:'22px', height:'22px', display:'grid', placeItems:'center', fontSize:'14px', lineHeight:1 } as CSSProperties,
      labelStyle: { fontSize:'9.5px', fontWeight: on ? 600 : 500, letterSpacing:'.01em', textAlign:'center' } as CSSProperties };
  });

  const subTitle = subTitleFor(railActive, isPlat);

  const subItem = (id: ScreenKey, label: string, count?: string | number): NavRow => {
    const on = screen === id;
    return { label, count: count === undefined ? '' : String(count), href: href(id),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 },
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' },
      countStyle: { marginLeft:'auto', fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } };
  };
  const subScreensMap: { [k: string]: NavRow[] } = {
    documents: [subItem('tenantHome','Overview'), subItem('dashboard','All documents','1,564'), subItem('builder','Prepare', s.fields.length), subItem('routing','Workflow'), subItem('sign','Signer view'), subItem('audit','Audit trail', AUDIT.length)],
    contacts: [subItem('contacts','Address book', s.contacts.length)],
    reports: [subItem('reports','Analytics & exports')],
    billing: isPlat
      ? [subItem('revenue','Revenue & Stripe'), subItem('invoices','Invoices', INVOICES.length)]
      : [subItem('billing','Billing & plan'), subItem('invoices','Invoices', INVOICES.filter((i: any) => i.slug === 'acme').length)],
    developer: [subItem('api','API & add-on'), subItem('sandbox','Sandbox'), subItem('guides','Guides & docs'), subItem('logs','Logs', isPlat ? LOGS.length : LOGS.filter(l => l.slug === 'acme').length)],
    support: [subItem('support', isPlat ? 'Ticket queue' : 'My tickets', s.tickets.filter(x => x.status !== 'resolved').length)],
    platform: [subItem('platformHome','Overview'), subItem('platform','Tenants & roles', TENANTS.length), subItem('revenue','Revenue & Stripe'), subItem('invoices','Invoices', INVOICES.length), subItem('support','Support queue'), subItem('logs','Platform logs')]
  };
  const subScreens = subScreensMap[railActive] || [];

  /* ── document library sidebar (quick access / folders / team folders) ── */
  const quickAccess: [string, string, number, string][] = [
    ['inbox', 'Inbox / Waiting for me', 3, '#4f46e5'],
    ['outbox', 'Outbox / Waiting for others', 12, '#0ea5e9'],
    ['completed', 'Completed / Signed', 127, '#10b981'],
    ['drafts', 'Drafts', 4, '#94a3b8'],
    ['favorites', 'Favorites', 6, '#f43f5e'],
    ['expiring', 'Expiring soon', 2, '#f59e0b'],
    ['shared', 'Shared with me', 9, '#8b5cf6'],
    ['mine', 'Owned by me', 88, '#64748b']
  ];
  const folders: [string, string, string][] = [
    ['documents', 'Documents', '1,564'], ['archive', 'Archive', '31'],
    ['templates', 'Templates', String(TEMPLATES.length)], ['trash', 'Trash', '7']
  ];
  const libTree = quickAccess.map(([id, label, count, color]) => {
    const on = s.libFolder === id;
    return { key: id, label, count: String(count),
      onClick: () => set({ libFolder: id, libSelected: [] }),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'7px 9px', borderRadius:'9px', border:'none', cursor:'pointer',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500, textAlign:'left' } as CSSProperties,
      dot: { width:'8px', height:'8px', borderRadius:'99px', background:color, flex:'0 0 8px' } as CSSProperties,
      countStyle: { marginLeft:'auto', fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties };
  });
  const libFolders = folders.map(([id, label, count]) => {
    const on = s.libFolder === id;
    return { key: id, label, count,
      onClick: () => set({ libFolder: id, libSelected: [] }),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 9px', borderRadius:'9px', border:'1px solid ' + (on ? '#c7d2fe' : 'transparent'), cursor:'pointer',
        background: on ? '#eef2ff' : 'transparent', color:'#0f172a', fontSize:'12.5px', fontWeight: on ? 600 : 500, textAlign:'left' } as CSSProperties,
      glyph: { width:'20px', height:'20px', borderRadius:'6px', background:'#eef1f6', display:'grid', placeItems:'center', fontSize:'9.5px', color:'#475569', flex:'0 0 20px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties,
      countStyle: { marginLeft:'auto', fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties };
  });
  const teamFolders = ([['Global Legal', 214], ['Sales — Americas', 118], ['Procurement', 46]] as [string, number][]).map(([label, count]) => ({
    key: label, label, count: String(count),
    onClick: () => { set({ libFolder: 'documents' }); flash(label + ' opened · shared team folder'); },
    style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'7px 9px', borderRadius:'9px', border:'none', background:'transparent', cursor:'pointer', fontSize:'12.5px', color:'#475569', textAlign:'left' } as CSSProperties,
    countStyle: { marginLeft:'auto', fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties
  }));
  const libFolderLabel = ((quickAccess as any[]).concat(folders).find(f => f[0] === s.libFolder) || ['', 'Documents'])[1] as string;
  const newFolder = () => flash('Folder created in ' + libFolderLabel);

  /* ── reports sidebar ── */
  const reportNav = ([['analytics', 'My Analytics'], ['all', 'All reports'], ['documents', 'By documents'],
    ['templates', 'By templates'], ['recipients', 'By recipients'], ['custom', 'Custom']] as [string, string][]).map(([id, label]) => {
    const on = s.reportsSection === id;
    return { key: id, label, onClick: () => set({ reportsSection: id }),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' } as CSSProperties };
  });

  /* ── developer sidebar ── */
  const apiSideNav = ([['overview','Overview'],['apps','Apps & keys'],['endpoints','Endpoints'],['webhooks','Webhooks'],['usage','Plan usage']] as [string, string][]).map(([id, label]) => {
    const on = s.apiSection === id && screen === 'api';
    return { key: id, label, onClick: () => { set({ apiSection: id }); go('api'); },
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' } as CSSProperties };
  });

  /* ── platform admin sidebar ── */
  const platformSideNav = ([['tenants','Tenants'],['users','Users & roles'],['flags','Feature flags'],['billing','Plans & usage'],['security','Security & compliance']] as [string, string][]).map(([id, label]) => {
    const on = s.platformTab === id && screen === 'platform';
    return { key: id, label, onClick: () => { set({ platformTab: id }); go('platform'); },
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' } as CSSProperties };
  });

  /* ── notifications / help / org menu ── */
  const notifications = ([
    ['Alex Rivera signed Master Services Agreement', '12 min ago', 'good'],
    ['Invoice INV-2026-0841 is due in 4 days', '2 hours ago', 'info'],
    ['Halden GmbH payment failed — dunning step 4', 'Yesterday', 'bad'],
    ['SF-4471 escalated to engineering', 'Yesterday', 'bad'],
    ['Contractor Agreement expires in 24 hours', '2 days ago', 'info']
  ] as [string, string, string][]).map(([label, ts, tone]) => ({ label, ts,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px',
      background: tone === 'good' ? '#10b981' : tone === 'bad' ? '#f43f5e' : A } as CSSProperties }));

  const helpItems = ([
    ['Start product tour', 'tour'], ['Support centre', 'support'], ['Contact support', 'support'],
    ['Guides & docs', 'guides'], ['API sandbox', 'sandbox'], ['Keyboard shortcuts', null]
  ] as [string, string | null][]).map(([label, target]) => ({ label,
    onClick: () => {
      if (target === 'tour') { const st0 = TOUR[0]; set({ tourStep: 0, helpOpen: false }); go(st0.screen as ScreenKey, { workspace: st0.ws }); return; }
      set({ helpOpen: false });
      if (target) go(target as ScreenKey);
      if (!target) flash(label + ' opened');
    },
    style: { display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'8px', border:'none', background:'transparent', cursor:'pointer', fontSize:'12.5px', color:'#334155' } as CSSProperties }));

  const orgOptions = ['Acme Corporation', 'Acme EU Holdings', 'Personal account'].map(label => ({
    label, current: s.org === label,
    onClick: () => { set({ org: label, orgOpen: false }); flash('Switched to ' + label); },
    lightStyle: { display:'flex', alignItems:'center', gap:'8px', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:'8px', border:'none',
      background: s.org === label ? '#eef2ff' : 'transparent', cursor:'pointer', fontSize:'12.5px', fontWeight: s.org === label ? 600 : 500, color: s.org === label ? '#0f172a' : '#475569' } as CSSProperties }));

  /* ── header / chrome styles ── */
  const titles = TITLES(s.fields.length, isPlat);
  const pageTitle = titles[screen] ? titles[screen][0] : '';
  const pageSub = titles[screen] ? titles[screen][1] : '';

  const logoStyle: CSSProperties = { width:'30px', height:'30px', borderRadius:'9px', background: A, color:'#fff', display:'grid', placeItems:'center', fontSize:'12px', fontWeight:700, letterSpacing:'-.5px' };
  const compliancePillStyle: CSSProperties = { display: s.wide ? 'flex' : 'none', alignItems:'center', gap:'6px', padding:'5px 10px', border:'1px solid #e3e7ee',
    borderRadius:'99px', fontSize:'11.5px', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', flex:'0 0 auto' };
  const openBuilderBtn: CSSProperties = Object.assign({}, btn('#fff', '#475569', '#e3e7ee'), { display: s.wide ? 'inline-flex' : 'none' });
  const primaryBtn: CSSProperties = btn(A, '#fff', A);
  const successBtn: CSSProperties = btn('#059669', '#fff', '#059669');
  const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'13px', lineHeight:1 };
  const orgRowStyle: CSSProperties = { display:'flex', alignItems:'center', gap:'8px', width:'100%', padding:'7px 8px', borderRadius:'9px', border:'1px solid #e3e7ee', background:'#fbfcfd', cursor:'pointer' };
  const orgChipStyle: CSSProperties = { width:'22px', height:'22px', borderRadius:'7px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'9px', fontWeight:700, flex:'0 0 22px' };
  const bellStyle: CSSProperties = { position:'relative', width:'32px', height:'32px', borderRadius:'9px', border:'1px solid #e3e7ee', background: s.notifOpen ? '#eef2ff' : '#fff', cursor:'pointer', color:'#475569', fontSize:'13px' };
  const bellDot: CSSProperties = { position:'absolute', top:'5px', right:'6px', width:'7px', height:'7px', borderRadius:'99px', background:'#f43f5e' };
  const helpStyle: CSSProperties = { width:'32px', height:'32px', borderRadius:'9px', border:'1px solid #e3e7ee', background: s.helpOpen ? '#eef2ff' : '#fff', cursor:'pointer', color:'#475569', fontSize:'13px' };
  const signOutStyle: CSSProperties = { marginLeft:'auto', width:'26px', height:'26px', borderRadius:'8px', border:'1px solid #1e293b', background:'#111c33', color:'#94a3b8', fontSize:'11px', cursor:'pointer', flex:'0 0 26px' };
  const wsTenantStyle: CSSProperties = { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: isPlat ? 500 : 600,
    background: isPlat ? 'transparent' : '#fff', color: isPlat ? '#64748b' : '#0f172a', boxShadow: isPlat ? 'none' : '0 1px 2px rgba(15,23,42,.12)' };
  const wsPlatformStyle: CSSProperties = { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: isPlat ? 600 : 500,
    background: isPlat ? '#fff' : 'transparent', color: isPlat ? '#92400e' : '#64748b', boxShadow: isPlat ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const wsScopeLabel = isPlat ? 'Super admin · all tenants' : 'Acme Corporation · org scope';

  /* ── embedded-session bar ── */
  const embed = s.embedSession;
  const hasEmbed = !!embed;
  const embedBarStyle: CSSProperties = { flex:'0 0 auto', display:'flex', alignItems:'center', gap:'12px', padding:'9px 22px', background:'#eef2ff', borderBottom:'1px solid #c7d2fe' };
  const embedChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background: A, color:'#fff', fontSize:'10px', fontWeight:700, letterSpacing:'.06em', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' };
  const embedTitle = embed ? embed.title : '';
  const embedMeta = embed ? embed.host + ' · session ' + embed.id + ' · external_id ' + embed.externalId : '';
  const embedContacts = embed ? embed.contacts.join(' · ') : '';
  const embedContactsChip: CSSProperties = { padding:'4px 9px', borderRadius:'99px', background:'#fff', border:'1px solid #c7d2fe', fontSize:'10.5px', color:'#3730a3', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', flex:'0 0 auto' };

  /* ── ghost + toast ── */
  const gt = s.dragTool ? sf.meta(s.dragTool) : null;
  const hasGhost = !!(s.dragTool && s.ghost);
  const ghostLabel = gt ? gt.label : '';
  const ghostStyle: CSSProperties = s.ghost ? { position:'fixed', left:(s.ghost.x - (gt ? gt.w : 80) / 2) + 'px', top:(s.ghost.y - (gt ? gt.h : 20) / 2) + 'px',
    width:(gt ? gt.w : 80) + 'px', height:(gt ? gt.h : 20) + 'px', border:'1.5px dashed ' + sf.recip(s.activeRecipient).color,
    background: sf.recip(s.activeRecipient).color + '26', borderRadius:'6px', display:'grid', placeItems:'center',
    fontSize:'11px', fontWeight:600, color:'#0f172a', pointerEvents:'none', zIndex:70 } : {};

  /* ── handlers ── */
  const signOut = async () => { await endSession(); router.replace('/login'); };
  const setTenantWs = () => { set({ menuDoc: null }); switchWorkspace('tenant'); };
  const setPlatformWs = () => { set({ menuDoc: null }); switchWorkspace('platform'); };
  const toggleOrg = () => set({ orgOpen: !s.orgOpen });
  const toggleNotif = () => set({ notifOpen: !s.notifOpen, helpOpen: false });
  const toggleHelp = () => set({ helpOpen: !s.helpOpen, notifOpen: false });
  const openSend = () => set({ modal: 'send' });
  const dismissTrial = () => set({ trialBanner: false });
  const startTrial = () => { router.push('/account/subscription'); flash('Trial upgrade — subscription opened'); };
  const embedReturn = () => { set({ embedSession: null }); go('api'); flash('Returned to ' + s.embedReturnUrl); };
  const embedEnd = () => set({ embedSession: null });

  return (
    <div style={{ display:'flex', height:'100vh', width:'100%', overflow:'hidden', fontFamily:"'Google Sans Flex', 'Helvetica Neue', Arial, sans-serif", color:'#0f172a', background:'#f5f6f8', WebkitFontSmoothing:'antialiased' } as CSSProperties}>

      <aside data-sf-scroll="1" style={{ width:'76px', flex:'0 0 76px', background:'#0f172a', display:'flex', flexDirection:'column', alignItems:'center', padding:'14px 8px', gap:'14px', overflowY:'auto', minHeight:0 }}>
        <div style={logoStyle}>SF</div>
        <nav aria-label="Sections" style={{ display:'flex', flexDirection:'column', gap:'4px', width:'100%' }}>
          {rail.map(r => (
            <Link key={r.id} href={r.href} style={{ ...r.style, textDecoration:'none' }}>
              <span style={r.glyph}>{r.icon}</span>
              <span style={r.labelStyle}>{r.label}</span>
            </Link>
          ))}
        </nav>
        <div style={{ marginTop:'auto', display:'flex', flexDirection:'column', gap:'6px', width:'100%', alignItems:'center' }}>
          <Link href="/account/profile" aria-label="My account" style={{ width:'32px', height:'32px', borderRadius:'99px', background:'#334155', color:'#e2e8f0', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, border:'none', cursor:'pointer', textDecoration:'none' }}>{initials(userName)}</Link>
          <button type="button" onClick={signOut} aria-label="Sign out" style={signOutStyle}>⏎</button>
        </div>
      </aside>

      <aside data-sf-scroll="1" style={{ width:'236px', flex:'0 0 236px', background:'#fff', borderRight:'1px solid #e3e7ee', display:'flex', flexDirection:'column', gap:'14px', padding:'16px 14px', overflowY:'auto', minHeight:0 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <div style={{ display:'flex', gap:'3px', background:'#f1f3f7', padding:'3px', borderRadius:'9px' }}>
            <button type="button" onClick={setTenantWs} style={wsTenantStyle}>Tenant</button>
            {session.isPlatformAdmin ? (
              <button type="button" onClick={setPlatformWs} style={wsPlatformStyle}>Platform</button>
            ) : null}
          </div>
          <button type="button" onClick={toggleOrg} aria-expanded={s.orgOpen} style={orgRowStyle}>
            <span style={orgChipStyle}>AC</span>
            <span style={{ display:'flex', flexDirection:'column', minWidth:0, lineHeight:1.2, textAlign:'left' }}>
              <span style={{ fontSize:'12px', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{orgName}</span>
              <span style={{ fontSize:'10px', color:'#94a3b8' }}>{wsScopeLabel}</span>
            </span>
            <span style={{ marginLeft:'auto', color:'#94a3b8', fontSize:'9px' }}>▾</span>
          </button>
          {s.orgOpen ? (
            <div role="menu" style={{ border:'1px solid #e3e7ee', borderRadius:'11px', padding:'5px', background:'#fff', boxShadow:'0 14px 34px -18px rgba(15,23,42,.3)' }}>
              {orgOptions.map(o => (
                <button key={o.label} type="button" role="menuitem" onClick={o.onClick} style={o.lightStyle}>{o.label}</button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
          <span style={railHead}>{subTitle}</span>
          {subScreens.map((n, i) => (
            <Link key={n.label + i} href={n.href} style={{ ...n.style, textDecoration:'none' }}>
              <span style={n.dot}></span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.label}</span>
              <span style={n.countStyle}>{n.count}</span>
            </Link>
          ))}
        </div>

        {railActive === 'documents' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
              <span style={railHead}>Quick access</span>
              {libTree.map(l => (
                <button key={l.key} type="button" onClick={l.onClick} style={l.style}>
                  <span style={l.dot}></span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.label}</span>
                  <span style={l.countStyle}>{l.count}</span>
                </button>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
              <span style={railHead}>Folders</span>
              {libFolders.map(f => (
                <button key={f.key} type="button" onClick={f.onClick} style={f.style}>
                  <span style={f.glyph}>▤</span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.label}</span>
                  <span style={f.countStyle}>{f.count}</span>
                </button>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
              <span style={railHead}>Shared team folders</span>
              {teamFolders.map(f => (
                <button key={f.key} type="button" onClick={f.onClick} style={f.style}>
                  <span style={{ color:'#94a3b8', fontSize:'11px' }}>▸</span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.label}</span>
                  <span style={f.countStyle}>{f.count}</span>
                </button>
              ))}
              <button type="button" onClick={newFolder} style={linkBtn(A)}>+ Create team</button>
            </div>
          </div>
        ) : null}

        {railActive === 'reports' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
            <span style={railHead}>Dashboards</span>
            {reportNav.map(n => (
              <button key={n.key} type="button" onClick={n.onClick} style={n.style}>
                <span style={n.dot}></span><span>{n.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {railActive === 'developer' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
            <span style={railHead}>Developer tools</span>
            {apiSideNav.map(n => (
              <button key={n.key} type="button" onClick={n.onClick} style={n.style}>
                <span style={n.dot}></span><span>{n.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {railActive === 'platform' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
            <span style={railHead}>Admin sections</span>
            {platformSideNav.map(n => (
              <button key={n.key} type="button" onClick={n.onClick} style={n.style}>
                <span style={n.dot}></span><span>{n.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop:'auto', display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
          <div style={{ border:'1px solid #eef1f6', borderRadius:'11px', padding:'11px', background:'#fbfcfd' }}>
            <div style={{ fontSize:'10px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", letterSpacing:'.04em' }}>ENVELOPE QUOTA</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:'6px', marginTop:'5px' }}>
              <span style={{ color:'#0f172a', fontSize:'17px', fontWeight:700 }}>418</span>
              <span style={{ color:'#94a3b8', fontSize:'11px' }}>/ 1,000</span>
            </div>
            <div style={{ height:'4px', borderRadius:'99px', background:'#eef1f6', marginTop:'8px', overflow:'hidden' }}>
              <div style={{ width:'42%', height:'100%', background:'#10b981', borderRadius:'99px' }}></div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <span style={{ width:'26px', height:'26px', borderRadius:'99px', background:'#eef1f6', color:'#475569', display:'grid', placeItems:'center', fontSize:'10px', fontWeight:700, flex:'0 0 26px' }}>{initials(userName)}</span>
            <div style={{ display:'flex', flexDirection:'column', lineHeight:1.25, minWidth:0 }}>
              <span style={{ color:'#0f172a', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userName}</span>
              <span style={{ color:'#94a3b8', fontSize:'10.5px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userRole}</span>
            </div>
            <Link href="/account/profile" aria-label="Account settings" style={{ ...iconBtn, display:'grid', placeItems:'center', textDecoration:'none' }}>⚙</Link>
          </div>
        </div>
      </aside>

      <main style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>

        <header style={{ height:'60px', flex:'0 0 60px', borderBottom:'1px solid #e3e7ee', background:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 22px', gap:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px', flex:'1 1 220px', minWidth:'180px' }}>
            <h1 style={{ margin:0, fontSize:'15px', fontWeight:600, letterSpacing:'-0.2px', whiteSpace:'nowrap', flex:'0 0 auto' }}>{pageTitle}</h1>
            <span style={{ width:'1px', height:'18px', background:'#e3e7ee', flex:'0 0 1px' }}></span>
            <span style={{ fontSize:'12.5px', color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:'1 1 auto', minWidth:0 }}>{pageSub}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:'0 1 auto', minWidth:0, justifyContent:'flex-end' }}>
            <div style={compliancePillStyle}>
              <span style={{ width:'7px', height:'7px', borderRadius:'99px', background:'#10b981' }}></span>SOC 2 · 21 CFR 11
            </div>
            <Link href={href('builder')} style={{ ...openBuilderBtn, textDecoration:'none' }}>Open builder</Link>
            <button type="button" onClick={openSend} style={primaryBtn}>Send for signature</button>
            <div style={{ position:'relative', display:'flex', gap:'6px', alignItems:'center' }}>
              <button type="button" aria-label="Notifications" aria-expanded={s.notifOpen} onClick={toggleNotif} style={bellStyle}>◔<span style={bellDot}></span></button>
              <button type="button" aria-label="Help" aria-expanded={s.helpOpen} onClick={toggleHelp} style={helpStyle}>?</button>
              {s.notifOpen ? (
                <div role="menu" style={{ position:'absolute', right:0, top:'40px', width:'330px', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'13px', boxShadow:'0 22px 50px -20px rgba(15,23,42,.4)', padding:'8px', zIndex:40, animation:'sfIn .12s ease' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 8px 8px' }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600 }}>Notifications</span>
                    <span style={{ fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{String(notifications.length)} new</span>
                  </div>
                  {notifications.map((n, i) => (
                    <div key={i} style={{ display:'flex', gap:'9px', alignItems:'flex-start', padding:'8px', borderTop:'1px solid #f2f4f8' }}>
                      <span style={n.dot}></span>
                      <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                        <span style={{ fontSize:'12px', color:'#0f172a', lineHeight:1.45 }}>{n.label}</span>
                        <span style={{ fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{n.ts}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
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

        {s.trialBanner ? (
          <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'12px', padding:'9px 22px', background:'#ecfdf5', borderBottom:'1px solid #a7f3d0' }}>
            <span style={{ fontSize:'12.5px', color:'#065f46', lineHeight:1.5, minWidth:0 }}>Your Business trial ends in 6 days — upgrade to keep unlimited envelopes, parallel routing and API access.</span>
            <div style={{ marginLeft:'auto', display:'flex', gap:'7px', flex:'0 0 auto' }}>
              <button type="button" onClick={startTrial} style={successBtn}>Upgrade plan</button>
              <button type="button" aria-label="Dismiss" onClick={dismissTrial} style={iconBtn}>✕</button>
            </div>
          </div>
        ) : null}

        {hasEmbed ? (
          <div style={embedBarStyle}>
            <span style={embedChip}>EMBEDDED</span>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
              <span style={{ fontSize:'12.5px', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{embedTitle}</span>
              <span style={{ fontSize:'11px', color:'#475569', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{embedMeta}</span>
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
        <div role="status" style={{ position:'fixed', bottom:'20px', left:'50%', transform:'translateX(-50%)', zIndex:90, background:'#0f172a', color:'#f1f5f9', padding:'11px 16px', borderRadius:'11px', fontSize:'12.5px', boxShadow:'0 18px 40px -18px rgba(15,23,42,.6)', animation:'sfIn .16s ease' }}>{s.toast}</div>
      ) : null}
    </div>
  );
}
