/* SignerPro design data — ported verbatim from the prototype app.js. */
import type { IconName } from '@/components/sf/Icon';
import { pathAllowed } from '@/lib/auth/access';
import { pathFor, type ScreenKey } from './routes';

export type Dict<T = any> = { [k: string]: T };
export type Tone = { bg: string; fg: string; bd: string };

export const BLANK_PNG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const ACCENT_DEFAULT = 'hsl(var(--color-accent-solid))';

/**
 * The builder palette. `id` is the backend `FieldType` verbatim — nothing is
 * flattened on save any more (see `adapters.ts:fieldTypeToApi`).
 *
 * `note` is a warning the inspector renders for a type the product does not
 * fully implement yet. Nothing carries one today.
 *
 * `currency` is not offered here — see `RETIRED_TYPES`.
 */
export const TYPES: { id: string; label: string; icon: string; svg?: IconName; w: number; h: number; note?: string }[] =[
    { id:'signature', label:'Signature', icon:'S', w:200, h:56 },
    { id:'initials', label:'Initials', icon:'IN', w:88, h:48 },
    { id:'datetime', label:'Date and Time', icon:'D+', w:196, h:40 },
    { id:'date', label:'Date Signed', icon:'D', w:152, h:40 },
    { id:'name', label:'Full Name', icon:'N', w:196, h:40 },
    { id:'email', label:'Email', icon:'@', w:216, h:40 },
    { id:'text', label:'Text Input', icon:'T', w:196, h:40 },
    { id:'checkbox', label:'Checkbox', icon:'', svg:'checkbox', w:32, h:32 },
    { id:'radio', label:'Radio Group', icon:'', svg:'radio', w:176, h:72 },
    { id:'dropdown', label:'Dropdown', icon:'', svg:'caretDown', w:196, h:40 },
    { id:'stamp', label:'Stamp', icon:'', svg:'stamp', w:112, h:112 },
    { id:'attachment', label:'Attachment', icon:'', svg:'upload', w:196, h:64 },
    { id:'number', label:'Number', icon:'#', w:140, h:40 },
    // PAY-1: renders on the signing surface as a Pay button, not a fill-in
    // control, so it is sized like one — wider and taller than a text input.
    { id:'payment', label:'Payment', icon:'$', w:160, h:48 },
    // ANN-1: the sender's own marks. Unlike every entry above, these are not
    // something a recipient fills in — they are drawn onto the page and burned
    // into the final PDF. `lib/sf/annotations.ts` holds what they carry.
    { id:'textbox', label:'Text Box', icon:'Tx', w:220, h:44 },
    { id:'drawing', label:'Pen Drawing', icon:'', svg:'pencil', w:220, h:120 }
  ];

/**
 * Types that were withdrawn from the palette but still exist on documents
 * authored before they were: `metaOf` resolves them from here, so a legacy
 * field keeps its own label and default size instead of silently resolving to
 * `TYPES[0]` and describing itself as a Signature.
 *
 * `currency` lives here: it remains implemented end to end (parsed and
 * normalised to two decimal places by
 * `backend/app/services/currency_service.py`), so documents already authored
 * with it keep working — it is simply no longer offered to new authors.
 */
export const RETIRED_TYPES: { id: string; label: string; icon: string; svg?: IconName; w: number; h: number; note?: string }[] = [
  { id:'currency', label:'Currency', icon:'$', w:160, h:40 }
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
    action:   { label:'Action required', bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' },
    waiting:  { label:'Waiting for others', bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-fg-info))', bd:'hsl(var(--color-accent-border))' },
    completed:{ label:'Completed', bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' },
    draft:    { label:'Draft', bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-subtle))', bd:'hsl(var(--color-border-subtle))' },
    voided:   { label:'Voided', bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' }
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
  /**
   * Steps about the super-admin workspace. Only platform admins can reach
   * `/platform` — everyone else is redirected to `/overview` by the route's
   * own guard — so for a tenant user the step would never arrive, and its
   * copy would describe a screen they are not allowed to see.
   */
  platformOnly?: boolean;
};

/**
 * The steps this session can actually walk. Filtering here rather than in the
 * component is what keeps "Step n of m" and the dots honest: a tenant user is
 * told the tour is eleven steps long because for them it is.
 */
export function tourSteps(isPlatformAdmin: boolean, role?: string): TourStep[] {
  return TOUR.filter(step => {
    if (step.platformOnly && !isPlatformAdmin) return false;
    /* Same reason as `platformOnly`, for the tenant roles: a sender is
       redirected away from Reports, Billing and Developer, so a step that
       navigates there would land them back on Home mid-tour. */
    return pathAllowed(pathFor(step.screen as ScreenKey, step.ws), role);
  });
}

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
    { title:'API console and guides', body:'Compose a call against your live workspace, read the real response and copy it back out as cURL, TypeScript or Python — with quickstart, reference, embedding, webhook and migration guides alongside.',
      ws:'tenant', screen:'sandbox', target:null },
    { title:'Support, both sides', body:'Tenants raise tickets with SLA-aware priorities; the platform queue adds assignment, escalation and internal notes that stay invisible to the customer.',
      ws:'tenant', screen:'support', target:null },
    { title:'The platform workspace', body:'Switch to super admin for tenants, impersonation, roles, feature flags, revenue and Stripe payouts, cross-tenant invoices, logs and security posture.',
      ws:'platform', screen:'platformHome', target:'[data-tour="workspace"]', platformOnly:true }
  ];

