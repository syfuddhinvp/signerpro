/**
 * TypeScript mirrors of the backend Pydantic schemas (`backend/app/schemas/`).
 *
 * RULES
 * -----
 * 1. Field names are EXACTLY what the API returns — snake_case, no renaming.
 * 2. `datetime` becomes `string` (ISO-8601 as emitted by FastAPI).
 * 3. Pydantic `X | None` becomes `X | null`; fields with a default that the
 *    server always serialises stay required here.
 * 4. `Decimal` becomes `number` (JSON numbers).
 *
 * Presentation mapping to the ported components lives in `lib/sf/adapters.ts`,
 * never here.
 */

/* ── shared primitives ─────────────────────────────────────────────────── */

export type IsoDateTime = string;
export type UUID = string;

/** `app/models/enums.py:DocumentStatus` */
export type DocumentStatus =
  | 'draft'
  | 'prepared'
  | 'sent'
  | 'viewed'
  | 'partially_completed'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'voided';
/** `app/models/enums.py:WorkflowType` */
export type WorkflowType = 'sequential' | 'parallel';

/** How an uploaded image is laid onto the page it becomes — an image has no
 *  page size of its own, so one is chosen for it. Mirrors
 *  `conversion_service.IMAGE_FIT_MODES`. */
export type ImageFit = 'fit' | 'fill' | 'actual';
/** `app/models/enums.py:RecipientStatus` */
export type RecipientStatus = 'waiting' | 'sent' | 'viewed' | 'completed' | 'declined' | 'expired';
/** `app/models/enums.py:FieldType` */
export type FieldType =
  | 'signature' | 'initials' | 'full_name' | 'date' | 'text' | 'email' | 'phone'
  | 'checkbox' | 'dropdown' | 'title' | 'company' | 'address' | 'currency' | 'number' | 'radio'
  // FLD-1: the backend enum accepts these four; the builder used to flatten
  // them to `text`/`date` on the first save, which is what made `attachment`
  // fields unreachable from the signing surface even after they got a real
  // upload endpoint.
  | 'stamp' | 'attachment' | 'datetime'
  // ANN-1: the sender's page annotations — a pen drawing and a text box. Always
  // read-only; see `lib/sf/annotations.ts` for the payload each one carries.
  | 'drawing' | 'textbox'
  // PAY-1: a money obligation on the page — the signer pays this amount (a
  // deposit or an invoice) during signing, into the tenant's own Stripe
  // account. See `PaymentFieldConfig` / `PaymentRequestResponse` / `SignerPaymentResponse`.
  | 'payment';
/** `app/schemas/recipient.py:RecipientRole` */
export type RecipientRole = 'sign' | 'approve' | 'copy' | 'inperson';
/** `app/schemas/document.py` */
export type ReminderCadence = '24h' | '48h' | '7d' | 'none';
export type DocType = 'agreement' | 'nda' | 'order' | 'hr';
export type LibrarySort = 'recent' | 'name' | 'status' | 'owner';
export type LibraryQuick =
  | 'all' | 'inbox' | 'outbox' | 'completed' | 'drafts' | 'favorites'
  | 'expiring' | 'shared' | 'mine' | 'archived' | 'trash';
export type BulkAction = 'archive' | 'restore' | 'unarchive' | 'delete' | 'move' | 'purge';
/** `app/schemas/contact.py:CONTACT_SOURCES` */
export type ContactSource = 'manual' | 'crm' | 'scim' | 'api';
/** `app/schemas/field.py:ValidationKind` */
export type ValidationKind = 'none' | 'email' | 'date' | 'numeric' | 'custom';
export type UserRole = 'admin' | 'sender';

/* ── auth & account (schemas/auth.py, schemas/account.py) ───────────────── */

export type UserResponse = {
  id: UUID;
  organization_id: UUID;
  name: string;
  email: string;
  role: UserRole | string;
};

export type CurrentUserResponse = UserResponse & {
  is_platform_admin: boolean;
  organization_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  timezone: string | null;
  status: string;
  mfa_method: string | null;
  mfa_enrolled: boolean;
  last_active_at: IsoDateTime | null;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token: string | null;
  expires_in: number | null;
  user: CurrentUserResponse;
  mfa_required: boolean;
};

export type MfaStatusResponse = {
  enrolled: boolean;
  method: string | null;
  enrolled_at: IsoDateTime | null;
  recovery_codes_remaining: number;
};

export type MfaEnrollResponse = {
  method: string;
  secret: string;
  otpauth_url: string;
  recovery_codes: string[];
};

export type MfaRecoveryCodesResponse = { recovery_codes: string[] };

export type SessionResponse = {
  id: UUID;
  device: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  location: string | null;
  last_seen_at: IsoDateTime;
  created_at: IsoDateTime;
  expires_at: IsoDateTime;
  is_current: boolean;
};

export type SavedSignatureResponse = {
  id: UUID;
  label: string;
  signature_type: string;
  signature_text: string | null;
  type_face: string | null;
  is_passkey_bound: boolean;
  /** Exactly one saved signature per account carries this. */
  is_default: boolean;
  adopted_at: IsoDateTime;
  preview_url: string | null;
  /** Prototype-facing aliases the backend also emits. */
  method: string | null;
  face: string | null;
};

export type NotificationPreferenceResponse = {
  event_key: string;
  label: string;
  enabled: boolean;
  extra_recipients: string[];
};

/** The field types starred into the builder palette's Favourites tab. */
export type FieldFavoritesResponse = {
  types: string[];
};

