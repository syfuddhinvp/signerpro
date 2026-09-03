'use client';

import { usePathname } from 'next/navigation';
import { workspaceForPath } from './routes';
/* SignForge state container — ported from the prototype app.js `state` object and helper methods. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ACCENT_DEFAULT, GROUP_LABELS, RECIPIENTS, RETIRED_TYPES, STATUS, TYPES, type Dict } from './data';

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
export type FieldType = { id: string; label: string; icon: string; w: number; h: number; note?: string };

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
  /** Title of the envelope the current document route is about, published by
   *  the document screens so the sidebar can name its contextual group. */
  docTitle: string;
  /** True while the open envelope is completed / voided / declined / expired. */
  docSealed: boolean;
  libView: string;
  libSelected: string[];
  reportRange: string;
  wizardStep: number;
  paletteTab: string;
  paletteQuery: string;
  favTypes: string[];
  pageMenu: string | null;
  helpOpen: boolean;
  authMode: string;
  authEmail: string;
  authPassword: string;
  remember: boolean;
  mfaCode: string;
  reg: { name: string; company: string; email: string; password: string; size: string; terms: boolean };
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
  /* No `card` or `ach` field: this application does not hold a PAN, an
     expiry, a CVC or a bank account number, even transiently in memory. They
     are typed into the provider's iframe (components/sf/StripeCheckout.tsx). */
  poNumber: string;
  addSeats: number;
  checkoutPlan: string;
  liveMode: boolean;
  contactQuery: string;
  contactGroup: string;
  openContact: string;
  newContact: { name: string; company: string; email: string; title: string; role: string; group: string };
  apiTab: string;
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
    docTitle: '',
    docSealed: false,
    libView: 'list',
    libSelected: [],
    reportRange: '30d',
    wizardStep: 1,
    paletteTab: 'all',
    paletteQuery: '',
    favTypes: ['signature','date','name','checkbox'],
    pageMenu: null,
    helpOpen: false,
    authMode: 'signin',
    authEmail: '',
    authPassword: '',
    remember: true,
    mfaCode: '',
    reg: { name:'', company:'', email:'', password:'', size:'501-5000', terms:false },
    invoiceFilter: 'all',
    openInvoice: '',
    logSource: 'all',
    logLevel: 'all',
    logQuery: '',
    openLog: null,
    autopay: true,
    billingEmail: '',
    taxId: '',
    cycle: 'monthly',
    defaultPm: 'pm_visa',
    payTab: 'card',
    poNumber: '',
    addSeats: 60,
    checkoutPlan: 'Enterprise',
    liveMode: true,
    contactQuery: '',
    contactGroup: 'all',
    openContact: '',
    newContact: { name:'', company:'', email:'', title:'', role:'sign', group:'customers' },
    apiTab: 'users',
    scopes: { 'users:read':true, 'contacts:read':true, 'contacts:write':true, 'documents:read':true, 'documents:write':true, 'envelopes:send':true, 'audit:read':false },
    embedOrigins: '',
    embedReturnUrl: '',
    embedSession: null,
    openTicket: '',
    ticketFilter: 'all',
    ticketQuery: '',
    replyDraft: '',
    replyInternal: false,
    newTicket: { subject:'', category:'signing', priority:'normal', envelope:'', body:'' },
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
    typedName: '',
    typeFace: 'Caveat',
    uploadSrc: null,
    declineReason: '',
    toast: null,
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

/**
 * Stand-in for "this field is not assigned to anybody yet".
 *
 * An envelope with fields but no recipients is a real state — it is what a
 * freshly uploaded PDF looks like the moment the first field is placed, and it
 * is also what the builder sees when `GET /recipients` fails. `recipOf` used to
 * fall back to `list[0]`, which is `undefined` for an empty list, so the very
 * next `.name`/`.color` read threw and the whole prepare view was replaced by
 * the "This view failed to load" boundary.
 */
export const UNASSIGNED_RECIPIENT: Recipient = {
  id: '', name: 'Unassigned', email: '', role: 'sign', color: '#8492a6', order: 1, status: 'draft',
};

export function recipOf(s: SFState, id: string): Recipient {
  const list = recipsOf(s);
  return list.find(r => r.id === id) || list[0] || UNASSIGNED_RECIPIENT;
}
export function metaOf(t: string): FieldType {
  // A withdrawn type still has to describe itself correctly on the documents
  // that already carry it — see `RETIRED_TYPES`.
  return TYPES.find(x => x.id === t) || RETIRED_TYPES.find(x => x.id === t) || TYPES[0];
}
export function snapOf(s: SFState, v: number): number { return s.grid ? Math.round(v / 8) * 8 : Math.round(v); }
export function initials(n: string): string { return n.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
export function money(n: number): string { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function fmt(n: number): string { return n.toLocaleString(); }
export function selOf(s: SFState): SFField[] { return s.fields.filter(f => s.selected.indexOf(f.id) > -1); }





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
  signable: () => SFField[];
  isDone: (f: SFField) => boolean;
  reorder: (id: string, dir: number) => void;
};

const SFContext = createContext<SFContextValue | null>(null);

export function SFProvider({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const pathname = usePathname() || '/';
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
    const isPlat = () => workspaceForPath(pathname) === 'platform';
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

/**
 * Publishes the envelope's name so the sidebar's contextual group can be
 * headed by the document you are actually working on rather than a generic
 * label. Document screens call it; nothing else should.
 */
export function useDocumentTitle(title: string | null | undefined, sealed = false): void {
  const { set } = useSF();
  useEffect(() => {
    // `docSealed` drives the sidebar: a sealed envelope offers its audit trail
    // and nothing else, because the other stages redirect here anyway.
    set({ docTitle: title || '', docSealed: sealed });
    return () => set({ docTitle: '', docSealed: false });
  }, [title, sealed, set]);
}

export function useSF(): SFContextValue {
  const ctx = useContext(SFContext);
  if (!ctx) throw new Error('useSF must be used inside <SFProvider>');
  return ctx;
}