export const DOCS_PAGES: Dict<{ title: string; lede: string; sections: { h: string; p?: string; code?: string; items?: string[] }[] }> ={
    quickstart: { title:'Quickstart guide', lede:'Issue a key, authenticate, read your first document and its audit trail — then subscribe to the event that tells you an agreement is done.',
      sections:[
        { h:'Before you start', p:'You need an organization admin session to issue a key. Every call below runs against the deployment you are signed in to; there is no separate test tenant, so a key of either mode reads and writes your real data. Read the last section on this page first if you are planning to create and send envelopes over the API — that part of the surface is not public yet.' },
        { h:'1 · Create an API key', p:'Issue keys from Apps & keys, or with a session-authenticated call as an organization admin. Ask for the narrowest set of scopes that does the job — GET /api/api-keys/scopes returns the catalogue with descriptions. The secret is returned exactly once, in this response, and only a SHA-256 hash of it is stored: if you lose it, roll the key rather than hunting for it.', code:'POST /api/api-keys\n{\n  "label": "Quickstart",\n  "mode": "test",\n  "scopes": ["documents:read", "audit:read"]\n}\n\n201 Created\n{\n  "id": "key_8f2c41ab",\n  "label": "Quickstart",\n  "mode": "test",\n  "prefix": "sk_test_9f2b",\n  "last_four": "d41c",\n  "scopes": ["audit:read", "documents:read"],\n  "secret": "sk_test_9f2b…d41c"   // shown once, never again\n}' },
        { h:'2 · Know which tenant your key writes to', p:'A test-mode key resolves to your sandbox organization and a live-mode key to your real one. This is enforced in the backend, not a label: a sk_test_ key cannot read or write a live record, and email, SMS and payment collection are suppressed on everything it touches. Start in test.', code:'GET /api/sandbox\n{\n  "is_sandbox": true,\n  "organization_id": "org_…_sandbox",\n  "live_organization_id": "org_…",\n  "side_effects_suppressed": true\n}' },
        { h:'2 · Authenticate and confirm what you hold', p:'The public surface lives under /api/v1 and authenticates with the X-API-Key header — not an Authorization bearer. Call whoami first: it costs nothing, needs no scope beyond a valid key, and tells you which organization and scopes the key actually resolved to, which is the fastest way to catch a key pasted from the wrong environment.', code:'curl https://your-deployment.example.com/api/v1/whoami \\\n  -H "X-API-Key: sk_test_9f2b…d41c"\n\n{\n  "organization_id": "org_8842",\n  "mode": "test",\n  "scopes": ["audit:read", "documents:read"],\n  "key_id": "key_8f2c41ab",\n  "is_platform_admin": false\n}' },
        { h:'3 · Read your documents', p:'Requires documents:read. Returns a JSON array, newest first, scoped to the key\'s organization — there is no way for a key to read across tenants. Filter with status, which takes one of the document status values.', code:'GET /api/v1/documents?status=sent\nX-API-Key: sk_test_9f2b…d41c\n\n# a single document, including fields and recipients\nGET /api/v1/documents/{document_id}' },
        { h:'4 · Pull the audit trail', p:'Requires audit:read. Each entry carries its own checksum plus the checksum of the entry before it, so the trail is a hash chain: recompute it and you can prove no entry was inserted, removed or edited. This is the endpoint to use when you are mirroring evidence into your own system of record.', code:'GET /api/v1/documents/{document_id}/audit-logs\n\n[\n  {\n    "event_type": "document_signed",\n    "event_message": "Casey Example signed.",\n    "actor_email": "casey@example.com",\n    "ip_address": "203.0.113.42",\n    "created_at": "2026-09-08T11:47:03Z",\n    "checksum": "9f2b7c41a0e5…",\n    "previous_checksum": "41ab8f2c0d7e…",\n    "kind": "signature"\n  }\n]' },
        { h:'5 · Hear about completion', p:'Do not poll for it. Register a webhook endpoint and subscribe to document.completed; the delivery is signed, retried six times and replayable from the dashboard. See the Webhooks page for the verification recipe — it is not the naive HMAC-of-the-body that most examples show, because the signature covers a timestamp too.', code:'POST /api/webhooks\n{\n  "url": "https://hooks.example.com/signerpro",\n  "event_types": ["document.completed", "document.declined", "recipient.signed"]\n}' },
        { h:'What the public API does not do yet', p:'Reading is public; writing mostly is not. Creating a document, placing fields, adding recipients and sending for signature are session-authenticated app endpoints (/api/documents, /api/fields, /api/recipients, /api/templates), not /api/v1 routes, and no API-key scope reaches them today — envelopes:send and documents:write exist in the catalogue ahead of the routes that will honour them. To drive preparation or signing from your own application right now, mint an embed session server-side and load the returned URL: that is the supported path, and it is covered on the Embedding page.' }
      ] },
    sandbox: { title:'Sandbox & test mode', lede:'A separate organization for testing, with outbound side effects suppressed.',
      sections:[
        { h:'What it is', p:'Your sandbox is a real, separate tenant paired with your live organization — not a flag on your live records. Because every query is scoped to an organization, nothing in the sandbox can read or write a live document, contact or template, and nothing live can see sandbox data.' },
        { h:'Two ways in', p:'Use a test-mode API key, or send the sandbox header on a session-authenticated call. Both resolve the request to the same sandbox organization; the header is per-request, so a live call is never one forgotten toggle away.', code:'# a test-mode key\ncurl https://app.example.com/api/v1/contacts \\\n  -H "X-API-Key: sk_test_…"\n\n# or one session call, sandboxed\ncurl https://app.example.com/api/contacts \\\n  -b "$SIGNERPRO_SESSION_COOKIE" \\\n  -H "X-SignerPro-Sandbox: 1"' },
        { h:'What is suppressed', items:['Outbound email — a signing link is generated but never delivered','Outbound SMS — including signer OTP messages','Payment collection — no invoice can be charged and no provider is contacted'] },
        { h:'Confirm which side you are on', p:'Rather than trusting a toggle, ask. Called without the header it reports your live organization with is_sandbox false.', code:'GET /api/sandbox\n{\n  "organization_id": "org_…_sandbox",\n  "is_sandbox": true,\n  "live_organization_id": "org_…",\n  "document_count": 4,\n  "contact_count": 4,\n  "side_effects_suppressed": true\n}' },
        { h:'Seed and reset', p:'Seeding is additive and gives you contacts and documents across the statuses worth testing against — draft, sent, viewed and completed. Reset empties the sandbox. Both are refused outright unless the request resolved to a sandbox, so neither verb has a path to a live record.', code:'POST /api/sandbox/seed     # 201, additive\nPOST /api/sandbox/reset    # 200, deletes sandbox documents and contacts' },
        { h:'What it is not', items:['Not a separate API — the same paths serve both, and the same code runs','Not browsable in the app UI yet; the sandbox is reachable through the API and the API console','Not a billing environment — subscriptions and invoices belong to the live organization'] }
      ] },
    reference: { title:'API reference', lede:'REST over HTTPS, JSON in and out, one header for auth, per-key rate limiting. This page lists what is actually deployed rather than what is planned.',
      sections:[
        { h:'Base path and authentication', p:'Every public route is prefixed /api/v1 on your own deployment host. Authenticate with the X-API-Key header. A missing or unknown key is 401; a valid key without the required scope is 403, and the message names every scope you are missing so you can fix it in one attempt rather than by bisection.', code:'GET /api/v1/documents\nX-API-Key: sk_live_9f2b…d41c\n\n403 Forbidden\n{ "detail": "API key is missing required scope(s): documents:read" }' },
        { h:'Scopes', items:['users:read — read organization members','contacts:read — read the address book','contacts:write — create and update contacts','documents:read — read documents, fields and recipients','documents:write — create and update documents, fields and recipients','envelopes:send — send documents for signature','audit:read — read audit trails'] },
        { h:'A note on the write scopes', p:'contacts:write, documents:write and envelopes:send can be granted to a key today, but no /api/v1 route consults them yet — the write surface is app-session authenticated. Granting them changes nothing about what the key can do, so grant them when the routes ship, not in advance.' },
        { h:'Endpoints', items:['GET /api/v1/whoami — organization, mode, scopes and key id for the calling key. No scope required.','GET /api/v1/documents — every document in the tenant, newest first. Optional status filter. Requires documents:read.','GET /api/v1/documents/{id} — one document with its fields and recipients. Requires documents:read.','GET /api/v1/documents/{id}/audit-logs — the hash-chained audit trail, oldest first. Requires audit:read.','GET /api/v1/users — members with role and status. Requires users:read.','GET /api/v1/contacts — address-book entries. Requires contacts:read.'] },
        { h:'Response shape', p:'List endpoints return a bare JSON array, not an envelope object, and are not paginated yet: there is no limit, cursor or has_more, and a tenant with 10,000 documents gets 10,000 rows. Treat that as the current contract and keep your own high-water mark — filter on status and reconcile by document id rather than assuming a page size. Pagination will arrive as an additive change.' },
        { h:'Rate limits', p:'600 requests per rolling 60 seconds, counted per API key id rather than per IP, so one tenant\'s traffic can never throttle another\'s and two keys in the same organization get their own budgets. Exceeding it returns 429 with a Retry-After header in seconds — read the header, do not guess a backoff. This ceiling is separate from your plan\'s monthly call quota, which is metered and billed independently.', code:'429 Too Many Requests\nRetry-After: 23\n{ "detail": "API rate limit exceeded for this key. Please slow down." }' },
        { h:'Errors', p:'Errors return the HTTP status plus a JSON body with a single detail string. There is no stable machine-readable error code today, so branch on the status, not on the message text.', items:['400 — malformed request or a validation failure.','401 — missing, unknown, revoked or expired key.','403 — valid key, missing scope.','404 — the resource does not exist, or belongs to another tenant. Cross-tenant reads are deliberately indistinguishable from missing rows so the API cannot be used to probe for the existence of another customer\'s document.','422 — the body parsed but failed schema validation; the detail names the field.','429 — rate limited, with Retry-After.'] },
        { h:'Idempotency', p:'There is no Idempotency-Key header on this surface — an earlier draft of this page claimed one. Because every public route is a GET, retries are safe by construction. When the write routes ship they will need an idempotency story, and this section is where it will be documented.' },
        { h:'Managing keys', items:['GET /api/api-keys/scopes — the scope catalogue with descriptions.','GET /api/api-keys/usage — call volume against your quota.','POST /api/api-keys/{id}/roll — issue a new secret for an existing key; returns the secret once.','POST /api/api-keys/{id}/revoke and /restore — disable or re-enable a key without deleting its history.','PATCH /api/api-keys/{id}/scopes, plus /scopes/grant and /scopes/revoke — change what a live key can reach.'] }
      ] },
    embed: { title:'Embedding SignerPro', lede:'Run preparation and signing inside your own application with a short-lived, origin-locked session. This is the supported way to write, while the public write API is still session-only.',
      sections:[
        { h:'Mint a session server-side', p:'Never expose a secret to the browser. Create the session from your server with an app session or an API key carrying documents:write, then hand the browser only the URL that comes back. The signed URL appears in this response and is never retrievable again — not from the list endpoint, not from support.', code:'POST /api/embed/sessions\n{\n  "landing": "builder",\n  "document": { "document_id": "doc_8842", "external_id": "hostcrm:deal_8842" },\n  "contacts": [{ "id": "ct1", "name": "Casey Example", "email": "casey@example.com", "role": "sign" }],\n  "return_url": "https://app.hostcrm.com/deals/8842",\n  "ttl_minutes": 30\n}' },
        { h:'What comes back', p:'Keep the id if you want to inspect or revoke the session later, and hand only the url to the browser.', code:'201 Created\n{\n  "id": "es_example",\n  "url": "https://app.example.com/embed/builder?session=…",\n  "landing": "builder",\n  "document_id": "doc_8842",\n  "external_id": "hostcrm:deal_8842",\n  "return_url": "https://app.hostcrm.com/deals/8842",\n  "allowed_origins": ["https://app.hostcrm.com"],\n  "expires_at": "2026-09-08T12:30:00Z",\n  "consumed_at": null,\n  "expired": false\n}' },
        { h:'Landing surfaces', items:['builder — prepare fields and recipients','routing — set the signing order','signing — sign as one recipient; recipient_id is required'] },
        { h:'Load it in an iframe', p:'Give the frame real height — the builder and the signing surface both scroll internally, and a short frame produces a nested scrollbar that signers routinely fail to notice.', code:'<' + 'iframe\n  src="{url}"\n  allow="clipboard-write"\n  style="width:100%;height:800px;border:0"\n><' + '/iframe>' },
        { h:'Allowed origins', p:'Maintain the parent-frame allow-list under Apps & keys, or with PATCH /api/organizations/me/api-settings. The token is exchanged by GET /api/embed/resolve, which refuses the call unless the Origin header matches an entry on the list. With no allow-list configured, only the first-party app origin may exchange a session — so a fresh deployment fails closed rather than open.' },
        { h:'Session lifetime and control', items:['ttl_minutes defaults to 30 and caps at 1440 (24 hours).','A session is single-use: consumed_at is stamped at exchange, and an expired or consumed token is refused at exchange time, not at render time.','POST /api/embed/sessions/{id}/revoke invalidates one immediately — call it when a deal is cancelled rather than waiting for the TTL.','GET /api/embed/sessions lists the sessions minted for your organization, and GET /api/embed/sessions/{id} inspects one.'] },
        { h:'Operating it safely', items:['Mint the session at the moment the user clicks, not when the page renders — a token minted on page load is already burning its TTL.','Set the shortest TTL that fits the task; 30 minutes is right for signing, and an hour is generous for preparation.','Keep the allow-list to exact origins you control. It is matched against the Origin header, so a wildcard is not available and should not be wanted.','Treat return_url as user-visible navigation: it is where the "Return to host app" action sends the signer.'] }
      ] },
    webhooks: { title:'Webhooks', lede:'Signed, timestamped, retried and replayable event delivery — with the exact verification recipe, because getting this wrong silently accepts forged events.',
      sections:[
        { h:'Register an endpoint', p:'Creating an endpoint returns its signing secret exactly once. The URL is validated on creation and re-validated at every delivery attempt, and addresses that resolve into private or link-local ranges are refused — so a URL that resolves publicly today cannot be re-pointed at internal metadata later.', code:'POST /api/webhooks\n{\n  "url": "https://hooks.example.com/signerpro",\n  "event_types": ["document.completed", "recipient.signed"]\n}\n\n201 Created\n{\n  "id": "whe_8842",\n  "url": "https://hooks.example.com/signerpro",\n  "event_types": ["document.completed", "recipient.signed"],\n  "secret": "whsec_…"   // shown once\n}' },
        { h:'The headers on every delivery', code:'X-SignFlow-Timestamp: 1717171717        # unix seconds\nX-SignFlow-Signature: sha256=<hex digest>\nX-SignFlow-Event: document.completed\nX-SignFlow-Delivery: whd_8f2c41ab\nX-SignFlow-Attempt: 1\nUser-Agent: SignFlow-Webhooks/1.0' },
        { h:'Verify the signature', p:'The signature covers the timestamp and the raw body joined by a dot — not the body alone. Verify against the exact bytes you received: the body is serialised with compact separators and sorted keys, so parsing and re-serialising it will change the bytes and every signature will fail. Compare in constant time, and reject anything older than five minutes to stop replay.', code:'const raw = await readRawBody(req);           // Buffer, not JSON.parse output\nconst ts = Number(req.headers["x-signflow-timestamp"]);\nconst sig = String(req.headers["x-signflow-signature"]).split("=", 2)[1];\n\nif (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {\n  return res.status(400).end();                // replay guard\n}\nconst expected = createHmac("sha256", endpointSecret)\n  .update(`${ts}.`).update(raw).digest("hex");\nif (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {\n  return res.status(400).end();\n}\nres.status(200).end();                         // ack fast, then process' },
        { h:'Events you can subscribe to', items:['document.created — created, still a draft and not yet sent','document.sent — sent out for signature','document.viewed — a recipient opened it for the first time','document.completed — every recipient has signed and the final PDF is sealed','document.declined — a recipient declined; the document is terminated','document.voided — the sender voided it','document.expired — it passed its expiry without completing','recipient.signed — one recipient finished their fields','recipient.declined — one recipient declined','recipient.reminded — a reminder was sent to a pending recipient','webhook.test — a synthetic event from the endpoint test button'] },
        { h:'Delivery guarantees', p:'At-least-once. Each (event, endpoint) pair is written to the database inside the same transaction as the business change, so a queued delivery survives a restart, and attempts are made after that transaction commits, off the request path. A broken or slow endpoint of yours can therefore never prevent a document from completing.' },
        { h:'Retries and backoff', p:'Six attempts in total. After a failure the next attempt is scheduled at 30 seconds, then doubling — 60s, 2m, 4m, 8m — capped at six hours, and after the sixth the delivery is marked exhausted and logged to the document audit trail. Any 2xx counts as success; everything else, including a timeout at ten seconds, is a failure.', items:['Attempt 1 — immediately after commit','Attempt 2 — +30 seconds','Attempt 3 — +1 minute','Attempt 4 — +2 minutes','Attempt 5 — +4 minutes','Attempt 6 — +8 minutes, then exhausted'] },
        { h:'Idempotency', p:'Every retry reuses the same X-SignFlow-Delivery id, and a replay from the dashboard reuses it too. Store the ids you have processed and return 200 for one you have seen before — do not derive your own key from the payload, because the payload of a retry is byte-identical and tells you nothing about whether you already acted on it.' },
        { h:'Inspect, test and replay', items:['GET /api/webhooks/event-types — the catalogue, with a description per event.','POST /api/webhooks/{id}/test — send a webhook.test delivery to prove the endpoint and your verification code work.','GET /api/webhooks/{id}/deliveries — attempt history with status codes and error text.','POST /api/webhooks/deliveries/{id}/replay — re-send one delivery after you have fixed your handler.','POST /api/webhooks/{id}/rotate-secret — new secret, returned once. Accept both secrets during the changeover, then drop the old one.'] },
        { h:'Operating it', p:'Retries are drained by a scheduled task (scripts/run_webhook_retries.py), not by a background thread inside the web process — if nothing is calling it on your deployment, first attempts still go out but nothing is ever retried. Check that before concluding an endpoint is broken.' }
      ] },
    migration: { title:'Migration guide', lede:'Move contacts, templates and completed archives from another provider — using the import paths that exist today.',
      sections:[
        { h:'Order of operations', p:'Contacts first, then templates, then archives. Templates reference roles rather than people so they do not depend on contacts, but recipients you add while testing a template will — and importing archives last keeps the noisy, high-volume step out of the way while you are still validating field placement.' },
        { h:'Import contacts', p:'Two routes, both session-authenticated as a member of the workspace, and both accepting dry_run so you can see the outcome before anything is written. Run every import as a dry run first and read the errors: a CSV that reports 40 skipped rows is telling you the column mapping is wrong, not that 40 contacts are duplicates.', code:'POST /api/contacts/import?dry_run=true\n{\n  "contacts": [\n    { "name": "Casey Example", "email": "casey@example.com", "company": "Example Industries", "default_role": "sign", "group": "customers" }\n  ],\n  "dry_run": true\n}\n\n# or a CRM-style export, multipart/form-data\nPOST /api/contacts/import/csv?dry_run=true' },
        { h:'CSV columns', p:'Recognised headers: name, email, company, title, phone, default_role, group, source, tags (semicolon separated), color, external_id. Only email is required, and anything else is ignored rather than rejected. Keep external_id populated with the record id from the old system — it is what lets you re-run an import without creating duplicates, and what lets you trace a contact back afterwards.' },
        { h:'Templates', p:'There is no template import endpoint, and field geometry does not transfer between providers in any useful form — coordinate systems, page origins and role models all differ. Rebuild each template once in the builder from the source PDF, then use POST /api/templates/from-document/{id} to capture it, /duplicate for variants and /{id}/use to spin up an envelope. It is slower than it sounds you want, and it is the step that surfaces the templates nobody actually uses.' },
        { h:'Completed archives', p:'Upload the sealed PDFs from the old provider as documents and file them in the Archive folder. Attach the provider\'s original certificate of completion alongside each one: your SignerPro audit trail starts at import and cannot vouch for events that happened elsewhere, so the imported certificate is the evidence for anything signed before cutover. Do not re-send an already-executed agreement to collect a SignerPro signature on it.' },
        { h:'In-flight envelopes', p:'These do not migrate. An unsigned envelope in the old system has to be voided there and sent again here, which means recipients get a new link and any partial signatures are lost. Plan the cutover for a quiet window and count what is in flight first — that number decides whether you cut over in one move or run both systems for a fortnight.' },
        { h:'Cutover checklist', items:['Freeze template edits in the old system and export contacts.','Dry-run the contact import; fix the column mapping until the error list is empty.','Import contacts for real, then rebuild and save each template.','Send one live test envelope per template, to yourself, and check field placement on the sealed PDF — not just in the builder.','Import the completed archive with original certificates attached.','Register webhook endpoints here, verify one test delivery, then disable the old provider\'s endpoints.','Issue new API keys, roll out the X-API-Key header, and revoke the old provider\'s credentials.','Count remaining in-flight envelopes in the old system; void and re-send them.'] }
      ] },
    overview: { title:'What SignerPro does', lede:'A plain-language tour of the product: the words we use, what happens to a document from upload to seal, and where to click for each step.',
      sections:[
        { h:'The five words worth knowing', items:['Document — the PDF you upload.','Envelope — the document once it has recipients and is out for signature. One document sent twice is two envelopes.','Field — a box a recipient fills: signature, initials, date, text, checkbox.','Recipient — a person on the envelope. A recipient signs, approves, or only receives a copy.','Routing — the order recipients are notified in: sequential (one after another) or parallel (everyone at once).'] },
        { h:'The path a document takes', items:['Upload — drag a PDF in, or start from a template.','Prepare — add recipients, then drag fields onto the pages and assign each one to a recipient.','Send — SignerPro emails each recipient a private link. Nobody needs a SignerPro account to sign.','Sign — recipients open the link, fill their fields, and confirm.','Seal — when the last recipient finishes, the PDF is flattened, hashed and locked, and a certificate of completion is attached. Everyone on the envelope gets the sealed copy by email.'] },
        { h:'Where things live', items:['Dashboard — what needs your attention today, and what you are waiting on.','Library — every document, grouped into Documents, Templates, Archive and Trash, with filters for status, type, date and owner.','Contacts — your address book. Recipients you add here can be reused without retyping an email.','Settings — signature appearance, notification cadence, branding and security for your workspace.'] },
        { h:'What it costs you in time', p:'A first envelope takes about five minutes end to end. A repeat send from a saved template takes under a minute, because the fields and roles are already placed.' },
        { h:'If you would rather be shown', p:'Open the product tour from the help menu. It walks the same path in the real interface, on your own workspace, and you can leave it at any point without losing work.' }
      ] },
    send: { title:'Send a document for signature', lede:'The core task, step by step — from a PDF on your desktop to an envelope in someone else\'s inbox.',
      sections:[
        { h:'1 · Upload the document', p:'From the Dashboard or Library, choose New, then Upload. PDF is the native format; Word, Excel and image files are converted to PDF on upload and the conversion is what gets signed. Keep a single file under 25 MB and 250 pages. If you have several files that should be signed together, upload them into one envelope — they are merged in the order you add them, and you can reorder pages afterwards.' },
        { h:'2 · Add your recipients', p:'Add each person by email, or pick them from Contacts. Then set what each one has to do.', items:['Needs to sign — must complete every field assigned to them.','Approver — reviews and approves, without signing.','Receives a copy — gets the sealed PDF at the end and is never asked to act.','In-person signer — you host the signing on your own device, with them next to you.'] },
        { h:'3 · Choose the signing order', p:'Sequential means recipient 2 is only emailed once recipient 1 finishes — use it when a countersignature has to come last. Parallel emails everyone at once and is faster when the order does not matter. You can mix the two by giving several recipients the same order number: they are notified together, and the next number waits for all of them.' },
        { h:'4 · Place the fields', p:'Drag a field from the left palette onto the page, then set who it belongs to. Each field is colour-coded by recipient, so a glance tells you whether anyone has been left with nothing to do. Fields snap to an 8-point grid; hold Alt while dragging to place one freely.', items:['Mark a field required and the recipient cannot finish without it.','Use a text field with validation (email, date, number) to stop bad data at the source rather than chasing a correction later.','Copy a field to the same spot on every page with Duplicate to all pages — useful for initials.','Conditional fields appear only when an earlier answer matches, which keeps a long form short for most signers.'] },
        { h:'5 · Set reminders and an expiry', p:'Reminders nudge anyone who has not acted, on the cadence you choose (24 hours, 48 hours, weekly, or never). An expiry voids the envelope automatically if it is still unsigned by then, which keeps stale agreements out of your Library. Both can be changed after sending.' },
        { h:'6 · Send, then watch it move', p:'After sending, the envelope appears in Outbox. Its row shows how far it has got — sent, viewed, partially signed, completed. Open it to see per-recipient status and the audit trail. From there you can resend the invitation, correct a field, reassign a recipient, or void the envelope with a reason.' },
        { h:'Before you send, check these three things', items:['Every signing recipient has at least one required field assigned to them.','The email addresses are right — a private link sent to the wrong address is the most common support ticket we see.','The routing order matches how the agreement actually gets approved internally.'] }
      ] },
    sign: { title:'Signing a document you received', lede:'For anyone who has been sent an envelope — including people who have never used SignerPro. No account, no download, no app.',
      sections:[
        { h:'Open your link', p:'The email from the sender contains a private link that is tied to your address. Open it on a phone, tablet or computer in any current browser. If the sender turned on extra verification you will be asked for a one-time code, or for an access code they gave you separately — we never send that code in the same email as the link.' },
        { h:'Agree to sign electronically', p:'The first screen is the electronic record and signature disclosure. It explains that you are consenting to sign and receive records electronically, and that you can withdraw consent and ask the sender for paper instead. You have to agree once per envelope, and your agreement is recorded with a timestamp.' },
        { h:'Fill your fields', p:'Choose Start, or scroll, and the document jumps to the first field waiting on you. Required fields are marked; the progress counter at the top tells you how many are left. Fields assigned to other recipients are visible but locked, so you can read the whole agreement without being able to change their answers.' },
        { h:'Make your signature', items:['Draw — sign with a finger, stylus or trackpad. Clear and redraw as often as you like.','Type — pick a handwriting style; your typed name becomes the mark.','Upload — use an image of your existing signature on a plain background.','Saved — reuse the signature you made last time. On a supported device you can lock it to a passkey, so a fingerprint or face check applies it.'] },
        { h:'Finish', p:'Choose Finish and your part is complete. If others are still to sign, you will be emailed the sealed PDF once the last person is done; otherwise it arrives straight away. Either way you can download a copy from the confirmation screen immediately.' },
        { h:'If something is wrong', items:['Wrong information in the document — do not sign. Choose Decline and give a reason; the sender is notified and the envelope is voided for everyone.','Not the right person to sign — some envelopes let you reassign to a colleague; if not, reply to the sender and ask them to correct the recipient.','Need more time — the link stays live until the expiry date shown on it. If it has expired, ask the sender to resend.','Lost the email — search for the sender name, check spam, then ask for a resend. Links cannot be forwarded to another address.'] },
        { h:'Is an electronic signature actually binding', p:'In most jurisdictions, yes — electronic signatures are recognised under laws such as the US ESIGN Act and UCITA, the EU eIDAS regulation, and equivalent legislation elsewhere. Each completed envelope carries a certificate recording who signed, when, from which IP address, and a hash of the exact document they saw, which is what makes it evidential. This is general information, not legal advice.' }
      ] },
    templates: { title:'Templates and reusable setups', lede:'If you send the same agreement more than twice, make it a template — the fields, roles, reminders and message are saved once and reused.',
      sections:[
        { h:'Make one', p:'Prepare a document as usual, then choose Save as template instead of Send. Give it a name your team will recognise and describe when to use it. You can also save any envelope you have already sent as a template from its detail view.' },
        { h:'Use roles, not people', p:'A template names roles — Customer, Sales lead, Legal — rather than individual recipients. When someone sends from the template they fill each role in with a real person, so the same setup works for every deal. Assign fields to roles at build time and they land on the right signer automatically.' },
        { h:'Prefill what you already know', p:'Fields can carry a default value, and text fields can be locked so the sender fills them but the signer cannot change them — the right shape for a price, a term length or a contract number.' },
        { h:'Share it with the team', items:['Private — only you can send from it.','Team — anyone in your team can send from it, and only the owner can edit it.','Workspace — available to everyone, typically owned by legal or operations.'] },
        { h:'Keep them honest', p:'Templates drift. Review the workspace set once a quarter: archive anything unused for six months, and check that clause references still match the current contract text. Editing a template never changes envelopes already sent from it.' }
      ] },
    team: { title:'Team, roles and permissions', lede:'Who can see and do what — and how to add people without giving away more than you meant to.',
      sections:[
        { h:'The four roles', items:['Super admin — platform-wide. Manages every tenant, feature flags and billing. Rare, and usually not you.','Org admin — owns one workspace: invites and removes people, sets branding, security policy and integrations, and can see every envelope in the workspace.','Sender — prepares and sends envelopes, and sees the ones they own or that were shared with them.','Viewer — read-only. Can open and download what has been shared with them, and cannot send.'] },
        { h:'Invite someone', p:'From Settings, then Users, choose Invite and enter the address and role. The invitation is valid for seven days and can be revoked before it is accepted. Grant Sender by default and promote later — admin rights are the ones that are hard to take back quietly.' },
        { h:'When someone leaves', p:'Deprovision rather than delete. Deprovisioning revokes access immediately but keeps their name on completed envelopes and in audit trails, which is what makes those records hold up later. Reassign their in-flight envelopes first, or they stall.' },
        { h:'Single sign-on and directory sync', p:'On Business and Enterprise, an org admin can connect SAML single sign-on so people use your identity provider, and SCIM so joiners, movers and leavers are applied automatically. Once SAML is enforced, password sign-in is refused for the workspace — set up and test the connection with a second admin account available before you enforce it.' },
        { h:'Two-factor authentication', p:'Enable it for yourself under your account, or require it workspace-wide from Settings, then Security. Authenticator apps and passkeys are supported; SMS is not, because it is the weakest of the three.' }
      ] },
    security: { title:'Security, audit trail and compliance', lede:'What we record, what an auditor will ask for, and where to find it.',
      sections:[
        { h:'The audit trail', p:'Every envelope carries an append-only log: created, sent, delivered, opened, each field completed, signed, declined, voided, downloaded. Each entry records the actor, an ISO 8601 timestamp, the IP address and the user agent. Nothing in the log can be edited or removed, including by an admin.' },
        { h:'The certificate of completion', p:'Attached to the sealed PDF and downloadable on its own from an envelope. It lists every recipient with their signing method and verification, the full event history, and the SHA-256 hash of the sealed document. If a signature is ever challenged, this is the document you produce.' },
        { h:'Proving a copy is unaltered', p:'Hash the PDF you hold and compare it with the hash on the certificate. If the two match, the file is byte-for-byte the one that was signed. A mismatch means the copy has been re-saved or edited and is not the executed original.' },
        { h:'How data is protected', items:['In transit — TLS 1.2 or better, on every connection.','At rest — AES-256, with documents in per-tenant storage.','Access — scoped API keys, short-lived embed sessions locked to an origin, and optional IP allow-listing for admin surfaces.','Isolation — every query is tenant-scoped; no request can read across workspaces.'] },
        { h:'Retention and deletion', p:'An org admin sets a retention window per document type. Documents past the window are purged on a nightly job, while the audit log and certificate are kept, so a deletion does not destroy the evidence that the agreement existed. Deleting a document from Trash is immediate and cannot be undone.' },
        { h:'What to send an auditor', items:['The sealed PDF for each agreement in scope.','Its certificate of completion.','The exported audit trail (CSV or JSON) from the envelope.','Your workspace security settings — password policy, two-factor requirement, SSO status, retention windows.'] }
      ] },
    faq: { title:'Troubleshooting and FAQ', lede:'The questions support answers most often, with the fix rather than the theory.',
      sections:[
        { h:'A recipient says they never got the email', p:'Check the envelope detail view: it records whether the message was delivered, and to which address. If delivery failed, the address is usually wrong or a corporate filter blocked it — correct the recipient and resend. If it was delivered, ask them to search for the sender name and check spam and quarantine. As a last resort, copy the signing link from the envelope and send it to them yourself, but only to the same address.' },
        { h:'I sent it with a mistake in the document', p:'Void the envelope with a reason, fix the PDF, and send again. Void is the honest option: it notifies everyone and records why. Correct is for smaller repairs — a mistyped email, a field in the wrong place, a missing recipient — and can be used while an envelope is still in flight.' },
        { h:'A field is in the wrong place on the signed PDF', p:'Almost always a rotated page. Fields are stored against the page as the signer saw it, so if you rotate a page after placing fields, re-check the placement before sending. Rotate first, place second.' },
        { h:'The signer cannot finish', items:['Progress counter still shows fields left — they are usually on a page that has scrolled past; Next field jumps to it.','A field rejects their input — it has validation attached and the format does not match, for example a date typed as 3/4 rather than 03/04/2026.','Nothing responds — a browser extension blocking scripts, or a very old browser. Ask them to try a private window, or another device.'] },
        { h:'Can I change a document after it has been signed', p:'No, and that is the point — the sealed PDF is hashed at completion. Send a new envelope for the amended version, and keep the original: the pair of them is the record of what changed and when.' },
        { h:'Can someone sign without an account', p:'Yes. Recipients never need an account, a password or an app. Accounts are only needed to send.' },
        { h:'What happens when a plan runs out of envelopes', p:'Sending is blocked while signing continues — envelopes already out stay live and can still be completed. An org admin can raise the limit from Plans and usage.' },
        { h:'Still stuck', p:'Open the Support screen and raise a ticket from the envelope in question: the envelope id, its audit trail and your workspace details are attached automatically, which is what lets support answer in one reply instead of three.' }
      ] },
  };