export type IntegrationResponse = {
  provider: string;
  label: string;
  detail: string | null;
  connected: boolean;
  connected_at: IsoDateTime | null;
};

export type CloudTargetItem = { provider: string; path: string | null; enabled: boolean };

export type AccountAuditEntry = {
  id: UUID;
  document_id: UUID | null;
  document_title: string | null;
  event_type: string;
  event_message: string;
  /** The acting user's or recipient's email; null for system events. */
  actor: string | null;
  ip_address: string | null;
  user_agent: string | null;
  log_metadata: Record<string, unknown> | null;
  created_at: IsoDateTime;
};

export type AccountAuditFeed = {
  items: AccountAuditEntry[];
  /** Entries matching the active filters — what the pager divides. */
  total: number;
  /** Facets over the whole trail, not just this page, for the filter menus. */
  event_types: string[];
  actors: string[];
};

/* ── organizations (schemas/organization.py) ────────────────────────────── */

export type OrganizationResponse = {
  id: UUID;
  name: string;
  /** Tenant identity / profile (ORG-1). */
  slug: string | null;
  region: string | null;
  company_size: string | null;
  seats_licensed: number;
  accent_color: string | null;
  logo_url: string | null;
  /** Field types the builder palette offers; `null` offers every type. */
  enabled_field_types: string[] | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_from_email: string | null;
  sms_provider: string | null;
  twilio_account_sid: string | null;
  twilio_from_number: string | null;
  telnyx_from_number: string | null;
};

/** `GET /api/organizations/me/overview` (schemas/organization.py). */
export type OrganizationOverviewStats = {
  action_required: number;
  out_for_signature: number;
  seats_activated: number;
  seats_licensed: number;
  completion_rate: number;
};

export type OrganizationOverviewAttentionItem = {
  title: string;
  detail: string;
  /** Front-end route the card links to. */
  screen: string;
  tone: string;
};

export type OrganizationOverviewSpendLine = { label: string; amount_cents: number };

export type OrganizationOverviewTeamRow = {
  name: string;
  role_label: string;
  last_active_at: IsoDateTime | null;
  sent_count: number;
};

export type OrganizationOverview = {
  range: string;
  stats: OrganizationOverviewStats;
  /** Always twelve buckets; the bucket width follows `range`. */
  series: number[];
  attention: OrganizationOverviewAttentionItem[];
  spend_lines: OrganizationOverviewSpendLine[];
  team: OrganizationOverviewTeamRow[];
};

/* ── documents (schemas/document.py) ────────────────────────────────────── */

export type DocumentResponse = {
  id: UUID;
  organization_id: UUID;
  sender_id: UUID;
  title: string;
  status: DocumentStatus;
  workflow_type: WorkflowType;
  is_template: boolean;
  original_file_path: string | null;
  final_file_path: string | null;
  original_sha256: string | null;
  field_config_sha256: string | null;
  final_sha256: string | null;
  page_count: number;
  sent_at: IsoDateTime | null;
  completed_at: IsoDateTime | null;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  owner_user_id: UUID | null;
  folder_id: UUID | null;
  source_template_id: UUID | null;
  doc_type: string | null;
  archived_at: IsoDateTime | null;
  deleted_at: IsoDateTime | null;
  reminder_cadence: string;
  expires_in_days: number;
  invite_subject: string | null;
  invite_message: string | null;
  recipients_total: number;
  recipients_completed: number;
};

export type DocumentListItem = DocumentResponse & {
  owner_name: string | null;
  is_favorite: boolean;
};

export type DocumentCounts = {
  all: number;
  action: number;
  waiting: number;
  completed: number;
  draft: number;
  voided: number;
  archived: number;
  trashed: number;
  templates: number;
  /* one key per library `quick` bucket — same predicate as the list it badges */
  inbox: number;
  outbox: number;
  drafts: number;
  favorites: number;
  expiring: number;
  shared: number;
  mine: number;
};

export type DocumentLibraryPage = {
  items: DocumentListItem[];
  total: number;
  limit: number;
  offset: number;
  counts: DocumentCounts;
};

export type DocumentLibraryParams = {
  quick?: LibraryQuick;
  status?: DocumentStatus;
  doc_type?: string;
  folder_id?: string;
  owner?: string;
  since_days?: number;
  /** `YYYY-MM-DD`, inclusive on both ends. Mutually exclusive with `since_days`. */
  updated_from?: string;
  updated_to?: string;
  q?: string;
  sort?: LibrarySort;
  limit?: number;
  offset?: number;
};

export type BulkActionSkipped = { document_id: UUID; reason: string };
export type BulkActionResult = {
  action: string;
  updated: number;
  document_ids: UUID[];
  skipped: BulkActionSkipped[];
};

export type RoutingResponse = {
  document_id: UUID;
  workflow_type: WorkflowType;
  reminder_cadence: string;
  expires_in_days: number;
  invite_subject: string | null;
  invite_message: string | null;
};

export type RoutingUpdate = {
  workflow_type?: WorkflowType;
  reminder_cadence?: ReminderCadence;
  expires_in_days?: number;
  invite_subject?: string;
  invite_message?: string;
};

export type SendDocumentResponse = {
  document: DocumentResponse;
  signing_links: Record<string, string>[];
};

export type UploadPdfResponse = { document: DocumentResponse; sha256: string; page_count: number };

/* ── fields (schemas/field.py) ──────────────────────────────────────────── */

