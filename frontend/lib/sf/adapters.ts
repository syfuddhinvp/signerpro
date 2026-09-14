/**
 * API shape → prototype shape.
 *
 * The ported SignerPro components must NOT change, so every difference between
 * the FastAPI response and what a component already reads is absorbed here.
 * These are pure functions: no React, no fetching, no `lib/api/client` import
 * (so they are safe in both server and client bundles).
 *
 * Where the design shows something the API does not have, the fallback is
 * documented inline with a `FALLBACK:` note.
 */

import {
  CONTACT_PALETTE,
  GROUP_LABELS,
  PLAN_TONE,
  STATUS_TONE,
  type Dict,
  type Tone,
} from './data';
import { radioOptions, type RadioOptions } from './radioGroups';
import type { Contact, Recipient, SFField } from './state';
import type * as PlatformApi from '@/lib/api/types';
import type {
  ApiKeyResponse,
  ApiKeyScopeResponse,
  ApiKeyUsageResponse,
  ApiSettingsResponse,
  AuditTrailEntry,
  CertificateSummaryResponse,
  ChargeResponse,
  ContactGroupResponse,
  ContactResponse,
  DocumentLibraryParams,
  DocumentListItem,
  DocumentStatus,
  FieldBulkItem,
  FieldCondition,
  FieldResponse,
  FieldType as ApiFieldType,
  FolderResponse,
  FolderTreeResponse,
  InvoiceResponse,
  OrganizationOverview,
  OrganizationResponse,
  PaymentFieldConfig,
  PaymentMethodResponse,
  PlanChangePreview,
  PlanResponse,
  QueueTicketStats,
  QuickReply,
  RecipientResponse,
  RecipientRole,
  RecipientStatus,
  RecipientSetItem,
  ReminderCadence,
  RoutingResponse,
  RoutingUpdate,
  SubscriptionResponse,
  SupportAgent,
  SystemLogRow,
  TemplateListParams,
  TemplateResponse,
  TenantTicketStats,
  TicketBucketCounts,
  TicketDetailResponse,
  TicketMessageResponse,
  TicketResponse,
  UpcomingInvoiceResponse,
  UsageRow,
  ValidationKind,
  WorkflowType,
} from '@/lib/api/types';

/* ── shared formatters ──────────────────────────────────────────────────── */

/** The prototype's em-dash placeholder for "no value". */
export const EMPTY = '—';

/** `2026-08-14T…` → `14 Aug 2026`, matching the prototype's date strings. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `updated_at` → `12 min ago` / `2 hours ago` / `Yesterday` / `3 days ago`,
 * i.e. the same vocabulary `DOCS[].updated` uses in the prototype.
 */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return EMPTY;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return EMPTY;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Integer cents → `$1,240.00`, the money format the prototype prints. */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

/**
 * `ENV-2291-KD` in the design is a human envelope reference the API does not
 * mint; `toLibraryRow` derives one from the UUID and the audit/certificate
 * cards must derive the *same* string for the same document.
 */
export function envelopeRef(documentId: string): string {
  return `ENV-${documentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** `Alex Rivera` → `AR`. Mirrors `state.ts#initials`. */
export function initialsOf(name: string): string {
  return name.split(' ').map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/** `2026-08-14T09:02:11Z` → `14 Aug 09:02:11 UTC`, the audit row's time format. */
export function formatAuditTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
  return `${day} ${time} UTC`;
}

/** `14 Aug 2026 11:18:52 UTC` — the certificate's "Sealed at" row. */
export function formatSealedAt(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return `${formatDate(iso)} ${date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' })} UTC`;
}

/** `28 Aug 12:04` — the ticket/message timestamp wording the design prints. */
export function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/** `11:42:08.412` — the log-row timestamp the console renders. */
export function formatLogTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Minutes → the design's `22m` / `5h 40m` duration wording. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return EMPTY;
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** `1102` → `1,102`, the thousands format the overview tiles print. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value || 0));
}

/** `128.4k` / `4.1M` — the compact counts the developer tiles print. */
export function formatCompact(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Seconds → `6m 12s`, the embed-duration wording in the design. */
export function formatSeconds(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}m ${total % 60}s` : `${total}s`;
}

/** `1 Sep 2026` → `1 Sep`, the short due-date form the invoice table prints. */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** `$74.7k` — the prototype's compact money label. Input is cents. */
export function formatCentsK(cents: number): string {
  return '$' + ((cents || 0) / 100000).toFixed(1) + 'k';
}

/** `+4.2%` — a signed percentage, as the stat tiles print deltas. */
export function formatSignedPct(value: number, digits = 1): string {
  const v = value || 0;
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}

/* ── contacts ───────────────────────────────────────────────────────────── */

/**
 * The API stores `source` lowercase (`manual|crm|scim|api`); the prototype's
 * `SRC_TONE` pill map is keyed by the display casing (`Manual|CRM|SCIM|API`).
 */
const CONTACT_SOURCE_LABEL: Dict<string> = {
  manual: 'Manual',
  crm: 'CRM',
  scim: 'SCIM',
  api: 'API',
};

export function contactSourceLabel(source: string): string {
  return CONTACT_SOURCE_LABEL[source] ?? (source ? source.toUpperCase() : 'Manual');
}

/**
 * `ContactResponse` → the `Contact` row `Contacts.tsx` renders.
 *
 * FALLBACK notes:
 * - `company` / `title` / `phone` are nullable on the API; the design always
 *   shows a value, so a null becomes the prototype's em-dash.
 * - `color` is nullable (contacts imported by CSV/SCIM often have none). The
 *   avatar needs one, so we deal from `CONTACT_PALETTE` by list position —
 *   the same palette `Modals.tsx` uses when creating a contact.
 * - `lastSigned` is a formatted string in the design; the API gives an ISO
 *   `last_signed_at`, null for a contact who has never signed.
 */
export function toContact(api: ContactResponse, index = 0): Contact {
  return {
    id: api.id,
    name: api.name,
    email: api.email,
    company: api.company || EMPTY,
    title: api.title || EMPTY,
    phone: api.phone || EMPTY,
    address: api.address || EMPTY,
    description: api.description || EMPTY,
    /* The owner row prefers the teammate's name and falls back to their
       sign-in address, which is what the API has for an SCIM-provisioned user. */
    owner: api.owner_name || api.owner_email || EMPTY,
    role: api.default_role,
    group: api.group,
    source: contactSourceLabel(api.source),
    tags: api.tags ?? [],
    envelopes: api.envelope_count ?? 0,
    lastSigned: formatDate(api.last_signed_at),
    color: api.color || CONTACT_PALETTE[index % CONTACT_PALETTE.length],
  };
}

export function toContacts(items: ContactResponse[]): Contact[] {
  return items.map((item, index) => toContact(item, index));
}

/**
 * Group pills. The prototype hardcodes `GROUP_LABELS`; the API owns the group
 * list per tenant, so we prefer the server's labels and fall back to the
 * design's for a key the server has not named.
 */
export function toGroupLabels(groups: ContactGroupResponse[]): Dict<string> {
  if (!groups.length) return { ...GROUP_LABELS };
  const labels: Dict<string> = {};
  for (const group of [...groups].sort((a, b) => a.sort_order - b.sort_order)) {
    labels[group.key] = group.label || GROUP_LABELS[group.key] || group.key;
  }
  return labels;
}

/**
 * Pill counts. `ContactListResponse.counts` is keyed by group key; the design
 * also wants an `all` bucket, which the service supplies — we recompute it from
 * `total` when it is missing so the header count and the pill agree.
 */
export function toContactCounts(counts: Dict<number>, total: number, groupKeys: string[]): Dict<number> {
  const out: Dict<number> = { all: counts.all ?? total };
  for (const key of groupKeys) out[key] = counts[key] ?? 0;
  return out;
}

/* ── documents / library ────────────────────────────────────────────────── */

/**
 * The design's five status buckets (`STATUS` in data.ts) against the backend's
 * nine-value `DocumentStatus` (`app/models/enums.py`). This is the single
 * bucketing implementation — every screen that needs a bucket calls it.
 *
 * FALLBACK notes:
 * - `prepared` is still an unsent envelope, so it reads as `draft`.
 * - `viewed` is still out for signature, so it reads as `waiting`.
 * - `declined` and `expired` have no bucket of their own in the prototype;
 *   both read as "action required" because the sender has to intervene.
 */
const DOC_STATUS_BUCKET: Record<DocumentStatus, string> = {
  draft: 'draft',
  prepared: 'draft',
  sent: 'waiting',
  viewed: 'waiting',
  partially_completed: 'action',
  completed: 'completed',
  declined: 'action',
  voided: 'voided',
  expired: 'action',
};

export function docStatusBucket(status: DocumentStatus | string): string {
  return DOC_STATUS_BUCKET[status as DocumentStatus] ?? 'draft';
}

/**
 * The *precise* status, for the pill on a library row. The bucket above is what
 * the filters and counts are built on — it deliberately flattens nine backend
 * states into five — but a sender reading the list wants to know whether an
 * envelope was merely sent or has actually been opened, so the pill says so.
 *
 * Tones stay inside the bucket's palette, so a "Sent" and a "Viewed" row still
 * read as the same family of "out for signature" at a glance.
 */
const DOC_STATUS_DETAIL: Record<DocumentStatus, { label: string; bg: string; fg: string; bd: string }> = {
  draft:               { label: 'Draft',      bg: '#f5f6f8', fg: '#475569', bd: '#e3e7ee' },
  prepared:            { label: 'Prepared',   bg: '#f5f6f8', fg: '#475569', bd: '#e3e7ee' },
  sent:                { label: 'Sent',       bg: '#eef2ff', fg: '#4338ca', bd: '#c7d2fe' },
  viewed:              { label: 'Viewed',     bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' },
  partially_completed: { label: 'In progress', bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' },
  completed:           { label: 'Signed',     bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' },
  declined:            { label: 'Declined',   bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
  expired:             { label: 'Expired',    bg: '#fff7ed', fg: '#c2410c', bd: '#fed7aa' },
  voided:              { label: 'Voided',     bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
};

export type DocStatusDetail = { label: string; bg: string; fg: string; bd: string };

export function docStatusDetail(status: DocumentStatus | string): DocStatusDetail {
  return DOC_STATUS_DETAIL[status as DocumentStatus] ?? DOC_STATUS_DETAIL.draft;
}

/**
 * The line under the pill: how far the envelope has actually got. "Signers: 2"
 * said nothing about progress; "1 of 2 signed" is the number the sender is
 * chasing. An unsent envelope has no progress yet, only a headcount.
 */
export function signerProgressLabel(status: DocumentStatus | string, signed: number, total: number): string {
  const count = total || 0;
  if (!count) return 'No signers yet';
  if (status === 'draft' || status === 'prepared') return count === 1 ? '1 signer' : `${count} signers`;
  return `${Math.min(signed, count)} of ${count} signed`;
}

/** The row shape `Library.tsx` renders (the `DOCS[]` entry shape in data.ts). */
export type LibraryRow = {
  id: string;
  title: string;
  pages: number;
  status: string;
  /** The backend's precise `DocumentStatus`, before the bucket flattens it. */
  rawStatus: string;
  signed: number;
  total: number;
  updated: string;
  to: string[];
  /** Extras the API provides that the prototype faked; ignored by the markup. */
  documentId: string;
  ownerName: string;
  isFavorite: boolean;
};

/**
 * `DocumentListItem` → `LibraryRow`.
 *
 * FALLBACK notes:
 * - The design's `id` is a human envelope reference (`ENV-2291-KD`); the API
 *   only has a UUID. We show a short uppercase slice of the UUID prefixed with
 *   `ENV-`, and keep the real UUID in `documentId` for links and mutations.
 * - `to` is a list of recipient ids in the prototype, used only to colour the
 *   avatar stack. The library page does not embed recipients, so it is empty
 *   until a screen fetches `recipients.list(documentId)`.
 */
export function toLibraryRow(api: DocumentListItem): LibraryRow {
  return {
    id: envelopeRef(api.id),
    title: api.title,
    pages: api.page_count ?? 0,
    status: docStatusBucket(api.status),
    rawStatus: api.status,
    signed: api.recipients_completed ?? 0,
    total: api.recipients_total ?? 0,
    updated: formatRelative(api.updated_at),
    to: [],
    documentId: api.id,
    ownerName: api.owner_name || EMPTY,
    isFavorite: api.is_favorite === true,
  };
}

export function toLibraryRows(items: DocumentListItem[]): LibraryRow[] {
  return items.map(toLibraryRow);
}

/* ── templates ──────────────────────────────────────────────────────────── */

/** The row shape the templates folder renders (`TEMPLATES[]` in data.ts). */
export type TemplateRow = {
  id: string;
  title: string;
  uses: number;
  fields: number;
  updated: string;
  owner: string;
  /** The real UUID, for links and mutations. */
  templateId: string;
};

/**
 * FALLBACK: the design's `TPL-014` reference does not exist on the API, so it
 * is derived from the UUID the same way library ids are.
 */
export function toTemplateRow(api: TemplateResponse): TemplateRow {
  return {
    id: `TPL-${api.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    title: api.title,
    uses: api.use_count ?? 0,
    fields: api.field_count ?? 0,
    updated: formatDate(api.updated_at),
    owner: api.owner_name || EMPTY,
    templateId: api.id,
  };
}

export function toTemplateRows(items: TemplateResponse[]): TemplateRow[] {
  return items.map(toTemplateRow);
}

/* ── document library: store filters → API query params ─────────────────── */

/**
 * The library screen's ephemeral filter state (`lib/sf/state.tsx`), lifted out
 * of the store so both the URL and the server page can speak the same shape.
 */