/* ── field inspector ── */

export const VALIDATION_REGEX_MAP: Dict<string> ={ none:'— no pattern enforced —', email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$', numeric:'^-?\\d+(\\.\\d+)?$', custom:'^[A-Z]{3}-\\d{4}$' };
export const ROLE_WORDS: Dict<string> = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };

/* ── dashboard / library ── */

export const QUICK_ACCESS: [string, string, number, string][] =[
      ['inbox', 'Inbox / Waiting for me', 3, 'hsl(var(--color-accent-solid))'],
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
  ['libTime', [['all','All time'],['7','Last 7 days'],['30','Last 30 days'],['90','Last quarter'],['custom','Custom range…']]],
  ['libOwner', [['all','All owners'],['me','Owned by me'],['team','My team'],['shared','Shared with me']]]
];
export const LIB_SORT_OPTIONS: [string, string][] = [['recent','Recent'],['name','Name'],['status','Status'],['owner','Owner']];
export const PAGE_THUMB_MENU: [string, string | null][] = [['Insert page above', null], ['Insert page below', null], ['Duplicate page', null], ['Rotate 90°', null], ['Delete page', null]];
export const PALETTE_TABS: [string, string][] = [['all','All fields'],['fav','Favourites']];

/* ── audit / certificate ── */

