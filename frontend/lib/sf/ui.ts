/* SignForge shared style atoms — ported verbatim from the prototype app.js. */
import type { CSSProperties } from 'react';
import type { Tone } from './data';

/* ── style atoms (Component.btn / Component.pill) ── */
export function btn(bg: string, fg: string, bd: string): CSSProperties {
  return { height:'32px', padding:'0 13px', borderRadius:'9px', border:'1px solid ' + bd, background:bg, color:fg,
    fontSize:'12.5px', fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:'6px', whiteSpace:'nowrap' };
}
export function pill(s: Tone): CSSProperties {
  return { display:'inline-flex', alignItems:'center', gap:'6px', padding:'4px 9px', borderRadius:'99px',
    background:s.bg, color:s.fg, border:'1px solid ' + s.bd, fontSize:'11.5px', fontWeight:600, whiteSpace:'nowrap' };
}

/* ── shared inline styles from renderVals() ── */
export const inputStyle: CSSProperties = { height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'12.5px', background:'#fff', outline:'none', width:'100%', color:'#0f172a' };
export const lbl: CSSProperties = { display:'flex', flexDirection:'column', gap:'5px', fontSize:'11px', letterSpacing:'.04em', textTransform:'uppercase', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
export const railHead: CSSProperties = { fontSize:'11px', letterSpacing:'.08em', textTransform:'uppercase', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontWeight:500 };

export const authInput: CSSProperties = { height:'38px', border:'1px solid #dfe4ec', borderRadius:'10px', padding:'0 12px', fontSize:'13px', background:'#fbfcfd', outline:'none', width:'100%', color:'#0f172a' };
export function authPrimary(A: string): CSSProperties {
  return { height:'40px', width:'100%', borderRadius:'10px', border:'1px solid ' + A, background: A, color:'#fff', fontSize:'13.5px', fontWeight:600, cursor:'pointer' };
}
export function linkBtn(A: string): CSSProperties {
  return { background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'12px', color: A, fontWeight:500 };
}

export const jsonBoxStyle: CSSProperties = { margin:0, padding:'12px 13px', borderRadius:'11px', background:'#0f172a', color:'#a5b4fc',
  fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11px', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-all', overflow:'auto', maxHeight:'260px' };

/* recurring card / panel / table atoms */
export const cardStyle: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' };
export const panelStyle: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' };
export const monoStyle: CSSProperties = { fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
export const rowDivider: CSSProperties = { borderTop:'1px solid #eef1f6' };
export const rowDividerLight: CSSProperties = { borderTop:'1px solid #f2f4f8' };
export const selectStyle: CSSProperties = { height:'30px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'12px', background:'#fff', color:'#334155', outline:'none' };

/* tab-strip button (the recurring "segmented control" item) */
export function tabBtn(on: boolean, height = '30px', padding = '0 13px', fontSize = '12.5px'): CSSProperties {
  return { height, padding, borderRadius:'8px', border:'none', cursor:'pointer', fontSize, fontWeight: on ? 600 : 500,
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
}
/* toggle switch + knob (feature flags, security, notification prefs) */
export function switchStyle(on: boolean): CSSProperties {
  return { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: on ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 38px' };
}
export function knobStyle(on: boolean): CSSProperties {
  return { position:'absolute', top:'3px', left: on ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' };
}
/* small round dot used in timelines / nav / status lists */
export function dotStyle(color: string, size = '8px'): CSSProperties {
  return { width:size, height:size, borderRadius:'99px', background:color, flex:'0 0 ' + size };
}

/* ── titles map from renderVals() ── */
export function TITLES(fieldCount: number, isPlat: boolean): { [k: string]: [string, string] } {
  return {
      dashboard: ['Documents', 'All envelopes across your workspace · live status sync'],
      builder: ['Prepare document', 'Master Services Agreement — Acme Corp · ' + fieldCount + ' fields · autosaved'],
      routing: ['Workflow & routing', 'Signing order, roles, reminders and expiration'],
      sign: ['Signer experience', 'Alex Rivera · alex.rivera@acme.io · guided signing session'],
      platform: ['Tenants, roles & flags', 'Super admin console · organisations, directory, feature flags, security posture'],
      tenantHome: ['Acme Corporation', 'Tenant admin overview · envelopes, seats, spend and attention items'],
      platformHome: ['Platform overview', 'Super admin dashboard · revenue, tenants, dunning and service health'],
      billing: ['Billing & plan', 'Stripe subscription, payment methods and upcoming invoice'],
      revenue: ['Revenue & Stripe', 'MRR, balance, payouts, subscriptions and webhook delivery'],
      invoices: [isPlat ? 'Invoices · all tenants' : 'Invoices & receipts', isPlat ? 'Every issued invoice, payment intent and dunning state' : 'Acme Corporation · issued invoices and receipts'],
      reports: ['Reports', 'Analytics and exports across documents, templates and recipients'],
      contacts: ['Contacts', 'Address book · signers, approvers and CC recipients, synced from CRM, SCIM and API'],
      sandbox: ['API sandbox', 'Compose a request against test data and inspect the live response'],
      guides: ['Guides & documentation', 'Quickstart, reference, embedding, webhooks, SDKs and migration'],
      api: ['Developer API & add-on', 'Keys, endpoints for users / contacts / documents, embed sessions and scopes'],
      support: [isPlat ? 'Support queue' : 'Support', isPlat ? 'All tenant tickets · SLA, priority, assignment and internal notes' : 'Acme Corporation · your tickets and conversations with support'],
      logs: [isPlat ? 'Platform logs' : 'Activity logs', isPlat ? 'API, webhook, auth, billing and admin events across tenants' : 'Acme Corporation · API, webhook, auth and signing events'],
      audit: ['Audit trail & certificate', 'ENV-2291-KD · tamper-evident event log']
  };
}

/* ── sub-sidebar titles keyed by rail section ── */
export function subTitleFor(railActive: string, isPlat: boolean): string {
  return ({ documents:'Documents', contacts:'Contacts', reports:'Reports', billing: isPlat ? 'Revenue' : 'Billing', developer:'Developer', support:'Support', platform:'Platform admin' } as { [k: string]: string })[railActive];
}

/* ── status → colour maps (re-exported from data for convenience) ── */
export { STATUS, STATUS_TONE, PLAN_TONE, INV_STATUS_TONE, INV_STATUS_LABEL, LEVEL_TONE, SRC_TONE, TK_STATUS_TONE, TK_STATUS_LABEL, TK_PRIO_TONE, TK_PRIO_LABEL, FLAG_ENV_TONE } from './data';

export const TONE_GOOD: Tone = { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' };
export const TONE_INFO: Tone = { bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' };
export const TONE_INDIGO: Tone = { bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' };
export const TONE_WARN: Tone = { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' };
export const TONE_BAD: Tone = { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' };
export const TONE_NEUTRAL: Tone = { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' };
export const TONE_MUTED: Tone = { bg:'#f5f6f8', fg:'#64748b', bd:'#e3e7ee' };
export const TONE_AMBER: Tone = { bg:'#fef3c7', fg:'#92400e', bd:'#fde68a' };
