/* SignForge design data — ported verbatim from the prototype app.js. */

export type Dict<T = any> = { [k: string]: T };
export type Tone = { bg: string; fg: string; bd: string };

export const BLANK_PNG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const ACCENT_DEFAULT = '#4f46e5';

export const TYPES: { id: string; label: string; icon: string; w: number; h: number }[] =[
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
    { id:'formula', label:'Formula', icon:'fx', w:176, h:40 },
    { id:'datetime', label:'Date and Time', icon:'D+', w:196, h:40 }
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

export const REPORT_RECIPIENTS: (string | number)[][] =[
    ['alex.rivera@acme.io', 14, 14, 1, 12, 1, 0, '2h 14m', '92%'],
    ['dana@northwind-legal.com', 38, 38, 2, 34, 1, 1, '1h 50m', '94%'],
    ['m.bell@acme.io', 22, 21, 0, 21, 0, 0, '< 30m', '100%'],
    ['priya@acme.io', 41, 41, 3, 36, 2, 0, '4h 05m', '90%'],
    ['sofia@vertex.dev', 6, 6, 1, 4, 1, 0, '2d 4h', '75%'],
    ['it@halden.de', 9, 9, 2, 6, 0, 1, '1d 6h', '72%'],
    ['elena.ruiz@kestrel.health', 17, 17, 0, 17, 0, 0, '1h 12m', '100%']
  ];

export const ROW_ACTIONS: [string, string | null][] =[
    ['Open', null], ['Prepare and send', 'builder'], ['Add fields', 'builder'], ['Make template', null],
    ['Email a copy', null], ['Create invite link', null], ['Freeform invite', null], ['Notarize', null],
    ['Quick preview', null], ['Share', null], ['Download', null], ['Download with certificate', null],
    ['Print', null], ['Export to cloud', null], ['Move to folder', null], ['Merge document with…', null],
    ['Duplicate', null], ['Rename', null], ['Archive', null], ['Delete', null]
  ];

export const DOCS: { id: string; title: string; pages: number; status: string; signed: number; total: number; updated: string; to: string[] }[] =[
    { id:'ENV-2291-KD', title:'Master Services Agreement — Acme Corp', pages:3, status:'action', signed:1, total:4, updated:'12 min ago', to:['r1','r2'] },
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

export const AUDIT: { action: string; actor: string; time: string; meta: string; checksum: string; kind: string }[] =[
    { action:'Document created', actor:'jordan.mehta@northwind.com', time:'14 Aug 09:02:11 UTC', meta:'198.51.100.24 · Seattle, US · Chrome 138 / macOS 15.4 · session 8f2c…41ab', checksum:'a91f4c07d3', kind:'neutral' },
    { action:'Envelope sent', actor:'system', time:'14 Aug 09:02:44 UTC', meta:'SMTP relay eu-west-1 · 2 recipients · sequential routing', checksum:'be20d7714c', kind:'neutral' },
    { action:'Document viewed', actor:'alex.rivera@acme.io', time:'14 Aug 09:41:07 UTC', meta:'203.0.113.77 · Austin, US · Safari 18.2 / iOS 18.5 · session 1d77…90fe', checksum:'c4470a9b12', kind:'info' },
    { action:'Disclosure accepted', actor:'alex.rivera@acme.io', time:'14 Aug 09:41:33 UTC', meta:'ESIGN consent recorded · disclosure v4.2', checksum:'d8102fe6aa', kind:'info' },
    { action:'Field signed — Client signature', actor:'alex.rivera@acme.io', time:'14 Aug 09:43:02 UTC', meta:'203.0.113.77 · drawn signature · 1120×360 raster · biometric stroke set attached', checksum:'e3bb61c40d', kind:'good' },
    { action:'Field completed — Date signed', actor:'alex.rivera@acme.io', time:'14 Aug 09:43:05 UTC', meta:'value 08/14/2026 · validation date passed', checksum:'f0d9ac2255', kind:'good' },
    { action:'Routed to approver', actor:'system', time:'14 Aug 09:43:09 UTC', meta:'dana@northwind-legal.com notified · reminder cadence 48h', checksum:'0a5ce8b391', kind:'neutral' },
    { action:'Envelope completed', actor:'system', time:'14 Aug 11:18:52 UTC', meta:'all required fields satisfied · PDF sealed · certificate generated', checksum:'17f4bd0c6e', kind:'good' }
  ];

export const TENANTS: { name: string; slug: string; owner: string; plan: string; seats: number; used: number; volume: string; region: string; status: string; mrr: number }[] =[
    { name:'Acme Corporation', slug:'acme', owner:'ops@acme.io', plan:'Enterprise', seats:1240, used:1102, volume:'18,430', region:'us-east-1', status:'Active', mrr:38400 },
    { name:'Northwind Legal', slug:'northwind-legal', owner:'dana@northwind-legal.com', plan:'Enterprise', seats:320, used:287, volume:'6,120', region:'eu-central-1', status:'Active', mrr:11200 },
    { name:'Vertex Robotics', slug:'vertex', owner:'admin@vertex.dev', plan:'Business', seats:180, used:96, volume:'2,940', region:'us-west-2', status:'Trial', mrr:2880 },
    { name:'Halden GmbH', slug:'halden', owner:'it@halden.de', plan:'Business', seats:90, used:88, volume:'1,410', region:'eu-central-1', status:'Past due', mrr:1440 },
    { name:'Kestrel Health', slug:'kestrel', owner:'security@kestrel.health', plan:'Enterprise', seats:640, used:512, volume:'9,780', region:'us-east-1', status:'Active', mrr:20480 },
    { name:'Lumen Studio', slug:'lumen', owner:'hello@lumen.studio', plan:'Team', seats:24, used:21, volume:'310', region:'ap-southeast-2', status:'Suspended', mrr:288 }
  ];

export const PLATFORM_USERS: { name: string; email: string; tenant: string; role: string; mfa: string; last: string }[] =[
    { name:'Jordan Mehta', email:'jordan.mehta@signforge.com', tenant:'SignForge (internal)', role:'super', mfa:'Passkey', last:'2 min ago' },
    { name:'Priya Raman', email:'priya@acme.io', tenant:'Acme Corporation', role:'orgadmin', mfa:'TOTP', last:'18 min ago' },
    { name:'Dana Whitfield', email:'dana@northwind-legal.com', tenant:'Northwind Legal', role:'orgadmin', mfa:'Passkey', last:'1 hour ago' },
    { name:'Marcus Bell', email:'m.bell@acme.io', tenant:'Acme Corporation', role:'sender', mfa:'TOTP', last:'3 hours ago' },
    { name:'Sofia Lindqvist', email:'sofia@vertex.dev', tenant:'Vertex Robotics', role:'sender', mfa:'None', last:'Yesterday' },
    { name:'Tobias Krause', email:'it@halden.de', tenant:'Halden GmbH', role:'viewer', mfa:'TOTP', last:'4 days ago' }
  ];

export const PERMS: [string, number[]][] =[
    ['Manage tenants & billing', [1,0,0,0]],
    ['Impersonate org users', [1,0,0,0]],
    ['Toggle feature flags', [1,0,0,0]],
    ['Invite & deprovision users', [1,1,0,0]],
    ['Create templates & envelopes', [1,1,1,0]],
    ['Send for signature', [1,1,1,0]],
    ['View audit trail & certificates', [1,1,1,1]]
  ];

export const INVOICES: any[] =[
    { number:'INV-2026-0841', tenant:'Acme Corporation', slug:'acme', period:'Aug 2026', status:'open', total:41196, due:'1 Sep', pi:'pi_3QhT7xKzR2', method:'Visa •••• 4242',
      lines:[['Enterprise seats — 1,240 × $44','$54,560.00'],['Annual commitment discount (−30%)','−$16,368.00'],['SMS authentication — 2,310 × $0.02','$46.20'],['Overage envelopes — 0','$0.00']], sub:38238.20, tax:2957.80 },
    { number:'INV-2026-0798', tenant:'Acme Corporation', slug:'acme', period:'Jul 2026', status:'paid', total:40884, due:'1 Aug', pi:'pi_3QfR1aKzR2', method:'Visa •••• 4242',
      lines:[['Enterprise seats — 1,232 × $44','$54,208.00'],['Annual commitment discount (−30%)','−$16,262.40'],['SMS authentication — 1,980 × $0.02','$39.60']], sub:37985.20, tax:2898.80 },
    { number:'INV-2026-0812', tenant:'Northwind Legal', slug:'northwind-legal', period:'Aug 2026', status:'paid', total:11984, due:'1 Sep', pi:'pi_3QhU2bKzR9', method:'ACH •••• 6789',
      lines:[['Enterprise seats — 320 × $44','$14,080.00'],['Multi-year discount (−20%)','−$2,816.00'],['Qualified e-signature (eIDAS) — 42','$630.00']], sub:11894.00, tax:90.00 },
    { number:'INV-2026-0803', tenant:'Vertex Robotics', slug:'vertex', period:'Aug 2026', status:'open', total:2880, due:'1 Sep', pi:'pi_3QhV9cKzRK', method:'Mastercard •••• 5100',
      lines:[['Business seats — 180 × $28 (trial credit applied)','$5,040.00'],['Trial credit','−$2,160.00']], sub:2880.00, tax:0 },
    { number:'INV-2026-0777', tenant:'Halden GmbH', slug:'halden', period:'Jul 2026', status:'past_due', total:1714, due:'overdue 9d', pi:'pi_3QfW4dKzRP', method:'SEPA •••• 2201',
      lines:[['Business seats — 90 × $28','$2,520.00'],['EU volume discount (−15%)','−$378.00'],['Late fee','$32.00']], sub:2174.00, tax:413.06 },
    { number:'INV-2026-0740', tenant:'Kestrel Health', slug:'kestrel', period:'Aug 2026', status:'paid', total:22528, due:'1 Sep', pi:'pi_3QhX7eKzRT', method:'ACH •••• 1188',
      lines:[['Enterprise seats — 640 × $44','$28,160.00'],['HIPAA add-on','$1,200.00'],['Committed-use discount (−25%)','−$7,040.00']], sub:22320.00, tax:208.00 },
    { number:'INV-2026-0699', tenant:'Lumen Studio', slug:'lumen', period:'Jun 2026', status:'void', total:288, due:'voided', pi:'pi_3QcY1fKzRW', method:'Visa •••• 9002',
      lines:[['Team seats — 24 × $12','$288.00'],['Credit note — account suspended','−$288.00']], sub:0, tax:0 }
  ];

export const LOGS: { ts: string; level: string; source: string; slug: string; msg: string; code: string; latency: string; payload: string }[] =[
    { ts:'11:42:08.412', level:'info', source:'api', slug:'acme', msg:'POST /v1/envelopes 201 — envelope ENV-2291-KD created', code:'201', latency:'88ms',
      payload:'{\n  "request_id": "req_8f2c41ab",\n  "actor": "jordan.mehta@northwind.com",\n  "tenant": "acme",\n  "envelope": { "id": "ENV-2291-KD", "fields": 9, "recipients": 3 },\n  "ip": "198.51.100.24"\n}' },
    { ts:'11:42:09.006', level:'info', source:'webhook', slug:'acme', msg:'envelope.sent delivered to https://hooks.acme.io/signforge', code:'200', latency:'142ms',
      payload:'{\n  "event": "envelope.sent",\n  "delivery": "wh_5512aa",\n  "attempts": 1,\n  "signature": "t=1787051129,v1=6b8f…"\n}' },
    { ts:'11:43:02.771', level:'info', source:'signing', slug:'acme', msg:'Field signed — Client signature by alex.rivera@acme.io', code:'—', latency:'—',
      payload:'{\n  "field": "f1",\n  "type": "signature",\n  "capture": "drawn",\n  "raster": "1120x360",\n  "hash": "sha256:e3bb61c40d…",\n  "geo": "Austin, US"\n}' },
    { ts:'11:44:15.203', level:'warn', source:'api', slug:'vertex', msg:'GET /v1/templates 429 — rate limit 500 rps exceeded', code:'429', latency:'12ms',
      payload:'{\n  "request_id": "req_91bd7c02",\n  "tenant": "vertex",\n  "limit": 500,\n  "observed": 612,\n  "retry_after": 1\n}' },
    { ts:'11:45:41.559', level:'error', source:'webhook', slug:'halden', msg:'invoice.payment_failed delivery failed after 4 attempts', code:'502', latency:'30s',
      payload:'{\n  "event": "invoice.payment_failed",\n  "invoice": "INV-2026-0777",\n  "endpoint": "https://halden.de/hooks/sf",\n  "attempts": 4,\n  "next_retry": "2026-08-28T13:10:00Z"\n}' },
    { ts:'11:47:03.884', level:'info', source:'auth', slug:'acme', msg:'SAML assertion accepted — priya@acme.io via Okta', code:'200', latency:'204ms',
      payload:'{\n  "idp": "okta",\n  "session": "sess_44ab19",\n  "mfa": "totp",\n  "assertion_id": "id6f2c…",\n  "clock_skew_ms": 41\n}' },
    { ts:'11:49:22.117', level:'warn', source:'auth', slug:'vertex', msg:'Sign-in without MFA — sofia@vertex.dev (policy grace period)', code:'200', latency:'96ms',
      payload:'{\n  "policy": "require_mfa",\n  "state": "grace",\n  "grace_ends": "2026-09-01",\n  "ip": "203.0.113.145"\n}' },
    { ts:'11:52:10.402', level:'error', source:'api', slug:'kestrel', msg:'POST /v1/envelopes 422 — merge tag {{client.name}} unresolved', code:'422', latency:'34ms',
      payload:'{\n  "request_id": "req_c0d41f7a",\n  "errors": [ { "field": "f3", "code": "merge_unresolved", "tag": "{{client.name}}" } ]\n}' },
    { ts:'11:55:47.938', level:'info', source:'admin', slug:'platform', msg:'Feature flag api.bulk_send_v3 rollout 5% → 10% (staging)', code:'—', latency:'—',
      payload:'{\n  "actor": "jordan.mehta@signforge.com",\n  "flag": "api.bulk_send_v3",\n  "before": { "on": false, "rollout": 5 },\n  "after": { "on": false, "rollout": 10 },\n  "mfa": "stepped_up"\n}' },
    { ts:'11:58:19.640', level:'warn', source:'admin', slug:'platform', msg:'Impersonation session opened — platform → acme (30 min TTL)', code:'—', latency:'—',
      payload:'{\n  "actor": "jordan.mehta@signforge.com",\n  "tenant": "acme",\n  "justification": "INC-4471",\n  "ttl_seconds": 1800,\n  "scopes": ["read:envelopes","read:audit"]\n}' },
    { ts:'12:01:55.288', level:'info', source:'billing', slug:'acme', msg:'Stripe charge succeeded — $40,884.00 (pi_3QfR1aKzR2)', code:'200', latency:'612ms',
      payload:'{\n  "object": "payment_intent",\n  "id": "pi_3QfR1aKzR2",\n  "amount": 4088400,\n  "currency": "usd",\n  "payment_method": "card_visa_4242",\n  "status": "succeeded"\n}' },
    { ts:'12:04:31.905', level:'error', source:'billing', slug:'halden', msg:'Stripe charge failed — insufficient_funds (SEPA •••• 2201)', code:'402', latency:'884ms',
      payload:'{\n  "object": "payment_intent",\n  "id": "pi_3QfW4dKzRP",\n  "amount": 171400,\n  "decline_code": "insufficient_funds",\n  "dunning_step": 4,\n  "next_attempt": "2026-08-30T09:00:00Z"\n}' }
  ];

export const TOUR: any[] =[
    { title:'Two levels of navigation', body:'The dark rail switches product area — Documents, Contacts, Reports, Billing, Developer, Support. It also carries your avatar for account settings and sign-out.',
      ws:'tenant', screen:'tenantHome', spot:{ left:6, top:52, width:64, height:300 }, card:{ left:96, top:120 } },
    { title:'The contextual sidebar', body:'The second sidebar belongs to whichever rail section is active: screens on top, then that area’s own navigation — quick-access buckets and folders for Documents, dashboards for Reports, sections for Developer.',
      ws:'tenant', screen:'tenantHome', spot:{ left:78, top:52, width:238, height:420 }, card:{ left:336, top:150 } },
    { title:'Tenant overview', body:'Your org’s home: envelopes needing action, weekly volume, seat activation, spend for the cycle and an attention queue that deep-links into the right screen.',
      ws:'tenant', screen:'tenantHome', spot:{ left:330, top:120, width:560, height:280 }, card:{ left:340, top:420 } },
    { title:'The document library', body:'Folders, archive, templates and trash on the left; filters, sort, bulk selection and a twenty-action row menu on the right — invite links, freeform invites, notarisation, merge, move, duplicate and cloud export.',
      ws:'tenant', screen:'dashboard', spot:{ left:330, top:150, width:600, height:330 }, card:{ left:346, top:500 } },
    { title:'Prepare, then set up and send', body:'Preparation is a two-step wizard. Step one is the three-pane builder: recipients and field palette, the page canvas with an 8px snap grid, and the inspector for validation, conditional logic and merge tags.',
      ws:'tenant', screen:'builder', spot:{ left:320, top:120, width:620, height:64 }, card:{ left:340, top:220 } },
    { title:'The signer experience', body:'What your recipients see: a sticky completion bar, a jump-to-next-required-field button, and a signature modal that draws, types, uploads or re-uses a passkey-bound signature.',
      ws:'tenant', screen:'sign', spot:{ left:330, top:120, width:600, height:110 }, card:{ left:350, top:260 } },
    { title:'Reports and exports', body:'Sent-invite breakdowns, completion rate and median time, per-recipient behaviour, template usage, plus a custom builder and scheduled CSV exports.',
      ws:'tenant', screen:'reports', spot:{ left:330, top:130, width:600, height:300 }, card:{ left:346, top:450 } },
    { title:'Billing runs on Stripe', body:'Subscription and seats, payment methods with autopay, an upcoming-invoice preview, plus invoices with payment intents, receipts and one-click pay.',
      ws:'tenant', screen:'billing', spot:{ left:330, top:120, width:560, height:280 }, card:{ left:340, top:420 } },
    { title:'Use it as an add-on', body:'Expose users, contacts and documents over REST, mint an origin-locked embed session, then land your users straight on the preparation surface with document and contact metadata already attached.',
      ws:'tenant', screen:'api', spot:{ left:330, top:120, width:600, height:140 }, card:{ left:350, top:290 } },
    { title:'Sandbox and guides', body:'Compose a call against seeded test data, read the response and copy the snippet in cURL, TypeScript, Python or PHP — with quickstart, reference, embedding, webhook and migration guides alongside.',
      ws:'tenant', screen:'sandbox', spot:{ left:330, top:120, width:520, height:300 }, card:{ left:340, top:440 } },
    { title:'Support, both sides', body:'Tenants raise tickets with SLA-aware priorities; the platform queue adds assignment, escalation and internal notes that stay invisible to the customer.',
      ws:'tenant', screen:'support', spot:{ left:330, top:120, width:420, height:320 }, card:{ left:770, top:200 } },
    { title:'The platform workspace', body:'Switch to super admin for tenants, impersonation, roles, feature flags, revenue and Stripe payouts, cross-tenant invoices, logs and security posture.',
      ws:'platform', screen:'platformHome', spot:{ left:78, top:52, width:238, height:120 }, card:{ left:336, top:170 } }
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
        { h:'Mount the iframe', p:'The helper handles resizing, focus and postMessage events for you.', code:'SignForge.mount("#agreement", {\n  session: "es_7d10c2e4",\n  onComplete: (envelope) => host.save(envelope.id),\n  onCancel: () => host.close()\n});' },
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

export const SANDBOX_RESPONSES: Dict<string> ={
    'GET /v1/users': '{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    { "id": "usr_8f2c41ab", "name": "Priya Raman", "email": "priya@acme.io", "role": "orgadmin", "mfa": "totp", "status": "active" },\n    { "id": "usr_91bd7c02", "name": "Marcus Bell", "email": "m.bell@acme.io", "role": "sender", "mfa": "totp", "status": "active" }\n  ]\n}',
    'GET /v1/contacts': '{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    { "id": "ct1", "name": "Alex Rivera", "email": "alex.rivera@acme.io", "default_role": "sign", "group": "customers" },\n    { "id": "ct2", "name": "Dana Whitfield", "email": "dana@northwind-legal.com", "default_role": "approve", "group": "counsel" }\n  ]\n}',
    'GET /v1/documents': '{\n  "object": "list",\n  "has_more": true,\n  "data": [\n    { "id": "ENV-2291-KD", "title": "Master Services Agreement — Acme Corp", "status": "action_required", "field_count": 9 }\n  ]\n}',
    'POST /v1/documents': '{\n  "id": "ENV-2304-QA",\n  "title": "Master Services Agreement — Acme Corp",\n  "status": "draft",\n  "page_count": 3,\n  "created_at": "2026-08-28T12:04:11Z"\n}',
    'POST /v1/embed/sessions': '{\n  "object": "embed_session",\n  "id": "es_7d10c2e4",\n  "url": "https://embed.signforge.com/s/es_7d10c2e4",\n  "expires_at": "2026-08-28T12:34:00Z"\n}',
    'GET /v1/templates': '{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    { "id": "TPL-014", "title": "Master Services Agreement — standard", "uses": 128, "fields": 9 }\n  ]\n}'
  };

/* ── field inspector ── */

export const VALIDATION_REGEX_MAP: Dict<string> ={ none:'— no pattern enforced —', email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$', date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$', numeric:'^-?\\d+(\\.\\d+)?$', custom:'^[A-Z]{3}-\\d{4}$' };
export const MERGE_SUGGESTIONS: string[] = ['{{client.name}}','{{client.email}}','{{contract.amount}}','{{contract.signedAt}}'];
export const ROLE_WORDS: Dict<string> = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };

/* ── dashboard / library ── */

export const DOC_FILTER_DEFS: [string, string][] =[['all','All'],['action','Action required'],['waiting','Waiting'],['completed','Completed'],['draft','Drafts'],['voided','Voided']];
export const DOC_ROW_ACTIONS: [string, string | null][] = [
  ['Resend notification', 'Reminder queued for 2 recipients'],
  ['Void agreement', 'Envelope voided — recipients notified'],
  ['Duplicate as template', 'Template created from '],
  ['Download certificate', 'Certificate of completion downloaded'],
  ['Open audit trail', null]
];
export const docCounts = (): Dict<number> => {
  const counts: Dict<number> = { all: DOCS.length };
  ['action','waiting','completed','draft','voided'].forEach(k => { counts[k] = DOCS.filter(d => d.status === k).length; });
  return counts;
};
export const DASHBOARD_STATS: { label: string; value: string; delta: string; good: boolean; pct: number }[] = [
      { label:'ACTION REQUIRED', value:String(docCounts().action), delta:'+2 today', good:false, pct:38 },
      { label:'OUT FOR SIGNATURE', value:String(docCounts().waiting), delta:'avg 4.2h', good:true, pct:62 },
      { label:'COMPLETED · 30D', value:'127', delta:'+18%', good:true, pct:84 },
      { label:'COMPLETION RATE', value:'94.2%', delta:'+1.4 pts', good:true, pct:94 }
];

export const QUICK_ACCESS: [string, string, number, string][] =[
      ['inbox', 'Inbox / Waiting for me', 3, '#4f46e5'],
      ['outbox', 'Outbox / Waiting for others', 12, '#0ea5e9'],
      ['completed', 'Completed / Signed', 127, '#10b981'],
      ['drafts', 'Drafts', 4, '#94a3b8'],
      ['favorites', 'Favorites', 6, '#f43f5e'],
      ['expiring', 'Expiring soon', 2, '#f59e0b'],
      ['shared', 'Shared with me', 9, '#8b5cf6'],
      ['mine', 'Owned by me', 88, '#64748b']
];
export const LIB_FOLDERS: [string, string, string][] = [
  ['documents', 'Documents', '1,564'], ['archive', 'Archive', '31'],
  ['templates', 'Templates', String(TEMPLATES.length)], ['trash', 'Trash', '7']
];

export const TEAM_FOLDERS: [string, number][] = [['Global Legal', 214], ['Sales — Americas', 118], ['Procurement', 46]];

export const FOLDER_STATUS_MAP: Dict<string> ={ inbox:'action', outbox:'waiting', completed:'completed', drafts:'draft', expiring:'waiting', favorites:'all', shared:'all', mine:'all', documents:'all', archive:'all', trash:'voided' };
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

export const CERT_ROWS: { k: string; v: string }[] =[
      { k:'Envelope ID', v:'ENV-2291-KD' }, { k:'Signers', v:'2 of 2 completed' },
      { k:'Sealed at', v:'14 Aug 2026 11:18:52 UTC' }, { k:'Hash algorithm', v:'SHA-256 / RFC 3161 TSA' },
      { k:'Time source', v:'DigiCert TSA · UTC' }, { k:'Certificate authority', v:'SignForge Trust Services' }
];

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

export const PLANS: { name: string; price: string; tag: string; tone: Tone; lines: { k: string; v: string }[] }[] =[
      { name:'Team', price:'$12', tag:'Self-serve', tone:{ bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' },
        lines:[{k:'Envelopes / seat',v:'25 / mo'},{k:'Templates',v:'10'},{k:'Routing',v:'Sequential'},{k:'Retention',v:'1 year'}] },
      { name:'Business', price:'$28', tag:'Most adopted', tone:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' },
        lines:[{k:'Envelopes / seat',v:'Unlimited'},{k:'Templates',v:'Unlimited'},{k:'Routing',v:'Seq + parallel'},{k:'Retention',v:'3 years'}] },
      { name:'Enterprise', price:'$44', tag:'SSO · SCIM · residency', tone:{ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' },
        lines:[{k:'Envelopes / seat',v:'Unlimited'},{k:'API rate',v:'500 rps'},{k:'Routing',v:'All + approvals'},{k:'Retention',v:'7 years + legal hold'}] }
];

export const USAGE_ROWS: { label: string; pct: number; value: string }[] =[
      { label:'Envelopes sent', pct:74, value:'38,912 / 52,500' },
      { label:'API calls', pct:41, value:'4.1M / 10M' },
      { label:'Storage', pct:58, value:'1.16 TB / 2 TB' },
      { label:'SMS authentications', pct:23, value:'2,310 / 10,000' }
];

export const SEC_DEFS: [string, string, string][] =[
      ['sso', 'SAML 2.0 / OIDC single sign-on', 'Okta · enforced for 4 of 6 tenants'],
      ['scim', 'SCIM 2.0 provisioning', 'deprovision within 60s of IdP removal'],
      ['ipAllow', 'IP allowlist for admin console', 'currently open to all egress ranges'],
      ['residency', 'Regional data residency pinning', 'us-east-1 · eu-central-1 · ap-southeast-2'],
      ['keyRotation', 'HSM key rotation (90 days)', 'last rotated 22 days ago'],
      ['dlp', 'DLP scanning on uploaded documents', 'blocks PII patterns before send']
    ];

export const PLATFORM_AUDIT: [string, string][] =[
      ['Feature flag changed', 'jordan.mehta@signforge.com · api.bulk_send_v3 · 10% staging · 198.51.100.24'],
      ['Impersonation session', 'jordan.mehta → acme · 30 min TTL · justification #INC-4471'],
      ['Tenant suspended', 'lumen · non-payment · automated dunning step 4'],
      ['Key rotation completed', 'HSM cluster us-east-1 · 4,102 envelopes re-sealed'],
      ['SCIM deprovision', 'sofia@vertex.dev removed from IdP · access revoked in 41s']
];
export const CERTIFICATIONS: string[] = ['SOC 2 Type II','ISO 27001','ISO 27018','HIPAA','21 CFR Part 11','eIDAS QES','GDPR','FedRAMP (in process)'];
export const PLATFORM_STATS_META: { label: string; value?: string; meta: string; good: boolean }[] = [
  { label:'TENANTS', meta:'2 in trial · 1 suspended', good:true },
  { label:'SEATS PROVISIONED', meta:'88% activated', good:true },
  { label:'ENVELOPES · 30D', value:'38.9k', meta:'+12.4% vs prior', good:true },
  { label:'MRR', meta:'net retention 118%', good:true },
  { label:'INCIDENTS · 90D', value:'0', meta:'99.99% signing uptime', good:true }
];

/* ── tenant admin overview ── */

export const ORG_STATS: { label: string; value: string; meta: string; good: boolean; pct: number }[] =[
      { label:'ACTION REQUIRED', value:'3', meta:'2 overdue', good:false, pct:36 },
      { label:'OUT FOR SIGNATURE', value:'12', meta:'avg 4.2h', good:true, pct:58 },
      { label:'SEATS ACTIVATED', value:'1,102', meta:'of 1,240', good:true, pct:89 },
      { label:'COMPLETION RATE', value:'94.2%', meta:'+1.4 pts', good:true, pct:94 }
];

export const ORG_SERIES: number[] =[318, 402, 366, 471, 508, 442, 530, 486, 612, 574, 538, 596];

export const ORG_ATTENTION: [string, string, string, string][] =[
      ['3 envelopes awaiting your signature', 'oldest waiting 2 days · Contractor Agreement', 'dashboard', '#f59e0b'],
      ['Invoice INV-2026-0841 due 1 Sep', '$41,196.00 · autopay scheduled', 'invoices', ACCENT_DEFAULT],
      ['2 users without MFA enrolled', 'policy grace period ends 1 Sep', 'platform', '#f43f5e'],
      ['Template “Order Form” has unmapped merge tags', '{{contract.amount}} unresolved on page 2', 'builder', '#64748b']
];

export const ORG_SPEND_LINES: { k: string; v: string }[] =[
      { k:'Enterprise seats · 1,240', v:'$54,560.00' },
      { k:'Annual commitment discount', v:'−$16,368.00' },
      { k:'SMS authentication · 2,310', v:'$46.20' },
      { k:'Estimated tax', v:'$2,957.80' }
    ];

export const ORG_TEAM: [string, string, string][] =[
      ['Priya Raman', 'Org admin · last active 18 min ago', '41 sent'],
      ['Marcus Bell', 'Sender · last active 3 hours ago', '28 sent'],
      ['Jordan Mehta', 'Legal ops · last active 2 min ago', '19 sent'],
      ['Dana Whitfield', 'Approver · last active 1 hour ago', '12 approved']
];

/* ── platform overview extras ── */

export const MRR_SERIES: number[] =[41, 44, 46, 49, 52, 56, 59, 63, 66, 68, 71, 74.7];

export const DUNNING: [string, string][] =[
      ['Halden GmbH', 'INV-2026-0777 · $1,714 · step 4 of 5 · SEPA insufficient funds'],
      ['Vertex Robotics', 'INV-2026-0803 · $2,880 · trial converts in 4 days'],
      ['Lumen Studio', 'INV-2026-0699 · voided · credit note issued']
];

export const HEALTH: [string, string, string][] =[
      ['Signing API', 'p95 88ms', '#10b981'], ['PDF render workers', 'p95 240ms', '#10b981'],
      ['Webhook delivery', '99.8% · 1 endpoint failing', '#f59e0b'], ['Stripe connectivity', 'operational', '#10b981'],
      ['Ledger anchoring', 'last anchor 12 min ago', '#10b981']
];

/* ── billing (tenant) ── */

export const PM_DEFS: { id: string; brand: string; label: string; meta: string }[] =[
      { id:'pm_visa', brand:'VISA', label:'Visa •••• 4242', meta:'exp 09/29 · Priya Raman · US' },
      { id:'pm_ach', brand:'ACH', label:'Wells Fargo •••• 6789', meta:'business checking · instant-verified' }
    ];

export const UPCOMING_LINES: { d: string; amt: string }[] =[
      { d:'Enterprise seats — 1,240 × $44', amt:'$54,560.00' },
      { d:'Annual commitment discount (−30%)', amt:'−$16,368.00' },
      { d:'SMS authentication — 2,310 × $0.02', amt:'$46.20' },
      { d:'Estimated tax (CA 8.625%)', amt:'$2,957.80' }
    ];

export const CHARGES: [string, string, string, string][] =[
      ['$40,884.00', 'pi_3QfR1aKzR2 · Visa •••• 4242 · 1 Aug 2026', 'Succeeded', 'good'],
      ['$40,102.00', 'pi_3QbM8yKzR2 · Visa •••• 4242 · 1 Jul 2026', 'Succeeded', 'good'],
      ['$1,240.00', 'pi_3QaL4pKzR2 · seat add-on proration · 18 Jun', 'Succeeded', 'good'],
      ['$40,102.00', 'pi_3QZK2nKzR2 · card declined, retried', 'Recovered', 'warn']
];
export const SUB_TILES_META: { label: string; value: string; meta: string }[] = [
  { label:'SEATS', value:'1,240', meta:'1,102 activated' },
  { label:'NEXT INVOICE', value:'$41,196', meta:'1 Sep 2026' }
];
export const PLAN_PRICES: Dict<string> = { Team:'$12 / seat', Business:'$28 / seat', Enterprise:'$44 / seat' };

/* ── revenue (platform) ── */

export const REVENUE_STATS: { label: string; value: string; meta: string; good: boolean }[] =[
      { label:'MRR', value:'$74.7k', meta:'+4.2% MoM', good:true },
      { label:'ARR', value:'$896k', meta:'118% NRR', good:true },
      { label:'GROSS VOLUME · 30D', value:'$81.3k', meta:'42 charges', good:true },
      { label:'FAILED PAYMENTS', value:'2', meta:'$4.6k at risk', good:false }
];

export const BALANCE_TILES: { label: string; value: string; meta: string }[] =[
      { label:'AVAILABLE', value:'$62,418', meta:'usd · instant payout eligible' },
      { label:'PENDING', value:'$18,905', meta:'settles in 2 days' },
      { label:'NEXT PAYOUT', value:'$62,418', meta:'29 Aug · Chase •••• 3391' },
      { label:'DISPUTES', value:'$0', meta:'0 open · 0.0% rate' }
    ];

export const SUBS_BY_PLAN: { name: string; count: number; mrr: number; pct: number }[] =[
      { name:'Enterprise', count:3, mrr:70080, pct:94 },
      { name:'Business', count:2, mrr:4320, pct:22 },
      { name:'Team', count:1, mrr:288, pct:6 }
];

export const CHURN_ROWS: { k: string; v: string; tone: string }[] =[
      { k:'Gross churn (logo)', v:'1.2%', tone:'good' }, { k:'Net revenue retention', v:'118%', tone:'good' },
      { k:'Involuntary churn (payments)', v:'0.4%', tone:'warn' }, { k:'Trial → paid conversion', v:'62%', tone:'good' }
];

export const STRIPE_WEBHOOKS: [string, string, string, string, string][] =[
      ['invoice.paid', 'evt_1QhT7a', '200', '11:58:02', 'good'],
      ['customer.subscription.updated', 'evt_1QhT52', '200', '11:41:18', 'good'],
      ['checkout.session.completed', 'evt_1QhSz9', '200', '10:22:47', 'good'],
      ['invoice.payment_failed', 'evt_1QhSw1', '502', '09:47:11', 'bad'],
      ['payment_intent.succeeded', 'evt_1QhSm4', '200', '09:12:36', 'good'],
      ['customer.subscription.trial_will_end', 'evt_1QhSg8', '200', '08:04:52', 'good']
];

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

export const CT_HISTORY: [string, string, string, string][] =[
      ['Master Services Agreement — Acme Corp', 'ENV-2291-KD · signed 14 Aug 2026', 'Completed', 'good'],
      ['Order Form — Enterprise Tier Renewal', 'ENV-2271-TT · sent 25 Aug 2026', 'Waiting', 'info'],
      ['Mutual NDA — Vertex Robotics', 'ENV-2287-QB · viewed 27 Aug 2026', 'Viewed', 'info'],
];
export const CONTACT_PALETTE: string[] = ['#10b981','#6366f1','#f59e0b','#0ea5e9','#8b5cf6','#14b8a6','#f43f5e'];

/* ── developer API ── */

export const API_DEFS: Dict<{ method: string; path: string; desc: string; params: [string, string, string][]; sample: string }> ={
      users: { method:'GET', path:'/v1/users?limit=25&status=active',
        desc:'Returns every user in the authenticated tenant with role, MFA state and last activity. Use this to map host-application accounts to SignForge identities before launching an embed session.',
        params:[['limit','integer','Page size, 1–100. Defaults to 25.'],['status','enum','active | invited | deprovisioned'],['role','enum','super | orgadmin | sender | viewer'],['updated_after','ISO 8601','Incremental sync cursor.']],
        sample:'{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    {\n      "id": "usr_8f2c41ab",\n      "name": "Priya Raman",\n      "email": "priya@acme.io",\n      "role": "orgadmin",\n      "tenant": "acme",\n      "mfa": "totp",\n      "status": "active",\n      "last_active_at": "2026-08-28T11:47:03Z"\n    },\n    {\n      "id": "usr_91bd7c02",\n      "name": "Marcus Bell",\n      "email": "m.bell@acme.io",\n      "role": "sender",\n      "tenant": "acme",\n      "mfa": "totp",\n      "status": "active",\n      "last_active_at": "2026-08-28T08:12:44Z"\n    }\n  ]\n}' },
      contacts: { method:'GET', path:'/v1/contacts?group=customers',
        desc:'Address-book entries available as envelope recipients. Writable with contacts:write — POST the same shape to create, PATCH /v1/contacts/{id} to update.',
        params:[['group','enum','customers | internal | counsel | vendors'],['q','string','Free-text match on name, email, company or tag.'],['source','enum','crm | scim | api | manual'],['expand','array','history, envelopes']],
        sample:'{\n  "object": "list",\n  "has_more": false,\n  "data": [\n    {\n      "id": "ct1",\n      "name": "Alex Rivera",\n      "email": "alex.rivera@acme.io",\n      "company": "Acme Corporation",\n      "default_role": "sign",\n      "group": "customers",\n      "source": "crm",\n      "tags": ["MSA", "Renewal 2026"],\n      "envelope_count": 14\n    }\n  ]\n}' },
      documents: { method:'GET', path:'/v1/documents?status=action_required',
        desc:'Envelope metadata with recipients, field counts and progress. Pair with GET /v1/documents/{id}/audit for the tamper-evident log and /certificate for the sealed PDF.',
        params:[['status','enum','draft | sent | action_required | completed | voided'],['contact_id','string','Filter by a contact appearing as recipient.'],['include','array','fields, recipients, audit'],['created_after','ISO 8601','Range filter.']],
        sample:'{\n  "object": "list",\n  "has_more": true,\n  "data": [\n    {\n      "id": "ENV-2291-KD",\n      "title": "Master Services Agreement — Acme Corp",\n      "status": "action_required",\n      "page_count": 3,\n      "field_count": 9,\n      "recipients": [\n        { "contact_id": "ct1", "role": "sign", "routing_order": 1, "status": "viewed" },\n        { "contact_id": "ct2", "role": "approve", "routing_order": 2, "status": "sent" }\n      ],\n      "expires_at": "2026-09-11T00:00:00Z",\n      "hash": "sha256:9f2b7c41a0e5…"\n    }\n  ]\n}' },
      embed: { method:'POST', path:'/v1/embed/sessions',
        desc:'Mints a short-lived, origin-locked session token. The host app opens the returned url in an iframe and SignForge lands directly on the preparation surface with the document and contacts you passed in.',
        params:[['document','object','title, file_url or template_id, external_id'],['contacts','array','Contact ids or inline {name, email, role}'],['landing','enum','builder | routing | signing'],['return_url','string','Where the “Return to host app” action navigates.']],
        sample:'{\n  "object": "embed_session",\n  "id": "es_7d10c2e4",\n  "url": "https://embed.signforge.com/s/es_7d10c2e4",\n  "expires_at": "2026-08-28T12:34:00Z",\n  "landing": "builder",\n  "document": {\n    "title": "Master Services Agreement — Acme Corp",\n    "external_id": "hostcrm:deal_8842",\n    "page_count": 3\n  },\n  "contacts": [\n    { "id": "ct1", "role": "sign", "routing_order": 1 },\n    { "id": "ct2", "role": "approve", "routing_order": 2 }\n  ]\n}' }
    };

export const API_TABS: [string, string][] = [['users','Users'],['contacts','Contacts'],['documents','Documents'],['embed','Embed session']];
export const API_STATS_META: { label: string; value?: string; meta: string; good: boolean }[] = [
  { label:'REQUESTS · 24H', value:'128.4k', meta:'p95 88ms', good:true },
  { label:'ERROR RATE', value:'0.04%', meta:'12 of 128.4k', good:true },
  { label:'ACTIVE KEYS', meta:'1 revoked', good:true },
  { label:'EMBED SESSIONS · 24H', value:'642', meta:'avg 6m 12s', good:true }
];
export const EMBED_SNIPPET: string =
  '<!-- host application -->\n' +
  '<' + 'script' + ' src="https://embed.signforge.com/v1.js">' + '<' + '/script>' + '\n' +
  '<' + 'script' + '>\n  SignForge.mount("#agreement", {\n    session: "es_7d10c2e4",      // POST /v1/embed/sessions\n    landing: "builder",\n    metadata: {\n      document: { external_id: "hostcrm:deal_8842" },\n      contacts: ["ct1", "ct2"]\n    },\n    onComplete: (envelope) => host.save(envelope.id)\n  });\n' +
  '<' + '/script>';

/* ── support ── */

export const AGENTS: { id: string; name: string }[] =[
      { id:'ag1', name:'Unassigned' }, { id:'ag2', name:'Marco Diaz · Signing' },
      { id:'ag3', name:'Amelia Chen · Platform' }, { id:'ag4', name:'Ravi Patel · Billing' }
    ];

export const TK_STATUS_TONE: Dict<Tone> ={ open:{ bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }, pending:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }, escalated:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }, resolved:{ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } };

export const TK_STATUS_LABEL: Dict<string> ={ open:'Open', pending:'Pending customer', escalated:'Escalated', resolved:'Resolved' };

export const TK_PRIO_TONE: Dict<Tone & { c: string }> ={ urgent:{ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca', c:'#f43f5e' }, high:{ bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa', c:'#f59e0b' }, normal:{ bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee', c:'#94a3b8' }, low:{ bg:'#f5f6f8', fg:'#64748b', bd:'#e3e7ee', c:'#cbd5e1' } };

export const TK_PRIO_LABEL: Dict<string> ={ urgent:'P1 Urgent', high:'P2 High', normal:'P3 Normal', low:'P4 Low' };
export const TICKET_FILTERS: [string, string][] = [['all','All'],['open','Open'],['escalated','Escalated'],['pending','Pending'],['resolved','Resolved']];
export const SLA_MAP: Dict<string> = { urgent:'1h 00m left', high:'4h 00m left', normal:'1d 0h left', low:'3d 0h left' };
export const TICKET_STATS_PLATFORM: { label: string; value?: string; meta: string; good: boolean }[] = [
  { label:'OPEN', meta:'2 breaching soon', good:false },
  { label:'FIRST RESPONSE', value:'22m', meta:'target 1h', good:true },
  { label:'CSAT · 30D', value:'4.8', meta:'128 responses', good:true }
];
export const TICKET_STATS_TENANT: { label: string; value?: string; meta: string; good: boolean }[] = [
  { label:'YOUR OPEN TICKETS', meta:'1 escalated', good:false },
  { label:'AVG RESPONSE', value:'22m', meta:'Enterprise SLA 1h', good:true },
  { label:'RESOLVED · 90D', value:'14', meta:'avg 5h 40m', good:true }
];
export const TICKET_QUICK_REPLIES_PLATFORM: [string, string][] = [
  ['Ask for logs', 'Could you share the request id and the exact timestamp (UTC) so we can pull the delivery log?'],
  ['Send workaround', 'As an interim path, typed signatures carry the same legal weight and are recorded identically in the audit trail.'],
  ['Confirm fix ETA', 'Engineering has this in the current sprint — I will confirm the release window within one business day.']
];
export const TICKET_QUICK_REPLIES_TENANT: [string, string][] = [
  ['Add urgency', 'This is blocking a signature due today — please treat as P1.'],
  ['Attach envelope', 'Reproduced on envelope ENV-2291-KD, page 1, signature field f1.'],
  ['Request call', 'Could we get a 15-minute screen share with an engineer today?']
];
export const NEW_TICKET_SLA_NOTE = 'Enterprise SLA: P1 responded within 1 hour, 24/7. P3 within one business day.';

/* ── auth ── */

export const STRENGTH_COLORS: string[] =['#e3e7ee', '#f43f5e', '#f59e0b', '#6366f1', '#10b981'];

export const STRENGTH_WORDS: string[] =['Use 12+ characters with a number, capital and symbol', 'Weak — add length', 'Fair — add a number or symbol', 'Strong', 'Excellent — meets enterprise policy'];
export const AUTH_TABS: [string, string][] = [['signin','Sign in'],['signup','Create account']];
export const AUTH_ROLES: [string, string, string][] = [['tenant','Tenant admin','Acme Corporation'],['platform','Super admin','SignForge platform']];

export const AUTH_TITLES: Dict<[string, string]> ={
      signin: ['Sign in to SignForge', 'Use your work account. Enterprise tenants may be redirected to their identity provider.'],
      signup: ['Create your workspace', 'Start a 14-day Business trial — no card required, 25 envelopes per seat.'],
      mfa: ['Two-factor verification', 'Enter the 6-digit code from your authenticator app.'],
      forgot: ['Reset your password', 'We will email a single-use reset link valid for 30 minutes.']
    };

/* ── signing / modals ── */
export const SIG_TABS: [string, string][] = [['draw','Draw'],['type','Type'],['upload','Upload'],['saved','Saved / Passkey']];
export const TYPE_FACES: string[] = ['Caveat','Dancing Script','Great Vibes','Google Sans Flex'];

export const SAVED_SIGS: { label: string; meta: string; face: string }[] =[
      { label:'Adopted 12 Aug 2026', meta:'passkey · Touch ID · device-bound', face:'Caveat' },
      { label:'Adopted 3 Mar 2026', meta:'drawn · archived raster', face:'Great Vibes' }
];
export const INKS: [string, string][] = [['#0f172a','Black ink'],['#1d4ed8','Blue ink']];
export const CADENCES: string[] = ['24h','48h','7 days','none'];
export const MODAL_COPY_STATIC: Dict<[string, string, string, string]> = {
      disclosure: ['Electronic Record and Signature Disclosure', 'Please read before signing electronically', 'By selecting \u201cI agree\u201d, you consent to receive records and signable documents electronically for this transaction and any related transactions. You may withdraw consent at any time by contacting the sender, in which case paper copies will be provided at no charge. You confirm you can access PDF documents and retain a copy for your records. Hardware requirements: a current browser, an internet connection, and 20 MB of available storage. This disclosure is version 4.2 and will be recorded in the audit trail with your IP address and timestamp.', 'I agree'],
      decline: ['Decline to sign', 'The sender is notified immediately and the envelope is voided', 'Declining stops the signing workflow for every remaining recipient. Your reason is recorded in the tamper-evident audit trail and shared with the sender.', 'Confirm decline'],
      reassign: ['Reassign signer', 'Delegate your signing responsibility', 'The new signer receives the envelope with your assigned fields. Your original invitation is revoked and the reassignment is written to the audit trail with both email addresses.', 'Send reassignment'],
};

/* The `send` modal copy is state-dependent; build it in the screen:
   ['Send for signature', 'Review before the envelope leaves your workspace',
    'ENV-2291-KD · 3 pages · ' + fields.length + ' fields across ' + recips.length + ' recipients. Routing is ' + routing +
    ', reminders ' + (cadence === 'none' ? 'disabled' : 'every ' + cadence) + ', expiring in ' + expiry + ' days.', 'Send envelope'] */

export const PAY_TITLES: Dict<[string, string]> ={
      card: ['Payment method', 'Tokenised by Stripe — card, ACH/SEPA or invoice billing'],
      seats: ['Add seats', 'Prorated for the remainder of this cycle'],
      plan: ['Change plan', 'Applies immediately with proration'],
      pay: ['Pay invoice', 'Charged through Stripe with instant confirmation'],
      ticket: ['New support ticket', 'Routed by category with SLA based on priority'],
      contact: ['New contact', 'Saved to the address book and exposed over the contacts API']
    };

/* ── reports ── */

export const REPORT_NAV: [string, string, boolean][] =[
      ['analytics', 'My Analytics', true], ['all', 'All reports', false],
      ['documents', 'By documents', false], ['templates', 'By templates', false],
      ['recipients', 'By recipients', false], ['custom', 'Custom', false]
];

export const INVITE_SPLIT: [string, number, string][] =[['Pending / expired', 1, '#f59e0b'], ['Completed', 9, '#10b981'], ['Declined', 0, '#f43f5e'], ['Cancelled', 5, '#facc15']];

export const REPORT_TILES: { label: string; value: string; meta: string }[] =[
      { label:'COMPLETION RATE', value:'60%', meta:'9 of 15 invites' },
      { label:'MEDIAN COMPLETION', value:'2h 14m', meta:'−18% vs prior period' },
      { label:'TEMPLATES CREATED', value:'7', meta:'128 uses' },
      { label:'DOCUMENTS CREATED', value:'18', meta:'6 senders' },
      { label:'RECIPIENTS', value:'6', meta:'2 first-time' }
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
      ['profile','User profile'], ['subscription','Subscription'], ['security','Settings · login & security'],
      ['payment','Payment services'], ['notifications','Notification settings'], ['email','Email notifications'],
      ['integrations','Integrations'], ['cloud','Cloud storage'], ['teams','My teams'],
      ['orgs','My organizations'], ['audit','Audit trail']
];

export const ACCOUNT_TITLES: Dict<[string, string]> ={
      profile:['User profile','Name, photo, locale and signature defaults'],
      subscription:['Subscription','Plan, seats and renewal — billing lives under Billing & plan'],
      security:['Settings · login and security','Email, password, two-factor and authenticated devices'],
      payment:['Payment services','Collect payments on signed documents via Stripe'],
      notifications:['Notification settings','Which events notify you, and how'],
      email:['Email notifications','Account email preferences and additional recipients'],
      integrations:['Integrations','CRM, storage and workflow connectors'],
      cloud:['Cloud storage','Automatic export of completed documents'],
      teams:['My teams','Shared folders, members and team templates'],
      orgs:['My organizations','Organizations you belong to and their admins'],
      audit:['Audit trail','Account-level security and administrative events']
    };

export const DEVICES: [string, string, string, string][] =[
      ['Windows · Edge', '10 Aug 2026 at 04:32', '68.100.82.195', 'Seattle, US'],
      ['Android · Chrome', '17 Oct 2026 at 04:49', '103.7.120.30', 'Dhaka, BD'],
      ['macOS · Safari', '28 Aug 2026 at 09:02', '198.51.100.24', 'Seattle, US · this device']
];

export const NOTIF_PREFS: [string, boolean][] =[
      ['Document viewed', true], ['Document signed', true], ['Envelope completed', true],
      ['Signer declined', true], ['Reminder sent', false], ['Envelope expiring in 24h', true],
      ['Payment failed', true], ['Weekly digest', false]
];

export const INTEGRATIONS: [string, string, boolean][] =[
      ['Salesforce', 'Connected · 2-way sync of opportunities', true],
      ['HubSpot', 'Not connected', false],
      ['Google Drive', 'Connected · completed copies to /Agreements', true],
      ['Dropbox', 'Not connected', false],
      ['Slack', 'Connected · #contracts channel', true],
      ['Zapier', 'Connected · 4 zaps', true],
      ['SharePoint', 'Not connected', false],
      ['Workday', 'Not connected', false]
];

export const TEAMS: [string, string, string][] =[
      ['Global Legal', '12 members · 214 documents · 7 templates', 'Owner'],
      ['Sales — Americas', '34 members · 118 documents · 4 templates', 'Admin'],
      ['Procurement', '9 members · 46 documents · 2 templates', 'Member']
];

export const ORGS: [string, string, string][] =[
      ['Acme Corporation', 'acme · Enterprise · 1,240 seats · us-east-1', 'Org admin'],
      ['Acme EU Holdings', 'acme-eu · Enterprise · 180 seats · eu-central-1', 'Member']
];

export const INVITE_DEFAULTS: [string, string][] =[
      ['Invite email subject', '{{document.name}}: Signature request from {{sender.name}}'],
      ['Invite email message', '{{sender.name}} invited you to sign {{document.name}}'],
      ['Reminder cadence', 'Every 48 hours, up to 3 reminders'],
      ['Signing order', 'Sequential'],
      ['Expiration', '14 days after send']
];

export const CLOUD_TARGETS: [string, string, boolean][] =[
      ['Google Drive', '/Agreements/Signed', true], ['Dropbox', '—', false],
      ['SharePoint', '—', false], ['Amazon S3', 's3://acme-agreements/signed', true]
];

/* ── global chrome ── */

export const NOTIFICATIONS: [string, string, string][] =[
      ['Alex Rivera signed Master Services Agreement', '12 min ago', 'good'],
      ['Invoice INV-2026-0841 is due in 4 days', '2 hours ago', 'info'],
      ['Halden GmbH payment failed — dunning step 4', 'Yesterday', 'bad'],
      ['SF-4471 escalated to engineering', 'Yesterday', 'bad'],
      ['Contractor Agreement expires in 24 hours', '2 days ago', 'info']
];

export const HELP_ITEMS: [string, string | null][] =[
      ['Start product tour', 'tour'], ['Support centre', 'support'], ['Contact support', 'support'],
      ['Guides & docs', 'guides'], ['API sandbox', 'sandbox'], ['Keyboard shortcuts', null]
];
export const ORG_OPTIONS: string[] = ['Acme Corporation', 'Acme EU Holdings', 'Personal account'];

/* ── sandbox & guides ── */

export const SB_PATH_OPTIONS: string[] =['/v1/users','/v1/contacts','/v1/documents','/v1/templates','/v1/embed/sessions','/v1/documents/ENV-2291-KD/audit'];
export const SB_LANG_TABS: [string, string][] = [['curl','cURL'],['node','TypeScript'],['python','Python'],['php','PHP']];
export const SB_FALLBACK_RESPONSE: string = '{\n  "error": {\n    "code": "not_found",\n    "message": "No such endpoint in the sandbox catalogue"\n  }\n}';
export const DOC_NAV: [string, string][] = [['quickstart','Quickstart guide'],['reference','API reference'],['embed','Embedding'],['webhooks','Webhooks'],['sdks','SDKs & samples'],['migration','Migration guide']];

/* ── nav ── */

export const SCREEN_RAIL: Dict<string> ={
      tenantHome:'documents', dashboard:'documents', builder:'documents', routing:'documents', sign:'documents', audit:'documents',
      contacts:'contacts', reports:'reports', billing:'billing', invoices:'billing',
      api:'developer', logs:'developer', sandbox:'developer', guides:'developer', support:'support',
      platformHome:'platform', platform:'platform', revenue:'platform'
    };
export const RAIL_DEFS_PLATFORM: [string, string, string, string][] = [['platform','Platform','⌘','platformHome'], ['billing','Revenue','◈','revenue'], ['support','Support','☎','support'], ['developer','Developer','‹›','api'], ['reports','Reports','▥','reports']];
export const RAIL_DEFS_TENANT: [string, string, string, string][] = [['documents','Documents','▤','tenantHome'], ['contacts','Contacts','◍','contacts'], ['reports','Reports','▥','reports'], ['billing','Billing','◈','billing'], ['developer','Developer','‹›','api'], ['support','Support','☎','support']];