/* ── platform / super admin ── */

export const PLAN_TONE: Dict<Tone> ={ Enterprise:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-accent-fg))', bd:'hsl(var(--color-accent-border))' }, Business:{ bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' }, Team:{ bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-subtle))', bd:'hsl(var(--color-border-subtle))' } };

export const STATUS_TONE: Dict<Tone> ={ Active:{ bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' }, Trial:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-fg-info))', bd:'hsl(var(--color-accent-border))' }, 'Past due':{ bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' }, Suspended:{ bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' } };
export const ROLE_LABEL: Dict<string> = { super:'Super admin', orgadmin:'Org admin', sender:'Sender', viewer:'Viewer' };
export const PERM_COLUMNS: string[] = ['Super admin','Org admin','Sender','Viewer'];
export const PLATFORM_TABS: [string, string][] = [['tenants','Tenants'],['users','Users & roles'],['flags','Feature flags'],['billing','Plans & usage'],['security','Security & compliance']];

export const FLAG_META: Dict<[string, string]> ={
      'signing.passkey_reuse': ['prod', 'One-click re-use of a device-bound signature for authenticated signers.'],
      'builder.conditional_logic_v2': ['prod', 'Nested conditional rules with multi-trigger AND/OR groups in the field inspector.'],
      'api.bulk_send_v3': ['staging', 'Bulk send endpoint accepting a 10k-row CSV, one envelope per row.'],
      'audit.ledger_anchoring': ['prod', 'Hourly anchoring of document hashes to the append-only verification ledger.'],
      'signing.ai_clause_summary': ['canary', 'Plain-language clause summary shown to signers before execution.']
    };
