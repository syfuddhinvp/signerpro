'use client';
/* SignForge state container — ported from the prototype app.js `state` object and helper methods. */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  ACCENT_DEFAULT, AUDIT, DOCS, GROUP_LABELS, RECIPIENTS, STATUS, TEMPLATES, TENANTS, TYPES,
  INVOICES, LOGS, FOLDER_STATUS_MAP, type Dict
} from './data';

export type Recipient = { id: string; name: string; email: string; role: string; color: string; order: number; status: string };
export type SFField = {
  id: string; page: number; type: string; x: number; y: number; w: number; h: number; to: string;
  required: boolean; readOnly: boolean; label: string; placeholder: string; validation: string;
  cond: { field: string; op: string; value: string } | null; merge: string;
};
export type Contact = {
  id: string; name: string; email: string; company: string; title: string; phone: string; role: string;
  group: string; source: string; tags: string[]; envelopes: number; lastSigned: string; color: string;
};
export type ApiKey = { id: string; label: string; mode: string; secret: string; full: string; created: string; lastUsed: string; revoked: boolean; revealed: boolean };
export type TicketMessage = { author: string; role: string; ts: string; internal: boolean; side: string; body: string };
export type Ticket = {
  id: string; subject: string; slug: string; tenant: string; requester: string; requesterEmail: string;
  category: string; priority: string; status: string; assignee: string; envelope: string; created: string;
  sla: string; tags: string[]; messages: TicketMessage[];
};
export type FieldType = { id: string; label: string; icon: string; w: number; h: number };

export type SFState = {
  wide: boolean;
  tourStep: number;
  docsPage: string;
  sbMethod: string;
  sbPath: string;
  sbEnv: string;
  sbLang: string;
  sbBody: string;
  sbParams: { k: string; v: string }[];
  sbResponse: string | null;
  sbSending: boolean;
  sbHistory: { method: string; path: string; status: number; ms: number; env: string; body: string }[];
  accountOpen: boolean;
  accountSection: string;
  libFolder: string;
  libView: string;
  libSelected: string[];
  libSort: string;
  libStatus: string;
  libType: string;
  libTime: string;
  libOwner: string;
  reportsSection: string;
  reportRange: string;
  wizardStep: number;
  paletteTab: string;
  paletteQuery: string;
  favTypes: string[];
  pageMenu: string | null;
  apiSection: string;
  notifOpen: boolean;
  helpOpen: boolean;
  orgOpen: boolean;
  trialBanner: boolean;
  org: string;
  authed: boolean;
  authMode: string;
  authEmail: string;
  authPassword: string;
  authRole: string;
  remember: boolean;
  mfaCode: string;
  reg: { name: string; company: string; email: string; password: string; size: string; terms: boolean };
  user: { name: string; role: string };
  workspace: string;
  screen: string;
  invoiceFilter: string;
  openInvoice: string;
  logSource: string;
  logLevel: string;
  logQuery: string;
  openLog: string | null;
  autopay: boolean;
  billingEmail: string;
  taxId: string;
  cycle: string;
  defaultPm: string;
  payTab: string;
  card: { number: string; exp: string; cvc: string; zip: string };
  ach: { routing: string; account: string };
  poNumber: string;
  addSeats: number;
  checkoutPlan: string;
  liveMode: boolean;
  contactQuery: string;
  contactGroup: string;
  openContact: string;
  newContact: { name: string; company: string; email: string; title: string; role: string; group: string };
  contacts: Contact[];
  apiTab: string;
  apiKeys: ApiKey[];
  scopes: Dict<boolean>;
  embedOrigins: string;
  embedReturnUrl: string;
  embedSession: { id: string; host: string; title: string; externalId: string; contacts: string[] } | null;
  openTicket: string;
  ticketFilter: string;
  ticketQuery: string;
  replyDraft: string;
  replyInternal: boolean;
  newTicket: { subject: string; category: string; priority: string; envelope: string; body: string };
  tickets: Ticket[];
  filter: string;
  query: string;
  menuDoc: string | null;
  zoom: number;
  page: number;
  grid: boolean;
  activeRecipient: string;
  selected: string[];
  marquee: { x: number; y: number; w: number; h: number } | null;
  guides: { axis: string; at: number }[];
  dragTool: string | null;
  ghost: { x: number; y: number } | null;
  recipients: Recipient[] | null;
  routing: string;
  cadence: string;
  expiry: string;
  message: string;
  signValues: Dict<any>;
  activeSignField: string | null;
  modal: string | null;
  sigTab: string;
  sigInk: string;
  sigStroke: number;
  typedName: string;
  typeFace: string;
  uploadSrc: string | null;
  declineReason: string;
  toast: string | null;
  platformTab: string;
  tenantQuery: string;
  tenantOverrides: Dict<string>;
  userRoles: Dict<string>;
  flagState: Dict<{ on: boolean; rollout: number }>;
  security: Dict<boolean>;
  fields: SFField[];
};

