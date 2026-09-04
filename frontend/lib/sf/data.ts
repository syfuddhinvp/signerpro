/* SignForge design data — ported verbatim from the prototype app.js. */

export type Dict<T = any> = { [k: string]: T };
export type Tone = { bg: string; fg: string; bd: string };

export const BLANK_PNG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const ACCENT_DEFAULT = '#4f46e5';

/**
 * The builder palette. `id` is the backend `FieldType` verbatim — nothing is
 * flattened on save any more (see `adapters.ts:fieldTypeToApi`).
 *
 * `note` is a warning the inspector renders for a type the product does not
 * fully implement yet. Nothing carries one today.
 *
 * `formula` and `currency` were withdrawn for a while because neither did what
 * its label promised. Both are back, and both now mean it: a formula is
 * evaluated server-side from the other fields' merge tags
 * (`backend/app/services/formula_service.py`), and currency is parsed and
 * normalised to two decimal places, rejecting anything that is not an amount.
 */
export const TYPES: { id: string; label: string; icon: string; w: number; h: number; note?: string }[] =[
    { id:'signature', label:'Signature', icon:'S', w:200, h:56 },
    { id:'initials', label:'Initials', icon:'IN', w:88, h:48 },
    { id:'date', label:'Date Signed', icon:'D', w:152, h:40 },
    { id:'name', label:'Full Name', icon:'N', w:196, h:40 },
    { id:'email', label:'Email', icon:'@', w:216, h:40 },
    { id:'text', label:'Text Input', icon:'T', w:196, h:40 },
    { id:'checkbox', label:'Checkbox', icon:'☑', w:32, h:32 },
    { id:'radio', label:'Radio Group', icon:'◉', w:176, h:72 },
    { id:'dropdown', label:'Dropdown', icon:'▾', w:196, h:40 },
    { id:'stamp', label:'Stamp', icon:'✦', w:112, h:112 },
    { id:'attachment', label:'Attachment', icon:'⇪', w:196, h:64 },
    { id:'number', label:'Number', icon:'#', w:140, h:40 },
    { id:'currency', label:'Currency', icon:'$', w:160, h:40 },
    { id:'formula', label:'Calculated', icon:'fx', w:176, h:40 },
    { id:'datetime', label:'Date and Time', icon:'D+', w:196, h:40 }
  ];

/**
 * Types that were withdrawn from the palette but still exist on documents
 * authored before they were: `metaOf` resolves them from here, so a legacy
 * field keeps its own label and default size instead of silently resolving to
 * `TYPES[0]` and describing itself as a Signature.
 *
 * Empty today: `formula` and `currency` were the only two, and both have been
 * implemented and returned to the palette. Kept as a mechanism because it is
 * the honest way to withdraw a type without stranding fields already authored
 * as it — `metaOf` resolves from here so a legacy field keeps its own label and
 * size instead of silently describing itself as a Signature.
 */
export const RETIRED_TYPES: { id: string; label: string; icon: string; w: number; h: number; note?: string }[] = [
];

export const RECIPIENTS: { id: string; name: string; email: string; role: string; color: string; order: number; status: string }[] =[
    { id:'r1', name:'Alex Rivera', email:'alex.rivera@acme.io', role:'sign', color:'#10b981', order:1, status:'Viewed' },
    { id:'r2', name:'Dana Whitfield', email:'dana@northwind-legal.com', role:'approve', color:'#6366f1', order:2, status:'Sent' },
    { id:'r3', name:'Marcus Bell', email:'m.bell@acme.io', role:'copy', color:'#f59e0b', order:3, status:'Pending' }
  ];

export const TEMPLATES: { id: string; title: string; uses: number; fields: number; updated: string; owner: string }[] =[
    { id:'TPL-014', title:'Master Services Agreement — standard', uses:128, fields:9, updated:'22 Aug 2026', owner:'Priya Raman' },
    { id:'TPL-011', title:'Mutual NDA — bilateral', uses:342, fields:5, updated:'18 Aug 2026', owner:'Dana Whitfield' },
    { id:'TPL-009', title:'Order Form — Enterprise tier', uses:96, fields:12, updated:'11 Aug 2026', owner:'Priya Raman' },
    { id:'TPL-006', title:'Contractor Agreement — US', uses:57, fields:8, updated:'2 Aug 2026', owner:'Jordan Mehta' },
    { id:'TPL-004', title:'Data Processing Addendum — EU', uses:41, fields:6, updated:'28 Jul 2026', owner:'Dana Whitfield' },
    { id:'TPL-002', title:'Employment Offer — engineering', uses:23, fields:11, updated:'14 Jul 2026', owner:'Marcus Bell' },
    { id:'TPL-001', title:'W-9 Request', uses:210, fields:4, updated:'3 Jul 2026', owner:'Marcus Bell' }
  ];