export const FLAG_ENV_TONE: Dict<Tone> = { prod:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-accent-fg))', bd:'hsl(var(--color-accent-border))' }, staging:{ bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' }, canary:{ bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' } };

/* ── tenant admin overview ── */

/* ── platform overview extras ── */

/* ── billing (tenant) ── */

export const PLAN_PRICES: Dict<string> = { Team:'$12 / seat', Business:'$28 / seat', Enterprise:'$44 / seat' };

/* ── revenue (platform) ── */

/* ── invoices ── */

export const INV_STATUS_TONE: Dict<Tone> ={ paid:{ bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' }, open:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-fg-info))', bd:'hsl(var(--color-accent-border))' }, past_due:{ bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' }, void:{ bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-muted))', bd:'hsl(var(--color-border-subtle))' } };

export const INV_STATUS_LABEL: Dict<string> ={ paid:'Paid', open:'Open', past_due:'Past due', void:'Void' };
export const INVOICE_FILTERS: [string, string][] = [['all','All'],['open','Open'],['paid','Paid'],['past_due','Past due']];

/* ── logs ── */
export const LOG_SOURCES: [string, string][] = [['all','All'],['api','API'],['webhook','Webhooks'],['auth','Auth'],['billing','Billing'],['signing','Signing'],['admin','Admin']];
export const LOG_LEVELS: [string, string][] = [['all','All levels'],['info','Info'],['warn','Warn'],['error','Error']];

export const LEVEL_TONE: Dict<{ bg: string; fg: string }> ={ info:{ bg:'rgba(99,102,241,.18)', fg:'#a5b4fc' }, warn:{ bg:'rgba(245,158,11,.18)', fg:'hsl(var(--color-border-warning))' }, error:{ bg:'rgba(244,63,94,.18)', fg:'#fda4af' } };

/* ── contacts ── */

export const GROUP_LABELS: Dict<string> ={ customers:'Customers', internal:'Internal', counsel:'Counsel', vendors:'Vendors' };

export const SRC_TONE: Dict<Tone> ={ CRM:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-accent-fg))', bd:'hsl(var(--color-accent-border))' }, SCIM:{ bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' }, API:{ bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' }, Manual:{ bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-subtle))', bd:'hsl(var(--color-border-subtle))' } };