export const INITIAL_STATE: SFState =
{
    wide: true,
    tourStep: -1,
    docsPage: 'quickstart',
    sbMethod: 'GET',
    sbPath: '/v1/contacts',
    sbEnv: 'test',
    sbLang: 'curl',
    sbBody: '{\n  "group": "customers"\n}',
    sbParams: [{ k:'group', v:'customers' }, { k:'limit', v:'25' }],
    sbResponse: null,
    sbSending: false,
    sbHistory: [],
    accountOpen: false,
    accountSection: 'profile',
    libFolder: 'documents',
    libView: 'list',
    libSelected: [],
    libSort: 'recent',
    libStatus: 'all',
    libType: 'all',
    libTime: 'all',
    libOwner: 'all',
    reportsSection: 'analytics',
    reportRange: '30d',
    wizardStep: 1,
    paletteTab: 'all',
    paletteQuery: '',
    favTypes: ['signature','date','name','checkbox'],
    pageMenu: null,
    apiSection: 'endpoints',
    notifOpen: false,
    helpOpen: false,
    orgOpen: false,
    trialBanner: true,
    org: 'Acme Corporation',
    authed: false,
    authMode: 'signin',
    authEmail: 'priya@acme.io',
    authPassword: '',
    authRole: 'tenant',
    remember: true,
    mfaCode: '',
    reg: { name:'', company:'', email:'', password:'', size:'501-5000', terms:false },
    user: { name:'Jordan Mehta', role:'Legal Ops · Admin' },
    workspace: 'tenant',
    screen: 'tenantHome',
    invoiceFilter: 'all',
    openInvoice: 'INV-2026-0841',
    logSource: 'all',
    logLevel: 'all',
    logQuery: '',
    openLog: null,
    autopay: true,
    billingEmail: 'ap@acme.io',
    taxId: 'US-EIN 84-2201993',
    cycle: 'monthly',
    defaultPm: 'pm_visa',
    payTab: 'card',
    card: { number:'', exp:'', cvc:'', zip:'' },
    ach: { routing:'', account:'' },
    poNumber: '',
    addSeats: 60,
    checkoutPlan: 'Enterprise',
    liveMode: true,
    contactQuery: '',
    contactGroup: 'all',
    openContact: 'ct1',
    newContact: { name:'', company:'', email:'', title:'', role:'sign', group:'customers' },
    contacts: [
      { id:'ct1', name:'Alex Rivera', email:'alex.rivera@acme.io', company:'Acme Corporation', title:'VP Operations', phone:'+1 512 555 0142', role:'sign', group:'customers', source:'CRM', tags:['MSA','Renewal 2026'], envelopes:14, lastSigned:'14 Aug 2026', color:'#10b981' },
      { id:'ct2', name:'Dana Whitfield', email:'dana@northwind-legal.com', company:'Northwind Legal', title:'General Counsel', phone:'+1 206 555 0197', role:'approve', group:'counsel', source:'Manual', tags:['Approver','Legal'], envelopes:38, lastSigned:'26 Aug 2026', color:'#6366f1' },
      { id:'ct3', name:'Marcus Bell', email:'m.bell@acme.io', company:'Acme Corporation', title:'Finance Director', phone:'+1 512 555 0188', role:'copy', group:'internal', source:'SCIM', tags:['CC only'], envelopes:22, lastSigned:'—', color:'#f59e0b' },
      { id:'ct4', name:'Priya Raman', email:'priya@acme.io', company:'Acme Corporation', title:'Head of Legal Ops', phone:'+1 512 555 0110', role:'sign', group:'internal', source:'SCIM', tags:['Org admin'], envelopes:41, lastSigned:'22 Aug 2026', color:'#0ea5e9' },
      { id:'ct5', name:'Sofia Lindqvist', email:'sofia@vertex.dev', company:'Vertex Robotics', title:'Procurement Lead', phone:'+46 8 555 0121', role:'sign', group:'vendors', source:'API', tags:['Vendor','NDA'], envelopes:6, lastSigned:'11 Aug 2026', color:'#8b5cf6' },
      { id:'ct6', name:'Tobias Krause', email:'it@halden.de', company:'Halden GmbH', title:'IT Manager', phone:'+49 30 555 0173', role:'sign', group:'vendors', source:'CRM', tags:['Reseller','EU'], envelopes:9, lastSigned:'2 Aug 2026', color:'#f43f5e' },
      { id:'ct7', name:'Elena Ruiz', email:'elena.ruiz@kestrel.health', company:'Kestrel Health', title:'Compliance Officer', phone:'+1 415 555 0164', role:'approve', group:'customers', source:'API', tags:['HIPAA','Approver'], envelopes:17, lastSigned:'19 Aug 2026', color:'#14b8a6' }
    ],
    apiTab: 'users',
    apiKeys: [
      { id:'k1', label:'Host app — production', mode:'live', secret:'sk_live_9f2b••••••••••••••4c71', full:'sk_seed_REDACTED_ROTATE_ME', created:'12 Jun 2026', lastUsed:'2 min ago', revoked:false, revealed:false },
      { id:'k2', label:'Host app — sandbox', mode:'test', secret:'sk_test_41ab••••••••••••••02de', full:'sk_seed_REDACTED_ROTATE_ME', created:'12 Jun 2026', lastUsed:'1 hour ago', revoked:false, revealed:false },
      { id:'k3', label:'Zapier connector', mode:'live', secret:'sk_live_7d10••••••••••••••be93', full:'sk_seed_REDACTED_ROTATE_ME', created:'3 Mar 2026', lastUsed:'6 days ago', revoked:true, revealed:false }
    ],
    scopes: { 'users:read':true, 'contacts:read':true, 'contacts:write':true, 'documents:read':true, 'documents:write':true, 'envelopes:send':true, 'audit:read':false },
    embedOrigins: 'https://app.hostcrm.com, https://staging.hostcrm.com',
    embedReturnUrl: 'https://app.hostcrm.com/deals/8842/agreements',
    embedSession: null,
    openTicket: 'SF-4471',
    ticketFilter: 'all',
    ticketQuery: '',
    replyDraft: '',
    replyInternal: false,
    newTicket: { subject:'', category:'signing', priority:'normal', envelope:'', body:'' },
    tickets: [
      { id:'SF-4471', subject:'Signer cannot apply drawn signature on iPad', slug:'acme', tenant:'Acme Corporation',
        requester:'Priya Raman', requesterEmail:'priya@acme.io', category:'signing', priority:'urgent', status:'escalated',
        assignee:'ag2', envelope:'ENV-2291-KD', created:'28 Aug 09:12', sla:'1h 12m left', tags:['iPadOS 18.5','Safari','P1'],
        messages:[
          { author:'Priya Raman', role:'Org admin · Acme', ts:'28 Aug 09:12', internal:false, side:'customer',
            body:'Two of our signers on iPad cannot complete the drawn signature — the canvas accepts strokes but "Adopt and sign" does nothing. Typed signature works. This is blocking the MSA renewal due today.' },
          { author:'Marco Diaz', role:'Support engineer · SignForge', ts:'28 Aug 09:26', internal:false, side:'agent',
            body:'Thanks Priya — reproduced on iPadOS 18.5 with Apple Pencil. The pointer capture is releasing early on stylus input. Escalating to the signing team and will send a workaround within the hour.' },
          { author:'Marco Diaz', role:'Support engineer · SignForge', ts:'28 Aug 09:28', internal:true, side:'agent',
            body:'Linked to SIGN-2210. Affects stylus pointerup only; touch and mouse unaffected. Flag signing.passkey_reuse not involved.' },
          { author:'Priya Raman', role:'Org admin · Acme', ts:'28 Aug 09:41', internal:false, side:'customer',
            body:'Understood. Typed signature is acceptable as an interim path — please confirm it is legally equivalent for the audit trail.' }
        ] },
      { id:'SF-4468', subject:'Webhook endpoint returning 502 for invoice.payment_failed', slug:'halden', tenant:'Halden GmbH',
        requester:'Tobias Krause', requesterEmail:'it@halden.de', category:'api', priority:'high', status:'pending',
        assignee:'ag3', envelope:'', created:'27 Aug 16:04', sla:'4h 30m left', tags:['webhooks','502'],
        messages:[
          { author:'Tobias Krause', role:'Viewer · Halden', ts:'27 Aug 16:04', internal:false, side:'customer',
            body:'We stopped receiving billing webhooks last week. Our endpoint is up — can you confirm what SignForge is seeing?' },
          { author:'Amelia Chen', role:'Support engineer · SignForge', ts:'27 Aug 16:48', internal:false, side:'agent',
            body:'Our delivery log shows four attempts to https://halden.de/hooks/sf all returning 502 with a 30s timeout. Could you check the reverse proxy body-size limit? Our payloads can exceed 64 KB.' }
        ] },
      { id:'SF-4462', subject:'Request: bulk send from CSV for 4,000 contractors', slug:'kestrel', tenant:'Kestrel Health',
        requester:'Security Team', requesterEmail:'security@kestrel.health', category:'api', priority:'normal', status:'open',
        assignee:'ag1', envelope:'', created:'26 Aug 11:31', sla:'1d 6h left', tags:['bulk-send','feature'],
        messages:[
          { author:'Security Team', role:'Org admin · Kestrel', ts:'26 Aug 11:31', internal:false, side:'customer',
            body:'We need to send 4,000 onboarding agreements in one batch with per-row merge tags. Is the bulk endpoint available on our plan?' }
        ] },
      { id:'SF-4455', subject:'Invoice INV-2026-0777 shows a late fee we dispute', slug:'halden', tenant:'Halden GmbH',
        requester:'Tobias Krause', requesterEmail:'it@halden.de', category:'billing', priority:'high', status:'open',
        assignee:'ag4', envelope:'', created:'25 Aug 08:55', sla:'2h 05m left', tags:['billing','dispute'],
        messages:[
          { author:'Tobias Krause', role:'Viewer · Halden', ts:'25 Aug 08:55', internal:false, side:'customer',
            body:'The SEPA debit failed because of a bank-side hold, not insufficient funds. Please remove the €32 late fee and retry.' }
        ] },
      { id:'SF-4440', subject:'Certificate of completion missing geolocation for one signer', slug:'acme', tenant:'Acme Corporation',
        requester:'Jordan Mehta', requesterEmail:'jordan.mehta@northwind.com', category:'security', priority:'normal', status:'resolved',
        assignee:'ag2', envelope:'ENV-2280-LM', created:'21 Aug 14:20', sla:'met in 3h 12m', tags:['audit','resolved'],
        messages:[
          { author:'Jordan Mehta', role:'Legal ops · Acme', ts:'21 Aug 14:20', internal:false, side:'customer',
            body:'The certificate for ENV-2280-LM lists IP but no city/country for the second signer. Our auditor needs it.' },
          { author:'Marco Diaz', role:'Support engineer · SignForge', ts:'21 Aug 17:32', internal:false, side:'agent',
            body:'The signer used a corporate VPN egress with no geo mapping. We have regenerated the certificate with the resolved ASN and noted the VPN in the audit entry. CSAT survey sent.' }
        ] },
      { id:'SF-4431', subject:'SSO users landing in the wrong tenant after IdP change', slug:'vertex', tenant:'Vertex Robotics',
        requester:'Sofia Lindqvist', requesterEmail:'sofia@vertex.dev', category:'security', priority:'urgent', status:'open',
        assignee:'ag3', envelope:'', created:'28 Aug 07:40', sla:'48m left', tags:['SSO','SAML','P1'],
        messages:[
          { author:'Sofia Lindqvist', role:'Sender · Vertex', ts:'28 Aug 07:40', internal:false, side:'customer',
            body:'After our Okta migration two users are being provisioned into the trial tenant instead of vertex. Sign-in succeeds but they see no documents.' }
        ] }
    ],
    filter: 'all',
    query: '',
    menuDoc: null,
    zoom: 1,
    page: 1,
    grid: true,
    activeRecipient: 'r1',
    selected: ['f1'],
    marquee: null,
    guides: [],
    dragTool: null,
    ghost: null,
    recipients: null,
    routing: 'sequential',
    cadence: '48h',
    expiry: '14',
    message: 'Please review and sign the attached Master Services Agreement. Reach out with any questions before executing.',
    signValues: {},
    activeSignField: null,
    modal: null,
    sigTab: 'draw',
    sigInk: '#0f172a',
    sigStroke: 3,
    typedName: 'Alex Rivera',
    typeFace: 'Caveat',
    uploadSrc: null,
    declineReason: '',
    toast: null,
    platformTab: 'tenants',
    tenantQuery: '',
    tenantOverrides: {},
    userRoles: {},
    flagState: {
      'signing.passkey_reuse': { on:true, rollout:100 },
      'builder.conditional_logic_v2': { on:true, rollout:45 },
      'api.bulk_send_v3': { on:false, rollout:10 },
      'audit.ledger_anchoring': { on:true, rollout:100 },
      'signing.ai_clause_summary': { on:false, rollout:5 }
    },
    security: { sso:true, scim:true, ipAllow:false, residency:true, keyRotation:true, dlp:false },
    fields: [
      { id:'f1', page:1, type:'signature', x:96, y:600, w:200, h:56, to:'r1', required:true, readOnly:false, label:'Client signature', placeholder:'', validation:'none', cond:null, merge:'' },
      { id:'f2', page:1, type:'date', x:328, y:600, w:152, h:40, to:'r1', required:true, readOnly:false, label:'Date signed', placeholder:'MM/DD/YYYY', validation:'date', cond:null, merge:'{{contract.signedAt}}' },
      { id:'f3', page:1, type:'name', x:96, y:672, w:196, h:40, to:'r1', required:true, readOnly:false, label:'Printed name', placeholder:'Full legal name', validation:'none', cond:null, merge:'{{client.name}}' },
      { id:'f4', page:1, type:'email', x:328, y:672, w:216, h:40, to:'r1', required:false, readOnly:false, label:'Billing email', placeholder:'name@company.com', validation:'email', cond:null, merge:'{{client.email}}' },
      { id:'f5', page:1, type:'checkbox', x:96, y:744, w:32, h:32, to:'r1', required:true, readOnly:false, label:'Accept terms', placeholder:'', validation:'none', cond:null, merge:'' },
      { id:'f6', page:1, type:'dropdown', x:328, y:744, w:196, h:40, to:'r2', required:false, readOnly:false, label:'Payment terms', placeholder:'', validation:'none', cond:{ field:'f5', op:'checked', value:'' }, merge:'{{contract.terms}}' },
      { id:'f7', page:1, type:'initials', x:592, y:600, w:88, h:48, to:'r2', required:true, readOnly:false, label:'Counsel initials', placeholder:'', validation:'none', cond:null, merge:'' },
      { id:'f8', page:2, type:'signature', x:120, y:520, w:200, h:56, to:'r2', required:true, readOnly:false, label:'Approver signature', placeholder:'', validation:'none', cond:null, merge:'' },
      { id:'f9', page:2, type:'stamp', x:400, y:496, w:112, h:112, to:'r3', required:false, readOnly:true, label:'Corporate seal', placeholder:'', validation:'none', cond:null, merge:'' }
    ]
};