export const ROW_ACTIONS: [string, string | null][] =[
    ['Open', null], ['Copy link', null], ['Prepare and send', 'builder'], ['Add fields', 'builder'], ['Make template', null],
    ['Email a copy', null], ['Create invite link', null], ['Freeform invite', null], ['Notarize', null],
    ['Quick preview', null], ['Share', null], ['Download', null], ['Download with certificate', null],
    ['Print', null], ['Export to cloud', null], ['Move to folder', null], ['Merge document with…', null],
    ['Duplicate', null], ['Rename', null], ['Archive', null], ['Delete', null]
  ];

export const DOCS: { id: string; title: string; pages: number; status: string; signed: number; total: number; updated: string; to: string[] }[] =[
    { id:'ENV-2291-KD', title:'Master Services Agreement — Example Industries', pages:3, status:'action', signed:1, total:4, updated:'12 min ago', to:['r1','r2'] },
    { id:'ENV-2287-QB', title:'Mutual NDA — Vertex Robotics', pages:2, status:'waiting', signed:2, total:3, updated:'2 hours ago', to:['r2','r3'] },
    { id:'ENV-2280-LM', title:'Statement of Work #14 — Data Migration', pages:5, status:'completed', signed:4, total:4, updated:'Yesterday', to:['r1','r3'] },
    { id:'ENV-2276-JZ', title:'Contractor Agreement — D. Whitfield', pages:4, status:'action', signed:0, total:2, updated:'Yesterday', to:['r2'] },
    { id:'ENV-2271-TT', title:'Order Form — Enterprise Tier Renewal', pages:2, status:'draft', signed:0, total:3, updated:'3 days ago', to:['r1','r2','r3'] },
    { id:'ENV-2264-PW', title:'Data Processing Addendum — EU', pages:6, status:'waiting', signed:1, total:2, updated:'4 days ago', to:['r1'] },
    { id:'ENV-2251-AH', title:'Reseller Agreement — Halden GmbH', pages:8, status:'voided', signed:0, total:3, updated:'1 week ago', to:['r3'] },
    { id:'ENV-2244-NC', title:'Employment Offer — Senior Engineer', pages:3, status:'completed', signed:2, total:2, updated:'2 weeks ago', to:['r1','r2'] }
  ];