export const CONTACT_PALETTE: string[] = ['#10b981','#6366f1','#f59e0b','#0ea5e9','#8b5cf6','#14b8a6','#f43f5e'];

/* ── developer API ── */

/* `sample` is a hand-written **illustrative** payload, not a live response.
   Every identity in it is a documentation placeholder (`example.com`), and
   `ApiScreen` labels the block "Example response" so a developer cannot read
   it as their own directory. */
export const API_DEFS: Dict<{ method: string; path: string; desc: string; params: [string, string, string][]; sample: string }> ={
      whoami: { method:'GET', path:'/api/v1/whoami',
        desc:'Resolves the calling key: which organization it belongs to, which scopes it actually holds, and its mode label. Needs no scope beyond a valid key, so it is the call to make first when a request is failing and you are not certain which key you pasted. API keys never carry platform-admin powers, and this route says so explicitly.',
        params:[],
        sample:'{\n  "organization_id": "org_8842",\n  "mode": "test",\n  "scopes": ["audit:read", "documents:read"],\n  "key_id": "key_8f2c41ab",\n  "is_platform_admin": false\n}' },
      documents: { method:'GET', path:'/api/v1/documents?status=sent',
        desc:'Every document in the calling key’s organization, newest first, as a bare JSON array — there is no cursor, limit or has_more on this surface yet. Requires documents:read. GET /api/v1/documents/{id} returns one, and a document belonging to another tenant answers 404 rather than 403 so the API cannot be used to probe for its existence.',
        params:[['status','enum','draft | prepared | sent | viewed | partially_completed | completed | declined | expired | voided']],
        sample:'[\n  {\n    "id": "doc_example_0001",\n    "organization_id": "org_8842",\n    "sender_id": "usr_8f2c41ab",\n    "title": "Master Services Agreement — Example Industries",\n    "status": "sent",\n    "workflow_type": "sequential",\n    "is_template": false,\n    "page_count": 3,\n    "original_sha256": "9f2b7c41a0e5…",\n    "final_sha256": null,\n    "sent_at": "2026-09-08T11:02:00Z",\n    "completed_at": null,\n    "expires_at": "2026-09-22T11:02:00Z",\n    "reminder_cadence": "48h",\n    "recipients_total": 2,\n    "recipients_completed": 1,\n    "created_at": "2026-09-08T10:58:14Z",\n    "updated_at": "2026-09-08T11:47:03Z"\n  }\n]' },
      audit: { method:'GET', path:'/api/v1/documents/{document_id}/audit-logs',
        desc:'The hash-chained audit trail for one document, oldest first. Requires audit:read. Each entry carries its own checksum and the checksum of the entry before it, so recomputing the chain proves that nothing was inserted, edited or removed — this is the endpoint to mirror into your own system of record when you need evidence rather than status.',
        params:[],
        sample:'[\n  {\n    "id": "aud_0001",\n    "event_type": "document_sent",\n    "event_message": "Sent to 2 recipients.",\n    "actor_email": "ada@example.com",\n    "ip_address": "203.0.113.7",\n    "created_at": "2026-09-08T11:02:00Z",\n    "checksum": "41ab8f2c0d7e…",\n    "previous_checksum": null,\n    "kind": "lifecycle"\n  },\n  {\n    "id": "aud_0002",\n    "event_type": "document_signed",\n    "event_message": "Casey Example signed.",\n    "actor_email": "casey@example.com",\n    "ip_address": "203.0.113.42",\n    "created_at": "2026-09-08T11:47:03Z",\n    "checksum": "9f2b7c41a0e5…",\n    "previous_checksum": "41ab8f2c0d7e…",\n    "kind": "signature"\n  }\n]' },
      users: { method:'GET', path:'/api/v1/users',
        desc:'Members of the calling key’s organization, oldest first. Requires users:read. Use it to map host-application accounts onto SignerPro identities before minting an embed session. The projection is deliberately narrow — no MFA state, no last-active timestamp — so a read-only integration key cannot be turned into a security-posture report on your staff.',
        params:[],
        sample:'[\n  {\n    "id": "usr_8f2c41ab",\n    "name": "Ada Example",\n    "email": "ada@example.com",\n    "role": "orgadmin",\n    "status": "active"\n  },\n  {\n    "id": "usr_91bd7c02",\n    "name": "Blake Example",\n    "email": "blake@example.com",\n    "role": "sender",\n    "status": "invited"\n  }\n]' },
      contacts: { method:'GET', path:'/api/v1/contacts',
        desc:'Address-book entries, oldest first. Requires contacts:read. Read-only on this surface: contacts:write exists in the scope catalogue but no /api/v1 route consults it yet, so creating and updating contacts is done through the session-authenticated app routes (POST /api/contacts, or /api/contacts/import and /import/csv for bulk).',
        params:[],
        sample:'[\n  {\n    "id": "ct1",\n    "name": "Casey Example",\n    "email": "casey@example.com"\n  },\n  {\n    "id": "ct2",\n    "name": "Devon Example",\n    "email": "devon@example.com"\n  }\n]' },
      embed: { method:'POST', path:'/api/embed/sessions',
        desc:'Mints a short-lived, origin-locked embed session. The host app loads the returned url in an iframe and SignerPro lands directly on the chosen surface with the document and contacts you passed in. The url appears in this response only. Note the path: this is an app route, not an /api/v1 one, and it is the supported way to drive preparation or signing from your own application while the public write surface is still session-only.',
        params:[['landing','enum','builder | routing | signing — defaults to builder'],['document','object','document_id or template_id, plus optional title, file_url and external_id'],['recipient_id','string','Required when landing is signing.'],['contacts','array','Inline {id, name, email, role} entries'],['return_url','string','Where the “Return to host app” action navigates. Falls back to the organization default.'],['ttl_minutes','integer','1–1440, defaults to 30.']],
        sample:'{\n  "id": "es_example",\n  "url": "https://app.example.com/embed/builder?session=…",\n  "landing": "builder",\n  "document_id": "doc_8842",\n  "external_id": "hostcrm:deal_8842",\n  "return_url": "https://app.hostcrm.com/deals/8842",\n  "allowed_origins": ["https://app.hostcrm.com"],\n  "contacts": [\n    { "id": "ct1", "name": "Casey Example", "email": "casey@example.com", "role": "sign" }\n  ],\n  "expires_at": "2026-09-08T12:30:00Z",\n  "consumed_at": null,\n  "created_at": "2026-09-08T12:00:00Z",\n  "expired": false\n}' }
    };

