/* SignerPro shared style atoms — ported from the prototype app.js.
 *
 * Two accessibility rules hold here, and `lib/sf/ui.a11y.test.ts` enforces them:
 *
 *  1. `outline: 'none'` may stay on these atoms — `app/globals.css` restores a
 *     `:focus-visible` ring for every focusable element with `!important`, so
 *     the pointer-focus noise the prototype was suppressing stays suppressed
 *     while keyboard focus is always visible (WCAG 2.4.7).
 *  2. Text colours must reach 4.5:1 against the surface they sit on, and
 *     control/line colours 3:1 (WCAG 1.4.3 / 1.4.11). The prototype's
 *     `#94a3b8` (2.6:1 on white) is not used here; `TEXT_MUTED` replaces it.
 */
import type { CSSProperties } from 'react';
import type { Tone } from './data';

/* ── accessible text tokens (mirror app/tokens.css) ──────────────────────
 * Every screen uses these instead of the prototype's `#94a3b8` / `#a5b0c0`
 * literals: same visual weight, AA-compliant. `test/a11y-tokens.test.ts`
 * asserts the raw literals are gone from screen source so this cannot regress.
 */
/** Primary body text — #0f172a, 16.8:1 on white. */
export const TEXT_DEFAULT = '#0f172a';
/** Secondary/meta text — #5b6675, 5.6:1 on white. Replaces `#94a3b8`. */
export const TEXT_MUTED = '#5b6675';
/** Tertiary text that must still be readable — #4a5462, 7.7:1 on white. */
export const TEXT_SUBTLE = '#4a5462';
/** Lines and control tracks — #8492a6, 3.4:1 on white (WCAG 1.4.11). */
export const BORDER_STRONG = '#8492a6';
/** The focus ring colour `globals.css` paints; exported for canvas drawing. */
export const FOCUS_RING = '#4f46e5';

/* ── dark-surface text ──────────────────────────────────────────────────
 * The app has a handful of deliberately dark panels (`#0f172a` rails, banners,
 * the log table, the auth hero). Secondary text there needs the *opposite*
 * correction: the light-surface tokens above would be unreadable on them.
 * These are measured against `#0f172a`, and against the `#111c33` chips that
 * sit inside those panels.
 */
/** Secondary text on a dark panel — 7.1:1 on #0f172a, 6.7:1 on #111c33. */
export const TEXT_MUTED_ON_DARK = '#98a4b6';
/** Body text on a dark panel — 12:1 on #0f172a. */
export const TEXT_ON_DARK = '#cad4e0';

/* ── style atoms (Component.btn / Component.pill) ── */
export function btn(bg: string, fg: string, bd: string): CSSProperties {
  return { height:'32px', padding:'0 13px', borderRadius:'9px', border:'1px solid ' + bd, background:bg, color:fg,
    fontSize:'.78125rem', fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:'6px', whiteSpace:'nowrap' };
}
export function pill(s: Tone): CSSProperties {
  return { display:'inline-flex', alignItems:'center', gap:'6px', padding:'4px 9px', borderRadius:'99px',
    background:s.bg, color:s.fg, border:'1px solid ' + s.bd, fontSize:'.71875rem', fontWeight:600, whiteSpace:'nowrap' };
}

/* ── shared inline styles from renderVals() ── */
export const inputStyle: CSSProperties = { height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'.78125rem', background:'#fff', outline:'none', width:'100%', color:'#0f172a' };
export const lbl: CSSProperties = { display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'#64748b', fontFamily:'var(--font-sans)' };
export const railHead: CSSProperties = { fontSize:'.6875rem', letterSpacing:'.08em', textTransform:'uppercase', color:'#64748b', fontFamily:'var(--font-sans)', fontWeight:500 };