export type FieldCondition = { field_id: UUID; op: 'checked' | 'equals' | 'notEmpty'; value?: unknown };

export type FieldResponse = {
  id: UUID;
  document_id: UUID;
  recipient_id: UUID;
  type: FieldType;
  label: string;
  required: boolean;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  placeholder: string | null;
  default_value: string | null;
  value: string | null;
  options: Record<string, unknown> | unknown[] | null;
  is_locked: boolean;
  validation: string;
  validation_pattern: string | null;
  condition: Record<string, unknown> | null;
  read_only: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

export type FieldCreate = {
  recipient_id: UUID;
  type: FieldType;
  label: string;
  required?: boolean;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  placeholder?: string | null;
  default_value?: string | null;
  value?: string | null;
  options?: Record<string, unknown> | unknown[] | null;
  validation?: ValidationKind;
  validation_pattern?: string | null;
  condition?: FieldCondition | null;
  read_only?: boolean;
};

export type FieldBulkItem = FieldCreate & { id?: string | null };

/* ── recipients (schemas/recipient.py) ──────────────────────────────────── */

export type RecipientResponse = {
  id: UUID;
  document_id: UUID;
  name: string;
  email: string;
  role_name: string | null;
  role: string;
  color: string | null;
  contact_id: UUID | null;
  signing_order: number;
  status: RecipientStatus;
  viewed_at: IsoDateTime | null;
  completed_at: IsoDateTime | null;
  declined_at: IsoDateTime | null;
  decline_reason: string | null;
  otp_enabled: boolean;
  phone_number: string | null;
  otp_verified: boolean;
  consent_accepted: boolean;
  consent_accepted_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** `POST .../recipients/{id}/signing-link` — a freshly minted signing URL.
 *  Minting supersedes whatever link was live for that recipient. */
export type SigningLinkResponse = {
  url: string;
  expires_at: IsoDateTime;
};

export type RecipientCreate = {
  name: string;
  email: string;
  role_name?: string | null;
  signing_order?: number;
  otp_enabled?: boolean;
  phone_number?: string | null;
  role?: RecipientRole;
  color?: string | null;
  contact_id?: string | null;
};

export type RecipientSetItem = RecipientCreate & { id?: string | null };

/* ── contacts (schemas/contact.py) ──────────────────────────────────────── */

export type ContactResponse = {
  id: UUID;
  organization_id: UUID;
  name: string;
  email: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  /** One of `CONTACT_ROLES`: sign | approve | copy | inperson. */
  default_role: string;
  /** A `ContactGroup.key`, e.g. `customers`. */
  group: string;
  source: ContactSource | string;
  tags: string[];
  color: string | null;
  envelope_count: number;
  last_signed_at: IsoDateTime | null;
  external_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

export type ContactListResponse = {
  items: ContactResponse[];
  total: number;
  /** Keyed by group key; the service also supplies an `all` bucket. */
  counts: Record<string, number>;
};

export type ContactListParams = {
  q?: string;
  group?: string;
  source?: string;
  tag?: string;
  limit?: number;
  offset?: number;
};

export type ContactCreate = {
  name: string;
  email: string;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  default_role?: string;
  group?: string;
  source?: string;
  tags?: string[];
  color?: string | null;
  external_id?: string | null;
};

export type ContactUpdate = Partial<Omit<ContactCreate, 'source' | 'external_id'>>;

export type ContactGroupResponse = {
  id: UUID;
  key: string;
  label: string;
  sort_order: number;
  contact_count: number;
};

export type ContactHistoryEntry = {
  document_id: UUID;
  title: string;
  status: string;
  event: string;
  occurred_at: IsoDateTime | null;
};

export type ContactImportError = { row: number; message: string };
export type ContactImportResponse = {
  created: number;
  updated: number;
  skipped: number;
  errors: ContactImportError[];
};

export type ContactAddRecipientsRequest = { document_id: string; contact_ids: string[] };

/* ── teams (schemas/team.py) ─────────────────────────────────────────────── */

export type TeamMemberRow = {
  user_id: UUID;
  name: string;
  email: string;
  role: string;
};

export type TeamResponse = {
  id: UUID;
  organization_id: UUID;
  name: string;
  description: string | null;
  member_count: number;
  /** Live, non-template documents filed in this team's folders. */
  document_count: number;
  template_count: number;
  /** `lead`/`member` when the caller belongs to the team, else null. */
  my_role: string | null;
  members: TeamMemberRow[];
};

/* ── folders (schemas/folder.py) ────────────────────────────────────────── */

export type FolderResponse = {
  id: UUID;
  name: string;
  parent_id: UUID | null;
  team_id: UUID | null;
  team_name: string | null;
  scope: 'personal' | 'team';
  document_count: number;
  sort_order: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  children: FolderResponse[];
};

export type FolderTreeResponse = {
  personal: FolderResponse[];
  team: FolderResponse[];
  unfiled_count: number;
};

/* ── templates (schemas/template.py) ────────────────────────────────────── */

export type TemplateResponse = {
  id: UUID;
  organization_id: UUID;
  title: string;
  doc_type: string | null;
  workflow_type: WorkflowType;
  use_count: number;
  field_count: number;
  recipient_count: number;
  owner_user_id: UUID | null;
  owner_name: string | null;
  folder_id: UUID | null;
  page_count: number;
  archived_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

export type TemplateListResponse = { items: TemplateResponse[]; total: number };

export type TemplateListParams = {
  q?: string;
  owner?: string;
  sort?: 'recent' | 'name' | 'uses';
  include_archived?: boolean;
  limit?: number;
  offset?: number;
};

export type TemplateUsageResponse = {
  template_id: UUID;
  use_count: number;
  completed_copies: number;
  by_sender: { name: string; count: number }[];
  series: number[];
};

/* ── invoices (schemas/operations.py) ───────────────────────────────────── */

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
};

export type InvoiceResponse = {
  id: UUID;
  organization_id: UUID;
  number: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  amount_due_cents: number;
  is_overdue: boolean;
  period_start: IsoDateTime | null;
  period_end: IsoDateTime | null;
  issued_at: IsoDateTime;
  due_at: IsoDateTime | null;
  paid_at: IsoDateTime | null;
  line_items: InvoiceLineItem[] | null;
  hosted_url: string | null;
  provider_payment_intent_id: string | null;
  payment_method_label: string | null;
  period_label: string | null;
  organization_name: string | null;
};

export type PlatformInvoiceResponse = Omit<InvoiceResponse, 'organization_name'> & {
  organization_name: string;
};

/* ── billing (schemas/billing.py) ───────────────────────────────────────── */

export type PlanResponse = {
  id: UUID;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: string;
  trial_days: number;
  is_active: boolean;
  entitlements: Record<string, unknown>;
  tag: string | null;
  marketing_lines: Record<string, unknown>[] | null;
  seat_price_cents: number | null;
  is_seat_based: boolean;
};

export type SubscriptionResponse = {
  id: UUID | null;
  organization_id: UUID;
  plan_code: string;
  plan_name: string;
  status: string;
  current_period_start: IsoDateTime | null;
  current_period_end: IsoDateTime | null;
  trial_ends_at: IsoDateTime | null;
  cancel_at_period_end: boolean;
  canceled_at: IsoDateTime | null;
  provider: string | null;
  entitlements: Record<string, unknown>;
  seats_licensed: number;
  seats_activated: number;
  seat_price_cents: number | null;
  is_seat_based: boolean;
  cycle: string;
  next_invoice_total_cents: number;
  next_invoice_at: IsoDateTime | null;
};

export type UsageLimit = {
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
};

export type UsageRow = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  pct: number;
  display: string;
};

export type UsageResponse = {
  organization_id: UUID;
  plan_code: string;
  plan_name: string;
  subscription_status: string;
  period_start: IsoDateTime;
  period_end: IsoDateTime;
  limits: Record<string, UsageLimit>;
  period_totals: Record<string, number>;
  features: Record<string, boolean>;
  rows: UsageRow[];
};

export type PaymentMethodResponse = {
  id: UUID;
  type: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  holder_name: string | null;
  country: string | null;
  label: string;
  meta: string | null;
  po_number: string | null;
  provider: string | null;
  is_default: boolean;
  created_at: IsoDateTime | null;
};

export type PaymentMethodCreate = {
  type?: 'card' | 'ach' | 'sepa' | 'invoice';
  provider_token?: string | null;
  holder_name?: string | null;
  country?: string | null;
  po_number?: string | null;
  make_default?: boolean;
};

export type BillingSettingsResponse = {
  organization_id: UUID;
  autopay: boolean;
  billing_email: string | null;
  tax_id: string | null;
  cycle: string;
  default_payment_method_id: UUID | null;
  po_number: string | null;
  currency: string;
};

export type BillingSettingsUpdate = {
  autopay?: boolean;
  billing_email?: string;
  tax_id?: string;
  cycle?: 'monthly' | 'annual';
  default_payment_method_id?: string;
  po_number?: string;
};

export type UpcomingInvoiceResponse = {
  organization_id: UUID;
  plan_code: string;
  plan_name: string;
  cycle: string;
  seats_licensed: number;
  period_start: IsoDateTime | null;
  period_end: IsoDateTime | null;
  currency: string;
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  due_at: IsoDateTime | null;
};

export type ChargeResponse = {
  id: UUID;
  invoice_id: UUID | null;
  amount_cents: number;
  currency: string;
  provider: string | null;
  provider_payment_id: string | null;
  method_label: string | null;
  status: string;
  decline_code: string | null;
  occurred_at: IsoDateTime;
  description: string | null;
};

/**
 * Hosted mode returns a `url` to redirect to; embedded mode returns a
 * `client_secret` the browser mounts Stripe's own iframe with and no url.
 * Exactly one of the two is populated — treat either as sufficient, and
 * neither as a failure to report rather than a blank frame to render.
 */
export type CheckoutResponse = {
  session_id: string;
  provider: string;
  plan_code: string;
  url: string | null;
  client_secret: string | null;
  mode: string;
  ui_mode: string;
  /** False for a provider test-mode session. Badged in the UI. */
  livemode: boolean;
};

/** The provider's own word on a session, read server-side after the return_url. */
export type CheckoutStatusResponse = {
  session_id: string;
  status: string;
  mode: string;
  applied: boolean;
  payment_method_id: string | null;
};

export type SeatChangeResponse = {
  subscription: SubscriptionResponse;
  seats_licensed: number;
  seats_activated: number;
  proration_cents: number;
  effective_at: IsoDateTime;
};

export type PlanChangePreview = {
  current_plan_code: string;
  current_plan_name: string;
  target_plan_code: string;
  target_plan_name: string;
  cycle: string;
  seats_licensed: number;
  current_amount_cents: number;
  target_amount_cents: number;
  proration_cents: number;
  remaining_fraction: number;
  effective_at: IsoDateTime;
  next_invoice_total_cents: number;
  next_invoice_at: IsoDateTime | null;
  is_downgrade: boolean;
};

/* ── revenue (schemas/operations.py) ────────────────────────────────────── */

export type RevenueSeriesPoint = { period: string; invoiced_cents: number; collected_cents: number };
export type RevenueMrrPoint = { period: string; mrr_cents: number };

export type RevenuePlanBreakdown = {
  plan_code: string;
  plan_name: string;
  plan_tag: string | null;
  subscribers: number;
  mrr_cents: number;
  active_subscribers: number;
  trialing_subscribers: number;
  seats: number;
  seat_price_cents: number | null;
};

export type RevenueSummary = {
  mrr_cents: number;
  arr_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  paying_tenants: number;
  trialing_tenants: number;
  series: RevenueSeriesPoint[];
  by_plan: RevenuePlanBreakdown[];
  gross_volume_30d_cents: number;
  charge_count_30d: number;
  failed_payment_count: number;
  at_risk_cents: number;
  mrr_change_pct: number;
  mrr_series: RevenueMrrPoint[];
};

export type DunningRow = {
  organization_id: UUID;
  organization_name: string;
  invoice_id: UUID | null;
  invoice_number: string | null;
  amount_cents: number;
  dunning_step: number;
  max_step: number;
  reason: string;
  next_attempt_at: IsoDateTime | null;
};

export type BalanceResponse = {
  currency: string;
  available_cents: number;
  pending_cents: number;
  pending_settles_at: IsoDateTime | null;
  next_payout_cents: number;
  next_payout_at: IsoDateTime | null;
  payout_destination: string;
  disputes_cents: number;
  dispute_count: number;
  dispute_rate_pct: number;
};

export type ChurnRow = {
  period: string;
  churned_tenants: number;
  churned_mrr_cents: number;
  retained_tenants: number;
  new_tenants: number;
};

export type ChurnResponse = {
  range: string;
  gross_logo_churn_pct: number;
  net_revenue_retention_pct: number;
  involuntary_churn_pct: number;
  trial_conversion_pct: number;
  rows: ChurnRow[];
};

export type BillingEventResponse = {
  id: UUID;
  provider: string;
  event_id: string;
  event_type: string;
  status_code: number | null;
  received_at: IsoDateTime;
  processed: boolean;
  error: string | null;
};

export type HealthComponent = { component: string; detail: string; tone: string };

/* ── platform: tenants, directory, flags, logs (schemas/platform.py) ────── */

export type TenantRow = {
  id: UUID;
  name: string;
  slug: string | null;
  region: string | null;
  company_size: string | null;
  owner_email: string | null;
  owner_name: string | null;
  plan_code: string | null;
  plan_name: string;
  subscription_tier: string;
  subscription_status: string;
  /** `suspended`, else the subscription status. */
  status: string;
  suspended_at: IsoDateTime | null;
  suspension_reason: string | null;
  seats_licensed: number;
  seats_activated: number;
  envelope_volume_30d: number;
  documents_count: number;
  users_count: number;
  mrr_cents: number;
  subscription_expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
};

export type TenantPage = { items: TenantRow[]; total: number };

export type TenantFlagOverride = { flag_id: UUID; key: string; enabled: boolean };

export type DirectoryUser = {
  id: UUID;
  name: string;
  email: string;
  role: string;
  /** `super` for platform admins, else the tenant role. */
  role_key: string;
  role_label: string;
  is_platform_admin: boolean;
  organization_id: UUID;
  organization_name: string;
  organization_slug: string | null;
  status: string;
  mfa_enabled: boolean;
  mfa_method: string | null;
  last_active_at: IsoDateTime | null;
  created_at: IsoDateTime;
};

export type TenantDetail = TenantRow & {
  accent_color: string | null;
  logo_url: string | null;
  billing_email: string | null;
  billing_cycle: string | null;
  live_mode_enabled: boolean;
  open_ticket_count: number;
  incidents_90d: number;
  flag_overrides: TenantFlagOverride[];
  admins: DirectoryUser[];
};

export type DirectoryPage = { items: DirectoryUser[]; total: number };

export type PermissionRow = { label: string; allowed: boolean[] };
export type PermissionMatrix = { columns: string[]; column_labels: string[]; permissions: PermissionRow[] };

/** The backend's `POST /api/saas/tenants/{id}/impersonate` payload. Consumed
 *  server-side by `app/api/auth/impersonate/route.ts`, which installs the
 *  token in the session cookie — it is never handed to client JS. */
export type ImpersonationSessionResponse = {
  id: UUID;
  access_token: string;
  token_type: string;
  organization_id: UUID;
  organization_name: string;
  impersonated_user_id: UUID;
  impersonated_user_email: string;
  impersonated_user_name: string;
  impersonated_user_role: string;
  justification: string;
  scopes: string[];
  expires_at: IsoDateTime;
  ended_at: IsoDateTime | null;
};

export type PlatformHealthRow = { component: string; detail: string; tone: string };

export type PlatformOverview = {
  tenants: { total: number; trial: number; suspended: number; active: number };
  seats: { provisioned: number; activated: number };
  envelopes_30d: number;
  mrr_cents: number;
  incidents_90d: number;
  /** `null` unless a real availability signal exists — nothing measures uptime. */
  uptime_pct: number | null;
  /** Error-level log entries in the last 24h. The real, measured figure. */
  errors_24h: number;
  mrr_series: number[];
  health: PlatformHealthRow[];
};

export type FeatureFlagResponse = {
  id: UUID;
  key: string;
  description: string | null;
  environment: string;
  enabled: boolean;
  rollout_pct: number;
  updated_at: IsoDateTime;
  updated_by: string | null;
  override_count: number;
};

export type FlagOverridesResponse = { key: string; organization_ids: UUID[] };

export type SecurityPostureRow = {
  key: string;
  label: string;
  detail: string | null;
  enabled: boolean;
  /** False when nothing in the codebase enforces this control. */
  implemented: boolean;
  /** `enabled` is only meaningful when the control exists: `implemented && enabled`. */
  enforced: boolean;
};

export type ComplianceResponse = {
  certifications: { name: string; status: string }[];
  last_key_rotation_at: IsoDateTime | null;
  rotation_interval_days: number;
  /** False while no key-rotation job exists. */
  key_rotation_implemented: boolean;
  /** What the certification statuses do and do not mean. Render it. */
  disclaimer: string;
};

export type SystemLogRow = {
  id: UUID;
  occurred_at: IsoDateTime;
  level: string;
  source: string;
  message: string;
  status_code: number | null;
  latency_ms: number | null;
  request_id: string | null;
  actor_email: string | null;
  ip_address: string | null;
  organization_id: UUID | null;
  organization_slug: string | null;
  organization_name: string | null;
  payload: Record<string, unknown> | unknown[] | null;
};

export type SystemLogPage = {
  items: SystemLogRow[];
  total: number;
  sources: string[];
  levels: string[];
};

export type LogParams = {
  source?: string;
  level?: string;
  q?: string;
  organization_id?: string;
  since_days?: number;
  limit?: number;
  offset?: number;
};

/* ── notifications (the header bell) ─────────────────────────────────────── */

export type NotificationTone = 'info' | 'good' | 'warn' | 'bad';

export type NotificationRow = {
  id: UUID;
  title: string;
  detail: string | null;
  tone: NotificationTone;
  /** A shell screen key, when the row leads somewhere. */
  screen: string | null;
  target_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationFacets = {
  /** `{ good: 12, bad: 1, ... }`, unfiltered by tone — what a chip *would*
   *  select, not what is currently selected. */
  tones: Record<NotificationTone, number>;
  unread: number;
  read: number;
};

export type NotificationFeed = {
  items: NotificationRow[];
  /** Unread across the whole feed, ignoring filters and paging — the badge. */
  unread: number;
  /** Rows matching the current filter, ignoring the page size. */
  total: number;
  facets: NotificationFacets;
};

export type NotificationStatusFilter = 'all' | 'unread' | 'read';

export type NotificationParams = {
  status?: NotificationStatusFilter;
  tone?: NotificationTone;
  q?: string;
  since_days?: number;
  limit?: number;
  offset?: number;
};

export type NotificationBulkAction = 'read' | 'unread' | 'delete';

export type NotificationWriteResponse = {
  updated: number;
  deleted: number;
  unread: number;
};

export type PlatformAuditRow = {
  id: UUID;
  action: string;
  actor_email: string | null;
  detail: string | null;
  ip_address: string | null;
  organization_id: UUID | null;
  organization_name: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: IsoDateTime;
};

export type PlatformAuditPage = { items: PlatformAuditRow[]; total: number };

/* ── saas (schemas/saas.py) ─────────────────────────────────────────────── */

export type SaaSMetrics = {
  total_organizations: number;
  total_users: number;
  total_documents: number;
  active_subscriptions: number;
  tier_counts: Record<string, number>;
};

/* ── support (schemas/operations.py) ────────────────────────────────────── */

export type TicketMessageResponse = {
  id: UUID;
  author_name: string;
  body: string;
  is_staff: boolean;
  is_internal: boolean;
  created_at: IsoDateTime;
};

export type TicketResponse = {
  id: UUID;
  organization_id: UUID;
  organization_name: string | null;
  organization_slug: string | null;
  reference: string;
  subject: string;
  category: string | null;
  status: string;
  priority: string;
  assignee_user_id: UUID | null;
  assignee_name: string | null;
  document_id: UUID | null;
  document_title: string | null;
  tags: string[];
  sla_due_at: IsoDateTime | null;
  sla_label: string | null;
  sla_breached: boolean;
  requester_name: string | null;
  requester_email: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
  message_count: number;
};

export type TicketDetailResponse = TicketResponse & { messages: TicketMessageResponse[] };
export type PlatformTicketResponse = TicketResponse & { organization_name: string };

export type TicketBucketCounts = {
  all: number;
  open: number;
  pending: number;
  escalated: number;
  resolved: number;
};

export type TicketPage = { items: TicketResponse[]; total: number; counts: TicketBucketCounts };

export type TicketCreate = {
  subject: string;
  body: string;
  category?: string | null;
  priority?: string;
  document_id?: string | null;
  tags?: string[] | null;
};

export type SupportAgent = {
  id: UUID;
  name: string;
  email: string;
  specialty: string | null;
  open_ticket_count: number;
};

export type TenantTicketStats = {
  open_count: number;
  escalated_count: number;
  avg_first_response_minutes: number | null;
  sla_target_minutes: number;
  resolved_90d: number;
  avg_resolution_minutes: number | null;
};

export type QueueTicketStats = {
  open_count: number;
  breaching_soon_count: number;
  first_response_minutes: number | null;
  target_minutes: number;
  csat_30d: number | null;
  csat_responses: number;
};

export type QuickReply = { label: string; body: string };

/* ── activity (schemas/operations.py) ───────────────────────────────────── */

export type ActivityEntry = {
  id: UUID;
  created_at: IsoDateTime;
  event_type: string;
  event_message: string;
  document_id: UUID | null;
  document_title: string | null;
  actor: string | null;
  ip_address: string | null;
  organization_id: UUID | null;
  organization_name: string | null;
};

export type ActivityPage = { entries: ActivityEntry[]; total: number; event_types: string[] };

/* ── audit trail (schemas/audit.py) ─────────────────────────────────────── */

export type AuditLogResponse = {
  id: UUID;
  document_id: UUID;
  recipient_id: UUID | null;
  user_id: UUID | null;
  event_type: string;
  event_message: string;
  ip_address: string | null;
  user_agent: string | null;
  log_metadata: Record<string, unknown> | null;
  created_at: IsoDateTime;
};

export type AuditTrailEntry = AuditLogResponse & {
  checksum: string;
  previous_checksum: string;
  kind: string;
};

export type AuditChainVerification = {
  entry_count: number;
  chain_head: string;
  hash_algorithm: string;
  valid: boolean;
};

export type CertificateSummaryResponse = {
  envelope_id: UUID;
  document_title: string;
  document_status: string;
  signers_completed: number;
  signers_total: number;
  sealed_at: IsoDateTime | null;
  hash_algorithm: string;
  time_source: string;
  certificate_authority: string;
  final_sha256: string | null;
  original_sha256: string | null;
  chain_head: string;
  audit_entry_count: number;
  chain_valid: boolean;
};

/* ── api keys & api settings (schemas/api_key.py) ───────────────────────── */

export type ApiKeyResponse = {
  id: UUID;
  label: string;
  mode: string;
  prefix: string;
  masked: string;
  scopes: string[];
  created_at: IsoDateTime;
  last_used_at: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
};

/** The plaintext `secret` is returned exactly once, on create/roll. */
export type ApiKeyCreated = ApiKeyResponse & { secret: string };

export type ApiKeyScopeResponse = { scope: string; label: string; description: string };

export type ApiKeyUsageResponse = {
  requests_24h: number;
  p95_latency_ms: number;
  error_rate_pct: number;
  error_count: number;
  active_key_count: number;
  revoked_key_count: number;
  embed_sessions_24h: number;
  embed_avg_seconds: number;
};

export type ApiSettingsResponse = {
  allowed_origins: string[];
  default_return_url: string | null;
  live_mode_enabled: boolean;
};

/* ── reports (schemas/report.py) ────────────────────────────────────────── */

export type ReportTile = { key: string; label: string; value: number; meta: string | null };

export type ReportOverviewResponse = {
  range_start: IsoDateTime;
  range_end: IsoDateTime;
  documents_created: number;
  documents_completed: number;
  completion_rate_pct: number;
  median_completion_seconds: number;
  median_completion_label: string;
  templates_created: number;
  templates_uses: number;
  sender_count: number;
  recipient_count: number;
  first_time_recipients: number;
  tiles: ReportTile[];
};

export type InviteReportResponse = { total: number; split: { label: string; count: number }[] };

export type DocumentReportRow = {
  document_id: UUID;
  title: string;
  status: string;
  signed: number;
  total: number;
  age_days: number;
  sender_name: string | null;
  updated_at: IsoDateTime | null;
};

export type DocumentReportResponse = { items: DocumentReportRow[]; total: number };

export type TemplateReportRow = {
  template_id: UUID;
  title: string;
  use_count: number;
  completed_copies: number;
  field_count: number;
  owner_name: string | null;
  updated_at: IsoDateTime | null;
};

export type TemplateReportResponse = { items: TemplateReportRow[]; total: number };

export type RecipientReportRow = {
  email: string;
  sent: number;
  delivered: number;
  viewed: number;
  completed: number;
  declined: number;
  expired: number;
  median_completion_seconds: number | null;
  median_completion_label: string;
  completion_rate_pct: number;
};

export type RecipientReportResponse = { items: RecipientReportRow[]; total: number };

export type SenderReportRow = {
  user_id: UUID;
  name: string;
  role_label: string;
  last_active_at: IsoDateTime | null;
  sent_count: number;
  approved_count: number;
};

export type ReportExportResponse = {
  export_id: UUID;
  status: string;
  report_key: string;
  range_key: string | null;
  format: string;
  download_url: string | null;
  error: string | null;
  created_at: IsoDateTime;
};

export type CustomReportResponse = {
  id: UUID;
  name: string;
  fields: string[];
  filters: Record<string, unknown> | null;
  group_by: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
};

export type CustomReportRunResponse = {
  report_id: UUID;
  name: string;
  fields: string[];
  group_by: string | null;
  row_count: number;
  rows: Record<string, unknown>[];
  groups: Record<string, unknown>[];
};

export type ReportScheduleResponse = {
  id: UUID;
  custom_report_id: UUID | null;
  report_key: string | null;
  cadence: string;
  format: string;
  recipients: string[];
  last_run_at: IsoDateTime | null;
  next_run_at: IsoDateTime | null;
};

export type ReportFieldCatalogueResponse = { fields: string[]; reports: string[]; ranges: string[] };

/* ── webhooks (schemas/webhook.py) ──────────────────────────────────────── */

export type WebhookEventTypeResponse = { event_type: string; description: string };

export type WebhookEndpointResponse = {
  id: UUID;
  organization_id: UUID;
  url: string;
  description: string | null;
  /** `null` means "every event type", the backend's wildcard subscription. */
  event_types: string[] | null;
  is_active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** Create and rotate-secret only. The plaintext secret is shown exactly once. */
export type WebhookEndpointCreated = WebhookEndpointResponse & { secret: string };

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'exhausted';

export type WebhookDeliveryResponse = {
  id: UUID;
  endpoint_id: UUID;
  event_id: UUID;
  event_type: string;
  document_id: UUID | null;
  payload: Record<string, unknown> | null;
  attempt: number;
  status: WebhookDeliveryStatus;
  status_code: number | null;
  error: string | null;
  delivered_at: IsoDateTime | null;
  next_retry_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/* ── invitations (schemas/invitation.py) ────────────────────────────────── */

export type InvitationResponse = {
  id: UUID;
  organization_id: UUID;
  email: string;
  role: string;
  invited_by_user_id: UUID;
  accepted_at: IsoDateTime | null;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
};


/** A registered WebAuthn credential. Only the public key ever leaves the browser. */
export type PasskeyResponse = {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};


/** A tenant's SAML identity provider. */
export type SsoConnectionResponse = {
  enabled: boolean;
  enforced: boolean;
  auto_provision: boolean;
  idp_entity_id: string;
  idp_sso_url: string;
  /** Comma-separated. The tenant boundary: see backend sso_service. */
  allowed_email_domains: string;
};

export type SsoConnectionRequest = SsoConnectionResponse & { idp_x509_cert: string };

/** Which organization a request resolved to, and whether it is a sandbox. */
export type SandboxStatusResponse = {
  organization_id: string;
  is_sandbox: boolean;
  /** Set only on a sandbox: the live organization it shadows. */
  live_organization_id: string | null;
  document_count: number;
  contact_count: number;
  /** Outbound email, SMS and payment collection are suppressed. */
  side_effects_suppressed: boolean;
};

export type SandboxResetResponse = SandboxStatusResponse & {
  deleted_documents: number;
  deleted_contacts: number;
};

/* ── payments (schemas/payment.py) ───────────────────────────────────────── */

/** `app/models/enums.py:PaymentSplitMode` */
export type PaymentSplitMode = 'single' | 'equal' | 'custom';
/** `app/models/enums.py:SignerPaymentStatus` */
export type SignerPaymentStatus = 'requires_payment' | 'processing' | 'succeeded' | 'failed' | 'refunded';

/** `schemas/payment.py:PaymentAccountResponse` — the tenant's own Stripe
 *  Connect account. `charges_enabled`, `payouts_enabled` and
 *  `details_submitted` are independent: a linked account can sit in any
 *  combination of them, and only `charges_enabled` says it can actually
 *  collect money. */
export type PaymentAccountResponse = {
  id: UUID;
  organization_id: UUID;
  provider: string;
  provider_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  default_currency: string | null;
  livemode: boolean;
  onboarded_at: IsoDateTime | null;
  last_synced_at: IsoDateTime | null;
  disabled_reason: string | null;
};

/** `schemas/payment.py:PaymentAccountLinkResponse` — a one-time hosted
 *  onboarding url (Stripe account link). */
export type PaymentAccountLink = {
  url: string;
  expires_at: IsoDateTime;
};

/** `schemas/payment.py:PaymentFieldConfig` — the validated shape of a
 *  `payment` field's `options` JSON. */
export type PaymentFieldConfig = {
  amount_mode: 'fixed' | 'signer_entered';
  amount_cents: number | null;
  min_cents: number | null;
  max_cents: number | null;
  currency: string;
  memo: string | null;
  payment_request_id: string | null;
};

/** `schemas/payment.py:PaymentAllocationInput` */
export type PaymentAllocationInput = {
  recipient_id: UUID;
  amount_cents: number;
};

/** `schemas/payment.py:PaymentRequestCreate` */
export type PaymentRequestPayload = {
  total_cents: number;
  currency?: string;
  memo?: string | null;
  split_mode?: PaymentSplitMode;
  allocations?: PaymentAllocationInput[];
};

/** `schemas/payment.py:PaymentRequestResponse` */
export type PaymentRequestResponse = {
  id: UUID;
  document_id: UUID;
  organization_id: UUID;
  total_cents: number;
  currency: string;
  memo: string | null;
  split_mode: PaymentSplitMode;
  created_by_user_id: UUID | null;
  collected_cents: number;
  paid_count: number;
  allocation_count: number;
};

/** `schemas/payment.py:SignerPaymentResponse` — one payment attempt against a
 *  `payment` field. */
export type SignerPaymentResponse = {
  id: UUID;
  organization_id: UUID;
  document_id: UUID;
  recipient_id: UUID;
  field_id: UUID;
  payment_request_id: UUID | null;
  amount_cents: number;
  currency: string;
  status: SignerPaymentStatus;
  provider: string | null;
  provider_payment_intent_id: string | null;
  provider_charge_id: string | null;
  receipt_url: string | null;
  failure_code: string | null;
  failure_message: string | null;
  paid_at: IsoDateTime | null;
  refunded_at: IsoDateTime | null;
  refunded_amount_cents: number;
  description: string | null;
  created_at: IsoDateTime;
};

/** `schemas/payment.py:PaymentIntentResponse` — what the signing client needs
 *  to mount Stripe's payment element. */
export type PaymentIntentResponse = {
  client_secret: string;
  publishable_key: string;
  connected_account_id: string;
  amount_cents: number;
  currency: string;
  description: string | null;
};