export type LibraryFilters = {
  /** `s.libFolder` — a `QUICK_ACCESS` / `LIB_FOLDERS` key, or a real folder id. */
  folder: string;
  /** `s.libStatus` — one of the design's five buckets, or `all`. */
  status: string;
  /** `s.libType` — `all | agreement | nda | order | hr`. */
  type: string;
  /** `s.libTime` — `all | 7 | 30 | 90 | custom`. `custom` reads `from`/`to`. */
  time: string;
  /** Inclusive `YYYY-MM-DD` bounds, honoured only when `time` is `custom`. */
  from: string;
  to: string;
  /** `s.libOwner` — `all | me | team | shared`. */
  owner: string;
  /** `s.query` — the search box. */
  q: string;
  /** `s.libSort` — `recent | name | status | owner`. */
  sort: string;
};

export const LIBRARY_FILTER_DEFAULTS: LibraryFilters = {
  folder: 'documents', status: 'all', type: 'all', time: 'all', from: '', to: '',
  owner: 'all', q: '', sort: 'recent',
};

/** The URL query key each filter is carried on. Short, and stable. */
export const LIBRARY_QUERY_KEYS: Record<keyof LibraryFilters, string> = {
  folder: 'folder', status: 'status', type: 'type', time: 'time', from: 'from', to: 'to',
  owner: 'owner', q: 'q', sort: 'sort',
};

/** `?folder=archive&status=draft…` → `LibraryFilters`, defaults filled in. */
export function libraryFiltersFromQuery(
  read: (key: string) => string | undefined | null,
): LibraryFilters {
  const pick = (key: keyof LibraryFilters) => (read(LIBRARY_QUERY_KEYS[key]) || '').trim();
  const out: LibraryFilters = { ...LIBRARY_FILTER_DEFAULTS };
  for (const key of Object.keys(LIBRARY_QUERY_KEYS) as (keyof LibraryFilters)[]) {
    const value = pick(key);
    if (value) out[key] = value;
  }
  return out;
}