export const authInput: CSSProperties = { height:'40px', border:'1px solid #dfe4ec', borderRadius:'10px', padding:'0 12px', fontSize:'.8125rem', background:'#fbfcfd', outline:'none', width:'100%', color:'#0f172a' };
export function authPrimary(A: string): CSSProperties {
  return { height:'44px', width:'100%', borderRadius:'10px', border:'1px solid ' + A, background: A, color:'#fff', fontSize:'.84375rem', fontWeight:600, cursor:'pointer',
    display:'inline-flex', alignItems:'center', justifyContent:'center', gap:'7px' };
}
export function linkBtn(A: string): CSSProperties {
  return { background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'.75rem', color: A, fontWeight:500,
    display:'inline-flex', alignItems:'center', gap:'5px' };
}

export const jsonBoxStyle: CSSProperties = { margin:0, padding:'12px 13px', borderRadius:'11px', background:'#0f172a', color:'#a5b4fc',
  fontFamily:'var(--font-sans)', fontSize:'.6875rem', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-all', overflow:'auto', maxHeight:'260px' };

/* recurring card / panel / table atoms */
export const cardStyle: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' };
export const panelStyle: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' };
export const monoStyle: CSSProperties = { fontFamily:'var(--font-sans)' };
export const rowDivider: CSSProperties = { borderTop:'1px solid #eef1f6' };
export const rowDividerLight: CSSProperties = { borderTop:'1px solid #f2f4f8' };
export const selectStyle: CSSProperties = { height:'30px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'.75rem', background:'#fff', color:'#334155', outline:'none' };

/* tab-strip button (the recurring "segmented control" item) */
export function tabBtn(on: boolean, height = '30px', padding = '0 13px', fontSize = '.78125rem'): CSSProperties {
  return { height, padding, borderRadius:'8px', border:'none', cursor:'pointer', fontSize, fontWeight: on ? 600 : 500,
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
}
/* toggle switch + knob (feature flags, security, notification prefs) */
export function switchStyle(on: boolean): CSSProperties {
  return { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: on ? '#10b981' : BORDER_STRONG, position:'relative', flex:'0 0 38px' };
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
      builder: ['Prepare document', fieldCount + ' fields · autosaved'],
      routing: ['Workflow & routing', 'Signing order, roles, reminders and expiration'],
      sign: ['Signer experience', 'Guided signing session'],
      platform: ['Tenants, roles & flags', 'Super admin console · organisations, directory, feature flags, security posture'],
      tenantHome: ['Overview', 'Tenant admin overview · envelopes, seats, spend and attention items'],
      platformHome: ['Platform overview', 'Super admin dashboard · revenue, tenants, dunning and service health'],
      billing: ['Billing & plan', 'Subscription, payment methods and upcoming invoice'],
      revenue: ['Revenue', 'MRR, balance, subscriptions and provider webhook delivery'],
      invoices: [isPlat ? 'Invoices · all tenants' : 'Invoices & receipts', isPlat ? 'Every issued invoice, payment intent and dunning state' : 'Issued invoices and receipts'],
      reports: ['Reports', 'Analytics and exports across documents, templates and recipients'],
      contacts: ['Contacts', 'Address book · signers, approvers and CC recipients, synced from CRM, SCIM and API'],
      sandbox: ['API console', 'Compose a request against your live workspace and inspect the response'],
      guides: ['Guides & documentation', 'Quickstart, reference, embedding, webhooks and migration'],
      api: ['Developer API & add-on', 'Keys, endpoints for users / contacts / documents, embed sessions and scopes'],
      support: [isPlat ? 'Support queue' : 'Support', isPlat ? 'All tenant tickets · SLA, priority, assignment and internal notes' : 'Your tickets and conversations with support'],
      logs: [isPlat ? 'Platform logs' : 'Activity logs', isPlat ? 'API, webhook, auth, billing and admin events across tenants' : 'API, webhook, auth and signing events'],
      mail: ['Mail outbox', 'Every message the platform has sent · delivery status, preview and compose'],
      catalog: ['Form catalog', 'Ready-made forms every tenant can import · upload the PDF, place fields, publish'],
      audit: ['Audit trail & certificate', 'Event log for this document'],
      account: ['My account', 'Profile, security, notifications, teams and organizations'],
      notifications: ['Notifications', 'Everything raised on your envelopes, billing and support']
  };
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
