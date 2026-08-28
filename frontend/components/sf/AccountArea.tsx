'use client';

/* SignForge — ACCOUNT AREA (template 2633–2926) ported verbatim from the prototype. */

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import {
  ACCOUNT_NAV, ACCOUNT_TITLES, AUDIT, CLOUD_TARGETS, DEVICES, INTEGRATIONS,
  INVITE_DEFAULTS, NOTIF_PREFS, ORGS, TEAMS,
} from '@/lib/sf/data';
import {
  btn, pill, inputStyle, lbl as lblStyle, railHead,
  TONE_GOOD, TONE_INDIGO, TONE_MUTED,
} from '@/lib/sf/ui';

const PLAN_USAGE: [string, string, number][] = [
  ['API requests', '4.1M of 10M', 41], ['Envelopes', '18,430 of 25,000', 74],
  ['Embed sessions', '642 of 2,000', 32], ['Webhook deliveries', '96k of 250k', 38],
  ['Storage', '1.16 TB of 2 TB', 58],
];

export default function AccountArea() {
  const { s, set, flash, accent, initials } = useSF();
  if (!s.accountOpen) return null;

  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const closeAccountBtn: CSSProperties = { ...btn('#fff', '#475569', '#e3e7ee'), marginLeft:'auto', width:'32px', justifyContent:'center', padding:'0' };
  const autoGhostBtn: CSSProperties = { ...btn('#fff', '#475569', '#e3e7ee'), marginLeft:'auto', flex:'0 0 auto' };
  const autoDangerBtn: CSSProperties = { ...btn('#fff', '#b91c1c', '#fecaca'), marginLeft:'auto', flex:'0 0 auto' };
  const mono: CSSProperties = { ...inputStyle, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' };

  const userName = s.user.name;
  const userRole = s.user.role;
  const userInitials = initials(s.user.name);

  const closeAccount = () => set({ accountOpen: false });
  const addEmail = () => flash('Verification sent to the new address');
  const toggle2fa = () => flash('Two-factor authentication is enforced by your organisation');
  const manageNotifications = () => set({ accountSection: 'notifications' });
  const goBilling = () => set({ workspace: 'tenant', screen: 'billing' });
  const openPlanChange = () => set({ modal: 'plan' });

  const accountNav = ACCOUNT_NAV.map(([id, label]) => {
    const on = s.accountSection === id;
    return {
      id, label,
      onClick: () => set({ accountSection: id }),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'9px 11px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' } as CSSProperties,
    };
  });

  const accountTitle = ACCOUNT_TITLES[s.accountSection][0];
  const accountSub = ACCOUNT_TITLES[s.accountSection][1];

  const acProfile = s.accountSection === 'profile';
  const acSubscription = s.accountSection === 'subscription';
  const acSecurity = s.accountSection === 'security';
  const acPayment = s.accountSection === 'payment';
  const acNotifications = s.accountSection === 'notifications';
  const acEmail = s.accountSection === 'email';
  const acIntegrations = s.accountSection === 'integrations';
  const acCloud = s.accountSection === 'cloud';
  const acTeams = s.accountSection === 'teams';
  const acOrgs = s.accountSection === 'orgs';
  const acAudit = s.accountSection === 'audit';

  const devices = DEVICES.map(([label, when, ip, geo]) => ({
    label, meta: when + ' · ' + ip + ' · ' + geo,
    onRemove: () => flash(label + ' signed out and removed'),
  }));

  const notifPrefs = NOTIF_PREFS.map(([label, on]) => ({
    label, on: on ? 'true' : 'false',
    onToggle: () => flash(label + ' notifications ' + (on ? 'off' : 'on')),
    switchStyle: { width:'34px', height:'19px', borderRadius:'99px', background: on ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 34px', border:'none', cursor:'pointer' } as CSSProperties,
    knob: { position:'absolute', top:'2px', left: on ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' } as CSSProperties,
  }));

  const integrations = INTEGRATIONS.map(([label, meta, on]) => ({
    label, meta,
    ctaLabel: on ? 'Manage' : 'Connect',
    onClick: () => flash(label + (on ? ' settings opened' : ' connection started')),
    ctaStyle: on ? btn('#fff', '#475569', '#e3e7ee') : btn(A, '#fff', A),
    pill: pill(on ? TONE_GOOD : TONE_MUTED),
    pillLabel: on ? 'Active' : 'Available',
  }));

  const teams = TEAMS.map(([label, meta, role]) => ({ label, meta, role, pill: pill(TONE_INDIGO) }));
  const orgs = ORGS.map(([label, meta, role]) => ({ label, meta, role, pill: pill(TONE_GOOD) }));
  const inviteDefaults = INVITE_DEFAULTS.map(([k, v]) => ({ k, v, onChange: () => flash(k + ' updated') }));
  const cloudTargets = CLOUD_TARGETS.map(([label, path, on]) => ({
    label, path,
    pill: pill(on ? TONE_GOOD : TONE_MUTED),
    pillLabel: on ? 'Exporting' : 'Off',
    onClick: () => flash(label + (on ? ' export settings' : ' setup started')),
  }));

  const planUsage = PLAN_USAGE.map(([label, meta, pct]) => ({
    label, meta,
    bar: { width: pct + '%', height:'100%', borderRadius:'99px', background: pct > 85 ? '#f59e0b' : A } as CSSProperties,
  }));

  const audit = AUDIT.map((a, i) => ({
    action: a.action, actor: a.actor, meta: a.meta, checksum: a.checksum, time: a.time,
    rowStyle: { display:'flex', justifyContent:'space-between', gap:'14px', padding:'13px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
    dot: { width:'9px', height:'9px', borderRadius:'99px', marginTop:'5px', flex:'0 0 9px',
      background: a.kind === 'good' ? '#10b981' : a.kind === 'info' ? A : '#cbd5e1' } as CSSProperties,
    actorStyle: { fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#64748b', background:'#f5f6f8', border:'1px solid #e3e7ee', borderRadius:'6px', padding:'2px 6px' } as CSSProperties,
  }));

  return (
    <div data-screen-label="My account" style={{ position:'fixed', inset:0, zIndex:90, background:'#f5f6f8', display:'flex', flexDirection:'column' }}>
      <header style={{ height:'56px', flex:'0 0 56px', background:'#fff', borderBottom:'1px solid #e3e7ee', display:'flex', alignItems:'center', gap:'12px', padding:'0 20px' }}>
        <span style={{ fontSize:'14px', fontWeight:700, letterSpacing:'-.2px' }}>My Account</span>
        <span style={{ width:'1px', height:'18px', background:'#e3e7ee' }}></span>
        <span style={{ fontSize:'12px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{userRole} · {s.org}</span>
        <button type="button" aria-label="Close account" onClick={closeAccount} style={closeAccountBtn}>✕</button>
      </header>
      <div style={{ flex:1, minHeight:0, display:'flex' }}>
        <div data-sf-scroll="1" style={{ width:'246px', flex:'0 0 246px', background:'#fff', borderRight:'1px solid #e3e7ee', padding:'14px', display:'flex', flexDirection:'column', gap:'3px', overflow:'auto' }}>
          {accountNav.map(n => (
            <button key={n.id} type="button" onClick={n.onClick} style={n.style}>
              <span style={n.dot}></span><span>{n.label}</span>
            </button>
          ))}
        </div>

        <div data-sf-scroll="1" style={{ flex:1, minWidth:0, overflow:'auto', padding:'24px 26px 44px' }}>
          <div style={{ maxWidth:'760px', display:'flex', flexDirection:'column', gap:'18px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <h2 style={{ margin:0, fontSize:'21px', fontWeight:700, letterSpacing:'-.5px' }}>{accountTitle}</h2>
              <span style={{ fontSize:'12.5px', color:'#64748b', lineHeight:1.5 }}>{accountSub}</span>
            </div>

            {acProfile ? (
              <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
                  <span style={{ width:'56px', height:'56px', borderRadius:'99px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'18px', fontWeight:700, flex:'0 0 56px' }}>{userInitials}</span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'15px', fontWeight:700 }}>{userName}</span>
                    <span style={{ fontSize:'12px', color:'#64748b' }}>{userRole}</span>
                  </div>
                  <button type="button" onClick={addEmail} style={autoGhostBtn}>Change photo</button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'11px' }}>
                  <label style={lblStyle}>Full name<input type="text" defaultValue={userName} style={inputStyle} /></label>
                  <label style={lblStyle}>Job title<input type="text" defaultValue="Legal Operations Lead" style={inputStyle} /></label>
                  <label style={lblStyle}>Time zone<input type="text" defaultValue="America/Los_Angeles" style={mono} /></label>
                  <label style={lblStyle}>Language<input type="text" defaultValue="English (US)" style={inputStyle} /></label>
                </div>
                <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'13px', display:'flex', alignItems:'center', gap:'14px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600 }}>Default signature</span>
                    <span style={{ fontSize:'11.5px', color:'#64748b' }}>Adopted 12 Aug 2026 · passkey-bound</span>
                  </div>
                  <span style={{ fontFamily:"'Caveat', cursive", fontSize:'26px', marginLeft:'auto' }}>{userName}</span>
                </div>
              </div>
            ) : null}

            {acSubscription ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                    <span style={{ fontSize:'19px', fontWeight:700, letterSpacing:'-.4px' }}>Enterprise</span>
                    <span style={{ fontSize:'12px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>1,240 seats · $44 / seat / mo · renews 1 Sep 2026</span>
                  </div>
                  <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
                    <button type="button" onClick={goBilling} style={ghostBtn}>Billing &amp; invoices</button>
                    <button type="button" onClick={openPlanChange} style={primaryBtn}>Change plan</button>
                  </div>
                </div>
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'10px' }}>
                  <span style={railHead}>Plan usage this cycle</span>
                  {planUsage.map(u => (
                    <div key={u.label} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                      <span style={{ width:'160px', fontSize:'12.5px', color:'#334155', flex:'0 0 160px' }}>{u.label}</span>
                      <div style={{ flex:1, height:'6px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={u.bar}></div></div>
                      <span style={{ width:'150px', textAlign:'right', fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 150px' }}>{u.meta}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {acSecurity ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'13px' }}>
                  <span style={railHead}>Login and security</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingBottom:'12px', borderBottom:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}><span style={{ fontSize:'12px', color:'#64748b' }}>Email</span><span style={{ fontSize:'13px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>priya@acme.io</span></div>
                    <button type="button" onClick={addEmail} style={autoGhostBtn}>Change</button>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingBottom:'12px', borderBottom:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}><span style={{ fontSize:'12px', color:'#64748b' }}>Password</span><span style={{ fontSize:'13px' }}>••••••••</span></div>
                    <button type="button" onClick={addEmail} style={autoGhostBtn}>Change</button>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', maxWidth:'460px' }}>
                      <span style={{ fontSize:'13px', fontWeight:600 }}>Two-factor authentication</span>
                      <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.55 }}>Each time you sign in from a new device or network you must enter a verification code in addition to your password.</span>
                    </div>
                    <button type="button" role="switch" aria-checked={true} onClick={toggle2fa} style={{ marginLeft:'auto', width:'38px', height:'21px', borderRadius:'99px', background:'#10b981', border:'none', position:'relative', cursor:'pointer', flex:'0 0 38px' }}>
                      <span style={{ position:'absolute', top:'3px', left:'20px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' }}></span>
                    </button>
                  </div>
                </div>

                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'11px' }}>
                  <span style={railHead}>Authenticated devices and browsers</span>
                  {devices.map(d => (
                    <div key={d.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'9px 0', borderTop:'1px solid #f2f4f8' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                        <span style={{ fontSize:'12.5px', fontWeight:600 }}>{d.label}</span>
                        <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{d.meta}</span>
                      </div>
                      <button type="button" onClick={d.onRemove} style={autoDangerBtn}>Remove</button>
                    </div>
                  ))}
                </div>

                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'11px' }}>
                  <span style={railHead}>Default invite settings</span>
                  {inviteDefaults.map(i => (
                    <div key={i.k} style={{ display:'flex', alignItems:'flex-start', gap:'12px', padding:'9px 0', borderTop:'1px solid #f2f4f8' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                        <span style={{ fontSize:'12.5px', fontWeight:600 }}>{i.k}</span>
                        <span style={{ fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-word' }}>{i.v}</span>
                      </div>
                      <button type="button" onClick={i.onChange} style={autoGhostBtn}>Change</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {acPayment ? (
              <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'13px' }}>
                <span style={railHead}>Collect payments on signature</span>
                <span style={{ fontSize:'12.5px', color:'#475569', lineHeight:1.6, maxWidth:'520px' }}>Attach a payment request to any envelope. Signers pay by card, ACH or SEPA at the moment they sign, and the charge is recorded in the audit trail alongside the signature.</span>
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd' }}>
                  <span style={{ width:'46px', height:'30px', borderRadius:'7px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'9.5px', fontWeight:700, flex:'0 0 46px' }}>STRIPE</span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600 }}>Stripe · acct_1QhT7xKz</span>
                    <span style={{ fontSize:'11px', color:'#64748b' }}>Connected · payouts daily to Chase •••• 3391</span>
                  </div>
                  <button type="button" onClick={goBilling} style={autoGhostBtn}>Manage</button>
                </div>
              </div>
            ) : null}

            {acNotifications ? (
              <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'11px' }}>
                <span style={railHead}>Notify me when</span>
                {notifPrefs.map(p => (
                  <div key={p.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
                    <span style={{ fontSize:'12.5px', color:'#334155' }}>{p.label}</span>
                    <button type="button" role="switch" aria-checked={p.on === 'true'} aria-label={p.label} onClick={p.onToggle} style={p.switchStyle}><span style={p.knob}></span></button>
                  </div>
                ))}
              </div>
            ) : null}

            {acEmail ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'13.5px', fontWeight:600 }}>Account email</span>
                    <span style={{ fontSize:'11.5px', color:'#64748b' }}>Notification preferences for the account owner</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'12.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>priya@acme.io</span>
                    <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'10px' }}>
                      <button type="button" role="switch" aria-checked={true} onClick={manageNotifications} style={{ width:'34px', height:'19px', borderRadius:'99px', background:'#10b981', border:'none', position:'relative', cursor:'pointer', flex:'0 0 34px' }}>
                        <span style={{ position:'absolute', top:'2px', left:'17px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' }}></span>
                      </button>
                      <button type="button" onClick={manageNotifications} style={ghostBtn}>Manage notifications</button>
                    </div>
                  </div>
                </div>
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                      <span style={{ fontSize:'13.5px', fontWeight:600 }}>Additional emails</span>
                      <span style={{ fontSize:'11.5px', color:'#64748b', maxWidth:'420px', lineHeight:1.5 }}>Add addresses that receive specific event notifications — accounts payable for invoices, legal ops for completions.</span>
                    </div>
                    <button type="button" onClick={addEmail} style={autoGhostBtn}>+ Add emails</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px 11px', border:'1px solid #eef1f6', borderRadius:'11px' }}>
                      <span style={{ fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>ap@acme.io</span>
                      <span style={{ fontSize:'11px', color:'#64748b' }}>invoices, payment failures</span>
                      <button type="button" onClick={addEmail} style={autoGhostBtn}>Edit</button>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px 11px', border:'1px solid #eef1f6', borderRadius:'11px' }}>
                      <span style={{ fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>legalops@acme.io</span>
                      <span style={{ fontSize:'11px', color:'#64748b' }}>envelope completed, declined</span>
                      <button type="button" onClick={addEmail} style={autoGhostBtn}>Edit</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {acIntegrations ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {integrations.map(i => (
                  <div key={i.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px', display:'flex', alignItems:'center', gap:'12px' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'13px', fontWeight:600 }}>{i.label}</span>
                        <span style={i.pill}>{i.pillLabel}</span>
                      </div>
                      <span style={{ fontSize:'11.5px', color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.meta}</span>
                    </div>
                    <button type="button" onClick={i.onClick} style={i.ctaStyle}>{i.ctaLabel}</button>
                  </div>
                ))}
              </div>
            ) : null}

            {acCloud ? (
              <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'11px' }}>
                <span style={railHead}>Automatic export of completed documents</span>
                {cloudTargets.map(c => (
                  <div key={c.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 0', borderTop:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'12.5px', fontWeight:600 }}>{c.label}</span>
                        <span style={c.pill}>{c.pillLabel}</span>
                      </div>
                      <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{c.path}</span>
                    </div>
                    <button type="button" onClick={c.onClick} style={autoGhostBtn}>Configure</button>
                  </div>
                ))}
              </div>
            ) : null}

            {acTeams ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {teams.map(t => (
                  <div key={t.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'13.5px', fontWeight:600 }}>{t.label}</span>
                        <span style={t.pill}>{t.role}</span>
                      </div>
                      <span style={{ fontSize:'11.5px', color:'#64748b' }}>{t.meta}</span>
                    </div>
                    <div style={{ marginLeft:'auto', display:'flex', gap:'7px' }}>
                      <button type="button" onClick={addEmail} style={ghostBtn}>Members</button>
                      <button type="button" onClick={addEmail} style={ghostBtn}>Shared folders</button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addEmail} style={primaryBtn}>+ Create team</button>
              </div>
            ) : null}

            {acOrgs ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {orgs.map(o => (
                  <div key={o.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'13.5px', fontWeight:600 }}>{o.label}</span>
                        <span style={o.pill}>{o.role}</span>
                      </div>
                      <span style={{ fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{o.meta}</span>
                    </div>
                    <button type="button" onClick={addEmail} style={autoGhostBtn}>Open</button>
                  </div>
                ))}
              </div>
            ) : null}

            {acAudit ? (
              <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
                {audit.map((a, i) => (
                  <div key={i} style={a.rowStyle}>
                    <div style={{ display:'flex', gap:'11px', alignItems:'flex-start' }}>
                      <span style={a.dot}></span>
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                          <span style={{ fontSize:'13px', fontWeight:600 }}>{a.action}</span>
                          <span style={a.actorStyle}>{a.actor}</span>
                        </div>
                        <div style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", lineHeight:1.7, wordBreak:'break-all' }}>{a.meta}</div>
                      </div>
                    </div>
                    <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap' }}>{a.time}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