/** `LibraryFilters` → the `?…` string the screen pushes and the page reads. */
export function libraryFiltersToQuery(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(LIBRARY_QUERY_KEYS) as (keyof LibraryFilters)[]) {
    const value = (filters[key] || '').trim();
    if (value && value !== LIBRARY_FILTER_DEFAULTS[key]) params.set(LIBRARY_QUERY_KEYS[key], value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * The design's `libFolder` keys against `LibraryQuick`.
 *
 * `documents` is the unfiltered root, `archive`/`trash` are the two soft-delete
 * views, and every `QUICK_ACCESS` key already matches a backend `quick` value.
 * Anything else is treated as a real folder id (`folder_id`, `quick=all`).
 */
const FOLDER_QUICK: Dict<string> = {
  documents: 'all', archive: 'archived', trash: 'trash', templates: 'all',
  inbox: 'inbox', outbox: 'outbox', completed: 'completed', drafts: 'drafts',
  favorites: 'favorites', expiring: 'expiring', shared: 'shared', mine: 'mine',
};

export function isLibraryFolderId(folder: string): boolean {
  return !!folder && FOLDER_QUICK[folder] === undefined;
}

/**
 * The design's five status buckets → the single `DocumentStatus` the API's
 * `status` filter takes.
 *
 * FALLBACK: a bucket is not always one status. `waiting` covers everything
 * still out for signature and `action` covers everything needing the sender,
 * but `?status=` is one value, so each bucket sends its most representative
 * status: `waiting` → `sent`, `action` → `partially_completed`. The `quick`
 * views (`inbox`, `outbox`) are the exact server-side equivalents and the
 * sidebar already routes through them.
 */
const LIB_STATUS_TO_API: Dict<DocumentStatus> = {
  action: 'partially_completed',
  waiting: 'sent',
  completed: 'completed',
  draft: 'draft',
  voided: 'voided',
};

export function libStatusToApiStatus(bucket: string): DocumentStatus | undefined {
  return LIB_STATUS_TO_API[bucket];
}

/** A `YYYY-MM-DD` the API will accept — the date inputs can hold a partial value. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `LibraryFilters` → `GET /api/documents/library` params. */
export function toLibraryParams(filters: LibraryFilters, limit: number, offset = 0): DocumentLibraryParams {
  const folder = filters.folder || 'documents';
  const params: DocumentLibraryParams = {
    quick: (FOLDER_QUICK[folder] ?? 'all') as DocumentLibraryParams['quick'],
    limit,
    offset,
  };
  if (isLibraryFolderId(folder)) params.folder_id = folder;
  const status = libStatusToApiStatus(filters.status);
  if (status) params.status = status;
  if (filters.type && filters.type !== 'all') params.doc_type = filters.type;
  /* A custom range and a rolling window are the same question asked two ways,
     so only one of them is ever sent. */
  if (filters.time === 'custom') {
    if (isIsoDate(filters.from)) params.updated_from = filters.from;
    if (isIsoDate(filters.to)) params.updated_to = filters.to;
  } else {
    const sinceDays = Number(filters.time);
    if (Number.isFinite(sinceDays) && sinceDays > 0) params.since_days = sinceDays;
  }
  if (filters.owner && filters.owner !== 'all') params.owner = filters.owner;
  const needle = (filters.q || '').trim();
  if (needle) params.q = needle;
  if (filters.sort) params.sort = filters.sort as DocumentLibraryParams['sort'];
  return params;
}

/** `LibraryFilters` → `GET /api/templates` params (the templates folder view). */
export function toTemplateParams(filters: LibraryFilters, limit: number, offset = 0): TemplateListParams {
  const params: TemplateListParams = { limit, offset };
  const needle = (filters.q || '').trim();
  if (needle) params.q = needle;
  if (filters.owner && filters.owner !== 'all') params.owner = filters.owner;
  params.sort = filters.sort === 'name' ? 'name' : filters.sort === 'owner' ? 'recent' : 'recent';
  if (filters.folder === 'archive') params.include_archived = true;
  return params;
}

/* ── folders ────────────────────────────────────────────────────────────── */

/** A flat `{id, name}` list of the folder tree, personal first, depth-first. */
export type FolderOption = { id: string; name: string; scope: string; documentCount: number };

export function toFolderOptions(tree: FolderTreeResponse | null): FolderOption[] {
  if (!tree) return [];
  const out: FolderOption[] = [];
  const walk = (nodes: FolderResponse[], prefix: string) => {
    for (const node of nodes) {
      const name = prefix ? `${prefix} / ${node.name}` : node.name;
      out.push({ id: node.id, name, scope: node.scope, documentCount: node.document_count ?? 0 });
      if (node.children?.length) walk(node.children, name);
    }
  };
  walk(tree.personal ?? [], '');
  walk(tree.team ?? [], '');
  return out;
}

/** The heading the design prints for the current folder. */
export function libraryFolderLabel(
  folder: string,
  designLabels: [string, string][],
  options: FolderOption[],
): string {
  const design = designLabels.find(entry => entry[0] === folder);
  if (design) return design[1];
  const real = options.find(option => option.id === folder);
  return real ? real.name : 'Documents';
}

/* ── builder: fields, recipients, routing ───────────────────────────────── */

/**
 * CANONICAL FIELD COORDINATE SPACE — the browser half of the seam documented in
 * `backend/app/services/pdf_service.py` (`coordinate convention`).
 *
 * Field geometry is **PDF points with a top-left origin**, everywhere: in the
 * database, on the wire, in `SFField`, and in the builder's and signer's own
 * state. `y` is the distance from the *top* of the page down to the field's
 * *top* edge — the same direction CSS `top` measures, which is why the overlay
 * can bind `top: y * scale` with no arithmetic of its own.
 *
 * There is therefore **no unit conversion in this file at all**. The only
 * transform in the whole system is the origin flip ReportLab needs, and it
 * happens once, server-side, in `PdfService._pdf_y`. (Before that seam existed
 * this module scaled px→pt by 3/4 with no flip, so a signature authored near
 * the top of the sheet was stamped near the bottom of the executed contract —
 * audit finding C1.)
 *
 * The browser's *scale* — how many CSS pixels one point is drawn as — is not a
 * constant here either. It comes from the rendered page: pdf.js reports each
 * page's true size in points (`page.getViewport({ scale: 1 })`), so an A4,
 * Legal, landscape or mixed-size PDF lays its fields out correctly by
 * construction. See `components/sf/pdf/PdfPageCanvas.tsx`.
 *
 * `field_service._validate_coordinates` still checks the rectangle against the
 * real mediabox, so a field dragged past the right or bottom edge is a 400 that
 * is surfaced in the toast rather than swallowed.
 */

/** Identity, kept as named seams so a future unit change has one place to live. */
const pxFromPt = (pt: number): number => Number(pt);
const ptFromPx = (px: number): number => Number(Number(px).toFixed(4));

/**
 * The prototype's palette (`TYPES` in data.ts) and the backend's `FieldType`
 * enum, in both directions.
 *
 * `stamp`, `attachment` and `datetime` used to be flattened to `text`/`date`
 * here even though the API models all three (audit §4, field-type matrix).
 * That flattening is what kept `attachment` fields unreachable: the
 * signing surface picks the upload control off the stored type, so a field
 * saved as `text` could never offer one. `toBuilderField`
 * remembers the row's real API type in the extras record below, so a field the
 * API calls `phone`/`title`/`company`/`address` (all of which the design can
 * only draw as a Text Input) keeps its type across a save round-trip instead of
 * being flattened to `text`.
 */
const API_FIELD_TYPE: Dict<ApiFieldType> = {
  signature: 'signature',
  initials: 'initials',
  date: 'date',
  name: 'full_name',
  email: 'email',
  text: 'text',
  checkbox: 'checkbox',
  radio: 'radio',
  dropdown: 'dropdown',
  number: 'number',
  currency: 'currency',
  stamp: 'stamp',
  attachment: 'attachment',
  datetime: 'datetime',
  textbox: 'textbox',
  drawing: 'drawing',
  payment: 'payment',
};

const BUILDER_FIELD_TYPE: Record<ApiFieldType, string> = {
  signature: 'signature',
  initials: 'initials',
  full_name: 'name',
  date: 'date',
  text: 'text',
  email: 'email',
  phone: 'text',
  checkbox: 'checkbox',
  dropdown: 'dropdown',
  title: 'text',
  company: 'text',
  address: 'text',
  currency: 'currency',
  number: 'number',
  radio: 'radio',
  stamp: 'stamp',
  attachment: 'attachment',
  datetime: 'datetime',
  textbox: 'textbox',
  drawing: 'drawing',
  payment: 'payment',
};

export function builderFieldType(apiType: string): string {
  return BUILDER_FIELD_TYPE[apiType as ApiFieldType] ?? 'text';
}

export function apiFieldType(builderType: string): ApiFieldType {
  return API_FIELD_TYPE[builderType] ?? 'text';
}

/**
 * PAY-1: a `payment` field's `options` JSON, defaulted so the inspector and
 * the envelope-level payment panel never read `undefined` out of it. Mirrors
 * `schemas/payment.py:PaymentFieldConfig` exactly — the backend is the
 * authority on what these keys mean and validates them again on save.
 */
export function paymentFieldOptions(options: unknown): PaymentFieldConfig {
  const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
  return {
    amount_mode: o.amount_mode === 'signer_entered' ? 'signer_entered' : 'fixed',
    amount_cents: typeof o.amount_cents === 'number' ? o.amount_cents : null,
    min_cents: typeof o.min_cents === 'number' ? o.min_cents : null,
    max_cents: typeof o.max_cents === 'number' ? o.max_cents : null,
    currency: typeof o.currency === 'string' && o.currency ? o.currency : 'USD',
    memo: typeof o.memo === 'string' ? o.memo : null,
    payment_request_id: typeof o.payment_request_id === 'string' ? o.payment_request_id : null,
  };
}

/**
 * Currency-unit ↔ integer-cents conversions for every amount a sender types.
 * The wire format (`amount_cents`, `total_cents`, …) is always integer cents
 * — a float dollar amount is exactly how money bugs happen — but nobody wants
 * to type "5000" for fifty dollars, so the inspector and the split UI edit in
 * "50.00" and convert at the boundary.
 */
export function centsFromAmountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function amountInputFromCents(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/**
 * Divide `totalCents` across `count` payers to the exact penny, handing the
 * remainder to the earliest payers one cent at a time — the same rule
 * `signer_payment_service._split_equal` applies server-side, so the sender
 * sees in the builder exactly what will be charged (e.g. $100.00 over 3
 * people is 33.34 / 33.33 / 33.33, never three even $33.33s that drop a cent).
 */
export function splitEqualCents(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Everything on a `FieldResponse` that `SFField` has no room for. `SFField`
 * lives in `lib/sf/state.tsx` (a shared file this conversion must not reshape),
 * so rather than smuggle extra keys onto the field objects the builder keeps
 * this record beside them, keyed by field id, and merges it back on save. That
 * is what stops a full-replace `PUT` from wiping `validation_pattern`,
 * `options`, a captured `default_value`, or the field's true API type.
 */
export type BuilderFieldExtras = {
  apiType: ApiFieldType;
  validationPattern: string | null;
  options: Record<string, unknown> | unknown[] | null;
  defaultValue: string | null;
};

export function toBuilderFieldExtras(api: FieldResponse): BuilderFieldExtras {
  return {
    apiType: api.type,
    validationPattern: api.validation_pattern,
    options: api.options ?? null,
    defaultValue: api.default_value,
  };
}

export function toBuilderExtrasMap(items: FieldResponse[]): Dict<BuilderFieldExtras> {
  const out: Dict<BuilderFieldExtras> = {};
  for (const item of items) out[item.id] = toBuilderFieldExtras(item);
  return out;
}

/**
 * `FieldResponse` → the `SFField` the canvas and inspector already render.
 *
 * The API's `condition` is `{field_id, op, value}`; the prototype's is
 * `{field, op, value}` with a string value, because the inspector binds it to a
 * text input.
 */
export function toBuilderField(api: FieldResponse): SFField {
  const condition = (api.condition ?? null) as { field_id?: string; op?: string; value?: unknown } | null;
  return {
    id: api.id,
    page: api.page_number,
    type: builderFieldType(api.type),
    x: pxFromPt(api.x),
    y: pxFromPt(api.y),
    w: pxFromPt(api.width),
    h: pxFromPt(api.height),
    to: api.recipient_id,
    required: api.required === true,
    readOnly: api.read_only === true,
    label: api.label,
    placeholder: api.placeholder ?? '',
    validation: api.validation || 'none',
    cond: condition && condition.field_id
      ? { field: condition.field_id, op: condition.op || 'checked', value: condition.value == null ? '' : String(condition.value) }
      : null,
  };
}

export function toBuilderFields(items: FieldResponse[]): SFField[] {
  return items.map(toBuilderField);
}

/** The default `custom` pattern the inspector's regex box advertises. */
export const DEFAULT_CUSTOM_PATTERN = '^[A-Z]{3}-\\d{4}$';

/**
 * `SFField` → one item of `PUT /api/documents/{id}/fields`.
 *
 * `id` is passed only for fields the server already knows about; a field the
 * builder created locally is sent without one so `field_service.bulk_save`
 * creates it (an unknown id is a hard 400 there). The call is a full replace, so
 * omitting the id never duplicates a row.
 *
 * `validation: 'custom'` requires a non-empty, compilable `validation_pattern`
 * server-side. The inspector only offers the kind, not the pattern, so a field
 * switched to `custom` inherits the pattern it already had, or the one the
 * inspector's regex box shows.
 */
export function toFieldBulkItem(
  field: SFField,
  extras?: BuilderFieldExtras,
  opts?: { includeId?: boolean },
): FieldBulkItem {
  const builderType = field.type;
  // Keep the row's real API type when the design can only draw it as one bucket.
  const type = extras && builderFieldType(extras.apiType) === builderType ? extras.apiType : apiFieldType(builderType);
  const condition: FieldCondition | null = field.cond && field.cond.field
    ? { field_id: field.cond.field, op: field.cond.op as FieldCondition['op'], value: field.cond.value || null }
    : null;
  const validation = (field.validation || 'none') as ValidationKind;
  const item: FieldBulkItem = {
    recipient_id: field.to,
    type,
    label: field.label || 'Field',
    required: field.required === true,
    page_number: field.page,
    x: ptFromPx(field.x),
    y: ptFromPx(field.y),
    width: ptFromPx(field.w),
    height: ptFromPx(field.h),
    placeholder: field.placeholder ? field.placeholder : null,
    default_value: extras ? extras.defaultValue : null,
    options: extras ? extras.options : null,
    validation,
    validation_pattern: validation === 'custom'
      ? (extras && extras.validationPattern ? extras.validationPattern : DEFAULT_CUSTOM_PATTERN)
      : null,
    condition,
    read_only: field.readOnly === true,
  };
  if (opts && opts.includeId) item.id = field.id;
  return item;
}

export function toFieldBulkItems(
  fields: SFField[],
  extrasById: Dict<BuilderFieldExtras>,
  serverIds: (id: string) => boolean,
): FieldBulkItem[] {
  return fields.map(field => toFieldBulkItem(field, extrasById[field.id], { includeId: serverIds(field.id) }));
}

/**
 * A stable identity for one authored field, used to re-key local state onto the
 * ids `bulk_save` returns (its response is sorted by page/y/x, not by request
 * order, and newly created rows come back with server-generated ids).
 */
export function builderFieldKey(f: {
  page: number; x: number; y: number; w: number; h: number; to: string; type: string;
}): string {
  return [f.page, f.x, f.y, f.w, f.h, f.to, f.type].join('|');
}

export function fieldResponseKey(api: FieldResponse): string {
  return builderFieldKey({
    page: api.page_number,
    x: pxFromPt(api.x),
    y: pxFromPt(api.y),
    w: pxFromPt(api.width),
    h: pxFromPt(api.height),
    to: api.recipient_id,
    type: builderFieldType(api.type),
  });
}

/**
 * The one `RecipientStatus` → display-label map, over the real six-value enum
 * (`app/models/enums.py:RecipientStatus`). The design's chips are
 * display-cased (`Viewed`, `Sent`, `Pending`) where the API is lowercase.
 *
 * FALLBACK: the API's `waiting` reads as the design's `Pending`; the design has
 * no `Declined`/`Expired` chip, so those labels are simply passed through the
 * same plain-text slot.
 */
const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  waiting: 'Pending',
  sent: 'Sent',
  viewed: 'Viewed',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
};

/**
 * The builder rail's label: an unknown status is title-cased rather than
 * silently relabelled, so a status the API grows shows up as itself.
 */
export function builderRecipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_LABEL[status as RecipientStatus]
    ?? (status ? status[0].toUpperCase() + status.slice(1) : 'Pending');
}

/** The signer chrome / attestation label: an unknown status reads as `Pending`. */
export function recipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_LABEL[status as RecipientStatus] ?? 'Pending';
}

/**
 * `RecipientResponse` → the `Recipient` the builder rail, inspector and routing
 * rows render.
 *
 * FALLBACK: `color` is nullable (a recipient added from a CSV or the API often
 * has none) but every chip and field outline needs one, so we deal from
 * `CONTACT_PALETTE` by signing order — the same palette the contact avatars use.
 */
export function toBuilderRecipient(api: RecipientResponse, index = 0): Recipient {
  return {
    id: api.id,
    name: api.name,
    email: api.email,
    role: api.role || 'sign',
    color: api.color || CONTACT_PALETTE[index % CONTACT_PALETTE.length],
    order: api.signing_order,
    status: builderRecipientStatusLabel(api.status),
  };
}

export function toBuilderRecipients(items: RecipientResponse[]): Recipient[] {
  return [...items]
    .sort((a, b) => a.signing_order - b.signing_order || a.created_at.localeCompare(b.created_at))
    .map((item, index) => toBuilderRecipient(item, index));
}

/**
 * A display name for an address the sender typed without one.
 *
 * Email is the only thing that identifies a recipient, and the sender should not
 * have to fill in a name to send an envelope — but `name` is required on both
 * `RecipientCreate` and `ContactCreate` (min_length=1), so the local part
 * stands in for it: `sarah.mitchell@acme.io` → `Sarah Mitchell`. An address
 * that carries no usable local part falls back to the address itself.
 */
export function displayNameFromEmail(email: string): string {
  const local = String(email ?? '').trim().toLowerCase().split('@')[0] || '';
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    // A digit-only fragment ("sarah.2") is noise in a display name.
    .filter(part => !/^\d+$/.test(part))
    .map(part => part[0].toUpperCase() + part.slice(1));
  return words.length ? words.join(' ') : (String(email ?? '').trim() || 'Recipient');
}

/**
 * A recipient the sender has just typed in, before the API has seen it.
 *
 * The id is deliberately a `local-` string: `toRecipientSetItems` sends an `id`
 * only for rows the server already knows, so this one is created rather than
 * rejected as "does not belong to this document", and `saveRecipients` re-keys
 * it to the server id once the write lands.
 */
export function newBuilderRecipient(name: string, email: string, existing: Recipient[] = []): Recipient {
  const typed = String(name ?? '').trim();
  return {
    id: 'local-' + Date.now().toString(36) + '-' + existing.length,
    // Name is optional in the UI; the API insists on one.
    name: typed || displayNameFromEmail(email),
    email: String(email ?? '').trim().toLowerCase(),
    role: 'sign',
    color: CONTACT_PALETTE[existing.length % CONTACT_PALETTE.length],
    order: existing.length + 1,
    status: builderRecipientStatusLabel('waiting'),
  };
}

/** Whether an id was minted by `newBuilderRecipient` and not yet persisted. */
export function isLocalRecipientId(id: string): boolean {
  return String(id ?? '').startsWith('local-');
}

/**
 * `Recipient[]` → `PUT /api/documents/{id}/recipients` (a full replace that
 * also fixes the signing order). As with fields, an id is sent only for a row
 * the server already knows.
 */
export function toRecipientSetItems(list: Recipient[], serverIds: (id: string) => boolean): RecipientSetItem[] {
  return [...list]
    .sort((a, b) => a.order - b.order)
    .map((r, index) => {
      const item: RecipientSetItem = {
        name: r.name,
        email: r.email,
        signing_order: index + 1,
        role: (r.role || 'sign') as RecipientRole,
        color: r.color || null,
      };
      if (serverIds(r.id)) item.id = r.id;
      return item;
    });
}

/** The recipient ids in signing order — the body `POST .../recipients/reorder` wants. */
export function toRecipientOrder(list: Recipient[]): string[] {
  return [...list].sort((a, b) => a.order - b.order).map(r => r.id);
}

/**
 * Reminder cadence. The design's chip ids are `24h | 48h | 7 days | none`; the
 * API's `ReminderCadence` literal is `24h | 48h | 7d | none`.
 */
const CADENCE_FROM_API: Dict<string> = { '24h': '24h', '48h': '48h', '7d': '7 days', none: 'none' };
const CADENCE_TO_API: Dict<ReminderCadence> = { '24h': '24h', '48h': '48h', '7 days': '7d', none: 'none' };

export function builderCadence(apiCadence: string): string {
  return CADENCE_FROM_API[apiCadence] ?? '48h';
}

export function apiCadence(builderCadenceValue: string): ReminderCadence {
  return CADENCE_TO_API[builderCadenceValue] ?? 'none';
}

/**
 * Expiry. The design's select offers 7 / 14 / 30 / 90 days only, so a stored
 * `expires_in_days` outside that set would render the control blank.
 *
 * FALLBACK: snap to the nearest offered option for display; the real number is
 * only overwritten once the user picks one.
 */
const EXPIRY_OPTIONS = [7, 14, 30, 90];

export function builderExpiry(days: number): string {
  if (EXPIRY_OPTIONS.indexOf(days) > -1) return String(days);
  const nearest = EXPIRY_OPTIONS.reduce((best, option) =>
    Math.abs(option - days) < Math.abs(best - days) ? option : best, EXPIRY_OPTIONS[0]);
  return String(nearest);
}

/** The routing slice of `SFState` the two screens bind to. */
export type BuilderRouting = {
  routing: string;
  cadence: string;
  expiry: string;
  message: string;
  /** The invite subject. `SFState` has no slot for it, so the screen holds it locally. */
  subject: string;
  /** Branding theme id, or '' for the tenant's default. Held as a string so it
   *  drops straight into a `<select value>` without a null check. */
  brandingThemeId: string;
};

export function toBuilderRouting(api: RoutingResponse): BuilderRouting {
  return {
    routing: api.workflow_type,
    cadence: builderCadence(api.reminder_cadence),
    expiry: builderExpiry(api.expires_in_days),
    message: api.invite_message ?? '',
    subject: api.invite_subject ?? '',
    brandingThemeId: api.branding_theme_id ?? '',
  };
}

export function toRoutingUpdate(patch: Partial<BuilderRouting>): RoutingUpdate {
  const body: RoutingUpdate = {};
  if (patch.routing !== undefined) body.workflow_type = patch.routing as WorkflowType;
  if (patch.cadence !== undefined) body.reminder_cadence = apiCadence(patch.cadence);
  if (patch.expiry !== undefined) {
    const days = parseInt(patch.expiry, 10);
    if (Number.isFinite(days)) body.expires_in_days = days;
  }
  if (patch.subject !== undefined) body.invite_subject = patch.subject;
  if (patch.message !== undefined) body.invite_message = patch.message;
  /* '' is the "use the tenant's default" choice, and the API spells that as an
     explicit null — omitting the key would leave the old theme in place. */
  if (patch.brandingThemeId !== undefined) body.branding_theme_id = patch.brandingThemeId || null;
  return body;
}

/* ── signer session + audit trail (appended: SIGN screens) ──────────────── */


/**
 * `RecipientResponse` → the prototype's `Recipient`.
 *
 * FALLBACK: `color` is nullable on the API (recipients created from a CSV or
 * the public API often carry none) and every avatar/field tag needs one, so we
 * deal from `CONTACT_PALETTE` by signing order — the same palette the builder
 * and contact modal use.
 */
export function toSignerRecipient(api: RecipientResponse, index = 0): Recipient {
  return {
    id: api.id,
    name: api.name,
    email: api.email,
    role: api.role,
    color: api.color || CONTACT_PALETTE[index % CONTACT_PALETTE.length],
    order: api.signing_order ?? index + 1,
    status: recipientStatusLabel(api.status),
  };
}

export function toSignerRecipients(items: RecipientResponse[]): Recipient[] {
  return [...items]
    .sort((a, b) => (a.signing_order ?? 0) - (b.signing_order ?? 0))
    .map((item, index) => toSignerRecipient(item, index));
}

/**
 * The API's `FieldType` against the design's `TYPES` ids.
 *
 * FALLBACK: `full_name` is `name` in the prototype, and `phone` / `title` /
 * `company` / `address` have no palette entry at all — they behave exactly like
 * a text input, so they render as `text`. The untranslated API type is kept on
 * `apiType` because the save endpoint is chosen by it.
 */
const FIELD_TYPE_TO_PROTOTYPE: Dict<string> = {
  full_name: 'name',
  phone: 'text',
  title: 'text',
  company: 'text',
  address: 'text',
};

export function fieldTypeToPrototype(type: string): string {
  return FIELD_TYPE_TO_PROTOTYPE[type] ?? type;
}

/** A signing field: the prototype's `SFField` plus what the API adds. */
export type SignerField = SFField & {
  /** The backend `FieldType`, unmapped — picks the save endpoint. */
  apiType: string;
  /** Real dropdown/radio choices, when the field was authored with them. */
  options: string[];
  /** Server-side value, so a reload shows what has already been saved. */
  savedValue: string | null;
  /** What the sender pre-filled, shown when the signer has saved nothing yet. */
  defaultValue: string | null;
  /**
   * When this field is one button of a radio group, the group it belongs to
   * and the choice it stands for (see `lib/sf/radioGroups.ts`). A `radio` row
   * authored before groups existed — or through the API — has null here and
   * stays one box listing every choice.
   */
  radio?: RadioOptions | null;
};

/**
 * The choices a dropdown/radio field was authored with, in whichever shape the
 * API row holds them: a bare array, `{choices: [...]}` or `{options: [...]}`.
 * Both the signing surface and the builder's inspector read them through here.
 */
export function fieldChoices(options: FieldResponse['options']): string[] {
  return fieldOptions(options);
}

function fieldOptions(options: FieldResponse['options']): string[] {
  if (Array.isArray(options)) return options.map(entry => String(entry));
  if (options && typeof options === 'object') {
    const choices = (options as { choices?: unknown; options?: unknown }).choices
      ?? (options as { options?: unknown }).options;
    if (Array.isArray(choices)) return choices.map(entry => String(entry));
  }
  return [];
}

function fieldCondition(condition: FieldResponse['condition']): SFField['cond'] {
  if (!condition || typeof condition !== 'object') return null;
  const raw = condition as { field_id?: unknown; field?: unknown; op?: unknown; value?: unknown };
  const field = typeof raw.field_id === 'string' ? raw.field_id : (typeof raw.field === 'string' ? raw.field : '');
  const op = typeof raw.op === 'string' ? raw.op : '';
  if (!field || !op) return null;
  return { field, op, value: raw.value === undefined || raw.value === null ? '' : String(raw.value) };
}

/** `FieldResponse` → the field shape `Signer.tsx` / the builder overlay read. */
export function toSignerField(api: FieldResponse): SignerField {
  return {
    id: api.id,
    page: api.page_number ?? 1,
    type: fieldTypeToPrototype(api.type),
    x: api.x,
    y: api.y,
    w: api.width,
    h: api.height,
    to: api.recipient_id,
    required: api.required === true,
    readOnly: api.read_only === true,
    label: api.label,
    placeholder: api.placeholder ?? '',
    validation: api.validation || 'none',
    cond: fieldCondition(api.condition),
    apiType: api.type,
    options: fieldOptions(api.options),
    savedValue: api.value,
    defaultValue: api.default_value ?? null,
    radio: api.type === 'radio' ? radioOptions(api.options) : null,
  };
}

export function toSignerFields(items: FieldResponse[]): SignerField[] {
  return items.map(toSignerField);
}

/**
 * Field values already saved on the server, in the shape `state.signValues`
 * holds them, so a returning signer sees their own work.
 *
 * The prototype encodes a typed signature as `typed:<face>:<text>` and a drawn
 * one as a `data:` URL; the API only stores the signature's *text*, so a typed
 * signature round-trips and a drawn one comes back as its adopted name.
 */
export function toSignValues(items: SignerField[]): Dict<unknown> {
  const values: Dict<unknown> = {};
  for (const field of items) {
    // A saved value is the signer's own work and always wins; the sender's
    // default only fills a field nobody has answered yet.
    const raw = field.savedValue === null || field.savedValue === '' ? field.defaultValue : field.savedValue;
    if (raw === null || raw === '') continue;
    if (field.type === 'checkbox') values[field.id] = raw === 'true';
    else if (field.type === 'signature' || field.type === 'initials') values[field.id] = `typed:Caveat:${raw}`;
    else values[field.id] = raw;
  }
  return values;
}

/* ── audit trail ────────────────────────────────────────────────────────── */

/** The row shape `Audit.tsx` renders (the `AUDIT[]` entry shape in data.ts). */
export type AuditRow = {
  action: string;
  actor: string;
  time: string;
  meta: string;
  checksum: string;
  kind: string;
};

/** `document_viewed` → `Document viewed`, the design's short action label. */
export function auditActionLabel(eventType: string): string {
  const words = eventType.replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Event';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `AuditTrailEntry[]` → `AuditRow[]`.
 *
 * FALLBACK notes:
 * - `actor` is the recipient's email when the entry belongs to a recipient. The
 *   trail carries only a `user_id` for sender-side events and the endpoint does
 *   not join the users table, so those read as `sender`; everything with
 *   neither id is `system`, exactly as the design's rows do.
 * - `meta` is the design's "IP · geo · user agent · session" line. There is no
 *   geo-IP or session id on the API, so it is composed from the real
 *   `event_message`, `ip_address`, `user_agent` and `log_metadata`.
 * - `checksum` is the real 64-hex chain link (the mock showed 10 chars).
 */
export function toAuditRows(
  entries: AuditTrailEntry[],
  recipientEmails: Dict<string> = {},
): AuditRow[] {
  return entries.map(entry => {
    const metaParts: string[] = [];
    if (entry.event_message) metaParts.push(entry.event_message);
    if (entry.ip_address) metaParts.push(entry.ip_address);
    if (entry.user_agent) metaParts.push(entry.user_agent);
    const extra = entry.log_metadata;
    if (extra && typeof extra === 'object') {
      for (const [key, value] of Object.entries(extra)) {
        if (value === null || value === undefined || value === '') continue;
        metaParts.push(`${key} ${String(value)}`);
      }
    }
    return {
      action: auditActionLabel(entry.event_type),
      actor: (entry.recipient_id ? recipientEmails[entry.recipient_id] : null)
        ?? (entry.recipient_id ? 'recipient' : (entry.user_id ? 'sender' : 'system')),
      time: formatAuditTime(entry.created_at),
      meta: metaParts.join(' · ') || EMPTY,
      checksum: entry.checksum,
      kind: entry.kind || 'neutral',
    };
  });
}

/** The signer-attestation card on the certificate rail. */
export type AttestationRow = { name: string; email: string; meta: string; color: string };

/**
 * FALLBACK: the design's attestation meta is `email · IP · city, country`.
 * There is no geo-IP service behind the API, so the city/country half is
 * dropped and the IP is the one the recipient's own audit entries recorded;
 * a recipient with no entry yet shows their status instead.
 */
export function toAttestations(
  recipientList: RecipientResponse[],
  entries: AuditTrailEntry[],
): AttestationRow[] {
  const ipByRecipient: Dict<string> = {};
  // `entries` arrives newest-first, so the last write wins the earliest IP.
  for (const entry of entries) {
    if (entry.recipient_id && entry.ip_address) ipByRecipient[entry.recipient_id] = entry.ip_address;
  }
  return toSignerRecipients(recipientList).map(recipient => ({
    name: recipient.name,
    email: recipient.email,
    meta: `${recipient.email} · ${ipByRecipient[recipient.id] ?? recipient.status}`,
    color: recipient.color,
  }));
}

/** The certificate card, assembled from `GET /certificate/summary`. */
export type CertificateCard = {
  envelopeRef: string;
  issued: string;
  statusKey: string;
  statusLabel: string;
  documentHash: string;
  rows: { k: string; v: string }[];
};

/**
 * `CertificateSummaryResponse` → the design's certificate rows.
 *
 * FALLBACK notes:
 * - `Envelope ID` is the derived `ENV-…` reference, not the raw UUID, so it
 *   matches the library row for the same envelope.
 * - The design's hash row reads `SHA-256 / RFC 3161 TSA` and its time source
 *   `DigiCert TSA · UTC`; the API reports its real (weaker) provenance —
 *   `SHA-256` and the platform clock — and that is what is shown.
 * - `documentHash` prefers `final_sha256` (the sealed PDF) and falls back to
 *   `original_sha256` for an envelope that is not sealed yet.
 */
export function toCertificateCard(
  summary: CertificateSummaryResponse,
  statusKey: string,
  statusLabel: string,
): CertificateCard {
  const hash = summary.final_sha256 || summary.original_sha256;
  return {
    envelopeRef: envelopeRef(summary.envelope_id),
    issued: summary.sealed_at ? `issued ${formatDate(summary.sealed_at)}` : 'not sealed yet',
    statusKey,
    statusLabel,
    documentHash: hash ? `sha256:${hash}` : 'sha256 pending · no PDF sealed yet',
    rows: [
      { k: 'Envelope ID', v: envelopeRef(summary.envelope_id) },
      { k: 'Signers', v: `${summary.signers_completed} of ${summary.signers_total} completed` },
      { k: 'Sealed at', v: formatSealedAt(summary.sealed_at) },
      { k: 'Hash algorithm', v: summary.hash_algorithm },
      { k: 'Time source', v: summary.time_source },
      { k: 'Certificate authority', v: summary.certificate_authority },
    ],
  };
}

/* ── support / logs / developer ─────────────────────────────────────────── */

/* ── support tickets ────────────────────────────────────────────────────── */


/** One message in the thread `Support.tsx` renders. */
export type SupportMessageRow = {
  author: string;
  role: string;
  ts: string;
  internal: boolean;
  side: string;
  body: string;
};

/**
 * The ticket row/detail shape `Support.tsx` already reads (the `Ticket` type in
 * `lib/sf/state.tsx`), plus the fields the API adds.
 *
 * FALLBACK notes:
 * - `id` is the API's human `reference` (`TKT-9A2F41`), which is what the design
 *   shows in the row meta line; the UUID stays in `ticketId` for mutations.
 * - `tenant` is the organization name; a tenant caller's own org may come back
 *   null on a legacy row, so it degrades to the em-dash.
 * - `sla` is the API's `sla_label`; `slaBreached` replaces the prototype's
 *   string-sniffing of that label.
 * - `envelope` is derived from `document_id` the same way library ids are.
 * - `category` always renders as a pill in the design, so a null becomes
 *   `General` rather than an empty chip.
 */
export type SupportTicketRow = {
  id: string;
  ticketId: string;
  subject: string;
  tenant: string;
  requester: string;
  requesterEmail: string;
  category: string;
  priority: string;
  status: string;
  assignee: string;
  assigneeName: string;
  envelope: string;
  documentId: string | null;
  created: string;
  /** Raw `updated_at`, already relative ("2 hours ago") for the row meta. */
  updated: string;
  /** `message_count` from the list row — the thread size without loading it. */
  messageCount: number;
  sla: string;
  slaBreached: boolean;
  tags: string[];
  messages: SupportMessageRow[];
};

export function toSupportMessages(items: TicketMessageResponse[]): SupportMessageRow[] {
  return items.map(message => ({
    author: message.author_name,
    role: message.is_staff ? 'Support engineer · SignerPro' : 'Requester',
    ts: formatDateTimeShort(message.created_at),
    internal: message.is_internal === true,
    side: message.is_staff ? 'agent' : 'customer',
    body: message.body,
  }));
}

export function toSupportTicket(api: TicketResponse | TicketDetailResponse): SupportTicketRow {
  const messages = 'messages' in api && Array.isArray(api.messages) ? toSupportMessages(api.messages) : [];
  return {
    id: api.reference,
    ticketId: api.id,
    subject: api.subject,
    tenant: api.organization_name || EMPTY,
    requester: api.requester_name || api.requester_email || EMPTY,
    requesterEmail: api.requester_email || EMPTY,
    category: api.category || 'General',
    priority: api.priority,
    status: api.status,
    assignee: api.assignee_user_id || '',
    assigneeName: api.assignee_name || 'Unassigned',
    envelope: api.document_id ? envelopeRef(api.document_id) : '',
    documentId: api.document_id,
    created: formatDateTimeShort(api.created_at),
    updated: formatRelative(api.updated_at),
    messageCount: api.message_count ?? 0,
    sla: api.sla_label || EMPTY,
    slaBreached: api.sla_breached === true,
    tags: api.tags ?? [],
    messages,
  };
}

export function toSupportTickets(items: TicketResponse[]): SupportTicketRow[] {
  return items.map(toSupportTicket);
}

/**
 * The filter-pill counts. The API owns them (`TicketPage.counts`), so the pills
 * keep showing the size of the other buckets while one is selected — a client
 * tally over the current page could not.
 */
export function toTicketCounts(counts: TicketBucketCounts | null | undefined): Dict<number> {
  const c = counts ?? { all: 0, open: 0, pending: 0, escalated: 0, resolved: 0 };
  return { all: c.all ?? 0, open: c.open ?? 0, pending: c.pending ?? 0, escalated: c.escalated ?? 0, resolved: c.resolved ?? 0 };
}

/** The three stat tiles, in the label/meta wording the design uses. */
export type StatTile = { label: string; value: string; meta: string; good: boolean };

export function toTenantTicketTiles(stats: TenantTicketStats | null): StatTile[] {
  const s = stats;
  return [
    {
      label: 'YOUR OPEN TICKETS',
      value: String(s?.open_count ?? 0),
      meta: `${s?.escalated_count ?? 0} escalated`,
      good: (s?.escalated_count ?? 0) === 0,
    },
    {
      label: 'AVG RESPONSE',
      value: formatMinutes(s?.avg_first_response_minutes ?? null),
      meta: `Enterprise SLA ${formatMinutes(s?.sla_target_minutes ?? null)}`,
      good: true,
    },
    {
      label: 'RESOLVED · 90D',
      value: String(s?.resolved_90d ?? 0),
      meta: `avg ${formatMinutes(s?.avg_resolution_minutes ?? null)}`,
      good: true,
    },
  ];
}

/**
 * FALLBACK: no CSAT survey exists yet — `/api/support/queue/stats` reports
 * `csat_30d: null` rather than inventing a score, so the tile shows the
 * em-dash. Awaiting a CSAT endpoint.
 */
export function toQueueTicketTiles(stats: QueueTicketStats | null): StatTile[] {
  const s = stats;
  return [
    {
      label: 'OPEN',
      value: String(s?.open_count ?? 0),
      meta: `${s?.breaching_soon_count ?? 0} breaching soon`,
      good: (s?.breaching_soon_count ?? 0) === 0,
    },
    {
      label: 'FIRST RESPONSE',
      value: formatMinutes(s?.first_response_minutes ?? null),
      meta: `target ${formatMinutes(s?.target_minutes ?? null)}`,
      good: true,
    },
    {
      label: 'CSAT · 30D',
      value: s?.csat_30d === null || s?.csat_30d === undefined ? EMPTY : s.csat_30d.toFixed(1),
      meta: `${s?.csat_responses ?? 0} responses`,
      good: true,
    },
  ];
}

/** Assignee options. `Unassigned` is the empty id, as the design's first entry. */
export function toAgentOptions(agents: SupportAgent[], current?: SupportTicketRow | null): { id: string; name: string }[] {
  const options = [{ id: '', name: 'Unassigned' }].concat(
    agents.map(agent => ({ id: agent.id, name: agent.specialty ? `${agent.name} · ${agent.specialty}` : agent.name })),
  );
  // A tenant caller cannot read the agent roster, but must still see who holds
  // the ticket in the (disabled) select.
  if (current?.assignee && !options.some(option => option.id === current.assignee)) {
    options.push({ id: current.assignee, name: current.assigneeName });
  }
  return options;
}

/** Canned replies: `[label, body]` pairs, the shape the macro buttons map over. */
export function toQuickReplyPairs(items: QuickReply[]): [string, string][] {
  return items.map(item => [item.label, item.body]);
}

/* ── system logs ────────────────────────────────────────────────────────── */

/** The row shape `Logs.tsx` renders (the `LOGS[]` entry shape in data.ts). */
export type LogRow = {
  id: string;
  ts: string;
  level: string;
  source: string;
  msg: string;
  code: string;
  latency: string;
  payload: string;
};

/**
 * FALLBACK: `status_code` and `latency_ms` are null for events that are not
 * HTTP requests (a signing event, say), which the design already renders as the
 * em-dash. The payload is pretty-printed JSON; a row with none shows `{}`.
 */
export function toLogRow(api: SystemLogRow): LogRow {
  return {
    id: api.id,
    ts: formatLogTime(api.occurred_at),
    level: api.level,
    source: api.source,
    msg: api.message,
    code: api.status_code === null || api.status_code === undefined ? EMPTY : String(api.status_code),
    latency: api.latency_ms === null || api.latency_ms === undefined ? EMPTY : `${api.latency_ms}ms`,
    payload: api.payload ? JSON.stringify(api.payload, null, 2) : '{}',
  };
}

export function toLogRows(items: SystemLogRow[]): LogRow[] {
  return items.map(toLogRow);
}

const LOG_SOURCE_LABEL: Dict<string> = {
  api: 'API', webhook: 'Webhooks', auth: 'Auth', billing: 'Billing', signing: 'Signing', admin: 'Admin',
};
const LOG_LEVEL_LABEL: Dict<string> = { info: 'Info', warn: 'Warn', error: 'Error' };

/** `SystemLogPage.sources` → the design's `[id, label]` filter pairs. */
export function toLogSourceFilters(sources: string[]): [string, string][] {
  return ([['all', 'All']] as [string, string][]).concat(
    sources.map(source => [source, LOG_SOURCE_LABEL[source] ?? source.toUpperCase()] as [string, string]),
  );
}

/** `SystemLogPage.levels` → the design's `[id, label]` filter pairs. */
export function toLogLevelFilters(levels: string[]): [string, string][] {
  return ([['all', 'All levels']] as [string, string][]).concat(
    levels.map(level => [level, LOG_LEVEL_LABEL[level] ?? level.toUpperCase()] as [string, string]),
  );
}

/* ── developer: api keys, usage, embed ──────────────────────────────────── */


/** The four developer stat tiles, from `GET /api/api-keys/usage`. */
export function toApiUsageTiles(usage: ApiKeyUsageResponse | null): StatTile[] {
  const u = usage;
  return [
    {
      label: 'REQUESTS · 24H',
      value: formatCompact(u?.requests_24h),
      meta: `p95 ${Math.round(u?.p95_latency_ms ?? 0)}ms`,
      good: true,
    },
    {
      label: 'ERROR RATE',
      value: `${(u?.error_rate_pct ?? 0).toFixed(2)}%`,
      meta: `${u?.error_count ?? 0} of ${formatCompact(u?.requests_24h)}`,
      good: (u?.error_rate_pct ?? 0) < 1,
    },
    {
      label: 'ACTIVE KEYS',
      value: String(u?.active_key_count ?? 0),
      meta: `${u?.revoked_key_count ?? 0} revoked`,
      good: true,
    },
    {
      label: 'EMBED SESSIONS · 24H',
      value: formatCompact(u?.embed_sessions_24h),
      meta: `avg ${formatSeconds(u?.embed_avg_seconds)}`,
      good: true,
    },
  ];
}

/**
 * The key row the developer screen renders.
 *
 * The plaintext secret is returned by the API exactly once, on create and on
 * roll: it is never stored on the row, and there is no reveal endpoint. `masked`
 * is all a listed key can ever show.
 */
export type ApiKeyRow = {
  id: string;
  label: string;
  mode: string;
  masked: string;
  scopes: string[];
  created: string;
  lastUsed: string;
  revoked: boolean;
};

export function toApiKeyRow(api: ApiKeyResponse): ApiKeyRow {
  return {
    id: api.id,
    label: api.label,
    mode: api.mode,
    masked: api.masked,
    scopes: api.scopes ?? [],
    created: formatDate(api.created_at),
    lastUsed: api.last_used_at ? formatDate(api.last_used_at) : 'never',
    revoked: api.revoked_at !== null && api.revoked_at !== undefined,
  };
}

export function toApiKeyRows(items: ApiKeyResponse[]): ApiKeyRow[] {
  return items.map(toApiKeyRow);
}

/**
 * The scope chips are on/off per scope name. The catalogue comes from
 * `GET /api/api-keys/scopes`; which of them are lit comes from the key whose
 * grants the panel is editing.
 */
export function toScopeState(catalogue: ApiKeyScopeResponse[], granted: string[]): Dict<boolean> {
  const on = new Set(granted);
  const out: Dict<boolean> = {};
  for (const entry of catalogue) out[entry.scope] = on.has(entry.scope);
  // A scope a key holds that the catalogue no longer lists must still show.
  for (const scope of granted) if (!(scope in out)) out[scope] = true;
  return out;
}

/** `allowed_origins` → the comma-separated string the origins input edits. */
export function toOriginsField(settings: ApiSettingsResponse | null): string {
  return (settings?.allowed_origins ?? []).join(', ');
}

/** …and back: the input's text → the `allowed_origins` array the API takes. */
export function fromOriginsField(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tenant overview (ORG-2) — `GET /api/organizations/me/overview`
 *
 * The response shapes live in `lib/api/types.ts` (mirroring
 * `backend/app/schemas/organization.py`); these aliases keep the names the
 * screens already import.
 * ══════════════════════════════════════════════════════════════════════════ */

export type OverviewStatsApi = OrganizationOverview['stats'];
export type OverviewAttentionApi = OrganizationOverview['attention'][number];
export type OverviewSpendLineApi = OrganizationOverview['spend_lines'][number];
export type OverviewTeamRowApi = OrganizationOverview['team'][number];
export type OrganizationOverviewResponse = OrganizationOverview;

/** What a fresh tenant (or a failed call) renders as. Twelve empty buckets. */
export const EMPTY_ORG_OVERVIEW: OrganizationOverviewResponse = {
  range: '90d',
  stats: { action_required: 0, out_for_signature: 0, seats_activated: 0, seats_licensed: 0, completion_rate: 0 },
  series: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  attention: [],
  spend_lines: [],
  team: [],
};


function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** The `ORG_STATS[]` shape `TenantHome.tsx` renders, from real counters.
 *
 * FALLBACK notes — the design's metas quoted a prior period the API does not
 * compute, so each one is replaced by a figure the same response does carry:
 * - ACTION REQUIRED's "2 overdue" → how many are out for signature.
 * - OUT FOR SIGNATURE's "avg 4.2h" → the completed share of the window.
 * - COMPLETION RATE's "+1.4 pts" → the window the rate was measured over.
 */
export function toOverviewStats(
  o: OrganizationOverviewResponse,
): { label: string; value: string; meta: string; good: boolean; pct: number }[] {
  const st = o.stats;
  const open = st.action_required + st.out_for_signature;
  return [
    {
      label: 'ACTION REQUIRED',
      value: formatCount(st.action_required),
      meta: st.action_required ? `${formatCount(st.out_for_signature)} out for signature` : 'nothing waiting on you',
      good: st.action_required === 0,
      pct: open ? clampPct((st.action_required / open) * 100) : 0,
    },
    {
      label: 'OUT FOR SIGNATURE',
      value: formatCount(st.out_for_signature),
      meta: `${st.completion_rate}% complete in range`,
      good: true,
      pct: open ? clampPct((st.out_for_signature / open) * 100) : 0,
    },
    {
      label: 'SEATS ACTIVATED',
      value: formatCount(st.seats_activated),
      meta: `of ${formatCount(st.seats_licensed)}`,
      good: st.seats_licensed === 0 || st.seats_activated <= st.seats_licensed,
      pct: st.seats_licensed ? clampPct((st.seats_activated / st.seats_licensed) * 100) : 0,
    },
    {
      label: 'COMPLETION RATE',
      value: `${st.completion_rate}%`,
      meta: rangeMetaLabel(o.range),
      good: st.completion_rate >= 75,
      pct: clampPct(st.completion_rate),
    },
  ];
}

/** `90d` → `last 90 days`, for a tile's sub-label. */
export function rangeMetaLabel(range: string): string {
  if (range === '7d') return 'last 7 days';
  if (range === '30d') return 'last 30 days';
  if (range === '12m') return 'last 12 months';
  return 'last 90 days';
}

/** ISO week number, so the volume chart's `W23…W34` axis is real. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Bucket labels for the twelve-bar envelope series. The service divides the
 * range into twelve equal buckets, so at `90d` each bucket is 7.5 days and the
 * design's weekly `W…` labels stay honest.
 */
export function toSeriesLabels(range: string, count = 12, now: number = Date.now()): string[] {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '12m' ? 365 : 90;
  const width = Math.max(days / count, 1 / 24);
  const weekly = width >= 5;
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = new Date(now - width * (count - i) * 86400000);
    labels.push(weekly ? `W${isoWeek(start)}` : start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  }
  return labels;
}

/** Tone keyword → the dot colour the design used. `ACCENT` defers to the theme. */
export const ATTENTION_TONE_COLOR: Dict<string> = {
  warn: '#f59e0b',
  bad: '#f43f5e',
  good: '#10b981',
  info: 'ACCENT',
  neutral: '#64748b',
};

/**
 * The service returns a front-end-ish `screen` such as `documents?quick=expiring`
 * or `settings/billing`; turn it into a real route this app serves.
 */
export function attentionHref(screen: string): string {
  const [rawPath, query] = (screen || '').split('?');
  const clean = rawPath.replace(/^\/+/, '');
  const MAP: Dict<string> = {
    '': '/overview',
    overview: '/overview',
    documents: '/documents',
    dashboard: '/documents',
    builder: '/documents/prepare',
    audit: '/documents/audit',
    contacts: '/contacts',
    reports: '/reports',
    billing: '/account/billing',
    'settings/billing': '/account/billing',
    invoices: '/account/billing',
    'billing/invoices': '/account/billing',
    support: '/support',
    'settings/team': '/account/billing',
    'settings/security': '/account/billing',
  };
  const base = MAP[clean] ?? `/${clean}`;
  return query ? `${base}?${query}` : base;
}

export type OverviewAttentionRow = { label: string; meta: string; href: string; color: string };

export function toOverviewAttention(items: OverviewAttentionApi[]): OverviewAttentionRow[] {
  return items.map(item => ({
    label: item.title,
    meta: item.detail,
    href: attentionHref(item.screen),
    color: ATTENTION_TONE_COLOR[item.tone] ?? '#64748b',
  }));
}

export type OverviewSpend = { total: string; lines: { k: string; v: string }[] };

/** Invoiced spend in the window, grouped by line description. */
export function toOverviewSpend(lines: OverviewSpendLineApi[]): OverviewSpend {
  return {
    total: formatCents(lines.reduce((sum, line) => sum + (line.amount_cents || 0), 0)),
    lines: lines.map(line => ({ k: line.label, v: formatCents(line.amount_cents) })),
  };
}

export type OverviewTeamRow = { name: string; meta: string; count: string };

export function toOverviewTeam(rows: OverviewTeamRowApi[]): OverviewTeamRow[] {
  return rows.map(row => ({
    name: row.name,
    meta: row.last_active_at
      ? `${row.role_label} · last active ${formatRelative(row.last_active_at).toLowerCase()}`
      : `${row.role_label} · never active`,
    count: `${formatCount(row.sent_count)} sent`,
  }));
}

/* ── overview banner ───────────────────────────────────────────────────────
 * `GET /api/organizations/me` — `slug` / `region` / `seats_licensed` are part
 * of `OrganizationResponse` in `lib/api/types.ts`; this alias keeps the name
 * the overview screen already imported, and the fields are still read
 * defensively so a partial payload cannot throw.
 */
export type OrganizationProfileExtras = Pick<OrganizationResponse, 'id' | 'name'>
  & Partial<Pick<OrganizationResponse, 'slug' | 'region' | 'seats_licensed'>>;

export type OverviewBanner = { name: string; initials: string; meta: string };

export function toOverviewBanner(
  org: OrganizationProfileExtras | null,
  plan: { plan_name?: string | null; current_period_end?: string | null } | null,
): OverviewBanner {
  const name = org?.name || 'Your organization';
  const parts = [
    org?.slug || null,
    plan?.plan_name || null,
    org?.region || null,
    plan?.current_period_end ? `renews ${formatDate(plan.current_period_end)}` : null,
  ].filter((part): part is string => Boolean(part));
  return { name, initials: initialsOf(name), meta: parts.join(' · ') || EMPTY };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Reports (RPT-1…8) — `GET /api/reports/*`
 * ══════════════════════════════════════════════════════════════════════════ */

/** The four ranges the API accepts (`report_service.RANGE_DAYS`). */
export const REPORT_RANGE_KEYS = ['7d', '30d', '90d', '12m'] as const;

export function normalizeReportRange(value: string | string[] | undefined, fallback = '30d'): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return REPORT_RANGE_KEYS.includes(raw as (typeof REPORT_RANGE_KEYS)[number]) ? (raw as string) : fallback;
}

export type ReportTileRow = { label: string; value: string; meta: string };

/**
 * The design's five analytics tiles, from `GET /api/reports/overview`.
 *
 * The response also ships a six-entry `tiles[]` for generic consumers, but the
 * design fixes five labels in a five-column grid, so they are composed from
 * the named fields instead.
 *
 * FALLBACK: MEDIAN COMPLETION's "−18% vs prior period" has no prior-period
 * figure on the API; it reports how many completions the median is over.
 */
export function toReportTiles(o: T_ReportOverview, senderCount?: number): ReportTileRow[] {
  return [
    {
      label: 'COMPLETION RATE',
      value: `${o.completion_rate_pct}%`,
      meta: `${formatCount(o.documents_completed)} of ${formatCount(o.documents_created)} documents`,
    },
    {
      label: 'MEDIAN COMPLETION',
      value: o.median_completion_label || EMPTY,
      meta: `over ${formatCount(o.documents_completed)} completed`,
    },
    {
      label: 'TEMPLATES CREATED',
      value: formatCount(o.templates_created),
      meta: `${formatCount(o.templates_uses)} uses`,
    },
    {
      label: 'DOCUMENTS CREATED',
      value: formatCount(o.documents_created),
      meta: `${formatCount(senderCount ?? o.sender_count)} senders`,
    },
    {
      label: 'RECIPIENTS',
      value: formatCount(o.recipient_count),
      meta: `${formatCount(o.first_time_recipients)} first-time`,
    },
  ];
}

/* Local structural aliases so this file needs no new import from lib/api. */
type T_ReportOverview = {
  documents_created: number;
  documents_completed: number;
  completion_rate_pct: number;
  median_completion_label: string;
  templates_created: number;
  templates_uses: number;
  sender_count: number;
  recipient_count: number;
  first_time_recipients: number;
};

/** A fresh tenant's analytics: every counter zero rather than a crash. */
export const EMPTY_REPORT_OVERVIEW = {
  range_start: '',
  range_end: '',
  documents_created: 0,
  documents_completed: 0,
  completion_rate_pct: 0,
  median_completion_seconds: 0,
  median_completion_label: EMPTY,
  templates_created: 0,
  templates_uses: 0,
  sender_count: 0,
  recipient_count: 0,
  first_time_recipients: 0,
  tiles: [],
};

/**
 * The stacked invite bar. `report_service.invites` keys its buckets
 * `pending_expired | completed | declined | cancelled`; the design fixes both
 * the wording and the colour of each, so the key drives the lookup and any
 * unknown bucket keeps the API's own label in a neutral colour.
 */
const INVITE_BUCKET: Dict<[string, string]> = {
  pending_expired: ['Pending / expired', '#f59e0b'],
  completed: ['Completed', '#10b981'],
  declined: ['Declined', '#f43f5e'],
  cancelled: ['Cancelled', '#facc15'],
};

export function toInviteSplit(split: { label: string; count: number }[]): [string, number, string][] {
  const order = ['pending_expired', 'completed', 'declined', 'cancelled'];
  const byKey = new Map(split.map(item => [item.label, item.count]));
  const rows: [string, number, string][] = order
    .filter(key => byKey.has(key))
    .map(key => [INVITE_BUCKET[key][0], byKey.get(key) ?? 0, INVITE_BUCKET[key][1]] as [string, number, string]);
  for (const item of split) {
    if (!order.includes(item.label)) rows.push([item.label, item.count, '#64748b']);
  }
  return rows.length ? rows : order.map(key => [INVITE_BUCKET[key][0], 0, INVITE_BUCKET[key][1]] as [string, number, string]);
}

export type ReportTableRow = { key: string; label: string; sub: string; cells: string[] };

/**
 * The nine-column recipients table.
 *
 * FALLBACK notes — the API's per-recipient counters do not line up 1:1 with the
 * design's column headings:
 * - `Created` ← `sent` (invites created for that email).
 * - `Sent` ← `delivered`.
 * - `Pending` is derived: sent − completed − declined − expired, floored at 0.
 * - `Cancelled` ← `expired`; the API has no cancelled-per-recipient counter and
 *   an expired invite is the closest thing the design's column means.
 */
export function toRecipientReportRows(
  items: {
    email: string;
    sent: number;
    delivered: number;
    viewed: number;
    completed: number;
    declined: number;
    expired: number;
    median_completion_label: string;
    completion_rate_pct: number;
  }[],
): ReportTableRow[] {
  return items.map(r => {
    const pending = Math.max(0, r.sent - r.completed - r.declined - r.expired);
    return {
      key: r.email,
      label: r.email,
      sub: '',
      cells: [
        String(r.sent),
        String(r.delivered),
        String(pending),
        String(r.completed),
        String(r.expired),
        String(r.declined),
        r.median_completion_label || EMPTY,
        `${r.completion_rate_pct}%`,
      ],
    };
  });
}

/** The documents report table: recipients · signed · status · updated · progress. */
export function toDocumentReportRows(
  items: {
    document_id: string;
    title: string;
    status: string;
    signed: number;
    total: number;
    age_days: number;
    sender_name: string | null;
    updated_at: string | null;
  }[],
): ReportTableRow[] {
  return items.map(d => {
    const bucket = docStatusBucket(d.status);
    return {
      key: d.document_id,
      label: d.title,
      sub: envelopeRef(d.document_id),
      cells: [
        String(d.total),
        String(d.signed),
        REPORT_STATUS_LABEL[bucket] ?? d.status,
        formatRelative(d.updated_at),
        `${d.total ? Math.round((d.signed / d.total) * 100) : 0}%`,
      ],
    };
  });
}

/** `STATUS[bucket].label` without importing the whole style map. */
const REPORT_STATUS_LABEL: Dict<string> = {
  action: 'Action required',
  waiting: 'Waiting for others',
  completed: 'Completed',
  draft: 'Draft',
  voided: 'Voided',
};

/** The templates report table: uses · fields · owner · updated. */
export function toTemplateReportRows(
  items: {
    template_id: string;
    title: string;
    use_count: number;
    completed_copies: number;
    field_count: number;
    owner_name: string | null;
    updated_at: string | null;
  }[],
): ReportTableRow[] {
  return items.map(t => ({
    key: t.template_id,
    label: t.title,
    sub: `TPL-${t.template_id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    cells: [
      String(t.use_count),
      String(t.field_count),
      t.owner_name || EMPTY,
      formatDate(t.updated_at),
    ],
  }));
}

/**
 * The "All reports" grid. The design's six cards map onto real
 * `report_service.REPORT_KEYS`, which is what makes each card downloadable via
 * `GET /api/reports/{report_key}/csv`.
 */
export const REPORT_CARDS: { key: string; label: string; meta: string }[] = [
  { key: 'documents', label: 'Documents report', meta: 'Status, progress and ageing for every envelope in the period.' },
  { key: 'templates', label: 'Templates report', meta: 'Template inventory with field counts and owners.' },
  { key: 'template_usage', label: 'Templates usage report', meta: 'Which templates are used, by whom and how often.' },
  { key: 'completed_copies', label: 'Completed copies report', meta: 'Every completed copy generated from a template.' },
  { key: 'recipients', label: 'Recipients report', meta: 'Per-recipient volume, completion time and decline rate.' },
  { key: 'audit', label: 'Audit export', meta: 'Full event log with checksums for a date range.' },
];

/** `document_title` → `Document title`, for the custom-report field chips. */
const REPORT_FIELD_LABEL: Dict<string> = {
  document_title: 'Document title',
  document_status: 'Envelope status',
  sender_name: 'Sender',
  recipient_email: 'Recipient',
  recipient_status: 'Recipient status',
  created_at: 'Created',
  completed_at: 'Completed',
  age_days: 'Age (days)',
  turnaround_seconds: 'Completion time',
};

export function reportFieldLabel(field: string): string {
  return REPORT_FIELD_LABEL[field] ?? field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/** A custom report run: `rows` are keyed by the definition's `fields`. */
export function toCustomReportCells(row: Record<string, unknown>, fields: string[]): string[] {
  return fields.map(field => {
    const value = row[field];
    if (value === null || value === undefined || value === '') return EMPTY;
    if (field === 'created_at' || field === 'completed_at') return formatDate(String(value));
    return String(value);
  });
}

/* ══ billing & invoices (BIL screens) ══════════════════════════════════ */


function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : EMPTY;
}

/* ── subscription (GET /api/billing/subscription) ───────────────────────── */

export type SubscriptionSummary = {
  planName: string;
  planCode: string;
  statusLabel: string;
  /** `sub_… · 1,240 seats × $44 · billed monthly` */
  metaLine: string;
  seatsLicensed: number;
  seatsActivated: number;
  seatPriceCents: number;
  cycle: string;
  cycleLabel: string;
  cycleMeta: string;
  nextInvoice: string;
  nextInvoiceMeta: string;
  isSeatBased: boolean;
};

/**
 * FALLBACK notes:
 * - the design's `sub_1QhT7xKz` is the provider subscription id; the API only
 *   exposes its own `id`, and an org that has never checked out has none — the
 *   em-dash stands in for it.
 * - `renews …` under CYCLE is derived from `current_period_end`, which is what
 *   the backend bills against, rather than the design's hardcoded year.
 */
export function toSubscriptionSummary(
  sub: SubscriptionResponse,
  cycleOverride?: string,
): SubscriptionSummary {
  const cycle = cycleOverride || sub.cycle || 'monthly';
  const seatPrice = sub.seat_price_cents ?? 0;
  const seats = sub.seats_licensed ?? 0;
  const seatWord = seats === 1 ? 'seat' : 'seats';
  const metaLine = [
    sub.id || EMPTY,
    sub.is_seat_based
      ? `${seats.toLocaleString('en-US')} ${seatWord} × ${formatCents(seatPrice)}`
      : sub.plan_name,
    `billed ${cycle === 'annual' ? 'annually' : 'monthly'}`,
  ].join(' · ');
  return {
    planName: sub.plan_name,
    planCode: sub.plan_code,
    statusLabel: titleCase(sub.status || 'active'),
    metaLine,
    seatsLicensed: seats,
    seatsActivated: sub.seats_activated ?? 0,
    seatPriceCents: seatPrice,
    cycle,
    cycleLabel: cycle === 'annual' ? 'Annual' : 'Monthly',
    cycleMeta: sub.current_period_end
      ? 'renews ' + formatDate(sub.current_period_end)
      : 'no renewal scheduled',
    nextInvoice: formatCents(sub.next_invoice_total_cents ?? 0),
    nextInvoiceMeta: formatDate(sub.next_invoice_at),
    isSeatBased: sub.is_seat_based === true,
  };
}

/**
 * The subscription-status pill. The design only draws the green "Active" tone;
 * a trialing / past-due / canceled subscription must not read as healthy.
 */
export function subscriptionStatusTone(status: string): Tone {
  if (status === 'active') return { bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' };
  if (status === 'trialing') return { bg: '#eef2ff', fg: '#3730a3', bd: '#c7d2fe' };
  if (status === 'past_due' || status === 'unpaid') return { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' };
  return { bg: '#f5f6f8', fg: '#475569', bd: '#e3e7ee' };
}

/* ── plans (GET /api/billing/plans) ─────────────────────────────────────── */

export type PlanChoice = {
  code: string;
  name: string;
  /** `$44 / seat`, the string the design's plan cards and modal print. */
  priceLabel: string;
  priceCents: number;
  tag: string;
  lines: { k: string; v: string }[];
};

/**
 * `marketing_lines` is typed `list[dict]` on the API; the rows the catalogue
 * ships are `{label, value}`. Anything else is skipped rather than rendered as
 * `[object Object]`.
 */
export function toPlanChoices(plans: PlanResponse[]): PlanChoice[] {
  return plans
    .filter(plan => plan.is_active !== false)
    .map(plan => {
      const unit = plan.seat_price_cents ?? plan.price_cents ?? 0;
      return {
        code: plan.code,
        name: plan.name,
        priceLabel: formatCents(unit, plan.currency) + (plan.is_seat_based ? ' / seat' : ''),
        priceCents: unit,
        tag: plan.tag || EMPTY,
        lines: (plan.marketing_lines ?? [])
          .filter(line => typeof line?.label === 'string' && typeof line?.value === 'string')
          .map(line => ({ k: String(line.label), v: String(line.value) })),
      };
    });
}

/* ── usage (GET /api/billing/usage) ─────────────────────────────────────── */

/** `UsageRow` → the `{label, pct, value}` row the usage meters render. */
export function toUsageMeters(rows: UsageRow[]): { label: string; pct: number; value: string }[] {
  return rows.map(row => ({ label: row.label, pct: row.pct ?? 0, value: row.display || String(row.used) }));
}

/* ── payment methods (GET /api/billing/payment-methods) ─────────────────── */

export type PaymentMethodRow = {
  id: string;
  brand: string;
  label: string;
  meta: string;
  /** `•••• •••• •••• 4242`, masked to the end when the provider withheld last4. */
  number: string;
  /** `MM/YY`, or `••/••` until the provider reports an expiry. */
  expiry: string;
  holder: string;
  isDefault: boolean;
};

/**
 * FALLBACK: the design's brand chip is a card network (`VISA`); an ACH/SEPA or
 * invoice instrument has no `brand`, so the instrument type fills the chip —
 * exactly what the prototype's `ACH` row did.
 */
export function toPaymentMethodRows(items: PaymentMethodResponse[]): PaymentMethodRow[] {
  return items.map(pm => {
    const mm = pm.exp_month ? String(pm.exp_month).padStart(2, '0') : null;
    const yy = pm.exp_year ? String(pm.exp_year).slice(-2) : null;
    return {
      id: pm.id,
      brand: (pm.brand || pm.type || 'card').replace(/_/g, ' ').toUpperCase(),
      label: pm.label || titleCase(pm.type),
      meta: pm.meta || [pm.holder_name, pm.country].filter(Boolean).join(' · ') || EMPTY,
      /* Only a PAN-bearing instrument gets a masked number; a wallet (Link)
         or an invoice has no last4, and inventing one would be a lie. */
      number: pm.last4 ? '•••• •••• •••• ' + pm.last4 : '',
      expiry: mm && yy ? mm + '/' + yy : '••/••',
      holder: (pm.holder_name || EMPTY).toUpperCase(),
      isDefault: pm.is_default === true,
    };
  });
}

/** The `Visa •••• 4242` chip the checkout modal shows above its CTA. */
export function defaultPaymentMethodLabel(items: PaymentMethodResponse[]): string {
  const def = items.find(pm => pm.is_default) ?? items[0];
  return def ? def.label || titleCase(def.type) : 'No payment method on file';
}

/* ── upcoming invoice (GET /api/billing/upcoming-invoice) ───────────────── */

export type MoneyLine = { d: string; amt: string };

/** Line items plus an explicit tax line when the API computed one. */
export function toUpcomingLines(upcoming: UpcomingInvoiceResponse): MoneyLine[] {
  const lines: MoneyLine[] = (upcoming.line_items ?? []).map(item => ({
    d: item.description,
    amt: formatCents(item.amount_cents, upcoming.currency),
  }));
  if (upcoming.tax_cents) lines.push({ d: 'Estimated tax', amt: formatCents(upcoming.tax_cents, upcoming.currency) });
  return lines;
}

/** `Total due 1 Sep 2026` — the design's footer label, with the real date. */
export function upcomingTotalLabel(upcoming: UpcomingInvoiceResponse): string {
  return upcoming.due_at ? 'Total due ' + formatDate(upcoming.due_at) : 'Total due';
}

/* ── charges (GET /api/billing/charges) ─────────────────────────────────── */

export type ChargeRow = { id: string; amount: string; meta: string; status: string; good: boolean };

/**
 * A `recovered` charge succeeded only after a decline, so it keeps the amber
 * tone the design gave its "Recovered" row; only a clean `succeeded` is green.
 */
export function toChargeRows(items: ChargeResponse[]): ChargeRow[] {
  return items.map(charge => ({
    id: charge.id,
    amount: formatCents(charge.amount_cents, charge.currency),
    meta: [
      charge.provider_payment_id || charge.description || EMPTY,
      charge.method_label,
      charge.status === 'failed' && charge.decline_code ? charge.decline_code : null,
      formatDate(charge.occurred_at),
    ].filter(Boolean).join(' · '),
    status: titleCase(charge.status),
    good: charge.status === 'succeeded',
  }));
}

/* ── invoices (GET /api/invoices, GET /api/saas/invoices) ───────────────── */

const INVOICE_TONES: Dict<Tone> = {
  paid: { bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' },
  open: { bg: '#eef2ff', fg: '#4338ca', bd: '#c7d2fe' },
  past_due: { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
  void: { bg: '#f5f6f8', fg: '#64748b', bd: '#e3e7ee' },
};

const INVOICE_LABELS: Dict<string> = {
  paid: 'Paid',
  open: 'Open',
  past_due: 'Past due',
  void: 'Void',
  draft: 'Draft',
  uncollectible: 'Uncollectible',
};

/**
 * The design's four status pills against the backend's six-value
 * `InvoiceStatus`. `draft` reads as neutral and `uncollectible` as the failure
 * tone — neither may borrow the paid/open colours.
 */
export function invoiceStatusLabel(status: string, isOverdue = false): string {
  if (isOverdue && status === 'open') return INVOICE_LABELS.past_due;
  return INVOICE_LABELS[status] ?? titleCase(status);
}

export function invoiceStatusTone(status: string, isOverdue = false): Tone {
  if (isOverdue && status === 'open') return INVOICE_TONES.past_due;
  if (status === 'uncollectible') return INVOICE_TONES.past_due;
  return INVOICE_TONES[status] ?? INVOICE_TONES.void;
}

export type InvoiceRow = {
  id: string;
  number: string;
  tenant: string;
  period: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  /** `1 Sep` / `overdue 9d` / `voided`, as the design's right-hand column. */
  due: string;
  pi: string;
  method: string;
  total: string;
  totalCents: number;
  amountDueCents: number;
  currency: string;
  hostedUrl: string;
  issued: string;
  lines: MoneyLine[];
  subtotal: string;
  tax: string;
  isPaid: boolean;
  isVoid: boolean;
  isOverdue: boolean;
};

function dueLabel(api: InvoiceResponse): string {
  if (api.status === 'void') return 'voided';
  if (api.status === 'paid') return formatDayMonth(api.paid_at ?? api.due_at);
  if (!api.due_at) return EMPTY;
  const overdueMs = Date.now() - new Date(api.due_at).getTime();
  if ((api.is_overdue || api.status === 'past_due' || api.status === 'uncollectible') && overdueMs > 0) {
    return 'overdue ' + Math.max(1, Math.floor(overdueMs / 86400000)) + 'd';
  }
  return formatDayMonth(api.due_at);
}

/**
 * FALLBACK notes:
 * - `period` uses the API's `period_label` (`Aug 2026`); an invoice raised
 *   outside a period has none, so the issue date stands in.
 * - `pi` / `method` are null until a collection attempt has been made; the
 *   design always prints something, hence the em-dash.
 * - the design's "Hosted invoice" row is a Stripe URL; we print the API's
 *   `hosted_url` and never synthesise one.
 */
export function toInvoiceRow(api: InvoiceResponse): InvoiceRow {
  const overdue = api.is_overdue === true || api.status === 'past_due';
  return {
    id: api.id,
    number: api.number,
    tenant: api.organization_name || EMPTY,
    period: api.period_label || formatDate(api.issued_at),
    status: api.status,
    statusLabel: invoiceStatusLabel(api.status, overdue),
    tone: invoiceStatusTone(api.status, overdue),
    due: dueLabel(api),
    pi: api.provider_payment_intent_id || EMPTY,
    method: api.payment_method_label || EMPTY,
    total: formatCents(api.total_cents, api.currency),
    totalCents: api.total_cents,
    amountDueCents: api.amount_due_cents,
    currency: api.currency,
    hostedUrl: api.hosted_url || EMPTY,
    issued: formatDate(api.issued_at),
    lines: (api.line_items ?? []).map(item => ({
      d: item.description,
      amt: formatCents(item.amount_cents, api.currency),
    })),
    subtotal: formatCents(api.subtotal_cents, api.currency),
    tax: formatCents(api.tax_cents, api.currency),
    isPaid: api.status === 'paid',
    isVoid: api.status === 'void',
    isOverdue: overdue,
  };
}

export function toInvoiceRows(items: InvoiceResponse[]): InvoiceRow[] {
  return items.map(toInvoiceRow);
}

/* ── plan change preview (GET /api/billing/change-plan/preview) ─────────── */

/** The checkout modal's summary rows, straight off the proration preview. */
export function toPlanPreviewPairs(preview: PlanChangePreview): [string, string][] {
  return [
    ['Plan', preview.target_plan_name + ' · ' + formatCents(preview.target_amount_cents)],
    ['Seats', preview.seats_licensed.toLocaleString('en-US')],
    [preview.proration_cents < 0 ? 'Credited today' : 'Prorated today', formatCents(preview.proration_cents)],
    ['Next invoice', formatCents(preview.next_invoice_total_cents)],
  ];
}

/* ── payment failures (402 from POST /api/invoices/{id}/pay) ────────────── */

const DECLINE_COPY: Dict<string> = {
  card_declined: 'the card was declined',
  no_payment_method: 'no payment method is on file',
  insufficient_funds: 'insufficient funds',
  expired_card: 'the card has expired',
};

/**
 * A decline must never read as a success. The 402 body carries `decline_code`
 * and the dunning state, but `ApiError` keeps only the message, so the screen
 * re-reads the invoice and its failed charge and this builds the sentence.
 */
export function declineNotice(
  invoiceNumber: string,
  declineCode: string | null | undefined,
  invoiceStatus?: string | null,
): string {
  const reason = declineCode ? (DECLINE_COPY[declineCode] ?? declineCode) : 'the payment was declined';
  const state = invoiceStatus === 'uncollectible'
    ? ' · marked uncollectible, no further retries'
    : (invoiceStatus === 'past_due' ? ' · invoice is past due, retry scheduled' : '');
  return invoiceNumber + ' not paid · ' + reason + state;
}

/* ── platform: tenants, directory, flags, security, revenue ─────────────── */
/** The prototype's neutral pill tone, for a plan or status the design never named. */
const PLATFORM_TONE_NEUTRAL: Tone = { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' };


/** A stat tile as `PlatformHome` / `Platform` / `Revenue` render it. */
export type PlatformStatTile = { label: string; value: string; meta: string; good: boolean };

/**
 * `GET /api/saas/overview` → the five platform stat tiles.
 *
 * FALLBACK: the design's "+12.4% vs prior" envelope delta and the MRR tile's
 * "net retention 118%" are not on `/overview` (NRR lives on
 * `/api/saas/revenue/churn`, which the overview screen does not fetch), so the
 * meta lines state what this endpoint does report.
 */
export function toPlatformStats(overview: PlatformApi.PlatformOverview): PlatformStatTile[] {
  const seats = overview.seats;
  const activated = seats.provisioned ? Math.round(seats.activated * 100 / seats.provisioned) : 0;
  return [
    { label:'TENANTS', value:String(overview.tenants.total),
      meta: overview.tenants.trial + ' in trial · ' + overview.tenants.suspended + ' suspended',
      good: overview.tenants.suspended === 0 },
    { label:'SEATS PROVISIONED', value: seats.provisioned.toLocaleString(),
      meta: activated + '% activated', good: true },
    { label:'ENVELOPES · 30D', value: overview.envelopes_30d.toLocaleString(),
      meta:'last 30 days', good: true },
    { label:'MRR', value: formatCentsK(overview.mrr_cents),
      meta:'across ' + overview.tenants.active + ' active tenants', good: true },
    /* No availability signal exists, so `uptime_pct` is null and no SLA is
       claimed. `errors_24h` is the measured figure the tile shows instead. */
    { label:'INCIDENTS · 90D', value:String(overview.incidents_90d),
      meta: (overview.errors_24h ?? 0).toLocaleString() + ' error-level events · 24h',
      good: overview.incidents_90d === 0 && (overview.errors_24h ?? 0) === 0 },
  ];
}

/** `mrr_series` (cents) → the `$k` numbers the bar chart scales against. */
export function toMrrSeriesK(series: number[]): number[] {
  return (series ?? []).map(cents => Math.round((cents || 0) / 1000) / 100);
}

/** Month labels under the MRR chart, oldest → newest, for `count` months. */
export function toMrrMonthTicks(count: number, now: Date = new Date()): string[] {
  const ticks: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    ticks.push(new Date(now.getFullYear(), now.getMonth() - i, 1)
      .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
  }
  return ticks;
}

/** The tenant row shape `Platform.tsx` renders (the `TENANTS[]` entry shape). */
export type TenantTableRow = {
  id: string;
  name: string;
  slug: string;
  owner: string;
  plan: string;
  planTone: Tone;
  seats: number;
  used: number;
  volume: string;
  region: string;
  status: string;
  statusTone: Tone;
  suspended: boolean;
  suspensionReason: string | null;
  mrrCents: number;
};

/**
 * `status` is `suspended` or the subscription status; the prototype's
 * `STATUS_TONE` / `PLAN_TONE` maps are keyed by the display words, so the
 * mapping happens here and the tone travels with the row — a plan or status the
 * design never named (the API allows any plan code) falls back to the neutral
 * tone instead of handing `undefined` to `pill()`.
 */
const TENANT_STATUS_LABEL: Dict<string> = {
  suspended: 'Suspended',
  trialing: 'Trial',
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  expired: 'Expired',
  incomplete: 'Incomplete',
  none: 'No subscription',
};

export function tenantStatusLabel(status: string): string {
  if (TENANT_STATUS_LABEL[status]) return TENANT_STATUS_LABEL[status];
  if (!status) return EMPTY;
  return status[0].toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export function toTenantTableRow(api: PlatformApi.TenantRow): TenantTableRow {
  const label = tenantStatusLabel(api.status);
  const plan = api.plan_name || api.subscription_tier || EMPTY;
  return {
    id: api.id,
    name: api.name,
    slug: api.slug || api.id,
    owner: api.owner_email || EMPTY,
    plan,
    planTone: PLAN_TONE[plan] ?? PLATFORM_TONE_NEUTRAL,
    seats: api.seats_licensed || 0,
    used: api.seats_activated || 0,
    volume: (api.envelope_volume_30d ?? 0).toLocaleString(),
    region: api.region || EMPTY,
    status: label,
    statusTone: STATUS_TONE[label] ?? PLATFORM_TONE_NEUTRAL,
    suspended: api.status === 'suspended',
    suspensionReason: api.suspension_reason,
    mrrCents: api.mrr_cents || 0,
  };
}

export function toTenantTableRows(items: PlatformApi.TenantRow[]): TenantTableRow[] {
  return items.map(toTenantTableRow);
}

/** Top-tenants-by-revenue rail on `PlatformHome`. */
export type TopTenantRow = { id: string; name: string; mrr: string; mrrCents: number };

export function toTopTenants(items: PlatformApi.TenantRow[], limit = 5): TopTenantRow[] {
  return items
    .slice()
    .sort((a, b) => (b.mrr_cents || 0) - (a.mrr_cents || 0))
    .slice(0, limit)
    .map(t => ({ id: t.id, name: t.name, mrr: formatCentsK(t.mrr_cents || 0), mrrCents: t.mrr_cents || 0 }));
}

/** Directory row (`PLATFORM_USERS[]` in the prototype). */
export type DirectoryRow = {
  id: string;
  name: string;
  email: string;
  tenant: string;
  role: string;
  mfa: string;
  last: string;
};

/**
 * FALLBACK: the design's MFA column shows the factor name (`Passkey`, `TOTP`).
 * The API reports `mfa_enabled` plus a nullable `mfa_method`, so an enrolled
 * user with no recorded method reads as `Enabled`.
 */
export function toDirectoryRow(api: PlatformApi.DirectoryUser): DirectoryRow {
  const method = api.mfa_method
    ? (api.mfa_method.toLowerCase() === 'totp' ? 'TOTP' : api.mfa_method[0].toUpperCase() + api.mfa_method.slice(1))
    : null;
  return {
    id: api.id,
    name: api.name,
    email: api.email,
    tenant: api.organization_name,
    role: api.role_key,
    mfa: api.mfa_enabled ? (method ?? 'Enabled') : 'None',
    last: formatRelative(api.last_active_at),
  };
}

export function toDirectoryRows(items: PlatformApi.DirectoryUser[]): DirectoryRow[] {
  return items.map(toDirectoryRow);
}

/** The server-owned permission matrix (`GET /api/saas/roles`). */
export type PermissionMatrixView = {
  columns: string[];
  columnLabels: string[];
  columnAbbrev: string[];
  rows: { label: string; allowed: boolean[] }[];
};

const ROLE_ABBREV: Dict<string> = { super:'SUP', orgadmin:'ORG', admin:'ORG', sender:'SND', viewer:'VIW' };

export function toPermissionMatrix(api: PlatformApi.PermissionMatrix): PermissionMatrixView {
  const columns = api.columns ?? [];
  return {
    columns,
    columnLabels: api.column_labels ?? [],
    columnAbbrev: columns.map(c => ROLE_ABBREV[c] ?? c.slice(0, 3).toUpperCase()),
    rows: (api.permissions ?? []).map(row => ({ label: row.label, allowed: row.allowed ?? [] })),
  };
}

/** Feature-flag row (`s.flagState` + `FLAG_META` in the prototype). */
export type FlagRow = {
  key: string;
  env: string;
  desc: string;
  on: boolean;
  rollout: number;
  updated: string;
  overrides: number;
};

export function toFlagRows(items: PlatformApi.FeatureFlagResponse[]): FlagRow[] {
  return items.map(f => ({
    key: f.key,
    env: f.environment,
    desc: f.description || EMPTY,
    on: f.enabled,
    rollout: f.rollout_pct ?? 0,
    updated: formatRelative(f.updated_at),
    overrides: f.override_count ?? 0,
  }));
}

/** Security-posture row (`SEC_DEFS` in the prototype). */
export type SecurityRow = {
  key: string;
  label: string;
  meta: string;
  /** The stored preference. Only meaningful when `implemented` is true. */
  on: boolean;
  /** Whether any code path enforces this control. All six are currently false. */
  implemented: boolean;
  /** `implemented && on` — the only honest "this control is active" signal. */
  enforced: boolean;
};

export function toSecurityRows(items: PlatformApi.SecurityPostureRow[]): SecurityRow[] {
  return items.map(r => ({
    key: r.key,
    label: r.label,
    meta: r.detail || EMPTY,
    on: r.enabled,
    implemented: r.implemented ?? false,
    enforced: r.enforced ?? false,
  }));
}

/** Certification chip. `in_process` renders the design's "(in process)" suffix. */
export function certificationLabel(row: { name: string; status: string }): string {
  return row.status === 'certified' ? row.name : row.name + ' (' + row.status.replace(/_/g, ' ') + ')';
}

export function toCertificationLabels(api: PlatformApi.ComplianceResponse): string[] {
  return (api.certifications ?? []).map(certificationLabel);
}

/** The compliance footnote, carrying the API's real rotation interval. */
export function toComplianceNote(api: PlatformApi.ComplianceResponse): string {
  /* The old copy asserted per-tenant residency, HSM-backed key material, a
     rotation cadence and hourly ledger anchoring. None of those exist. The
     note now carries only the API's own disclaimer plus the rotation facts as
     the API states them. */
  const rotation = api.key_rotation_implemented
    ? 'Key rotation runs on a ' + api.rotation_interval_days + '-day interval (last rotation ' +
      (api.last_key_rotation_at ? formatRelative(api.last_key_rotation_at) : 'not yet recorded') + ').'
    : 'Key rotation is not implemented — the ' + api.rotation_interval_days +
      '-day interval is a target, not a schedule anything runs.';
  return [api.disclaimer, rotation].filter(Boolean).join(' ');
}

/** Dunning queue row (`DUNNING` in the prototype: `[tenant, meta]`). */
export type DunningQueueRow = {
  key: string;
  organizationId: string;
  invoiceId: string | null;
  tenant: string;
  meta: string;
};

export function toDunningRows(items: PlatformApi.DunningRow[]): DunningQueueRow[] {
  return items.map((d, i) => ({
    key: d.invoice_id ?? d.organization_id + ':' + i,
    organizationId: d.organization_id,
    invoiceId: d.invoice_id,
    tenant: d.organization_name,
    meta: [
      d.invoice_number ?? EMPTY,
      formatCents(d.amount_cents),
      'step ' + d.dunning_step + ' of ' + d.max_step,
      d.reason.replace(/_/g, ' '),
    ].join(' · '),
  }));
}

/** Service-health row (`HEALTH` in the prototype: `[label, meta, colour]`). */
export type PlatformHealthTile = { label: string; meta: string; color: string };

const HEALTH_TONE_COLOR: Dict<string> = { good:'#10b981', ok:'#10b981', warn:'#f59e0b', bad:'#f43f5e', error:'#f43f5e' };

export function toPlatformHealthRows(
  items: (PlatformApi.HealthComponent | PlatformApi.PlatformHealthRow)[],
): PlatformHealthTile[] {
  return items.map(h => ({ label: h.component, meta: h.detail, color: HEALTH_TONE_COLOR[h.tone] ?? '#10b981' }));
}

/** Platform audit stream entry (`PLATFORM_AUDIT` in the prototype). */
export type AuditStreamRow = { key: string; label: string; meta: string };

const PLATFORM_AUDIT_ACTION_LABEL: Dict<string> = {
  'flag.changed': 'Feature flag changed',
  'flag.override_set': 'Feature flag override set',
  'flag.overrides_replaced': 'Feature flag overrides replaced',
  'impersonation.started': 'Impersonation session',
  'impersonation.ended': 'Impersonation ended',
  'tenant.created': 'Tenant created',
  'tenant.suspended': 'Tenant suspended',
  'tenant.reinstated': 'Tenant reinstated',
  'user.role_assigned': 'Role assigned',
  'security_posture.changed': 'Security posture changed',
};

export function platformAuditActionLabel(action: string): string {
  if (PLATFORM_AUDIT_ACTION_LABEL[action]) return PLATFORM_AUDIT_ACTION_LABEL[action];
  const words = action.replace(/[._]/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1) : action;
}

export function toPlatformAuditStream(items: PlatformApi.PlatformAuditRow[]): AuditStreamRow[] {
  return items.map(entry => ({
    key: entry.id,
    label: platformAuditActionLabel(entry.action),
    meta: [entry.actor_email, entry.detail, entry.organization_name, entry.ip_address]
      .filter((part): part is string => !!part)
      .join(' · ') || formatRelative(entry.occurred_at),
  }));
}

/** Plan card for the "Plans & usage" tab (`PLANS` in the prototype). */
export type PlatformPlanCard = {
  code: string;
  name: string;
  price: string;
  tag: string;
  tone: Tone;
  lines: { k: string; v: string }[];
  tenantsLabel: string;
  mrr: string;
};

/**
 * `GET /api/billing/plans` + the per-plan roll-up from `GET /api/saas/revenue`.
 *
 * FALLBACK: `tag` is nullable on the API and the design always shows a chip, so
 * a plan with no tag falls back to its billing interval.
 */
export function toPlatformPlanCards(
  plans: PlatformApi.PlanResponse[],
  summary: PlatformApi.RevenueSummary | null,
): PlatformPlanCard[] {
  const byPlan = new Map((summary?.by_plan ?? []).map(row => [row.plan_code, row]));
  return plans.map(plan => {
    const roll = byPlan.get(plan.code);
    const seatPrice = plan.seat_price_cents ?? plan.price_cents;
    const subscribers = roll?.subscribers ?? 0;
    const lines = (plan.marketing_lines ?? [])
      .map(line => ({
        k: String((line as { label?: unknown }).label ?? ''),
        v: String((line as { value?: unknown }).value ?? ''),
      }))
      .filter(line => !!line.k);
    return {
      code: plan.code,
      name: plan.name,
      price: '$' + Math.round((seatPrice || 0) / 100),
      tag: plan.tag || plan.billing_interval,
      tone: PLAN_TONE[plan.name] ?? PLATFORM_TONE_NEUTRAL,
      lines,
      tenantsLabel: subscribers + (subscribers === 1 ? ' tenant' : ' tenants'),
      mrr: formatCentsK(roll?.mrr_cents ?? 0),
    };
  });
}

/* ── revenue screen ─────────────────────────────────────────────────────── */

export function toRevenueStats(summary: PlatformApi.RevenueSummary): PlatformStatTile[] {
  return [
    { label:'MRR', value: formatCentsK(summary.mrr_cents),
      meta: formatSignedPct(summary.mrr_change_pct) + ' MoM', good: summary.mrr_change_pct >= 0 },
    { label:'ARR', value: formatCentsK(summary.arr_cents),
      meta: summary.paying_tenants + ' paying · ' + summary.trialing_tenants + ' trialing', good: true },
    { label:'GROSS VOLUME · 30D', value: formatCentsK(summary.gross_volume_30d_cents),
      meta: summary.charge_count_30d + ' charges', good: true },
    { label:'FAILED PAYMENTS', value: String(summary.failed_payment_count),
      meta: formatCents(summary.at_risk_cents) + ' at risk', good: summary.failed_payment_count === 0 },
  ];
}

/** The four balance tiles (`BALANCE_TILES` in the prototype). */
export function toBalanceTiles(balance: PlatformApi.BalanceResponse): { label: string; value: string; meta: string }[] {
  const currency = balance.currency || 'USD';
  return [
    { label:'AVAILABLE', value: formatCents(balance.available_cents, currency),
      meta: currency.toLowerCase() + ' · available to pay out' },
    { label:'PENDING', value: formatCents(balance.pending_cents, currency),
      meta: balance.pending_settles_at ? 'settles ' + formatDate(balance.pending_settles_at) : 'nothing in transit' },
    { label:'NEXT PAYOUT', value: formatCents(balance.next_payout_cents, currency),
      meta: (balance.next_payout_at ? formatDate(balance.next_payout_at) : 'unscheduled') + ' · ' + balance.payout_destination },
    { label:'DISPUTES', value: formatCents(balance.disputes_cents, currency),
      meta: balance.dispute_count + ' open · ' + balance.dispute_rate_pct.toFixed(1) + '% rate' },
  ];
}

/** Subscriptions-by-plan bars, scaled against the largest plan's MRR. */
export function toSubsByPlan(summary: PlatformApi.RevenueSummary): { name: string; meta: string; pct: number }[] {
  const rows = summary.by_plan ?? [];
  const max = rows.reduce((a, r) => Math.max(a, r.mrr_cents || 0), 0);
  return rows.map(r => ({
    name: r.plan_name,
    meta: r.subscribers + ' subs · ' + formatCentsK(r.mrr_cents),
    pct: max ? Math.round((r.mrr_cents || 0) * 100 / max) : 0,
  }));
}

/** The four churn/retention lines (`CHURN_ROWS` in the prototype). */
export function toChurnRows(churn: PlatformApi.ChurnResponse): { k: string; v: string; tone: string }[] {
  return [
    { k:'Gross churn (logo)', v: churn.gross_logo_churn_pct.toFixed(1) + '%',
      tone: churn.gross_logo_churn_pct > 3 ? 'warn' : 'good' },
    { k:'Net revenue retention', v: churn.net_revenue_retention_pct.toFixed(0) + '%',
      tone: churn.net_revenue_retention_pct >= 100 ? 'good' : 'warn' },
    { k:'Involuntary churn (payments)', v: churn.involuntary_churn_pct.toFixed(1) + '%',
      tone: churn.involuntary_churn_pct > 0 ? 'warn' : 'good' },
    { k:'Trial → paid conversion', v: churn.trial_conversion_pct.toFixed(0) + '%',
      tone: churn.trial_conversion_pct >= 50 ? 'good' : 'warn' },
  ];
}

/** Provider webhook rows (`STRIPE_WEBHOOKS` in the prototype). */
export type BillingEventRow = {
  id: string;
  type: string;
  ref: string;
  status: string;
  ts: string;
  good: boolean;
};

export function toBillingEventRows(items: PlatformApi.BillingEventResponse[]): BillingEventRow[] {
  return items.map(e => {
    const good = e.processed && !e.error;
    return {
      id: e.id,
      type: e.event_type,
      ref: e.event_id,
      status: e.status_code ? String(e.status_code) : (good ? 'processed' : e.error ? 'failed' : 'pending'),
      ts: new Date(e.received_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      good,
    };
  });
}