export const API_TABS: [string, string][] = [['whoami','Whoami'],['documents','Documents'],['audit','Audit trail'],['users','Users'],['contacts','Contacts'],['embed','Embed session']];
export const EMBED_SNIPPET: string =
  '// your server — the key never reaches the browser\n' +
  'const res = await fetch("https://app.example.com/api/embed/sessions", {\n' +
  '  method: "POST",\n' +
  '  headers: { "X-API-Key": process.env.SIGNERPRO_KEY, "Content-Type": "application/json" },\n' +
  '  body: JSON.stringify({\n' +
  '    landing: "builder",\n' +
  '    document: { document_id: "doc_8842", external_id: "hostcrm:deal_8842" },\n' +
  '    return_url: "https://app.hostcrm.com/deals/8842"\n' +
  '  })\n' +
  '});\n' +
  'const { url } = await res.json();   // single-use, expires in ttl_minutes\n\n' +
  '<!-- host application -->\n' +
  '<' + 'iframe src="{url}" allow="clipboard-write" style="width:100%;height:800px;border:0">' + '<' + '/iframe>';

/* ── support ── */

export const TK_STATUS_TONE: Dict<Tone> ={ open:{ bg:'hsl(var(--color-accent-subtle))', fg:'hsl(var(--color-fg-info))', bd:'hsl(var(--color-accent-border))' }, pending:{ bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' }, escalated:{ bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' }, resolved:{ bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' } };

export const TK_STATUS_LABEL: Dict<string> ={ open:'Open', pending:'Pending customer', escalated:'Escalated', resolved:'Resolved' };

export const TK_PRIO_TONE: Dict<Tone & { c: string }> ={ urgent:{ bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))', c:'#f43f5e' }, high:{ bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))', c:'#f59e0b' }, normal:{ bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-subtle))', bd:'hsl(var(--color-border-subtle))', c:'#8492a6' }, low:{ bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-muted))', bd:'hsl(var(--color-border-subtle))', c:'#8492a6' } };

export const TK_PRIO_LABEL: Dict<string> ={ urgent:'P1 Urgent', high:'P2 High', normal:'P3 Normal', low:'P4 Low' };
export const TICKET_FILTERS: [string, string][] = [['all','All'],['open','Open'],['escalated','Escalated'],['pending','Pending'],['resolved','Resolved']];
export const SLA_MAP: Dict<string> = { urgent:'1h 00m left', high:'4h 00m left', normal:'1d 0h left', low:'3d 0h left' };
/* ── auth ── */

export const STRENGTH_COLORS: string[] =['hsl(var(--color-border-subtle))', '#f43f5e', '#f59e0b', '#6366f1', '#10b981'];

export const STRENGTH_WORDS: string[] =['Use 12+ characters with a number, capital and symbol', 'Weak — add length', 'Fair — add a number or symbol', 'Strong', 'Excellent — meets enterprise policy'];
export const AUTH_TABS: [string, string][] = [['signin','Sign in'],['signup','Create account']];
/* The meta line is shown on the unauthenticated sign-in screen, so it cannot
   name a tenant: the prototype's literal `Acme Corporation` was visible to
   every visitor and implied a real customer of this deployment. It describes
   the scope of the sign-in instead. */

export const AUTH_TITLES: Dict<[string, string]> ={
      signin: ['Sign in to SignerPro', 'Use your work account. Enterprise tenants may be redirected to their identity provider.'],
      signup: ['Create your workspace', 'Start a 14-day Business trial — no card required, 25 envelopes per seat.'],
      mfa: ['Two-factor verification', 'Enter the 6-digit code from your authenticator app.'],
      forgot: ['Reset your password', 'We will email a single-use reset link valid for 30 minutes.']
    };

/* ── signing / modals ── */
export const SIG_TABS: [string, string][] = [['draw','Draw'],['type','Type'],['upload','Upload'],['saved','Saved / Passkey']];
export const TYPE_FACES: string[] = ['Caveat','Dancing Script','Great Vibes','Geist'];

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
      ['billing','Billing & plan'],
      ['security','Settings · login & security'],
      ['notifications','Notifications & email'],
      ['integrations','Integrations'],
      ['organization','Organization & teams'], ['audit','Audit trail'],
      /* Stripe Connect status for this org — its own screen at
         `/account/payments`, same reason `billing` is: it needs more than
         the `[section]` catch-all route gives it. */
      ['payments','Payments'],
      /* Sender branding (ORG-7) — its own screen at `/account/brand`, for the
         same reason as `payments`. */
      ['brand','Branding themes']
];

export const ACCOUNT_TITLES: Dict<[string, string]> ={
      profile:['User profile','Name, photo, locale and signature defaults'],
      billing:['Billing & plan','Plan, seats, renewal, payment methods, and every issued invoice'],
      security:['Settings · login and security','Email, password, two-factor and authenticated devices'],
      notifications:['Notifications & email','Which events notify you, where they are delivered, and who else is copied'],
      integrations:['Integrations','Storage connectors and automatic export of completed documents'],
      organization:['Organization & teams','Your organization, everyone in it, and the teams they work in'],
      audit:['Audit trail','Account-level security and administrative events'],
      brand:['Branding themes','The logo, colours and wording recipients see in invitation emails and while signing']
    };

/* ── global chrome ── */

export const HELP_ITEMS: [string, string | null][] =[
      ['Start product tour', 'tour'], ['Support centre', 'support'], ['Contact support', 'support'],
      ['Guides & docs', 'guides'], ['API console', 'sandbox'], ['Keyboard shortcuts', null]
];
/* ── sandbox & guides ── */

export const SB_LANG_TABS: [string, string][] = [['curl','cURL'],['node','TypeScript'],['python','Python']];
/* `DOC_NAV` is grouped: the third element is the heading a page sits under.
   Everyday users land on `overview`, so the plain-language pages come first
   and the developer reference sits below them rather than in front. */
export const DOC_NAV: [string, string, string][] = [
  ['overview','What SignerPro does','Getting started'],
  ['send','Send a document','Getting started'],
  ['sign','Sign a document','Getting started'],
  ['templates','Templates','Everyday use'],
  ['team','Team & permissions','Everyday use'],
  ['security','Security & audit trail','Everyday use'],
  ['faq','Troubleshooting & FAQ','Everyday use'],
  ['quickstart','Quickstart guide','Developers'],
  ['sandbox','Sandbox & test mode','Developers'],
  ['reference','API reference','Developers'],
  ['embed','Embedding','Developers'],
  ['webhooks','Webhooks','Developers'],
  ['migration','Migration guide','Developers']
];

/* ── nav ──
   The rail and the screen→rail map live in `lib/sf/navigation.ts` and
   `lib/sf/routes.ts`. The prototype's copies lived here and drifted. */