/* ── pure helpers ported from the class (non-rendering) ── */

export function accentOf(accent?: string): string { return accent || ACCENT_DEFAULT; }
export function recipsOf(s: SFState): Recipient[] { return s.recipients || RECIPIENTS; }
export function recipOf(s: SFState, id: string): Recipient {
  const list = recipsOf(s);
  return list.find(r => r.id === id) || list[0];
}
export function metaOf(t: string): FieldType { return TYPES.find(x => x.id === t) || TYPES[0]; }
export function snapOf(s: SFState, v: number): number { return s.grid ? Math.round(v / 8) * 8 : Math.round(v); }
export function initials(n: string): string { return n.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
export function money(n: number): string { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function fmt(n: number): string { return n.toLocaleString(); }
export function selOf(s: SFState): SFField[] { return s.fields.filter(f => s.selected.indexOf(f.id) > -1); }

/* dashboard document counts + filtering */
export function docCounts(): Dict<number> {
  const counts: Dict<number> = { all: DOCS.length };
  ['action', 'waiting', 'completed', 'draft', 'voided'].forEach(k => { counts[k] = DOCS.filter(d => d.status === k).length; });
  return counts;
}
export function docsFiltered(s: SFState) {
  const q = s.query.toLowerCase();
  return DOCS.filter(d => (s.filter === 'all' || d.status === s.filter) && (!q || (d.title + d.id).toLowerCase().indexOf(q) > -1));
}
/* document-library filtering (two-pane) */
export function libDocsFiltered(s: SFState) {
  const q = s.query.toLowerCase();
  const baseStatus = FOLDER_STATUS_MAP[s.libFolder] || 'all';
  return DOCS.filter(d => {
    if (baseStatus !== 'all' && d.status !== baseStatus) return false;
    if (s.libStatus !== 'all' && d.status !== s.libStatus) return false;
    if (!q) return true;
    return (d.title + d.id).toLowerCase().indexOf(q) > -1;
  });
}
export function isTemplateFolder(s: SFState): boolean { return s.libFolder === 'templates'; }

/* contacts */
export function contactCounts(s: SFState): Dict<number> {
  const counts: Dict<number> = { all: s.contacts.length };
  Object.keys(GROUP_LABELS).forEach(g => { counts[g] = s.contacts.filter(c => c.group === g).length; });
  return counts;
}
export function contactsFiltered(s: SFState): Contact[] {
  const cq = s.contactQuery.toLowerCase();
  return s.contacts.filter(c => (s.contactGroup === 'all' || c.group === s.contactGroup) &&
    (!cq || (c.name + c.email + c.company + c.tags.join(' ')).toLowerCase().indexOf(cq) > -1));
}

/* invoices / logs / tickets scoping */
export function invoicesScoped(isPlat: boolean) { return INVOICES.filter(i => isPlat || i.slug === 'acme'); }
export function invoicesFiltered(s: SFState, isPlat: boolean) {
  return invoicesScoped(isPlat).filter(i => s.invoiceFilter === 'all' || i.status === s.invoiceFilter);
}
export function logsScoped(isPlat: boolean) { return LOGS.filter(l => isPlat || l.slug === 'acme'); }
export function logsFiltered(s: SFState, isPlat: boolean) {
  const lq = s.logQuery.toLowerCase();
  return logsScoped(isPlat).filter(l => (s.logSource === 'all' || l.source === s.logSource) &&
    (s.logLevel === 'all' || l.level === s.logLevel) &&
    (!lq || (l.msg + l.source + l.payload).toLowerCase().indexOf(lq) > -1));
}
export function ticketsScoped(s: SFState, isPlat: boolean): Ticket[] { return s.tickets.filter(t => isPlat || t.slug === 'acme'); }
export function ticketCounts(s: SFState, isPlat: boolean): Dict<number> {
  const scoped = ticketsScoped(s, isPlat);
  const counts: Dict<number> = { all: scoped.length };
  ['open', 'pending', 'escalated', 'resolved'].forEach(k => { counts[k] = scoped.filter(t => t.status === k).length; });
  return counts;
}
export function ticketsFiltered(s: SFState, isPlat: boolean): Ticket[] {
  const tkq = s.ticketQuery.toLowerCase();
  return ticketsScoped(s, isPlat).filter(t => (s.ticketFilter === 'all' || t.status === s.ticketFilter) &&
    (!tkq || (t.subject + t.id + t.requester + t.tenant).toLowerCase().indexOf(tkq) > -1));
}

/* tenants */
export function tenantsFiltered(s: SFState) {
  const tq = s.tenantQuery.toLowerCase();
  return TENANTS.filter(t => !tq || (t.name + t.slug + t.plan + t.region).toLowerCase().indexOf(tq) > -1);
}
export function tenantStatus(s: SFState, t: { slug: string; status: string }): string { return s.tenantOverrides[t.slug] || t.status; }

/* signing */
export function signable(s: SFState): SFField[] {
  return s.fields.filter(f => {
    if (f.page !== 1 || f.readOnly) return false;
    if (f.cond) {
      const v = s.signValues[f.cond.field];
      if (f.cond.op === 'checked' && v !== true) return false;
      if (f.cond.op === 'equals' && String(v || '') !== f.cond.value) return false;
      if (f.cond.op === 'notEmpty' && !v) return false;
    }
    return true;
  });
}
export function isDone(s: SFState, f: SFField): boolean {
  const v = s.signValues[f.id];
  return f.type === 'checkbox' ? v === true : !!(v && String(v).length);
}

/* templates / audit convenience */
export function templates() { return TEMPLATES; }
export function auditEntries() { return AUDIT; }
export function statusOf(key: string) { return STATUS[key]; }

/* password strength (auth screens) */
export function passwordScore(pw: string): number {
  return (pw.length >= 12 ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + (/[0-9]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
}

/* recipient reorder (Component.reorder) */
export function reorderRecips(s: SFState, id: string, dir: number): Recipient[] | null {
  const arr = recipsOf(s).slice().sort((a, b) => a.order - b.order);
  const i = arr.findIndex(r => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return null;
  const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  return arr.map((r, k) => Object.assign({}, r, { order: k + 1 }));
}

/* ── context ── */

export type SFPatch = Partial<SFState> | ((s: SFState) => Partial<SFState>);

export type SFContextValue = {
  s: SFState;
  set: (patch: SFPatch) => void;
  flash: (msg: string) => void;
  accent: () => string;
  recips: () => Recipient[];
  recip: (id: string) => Recipient;
  meta: (t: string) => FieldType;
  snap: (v: number) => number;
  initials: (n: string) => string;
  money: (n: number) => string;
  fmt: (n: number) => string;
  sel: () => SFField[];
  setField: (id: string, patch: Partial<SFField>) => void;
  isPlat: () => boolean;
  docCounts: () => Dict<number>;
  docsFiltered: () => typeof DOCS;
  libDocsFiltered: () => typeof DOCS;
  contactCounts: () => Dict<number>;
  contactsFiltered: () => Contact[];
  invoicesFiltered: () => typeof INVOICES;
  logsFiltered: () => typeof LOGS;
  ticketCounts: () => Dict<number>;
  ticketsFiltered: () => Ticket[];
  tenantsFiltered: () => typeof TENANTS;
  tenantStatus: (t: { slug: string; status: string }) => string;
  signable: () => SFField[];
  isDone: (f: SFField) => boolean;
  reorder: (id: string, dir: number) => void;
};

const SFContext = createContext<SFContextValue | null>(null);

export function SFProvider({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const [s, setS] = useState<SFState>(INITIAL_STATE);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<SFState>(s);
  stateRef.current = s;

  const set = useCallback((patch: SFPatch) => {
    setS(prev => Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch));
  }, []);

  const flash = useCallback((msg: string) => {
    setS(prev => Object.assign({}, prev, { toast: msg }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setS(prev => Object.assign({}, prev, { toast: null })), 2400);
  }, []);

  const value = useMemo<SFContextValue>(() => {
    const isPlat = () => s.workspace === 'platform';
    return {
      s,
      set,
      flash,
      accent: () => accentOf(accent),
      recips: () => recipsOf(s),
      recip: (id: string) => recipOf(s, id),
      meta: metaOf,
      snap: (v: number) => snapOf(s, v),
      initials,
      money,
      fmt,
      sel: () => selOf(s),
      setField: (id: string, patch: Partial<SFField>) =>
        set(st => ({ fields: st.fields.map(f => (f.id === id ? Object.assign({}, f, patch) : f)) })),
      isPlat,
      docCounts,
      docsFiltered: () => docsFiltered(s),
      libDocsFiltered: () => libDocsFiltered(s),
      contactCounts: () => contactCounts(s),
      contactsFiltered: () => contactsFiltered(s),
      invoicesFiltered: () => invoicesFiltered(s, isPlat()),
      logsFiltered: () => logsFiltered(s, isPlat()),
      ticketCounts: () => ticketCounts(s, isPlat()),
      ticketsFiltered: () => ticketsFiltered(s, isPlat()),
      tenantsFiltered: () => tenantsFiltered(s),
      tenantStatus: (t: { slug: string; status: string }) => tenantStatus(s, t),
      signable: () => signable(s),
      isDone: (f: SFField) => isDone(s, f),
      reorder: (id: string, dir: number) => {
        const next = reorderRecips(s, id, dir);
        if (next) set({ recipients: next });
      }
    };
  }, [s, set, flash, accent]);

  return <SFContext.Provider value={value}>{children}</SFContext.Provider>;
}

export function useSF(): SFContextValue {
  const ctx = useContext(SFContext);
  if (!ctx) throw new Error('useSF must be used inside <SFProvider>');
  return ctx;
}