export const STATUS: Dict<Tone & { label: string }> ={
    action:   { label:'Action required', bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' },
    waiting:  { label:'Waiting for others', bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' },
    completed:{ label:'Completed', bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' },
    draft:    { label:'Draft', bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' },
    voided:   { label:'Voided', bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }
  };

export type TourStep = {
  title: string;
  body: string;
  ws: 'tenant' | 'platform';
  screen: string;
  /**
   * CSS selector for the element this step is about, or null when the step is
   * about the screen as a whole. Anything null (or missing at runtime) falls
   * back to the active screen root, then to a docked card with no spotlight.
   */
  target: string | null;
};

export const TOUR: TourStep[] = [
    { title:'One sidebar, one tree', body:'Everything lives in a single sidebar. The top level is your product areas — Home, Documents, Contacts, Reports, Billing, Developer and Support — and each owns its own screens, so nothing is reachable from two places at once.',
      ws:'tenant', screen:'tenantHome', target:'[data-tour="areas"]' },
    { title:'The area you are in opens', body:'Whichever area you are in unfolds its own rows underneath it; the rest stay collapsed, so the whole tree fits on one screen. Every row is a link — the address bar always says where you are.',
      ws:'tenant', screen:'dashboard', target:'[data-tour="areas"]' },
    { title:'Your overview', body:'Envelopes needing action, weekly volume, seat activation, spend for the cycle and an attention queue that deep-links into the right screen.',
      ws:'tenant', screen:'tenantHome', target:null },
    { title:'Views and folders', body:'Under Documents the rows split in two: views — waiting for me, waiting for others, drafts, expiring — are saved filters over everything, and folders are where documents actually live. Both are links, so any view can be shared.',
      ws:'tenant', screen:'dashboard', target:'[data-tour="areas"]' },
    { title:'The document library', body:'Filters, sort, bulk selection and a row menu covering invite links, freeform invites, notarisation, merge, move, duplicate and cloud export. Every filter is in the URL.',
      ws:'tenant', screen:'dashboard', target:null },
    { title:'Working on one envelope', body:'Open a document and Documents grows a group named after it: Prepare, Workflow, Signer view and Audit trail, all pinned to that envelope. Close it and they go away — they are stages of a document, not places in the app.',
      ws:'tenant', screen:'dashboard', target:'[data-tour="areas"]' },
    { title:'Reports and exports', body:'Sent-invite breakdowns, completion rate and median time, per-recipient behaviour, template usage, plus a custom builder and scheduled CSV exports — one dashboard per sidebar row.',
      ws:'tenant', screen:'reports', target:null },
    { title:'Billing runs on Stripe', body:'Subscription and seats, payment methods with autopay, an upcoming-invoice preview, plus invoices with payment intents, receipts and one-click pay.',
      ws:'tenant', screen:'billing', target:null },
    { title:'Use it as an add-on', body:'Expose users, contacts and documents over REST, mint an origin-locked embed session, then land your users straight on the preparation surface with document and contact metadata already attached.',
      ws:'tenant', screen:'api', target:null },
    { title:'Sandbox and guides', body:'Compose a call against seeded test data, read the response and copy the snippet in cURL, TypeScript, Python or PHP — with quickstart, reference, embedding, webhook and migration guides alongside.',
      ws:'tenant', screen:'sandbox', target:null },
    { title:'Support, both sides', body:'Tenants raise tickets with SLA-aware priorities; the platform queue adds assignment, escalation and internal notes that stay invisible to the customer.',
      ws:'tenant', screen:'support', target:null },
    { title:'The platform workspace', body:'Switch to super admin for tenants, impersonation, roles, feature flags, revenue and Stripe payouts, cross-tenant invoices, logs and security posture.',
      ws:'platform', screen:'platformHome', target:'[data-tour="workspace"]' }
  ];

export const DOCS_PAGES: Dict<{ title: string; lede: string; sections: { h: string; p?: string; code?: string; items?: string[] }[] }> ={
    quickstart: { title:'Quickstart guide', lede:'Send your first envelope in about ten minutes — create a key, upload a document, place fields, invite a signer.',
      sections:[
        { h:'1 · Create an API key', p:'Keys are scoped per environment. Test keys never send real email and never charge a card.', code:'curl https://api.signforge.com/v1/keys \\\n  -H "Authorization: Bearer sk_test_…" \\\n  -d label="Quickstart" -d mode=test' },
        { h:'2 · Upload a document', p:'Upload a PDF or reference a template. The response returns page dimensions you need for field placement.', code:'POST /v1/documents\n{\n  "title": "Master Services Agreement",\n  "file_url": "https://files.acme.io/msa.pdf",\n  "external_id": "hostcrm:deal_8842"\n}' },
        { h:'3 · Place fields', p:'Coordinates are in points from the top-left of each page. Snap to an 8-point grid to match the builder.', code:'POST /v1/documents/{id}/fields\n{\n  "fields": [\n    { "type": "signature", "page": 1, "x": 96, "y": 600, "w": 200, "h": 56, "recipient": "ct1", "required": true },\n    { "type": "date", "page": 1, "x": 328, "y": 600, "w": 152, "h": 40, "recipient": "ct1" }\n  ]\n}' },
        { h:'4 · Invite signers', p:'Sequential routing notifies recipient 2 only after recipient 1 completes. Parallel notifies everyone at once.', code:'POST /v1/documents/{id}/invite\n{\n  "routing": "sequential",\n  "recipients": [\n    { "contact_id": "ct1", "role": "sign", "order": 1 },\n    { "contact_id": "ct2", "role": "approve", "order": 2 }\n  ],\n  "reminders": "48h",\n  "expires_in_days": 14\n}' },
        { h:'5 · Listen for completion', p:'Subscribe to envelope.completed and fetch the sealed PDF plus certificate when it fires.', items:['envelope.sent','document.viewed','field.signed','envelope.completed','envelope.declined'] }
      ] },
    reference: { title:'API reference', lede:'REST over HTTPS, JSON in and out, cursor pagination, idempotency keys on every write.',
      sections:[
        { h:'Base URL and auth', p:'All requests require a bearer key. Keys carry scopes; a 403 lists the scope you are missing.', code:'https://api.signforge.com/v1\nAuthorization: Bearer sk_live_…\nIdempotency-Key: 8f2c41ab' },
        { h:'Resources', items:['GET /v1/users — tenant users with role and MFA state','GET /v1/contacts — address book, writable with contacts:write','GET /v1/documents — envelopes with recipients and progress','POST /v1/documents/{id}/invite — start routing','GET /v1/documents/{id}/audit — tamper-evident log','GET /v1/documents/{id}/certificate — sealed PDF','POST /v1/embed/sessions — origin-locked embed token','GET /v1/templates — template inventory'] },
        { h:'Pagination', p:'Cursor based. Pass the last id as starting_after; has_more tells you when to stop.', code:'GET /v1/documents?limit=50&starting_after=ENV-2291-KD' },
        { h:'Errors', p:'Errors return a stable code plus a human message. 429 includes retry_after in seconds.', code:'{\n  "error": {\n    "code": "merge_unresolved",\n    "message": "Merge tag {{client.name}} has no value",\n    "field": "f3"\n  }\n}' }
      ] },
    embed: { title:'Embedding SignForge', lede:'Run preparation and signing inside your own application with an origin-locked session.',
      sections:[
        { h:'Mint a session server-side', p:'Never expose a secret key to the browser. Create the session on your server and pass only the session id to the client.', code:'POST /v1/embed/sessions\n{\n  "landing": "builder",\n  "document": { "template_id": "TPL-014", "external_id": "hostcrm:deal_8842" },\n  "contacts": ["ct1", "ct2"],\n  "return_url": "https://app.hostcrm.com/deals/8842"\n}' },
        { h:'Mount the iframe', p:'The helper handles resizing, focus and postMessage events for you.', code:'SignForge.mount("#agreement", {\n  session: "es_example",\n  onComplete: (envelope) => host.save(envelope.id),\n  onCancel: () => host.close()\n});' },
        { h:'Allowed origins', p:'Sessions are rejected unless the parent frame origin is on the allow-list configured under Apps & keys.' }
      ] },
    webhooks: { title:'Webhooks', lede:'Signed, retried, replayable event delivery.',
      sections:[
        { h:'Verify the signature', p:'Compute an HMAC of the raw body with your endpoint secret and compare in constant time.', code:'const sig = req.headers["signforge-signature"];\nconst expected = hmacSha256(rawBody, endpointSecret);\nif (!timingSafeEqual(sig, expected)) return res.status(400).end();' },
        { h:'Retry schedule', items:['Immediately','+30 seconds','+5 minutes','+1 hour','+6 hours, then the endpoint is marked failing'] },
        { h:'Idempotency', p:'Every delivery carries a stable event id. Store processed ids — retries repeat the same id.' }
      ] },
    sdks: { title:'SDKs & sample apps', lede:'Official clients for TypeScript, Python, PHP, Go and Java, plus runnable examples.',
      sections:[
        { h:'Install', code:'npm i @signforge/node\npip install signforge\ncomposer require signforge/signforge-php' },
        { h:'TypeScript', code:'import { SignForge } from "@signforge/node";\n\nconst sf = new SignForge(process.env.SIGNFORGE_KEY);\nconst env = await sf.documents.create({\n  title: "MSA — Acme",\n  templateId: "TPL-014"\n});\nawait sf.documents.invite(env.id, { recipients: [{ contactId: "ct1", role: "sign" }] });' },
        { h:'Sample apps', items:['Next.js — embedded builder with App Router server actions','Laravel — queue-driven bulk send from CSV','NestJS — webhook receiver with signature verification','Postman collection — every endpoint with environment variables'] }
      ] },
    migration: { title:'Migration guide', lede:'Move templates, contacts and completed archives from another provider.',
      sections:[
        { h:'What transfers', items:['Templates with field geometry and roles','Contacts with groups and tags','Completed PDFs with their original certificates attached as evidence','In-flight envelopes — recipients are re-invited with a new link'] },
        { h:'Bulk import', p:'Upload a manifest and we validate before writing anything. Dry-run reports are retained for 30 days.', code:'POST /v1/imports\n{\n  "source": "other-provider",\n  "manifest_url": "https://files.acme.io/manifest.json",\n  "dry_run": true\n}' },
        { h:'Cutover checklist', items:['Freeze template edits in the old system','Run a dry-run import and review the report','Import contacts, then templates, then archives','Repoint webhooks and API keys','Send one live test envelope per template'] }
      ] }
  };

/* ── field inspector ── */

export const VALIDATION_REGEX_MAP: Dict<string> ={ none:'— no pattern enforced —', email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$', numeric:'^-?\\d+(\\.\\d+)?$', custom:'^[A-Z]{3}-\\d{4}$' };
export const MERGE_SUGGESTIONS: string[] = ['{{client.name}}','{{client.email}}','{{contract.amount}}','{{contract.signedAt}}'];
export const ROLE_WORDS: Dict<string> = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };

/* ── dashboard / library ── */

export const QUICK_ACCESS: [string, string, number, string][] =[
      ['inbox', 'Inbox / Waiting for me', 3, '#4f46e5'],
      ['outbox', 'Outbox / Waiting for others', 12, '#0ea5e9'],
      ['completed', 'Completed / Signed', 127, '#10b981'],
      ['drafts', 'Drafts', 4, '#8492a6'],
      ['favorites', 'Favorites', 6, '#f43f5e'],
      ['expiring', 'Expiring soon', 2, '#f59e0b'],
      ['shared', 'Shared with me', 9, '#8b5cf6'],
      ['mine', 'Owned by me', 88, '#64748b']
];
export const LIB_FOLDERS: [string, string, string][] = [
  ['documents', 'Documents', '1,564'], ['archive', 'Archive', '31'],
  ['templates', 'Templates', String(TEMPLATES.length)], ['trash', 'Trash', '7']
];

export const LIB_FILTER_DEFS: [string, [string, string][]][] = [
  ['libStatus', [['all','All statuses'],['action','Action required'],['waiting','Waiting for others'],['completed','Completed'],['draft','Drafts'],['voided','Voided']]],
  ['libType', [['all','All types'],['agreement','Agreements'],['nda','NDAs'],['order','Order forms'],['hr','HR documents']]],
  ['libTime', [['all','All time'],['7','Last 7 days'],['30','Last 30 days'],['90','Last quarter']]],
  ['libOwner', [['all','All owners'],['me','Owned by me'],['team','My team'],['shared','Shared with me']]]
];
export const LIB_SORT_OPTIONS: [string, string][] = [['recent','Recent'],['name','Name'],['status','Status'],['owner','Owner']];
export const PAGE_THUMB_MENU: [string, string | null][] = [['Insert page above', null], ['Insert page below', null], ['Duplicate page', null], ['Rotate 90°', null], ['Delete page', null]];
export const PALETTE_TABS: [string, string][] = [['all','All fields'],['fav','Favourites']];

/* ── audit / certificate ── */

/* ── platform / super admin ── */

export const PLAN_TONE: Dict<Tone> ={ Enterprise:{ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' }, Business:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' }, Team:{ bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' } };

export const STATUS_TONE: Dict<Tone> ={ Active:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' }, Trial:{ bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }, 'Past due':{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }, Suspended:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' } };
export const ROLE_LABEL: Dict<string> = { super:'Super admin', orgadmin:'Org admin', sender:'Sender', viewer:'Viewer' };
export const PERM_COLUMNS: string[] = ['Super admin','Org admin','Sender','Viewer'];
export const PLATFORM_TABS: [string, string][] = [['tenants','Tenants'],['users','Users & roles'],['flags','Feature flags'],['billing','Plans & usage'],['security','Security & compliance']];

export const FLAG_META: Dict<[string, string]> ={
      'signing.passkey_reuse': ['prod', 'One-click re-use of a device-bound signature for authenticated signers.'],
      'builder.conditional_logic_v2': ['prod', 'Nested conditional rules with multi-trigger AND/OR groups in the field inspector.'],
      'api.bulk_send_v3': ['staging', 'Bulk send endpoint accepting 10k-row CSV merges with per-row merge tags.'],
      'audit.ledger_anchoring': ['prod', 'Hourly anchoring of document hashes to the append-only verification ledger.'],
      'signing.ai_clause_summary': ['canary', 'Plain-language clause summary shown to signers before execution.']
    };
export const FLAG_ENV_TONE: Dict<Tone> = { prod:{ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' }, staging:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }, canary:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' } };

/* ── tenant admin overview ── */

/* ── platform overview extras ── */

/* ── billing (tenant) ── */

export const PLAN_PRICES: Dict<string> = { Team:'$12 / seat', Business:'$28 / seat', Enterprise:'$44 / seat' };

/* ── revenue (platform) ── */

/* ── invoices ── */

export const INV_STATUS_TONE: Dict<Tone> ={ paid:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' }, open:{ bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }, past_due:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }, void:{ bg:'#f5f6f8', fg:'#64748b', bd:'#e3e7ee' } };

export const INV_STATUS_LABEL: Dict<string> ={ paid:'Paid', open:'Open', past_due:'Past due', void:'Void' };
export const INVOICE_FILTERS: [string, string][] = [['all','All'],['open','Open'],['paid','Paid'],['past_due','Past due']];

/* ── logs ── */
export const LOG_SOURCES: [string, string][] = [['all','All'],['api','API'],['webhook','Webhooks'],['auth','Auth'],['billing','Billing'],['signing','Signing'],['admin','Admin']];
export const LOG_LEVELS: [string, string][] = [['all','All levels'],['info','Info'],['warn','Warn'],['error','Error']];

export const LEVEL_TONE: Dict<{ bg: string; fg: string }> ={ info:{ bg:'rgba(99,102,241,.18)', fg:'#a5b4fc' }, warn:{ bg:'rgba(245,158,11,.18)', fg:'#fcd34d' }, error:{ bg:'rgba(244,63,94,.18)', fg:'#fda4af' } };

/* ── contacts ── */

export const GROUP_LABELS: Dict<string> ={ customers:'Customers', internal:'Internal', counsel:'Counsel', vendors:'Vendors' };

export const SRC_TONE: Dict<Tone> ={ CRM:{ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' }, SCIM:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' }, API:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }, Manual:{ bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' } };

export const CONTACT_PALETTE: string[] = ['#10b981','#6366f1','#f59e0b','#0ea5e9','#8b5cf6','#14b8a6','#f43f5e'];

/* ── developer API ── */

/* `sample` is a hand-written **illustrative** payload, not a live response.
   Every identity in it is a documentation placeholder (`example.com`), and
   `ApiScreen` labels the block "Example response" so a developer cannot read
   it as their own directory. */
export const API_DEFS: Dict<{ method: string; path: string; desc: string; params: [string, string, string][]; sample: string }> ={
      users: { method:'GET', path:'/v1/users?limit=25&status=active',
        desc:'Returns every user in the authenticated tenant with role, MFA state and last activity. Use this to map host-application accounts to SignForge identities before launching an embed session.',
        params:[['limit','integer','Page size, 1–100. Defaults to 25.'],['status','enum','active | invited | deprovisioned'],['role','enum','super | orgadmin | sender | viewer'],['updated_after','ISO 8601','Incremental sync cursor.']],
        sample:'{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    {\n      "id": "usr_8f2c41ab",\n      "name": "Ada Example",\n      "email": "ada@example.com",\n      "role": "orgadmin",\n      "tenant": "acme",\n      "mfa": "totp",\n      "status": "active",\n      "last_active_at": "2026-08-28T11:47:03Z"\n    },\n    {\n      "id": "usr_91bd7c02",\n      "name": "Blake Example",\n      "email": "blake@example.com",\n      "role": "sender",\n      "tenant": "acme",\n      "mfa": "totp",\n      "status": "active",\n      "last_active_at": "2026-08-28T08:12:44Z"\n    }\n  ]\n}' },
      contacts: { method:'GET', path:'/v1/contacts?group=customers',
        desc:'Address-book entries available as envelope recipients. Writable with contacts:write — POST the same shape to create, PATCH /v1/contacts/{id} to update.',
        params:[['group','enum','customers | internal | counsel | vendors'],['q','string','Free-text match on name, email, company or tag.'],['source','enum','crm | scim | api | manual'],['expand','array','history, envelopes']],
        sample:'{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    {\n      "id": "ct1",\n      "name": "Casey Example",\n      "email": "casey@example.com",\n      "company": "Example Industries",\n      "default_role": "sign",\n      "group": "customers",\n      "source": "crm",\n      "tags": ["MSA", "Renewal 2026"],\n      "envelope_count": 14\n    }\n  ]\n}' },
      documents: { method:'GET', path:'/v1/documents?status=action_required',
        desc:'Envelope metadata with recipients, field counts and progress. Pair with GET /v1/documents/{id}/audit for the tamper-evident log and /certificate for the sealed PDF.',
        params:[['status','enum','draft | sent | action_required | completed | voided'],['contact_id','string','Filter by a contact appearing as recipient.'],['include','array','fields, recipients, audit'],['created_after','ISO 8601','Range filter.']],
        sample:'{\n  "object": "list",\n  "has_more": true,\n  "data": [\n    {\n      "id": "env_example_0001",\n      "title": "Master Services Agreement — Example Industries",\n      "status": "action_required",\n      "page_count": 3,\n      "field_count": 9,\n      "recipients": [\n        { "contact_id": "ct1", "role": "sign", "routing_order": 1, "status": "viewed" },\n        { "contact_id": "ct2", "role": "approve", "routing_order": 2, "status": "sent" }\n      ],\n      "expires_at": "2026-09-11T00:00:00Z",\n      "hash": "sha256:9f2b7c41a0e5…"\n    }\n  ]\n}' },
      embed: { method:'POST', path:'/v1/embed/sessions',
        desc:'Mints a short-lived, origin-locked session token. The host app opens the returned url in an iframe and SignForge lands directly on the preparation surface with the document and contacts you passed in.',
        params:[['document','object','title, file_url or template_id, external_id'],['contacts','array','Contact ids or inline {name, email, role}'],['landing','enum','builder | routing | signing'],['return_url','string','Where the “Return to host app” action navigates.']],
        sample:'{\n  "object": "embed_session",\n  "id": "es_example",\n  "url": "https://embed.signforge.example/s/es_example",\n  "expires_at": "2026-08-28T12:34:00Z",\n  "landing": "builder",\n  "document": {\n    "title": "Master Services Agreement — Example Industries",\n    "external_id": "hostcrm:deal_8842",\n    "page_count": 3\n  },\n  "contacts": [\n    { "id": "ct1", "role": "sign", "routing_order": 1 },\n    { "id": "ct2", "role": "approve", "routing_order": 2 }\n  ]\n}' }
    };

export const API_TABS: [string, string][] = [['users','Users'],['contacts','Contacts'],['documents','Documents'],['embed','Embed session']];
export const EMBED_SNIPPET: string =
  '<!-- host application -->\n' +
  '<' + 'script' + ' src="https://embed.signforge.com/v1.js">' + '<' + '/script>' + '\n' +
  '<' + 'script' + '>\n  SignForge.mount("#agreement", {\n    session: "es_example",      // POST /v1/embed/sessions\n    landing: "builder",\n    metadata: {\n      document: { external_id: "hostcrm:deal_8842" },\n      contacts: ["ct1", "ct2"]\n    },\n    onComplete: (envelope) => host.save(envelope.id)\n  });\n' +
  '<' + '/script>';

/* ── support ── */

export const TK_STATUS_TONE: Dict<Tone> ={ open:{ bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }, pending:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }, escalated:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }, resolved:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } };

export const TK_STATUS_LABEL: Dict<string> ={ open:'Open', pending:'Pending customer', escalated:'Escalated', resolved:'Resolved' };

export const TK_PRIO_TONE: Dict<Tone & { c: string }> ={ urgent:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca', c:'#f43f5e' }, high:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa', c:'#f59e0b' }, normal:{ bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee', c:'#8492a6' }, low:{ bg:'#f5f6f8', fg:'#64748b', bd:'#e3e7ee', c:'#8492a6' } };

export const TK_PRIO_LABEL: Dict<string> ={ urgent:'P1 Urgent', high:'P2 High', normal:'P3 Normal', low:'P4 Low' };
export const TICKET_FILTERS: [string, string][] = [['all','All'],['open','Open'],['escalated','Escalated'],['pending','Pending'],['resolved','Resolved']];
export const SLA_MAP: Dict<string> = { urgent:'1h 00m left', high:'4h 00m left', normal:'1d 0h left', low:'3d 0h left' };
/* ── auth ── */

export const STRENGTH_COLORS: string[] =['#e3e7ee', '#f43f5e', '#f59e0b', '#6366f1', '#10b981'];

export const STRENGTH_WORDS: string[] =['Use 12+ characters with a number, capital and symbol', 'Weak — add length', 'Fair — add a number or symbol', 'Strong', 'Excellent — meets enterprise policy'];
export const AUTH_TABS: [string, string][] = [['signin','Sign in'],['signup','Create account']];
/* The meta line is shown on the unauthenticated sign-in screen, so it cannot
   name a tenant: the prototype's literal `Acme Corporation` was visible to
   every visitor and implied a real customer of this deployment. It describes
   the scope of the sign-in instead. */

export const AUTH_TITLES: Dict<[string, string]> ={
      signin: ['Sign in to SignForge', 'Use your work account. Enterprise tenants may be redirected to their identity provider.'],
      signup: ['Create your workspace', 'Start a 14-day Business trial — no card required, 25 envelopes per seat.'],
      mfa: ['Two-factor verification', 'Enter the 6-digit code from your authenticator app.'],
      forgot: ['Reset your password', 'We will email a single-use reset link valid for 30 minutes.']
    };

/* ── signing / modals ── */
export const SIG_TABS: [string, string][] = [['draw','Draw'],['type','Type'],['upload','Upload'],['saved','Saved / Passkey']];
export const TYPE_FACES: string[] = ['Caveat','Dancing Script','Great Vibes','Google Sans Flex'];

export const INKS: [string, string][] = [['#0f172a','Black ink'],['#1d4ed8','Blue ink']];
export const CADENCES: string[] = ['24h','48h','7 days','none'];
export const MODAL_COPY_STATIC: Dict<[string, string, string, string]> = {
      disclosure: ['Electronic Record and Signature Disclosure', 'Please read before signing electronically', 'By selecting \u201cI agree\u201d, you consent to receive records and signable documents electronically for this transaction and any related transactions. You may withdraw consent at any time by contacting the sender, in which case paper copies will be provided at no charge. You confirm you can access PDF documents and retain a copy for your records. Hardware requirements: a current browser, an internet connection, and 20 MB of available storage. This disclosure is version 4.2 and will be recorded in the audit trail with your IP address and timestamp.', 'I agree'],
      decline: ['Decline to sign', 'The sender is notified immediately and the envelope is voided', 'Declining stops the signing workflow for every remaining recipient. Your reason is recorded in the tamper-evident audit trail and shared with the sender.', 'Confirm decline'],
      reassign: ['Reassign signer', 'Delegate your signing responsibility', 'The new signer receives the envelope with your assigned fields. Your original invitation is revoked and the reassignment is written to the audit trail with both email addresses.', 'Send reassignment'],
};

/* The `send` modal copy is state-dependent and is built in `Modals.tsx` from
   the real document id, field count and recipient count. */

export const PAY_TITLES: Dict<[string, string]> ={
      card: ['Payment method', 'Entered in Stripe\u2019s own frame, or billed by invoice'],
      seats: ['Add seats', 'Prorated for the remainder of this cycle'],
      plan: ['Change plan', 'Applies immediately with proration'],
      pay: ['Pay invoice', 'Records payment against this invoice'],
      ticket: ['New support ticket', 'Routed by category with SLA based on priority'],
      contact: ['New contact', 'Saved to the address book and exposed over the contacts API']
    };

/* ── reports ── */

export const REPORT_NAV: [string, string, boolean][] =[
      ['analytics', 'My Analytics', true], ['all', 'All reports', false],
      ['documents', 'By documents', false], ['templates', 'By templates', false],
      ['recipients', 'By recipients', false], ['custom', 'Custom', false]
];

export const REPORT_RANGES: [string, string][] = [['7d','Last 7 days'],['30d','Last 30 days'],['90d','Last quarter'],['12m','Last 12 months']];

export const ALL_REPORT_CARDS: [string, string][] =[
      ['Documents report', 'Status, progress and ageing for every envelope in the period.'],
      ['Templates report', 'Template inventory with field counts and owners.'],
      ['Templates usage report', 'Which templates are used, by whom and how often.'],
      ['Completed copies report', 'Every completed copy generated from a template.'],
      ['Recipients report', 'Per-recipient volume, completion time and decline rate.'],
      ['Audit export', 'Full event log with checksums for a date range.']
];
export const CUSTOM_REPORT_FIELDS: string[] = ['Envelope status','Recipient','Sender','Template','Completion time','Field values','Tenant','Tags'];

/* ── account area ── */

export const ACCOUNT_NAV: [string, string][] =[
      ['profile','User profile'],
      ['billing','Billing & plan'], ['invoices','Invoices'],
      ['security','Settings · login & security'],
      ['notifications','Notification settings'], ['email','Email notifications'],
      ['integrations','Integrations'], ['cloud','Cloud storage'], ['teams','My teams'],
      ['orgs','My organizations'], ['audit','Audit trail']
];

export const ACCOUNT_TITLES: Dict<[string, string]> ={
      profile:['User profile','Name, photo, locale and signature defaults'],
      billing:['Billing & plan','Plan, seats, renewal, payment methods and the upcoming invoice'],
      invoices:['Invoices','Issued invoices, receipts and payment state'],
      security:['Settings · login and security','Email, password, two-factor and authenticated devices'],
      notifications:['Notification settings','Which events notify you, and how'],
      email:['Email notifications','Account email preferences and additional recipients'],
      integrations:['Integrations','CRM, storage and workflow connectors'],
      cloud:['Cloud storage','Automatic export of completed documents'],
      teams:['My teams','Shared folders, members and team templates'],
      orgs:['My organizations','Organizations you belong to and their admins'],
      audit:['Audit trail','Account-level security and administrative events']
    };

/* ── global chrome ── */

export const HELP_ITEMS: [string, string | null][] =[
      ['Start product tour', 'tour'], ['Support centre', 'support'], ['Contact support', 'support'],
      ['Guides & docs', 'guides'], ['API sandbox', 'sandbox'], ['Keyboard shortcuts', null]
];
/* ── sandbox & guides ── */

export const SB_LANG_TABS: [string, string][] = [['curl','cURL'],['node','TypeScript'],['python','Python'],['php','PHP']];
export const DOC_NAV: [string, string][] = [['quickstart','Quickstart guide'],['reference','API reference'],['embed','Embedding'],['webhooks','Webhooks'],['sdks','SDKs & samples'],['migration','Migration guide']];

/* ── nav ──
   The rail and the screen→rail map live in `lib/sf/navigation.ts` and
   `lib/sf/routes.ts`. The prototype's copies lived here and drifted. */

