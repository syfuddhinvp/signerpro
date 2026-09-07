/**
 * One thin typed function per backend endpoint the UI needs, grouped by
 * domain. No React, no adapters, no formatting — just `path + params + type`.
 *
 * Both transports are supported through the `Caller` indirection:
 *
 * ```ts
 * // server component / server action
 * import { apiFetch } from '@/lib/api/client';
 * const res = await contacts.list(apiFetch, { limit: 200 });
 *
 * // client component (goes through /api/proxy)
 * import { apiCall } from '@/lib/api/browser';
 * const res = await contacts.create(apiCall, { name, email });
 * ```
 *
 * Paths are the real backend paths (`/api/...`); the browser transport rewrites
 * them to `/api/proxy/...` itself.
 */

import type { ApiRequestInit, ApiResult } from './result';
import type * as T from './types';

/** Either transport: `apiFetch` (server) or `apiCall` (browser). */
export type Caller = <R>(path: string, init?: ApiRequestInit) => Promise<ApiResult<R>>;

const get = <R>(call: Caller, path: string, query?: ApiRequestInit['query']) =>
  call<R>(path, { method: 'GET', query });
const post = <R>(call: Caller, path: string, body?: unknown, query?: ApiRequestInit['query']) =>
  call<R>(path, { method: 'POST', body, query });
const patch = <R>(call: Caller, path: string, body?: unknown) =>
  call<R>(path, { method: 'PATCH', body });
const put = <R>(call: Caller, path: string, body?: unknown) =>
  call<R>(path, { method: 'PUT', body });
const del = <R>(call: Caller, path: string, query?: ApiRequestInit['query']) =>
  call<R>(path, { method: 'DELETE', query });

/* ── auth / account ─────────────────────────────────────────────────────── */

export const account = {
  me: (c: Caller) => get<T.CurrentUserResponse>(c, '/api/me'),
  updateMe: (c: Caller, body: { name?: string; locale?: string; timezone?: string; avatar_url?: string }) =>
    patch<T.CurrentUserResponse>(c, '/api/me', body),
  /** Replaces the profile photo. `image` is a data URL or bare base64 (PNG/JPEG). */
  updateAvatar: (c: Caller, image: string) =>
    put<T.CurrentUserResponse>(c, '/api/me/avatar', { image_base64: image }),
  removeAvatar: (c: Caller) => del<T.CurrentUserResponse>(c, '/api/me/avatar'),
  signatures: (c: Caller) => get<T.SavedSignatureResponse[]>(c, '/api/me/signatures'),
  createSignature: (c: Caller, body: Record<string, unknown>) =>
    post<T.SavedSignatureResponse>(c, '/api/me/signatures', body),
  /** Answers with the whole list, already re-sorted with the default first. */
  setDefaultSignature: (c: Caller, id: string) =>
    post<T.SavedSignatureResponse[]>(c, `/api/me/signatures/${id}/default`, {}),
  deleteSignature: (c: Caller, id: string) => del<void>(c, `/api/me/signatures/${id}`),
  notificationPreferences: (c: Caller) => get<T.NotificationPreferenceResponse[]>(c, '/api/me/notification-preferences'),
  updateNotificationPreferences: (c: Caller, body: { prefs?: Record<string, boolean>; extra_recipients?: string[] }) =>
    put<T.NotificationPreferenceResponse[]>(c, '/api/me/notification-preferences', body),
  fieldFavorites: (c: Caller) => get<T.FieldFavoritesResponse>(c, '/api/me/field-favorites'),
  /** Replaces the whole starred set; the palette is the source of truth. */
  updateFieldFavorites: (c: Caller, types: string[]) =>
    put<T.FieldFavoritesResponse>(c, '/api/me/field-favorites', { types }),
  auditTrail: (
    c: Caller,
    params?: {
      limit?: number; offset?: number; search?: string; event_type?: string;
      actor?: string; date_from?: string; date_to?: string;
      sort_by?: 'time' | 'action' | 'document' | 'actor'; sort_dir?: 'asc' | 'desc';
    },
  ) => get<T.AccountAuditFeed>(c, '/api/me/audit-trail', params),
  integrations: (c: Caller) => get<T.IntegrationResponse[]>(c, '/api/integrations'),
  cloudTargets: (c: Caller) => get<T.CloudTargetItem[]>(c, '/api/integrations/cloud-targets'),
  updateCloudTargets: (c: Caller, targets: T.CloudTargetItem[]) =>
    put<T.CloudTargetItem[]>(c, '/api/integrations/cloud-targets', { targets }),
  connectIntegration: (c: Caller, provider: string, body?: Record<string, unknown>) =>
    post<T.IntegrationResponse>(c, `/api/integrations/${provider}/connect`, body ?? {}),
  disconnectIntegration: (c: Caller, provider: string) => del<void>(c, `/api/integrations/${provider}`),
};

export const auth = {
  me: (c: Caller) => get<T.CurrentUserResponse>(c, '/api/auth/me'),
  sessions: (c: Caller) => get<T.SessionResponse[]>(c, '/api/auth/sessions'),
  revokeSession: (c: Caller, id: string) => del<void>(c, `/api/auth/sessions/${id}`),
  revokeOtherSessions: (c: Caller) => del<void>(c, '/api/auth/sessions'),
  mfaStatus: (c: Caller) => get<T.MfaStatusResponse>(c, '/api/auth/mfa'),
  mfaEnroll: (c: Caller, method = 'totp') => post<T.MfaEnrollResponse>(c, '/api/auth/mfa/enroll', { method }),
  changePassword: (c: Caller, body: { current_password: string; password: string }) =>
    patch<void>(c, '/api/auth/password', body),

  // WebAuthn. The ceremony is two calls by protocol: the server mints a
  // challenge, the authenticator signs it, the server verifies.
  passkeys: (c: Caller) => get<T.PasskeyResponse[]>(c, '/api/auth/passkeys'),
  passkeyRegisterBegin: (c: Caller) =>
    post<Record<string, unknown>>(c, '/api/auth/passkeys/register/begin', {}),
  passkeyRegisterFinish: (c: Caller, credential: Record<string, unknown>, label: string | null) =>
    post<T.PasskeyResponse>(c, '/api/auth/passkeys/register/finish', { credential, label }),
  passkeyDelete: (c: Caller, id: string) => del<void>(c, `/api/auth/passkeys/${id}`),

  ssoConnection: (c: Caller) => get<T.SsoConnectionResponse | null>(c, '/api/auth/sso/connection'),
  saveSsoConnection: (c: Caller, body: T.SsoConnectionRequest) =>
    put<T.SsoConnectionResponse>(c, '/api/auth/sso/connection', body),
};

export const organizations = {
  me: (c: Caller) => get<T.OrganizationResponse>(c, '/api/organizations/me'),
  update: (c: Caller, body: Record<string, unknown>) => patch<T.OrganizationResponse>(c, '/api/organizations/me', body),
  members: (c: Caller) => get<T.UserResponse[]>(c, '/api/organizations/me/members'),
  setMemberRole: (c: Caller, userId: string, role: string) =>
    patch<T.UserResponse>(c, `/api/organizations/me/members/${userId}/role`, { role }),
  overview: (c: Caller, params?: { range?: string }) =>
    get<T.OrganizationOverview>(c, '/api/organizations/me/overview', params),
  apiSettings: (c: Caller) => get<T.ApiSettingsResponse>(c, '/api/organizations/me/api-settings'),
  updateApiSettings: (c: Caller, body: Partial<T.ApiSettingsResponse>) =>
    patch<T.ApiSettingsResponse>(c, '/api/organizations/me/api-settings', body),
};

export const invitations = {
  list: (c: Caller) => get<T.InvitationResponse[]>(c, '/api/invitations/'),
  create: (c: Caller, body: { email: string; role: string }) =>
    post<{ invitation: T.InvitationResponse; invite_link: string }>(c, '/api/invitations/', body),
  revoke: (c: Caller, id: string) => del<void>(c, `/api/invitations/${id}`),
};

/* ── documents / library ────────────────────────────────────────────────── */

export const documents = {
  library: (c: Caller, params?: T.DocumentLibraryParams) =>
    get<T.DocumentLibraryPage>(c, '/api/documents/library', params),
  counts: (c: Caller) => get<T.DocumentCounts>(c, '/api/documents/counts'),
  list: (c: Caller, params?: { status?: T.DocumentStatus }) =>
    get<T.DocumentResponse[]>(c, '/api/documents', params),
  get: (c: Caller, id: string) => get<T.DocumentResponse>(c, `/api/documents/${id}`),
  create: (c: Caller, body: { title: string; workflow_type?: T.WorkflowType; is_template?: boolean }) =>
    post<T.DocumentResponse>(c, '/api/documents', body),
  update: (c: Caller, id: string, body: Record<string, unknown>) =>
    patch<T.DocumentResponse>(c, `/api/documents/${id}`, body),
  remove: (c: Caller, id: string) => del<void>(c, `/api/documents/${id}`),
  rename: (c: Caller, id: string, title: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/rename`, { title }),
  duplicate: (c: Caller, id: string, title?: string) =>
    post<T.DocumentResponse>(c, `/api/documents/${id}/duplicate`, { title: title ?? null }),
  makeTemplate: (c: Caller, id: string, title?: string) =>
    post<T.DocumentResponse>(c, `/api/documents/${id}/make-template`, { title: title ?? null }),
  archive: (c: Caller, id: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/archive`),
  unarchive: (c: Caller, id: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/unarchive`),
  trash: (c: Caller, id: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/trash`),
  restore: (c: Caller, id: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/restore`),
  move: (c: Caller, id: string, folder_id: string | null) =>
    post<T.DocumentResponse>(c, `/api/documents/${id}/move`, { folder_id }),
  favorite: (c: Caller, id: string) => post<void>(c, `/api/documents/${id}/favorite`),
  unfavorite: (c: Caller, id: string) => del<void>(c, `/api/documents/${id}/favorite`),
  bulk: (c: Caller, body: { document_ids: string[]; action: T.BulkAction; folder_id?: string | null }) =>
    post<T.BulkActionResult>(c, '/api/documents/bulk', body),
  emptyTrash: (c: Caller) => del<T.BulkActionResult>(c, '/api/documents/trash'),
  /** `POST /api/documents/bulk-download` streams a zip — use `apiDownload`, not a JSON caller. */
  bulkDownloadPath: () => '/api/documents/bulk-download',
  routing: (c: Caller, id: string) => get<T.RoutingResponse>(c, `/api/documents/${id}/routing`),
  updateRouting: (c: Caller, id: string, body: T.RoutingUpdate) =>
    put<T.RoutingResponse>(c, `/api/documents/${id}/routing`, body),
  send: (c: Caller, id: string) => post<T.SendDocumentResponse>(c, `/api/documents/${id}/send`),
  void: (c: Caller, id: string, reason?: string) =>
    post<T.DocumentResponse>(c, `/api/documents/${id}/void`, undefined, { reason }),
  remind: (c: Caller, id: string) =>
    post<{ signing_links: { recipient_id: string; email: string; signing_link: string }[] }>(c, `/api/documents/${id}/remind`),
  generateFinalPdf: (c: Caller, id: string) => post<T.DocumentResponse>(c, `/api/documents/${id}/generate-final-pdf`),
  /**
   * `POST /api/documents/{id}/upload-pdf` — multipart, one PDF per envelope.
   * The backend refuses a second upload (409), rejects non-PDF bytes (400) and
   * anything over `max_upload_bytes` (413).
   */
  uploadPdf: (c: Caller, id: string, file: File) => {
    const formData = new FormData();
    formData.append('upload', file, file.name);
    // A 25 MB PDF over a slow link needs more than the 15s default deadline.
    return c<T.UploadPdfResponse>(`/api/documents/${id}/upload-pdf`, { method: 'POST', formData, timeoutMs: 120_000 });
  },
  /** `GET /api/documents/{id}/pdf` streams a PDF — link to it, don't JSON-fetch it. */
  pdfPath: (id: string) => `/api/documents/${id}/pdf`,
  finalPdfPath: (id: string) => `/api/documents/${id}/final-pdf`,
};

export const fields = {
  list: (c: Caller, documentId: string) => get<T.FieldResponse[]>(c, `/api/documents/${documentId}/fields`),
  create: (c: Caller, documentId: string, body: T.FieldCreate) =>
    post<T.FieldResponse>(c, `/api/documents/${documentId}/fields`, body),
  bulkSave: (c: Caller, documentId: string, items: T.FieldBulkItem[]) =>
    put<T.FieldResponse[]>(c, `/api/documents/${documentId}/fields`, { fields: items }),
  update: (c: Caller, documentId: string, fieldId: string, body: Partial<T.FieldCreate>) =>
    patch<T.FieldResponse>(c, `/api/documents/${documentId}/fields/${fieldId}`, body),
  remove: (c: Caller, documentId: string, fieldId: string) =>
    del<void>(c, `/api/documents/${documentId}/fields/${fieldId}`),
};

export const recipients = {
  list: (c: Caller, documentId: string) => get<T.RecipientResponse[]>(c, `/api/documents/${documentId}/recipients`),
  create: (c: Caller, documentId: string, body: T.RecipientCreate) =>
    post<T.RecipientResponse>(c, `/api/documents/${documentId}/recipients`, body),
  setAll: (c: Caller, documentId: string, items: T.RecipientSetItem[], workflow_type?: T.WorkflowType) =>
    put<T.RecipientResponse[]>(c, `/api/documents/${documentId}/recipients`, { recipients: items, workflow_type }),
  bulkAdd: (c: Caller, documentId: string, body: { recipients?: T.RecipientCreate[]; from_contact_ids?: string[] }) =>
    post<T.RecipientResponse[]>(c, `/api/documents/${documentId}/recipients/bulk`, body),
  reorder: (c: Caller, documentId: string, recipient_ids: string[]) =>
    post<T.RecipientResponse[]>(c, `/api/documents/${documentId}/recipients/reorder`, { recipient_ids }),
  update: (c: Caller, documentId: string, recipientId: string, body: Partial<T.RecipientCreate>) =>
    patch<T.RecipientResponse>(c, `/api/documents/${documentId}/recipients/${recipientId}`, body),
  remove: (c: Caller, documentId: string, recipientId: string) =>
    del<void>(c, `/api/documents/${documentId}/recipients/${recipientId}`),
  /** `POST .../resend` — issues a fresh signing link for one recipient and
   *  emails it. The previous link for that signer is superseded either way. */
  resend: (c: Caller, documentId: string, recipientId: string) =>
    post<{ email: string; signing_link: string }>(c, `/api/documents/${documentId}/recipients/${recipientId}/resend`),
  /** The same call with `notify=false`: hands the link back without sending an
   *  email, which is what "copy link" needs. */
  signingLink: (c: Caller, documentId: string, recipientId: string) =>
    post<{ email: string; signing_link: string }>(c, `/api/documents/${documentId}/recipients/${recipientId}/resend?notify=false`),
};

/* ── contacts ───────────────────────────────────────────────────────────── */

export const contacts = {
  list: (c: Caller, params?: T.ContactListParams) => get<T.ContactListResponse>(c, '/api/contacts', params),
  get: (c: Caller, id: string) => get<T.ContactResponse>(c, `/api/contacts/${id}`),
  create: (c: Caller, body: T.ContactCreate) => post<T.ContactResponse>(c, '/api/contacts', body),
  update: (c: Caller, id: string, body: T.ContactUpdate) => patch<T.ContactResponse>(c, `/api/contacts/${id}`, body),
  remove: (c: Caller, id: string) => del<void>(c, `/api/contacts/${id}`),
  history: (c: Caller, id: string, params?: { limit?: number; offset?: number }) =>
    get<T.ContactHistoryEntry[]>(c, `/api/contacts/${id}/history`, params),
  groups: (c: Caller) => get<T.ContactGroupResponse[]>(c, '/api/contacts/groups'),
  createGroup: (c: Caller, body: { key: string; label: string; sort_order?: number }) =>
    post<T.ContactGroupResponse>(c, '/api/contacts/groups', body),
  updateGroup: (c: Caller, id: string, body: { key?: string; label?: string; sort_order?: number }) =>
    patch<T.ContactGroupResponse>(c, `/api/contacts/groups/${id}`, body),
  removeGroup: (c: Caller, id: string) => del<void>(c, `/api/contacts/groups/${id}`),
  import: (c: Caller, body: { contacts: T.ContactCreate[]; dry_run?: boolean }) =>
    post<T.ContactImportResponse>(c, '/api/contacts/import', body),
  addAsRecipients: (c: Caller, body: T.ContactAddRecipientsRequest) =>
    post<T.RecipientResponse[]>(c, '/api/contacts/add-as-recipients', body),
};

/* ── folders & templates ────────────────────────────────────────────────── */

export const teams = {
  list: (c: Caller) => get<T.TeamResponse[]>(c, '/api/teams'),
  get: (c: Caller, id: string) => get<T.TeamResponse>(c, `/api/teams/${id}`),
  create: (c: Caller, body: { name: string; description?: string | null }) =>
    post<T.TeamResponse>(c, '/api/teams', body),
  update: (c: Caller, id: string, body: { name?: string; description?: string | null }) =>
    patch<T.TeamResponse>(c, `/api/teams/${id}`, body),
  remove: (c: Caller, id: string) => del<void>(c, `/api/teams/${id}`),
  /** Idempotent — adding someone who is already in the team sets their role. */
  addMember: (c: Caller, id: string, body: { user_id: string; role?: string }) =>
    post<T.TeamResponse>(c, `/api/teams/${id}/members`, body),
  removeMember: (c: Caller, id: string, userId: string) =>
    del<void>(c, `/api/teams/${id}/members/${userId}`),
};

export const folders = {
  list: (c: Caller) => get<T.FolderResponse[]>(c, '/api/folders'),
  tree: (c: Caller) => get<T.FolderTreeResponse>(c, '/api/folders/tree'),
  create: (c: Caller, body: { name: string; parent_id?: string | null; team_id?: string | null; sort_order?: number }) =>
    post<T.FolderResponse>(c, '/api/folders', body),
  update: (c: Caller, id: string, body: Record<string, unknown>) => patch<T.FolderResponse>(c, `/api/folders/${id}`, body),
  remove: (c: Caller, id: string) => del<void>(c, `/api/folders/${id}`),
  moveDocuments: (c: Caller, body: { document_ids: string[]; folder_id: string | null }) =>
    post<string[]>(c, '/api/folders/move', body),
};

export const templates = {
  list: (c: Caller, params?: T.TemplateListParams) => get<T.TemplateListResponse>(c, '/api/templates', params),
  get: (c: Caller, id: string) => get<T.TemplateResponse>(c, `/api/templates/${id}`),
  fromDocument: (c: Caller, documentId: string, body?: { title?: string; folder_id?: string | null }) =>
    post<T.TemplateResponse>(c, `/api/templates/from-document/${documentId}`, body ?? {}),
  update: (c: Caller, id: string, body: Record<string, unknown>) => patch<T.TemplateResponse>(c, `/api/templates/${id}`, body),
  duplicate: (c: Caller, id: string, title?: string) =>
    post<T.TemplateResponse>(c, `/api/templates/${id}/duplicate`, { title: title ?? null }),
  archive: (c: Caller, id: string) => post<T.TemplateResponse>(c, `/api/templates/${id}/archive`),
  restore: (c: Caller, id: string) => post<T.TemplateResponse>(c, `/api/templates/${id}/restore`),
  use: (c: Caller, id: string, body?: { title?: string; folder_id?: string | null }) =>
    post<T.DocumentResponse>(c, `/api/templates/${id}/use`, body ?? {}),
  usage: (c: Caller, id: string) => get<T.TemplateUsageResponse>(c, `/api/templates/${id}/usage`),
};

/* ── billing & invoices ─────────────────────────────────────────────────── */

export const billing = {
  plans: (c: Caller) => get<T.PlanResponse[]>(c, '/api/billing/plans'),
  subscription: (c: Caller) => get<T.SubscriptionResponse>(c, '/api/billing/subscription'),
  usage: (c: Caller) => get<T.UsageResponse>(c, '/api/billing/usage'),
  settings: (c: Caller) => get<T.BillingSettingsResponse>(c, '/api/billing/settings'),
  updateSettings: (c: Caller, body: T.BillingSettingsUpdate) =>
    patch<T.BillingSettingsResponse>(c, '/api/billing/settings', body),
  paymentMethods: (c: Caller) => get<T.PaymentMethodResponse[]>(c, '/api/billing/payment-methods'),
  addPaymentMethod: (c: Caller, body: T.PaymentMethodCreate) =>
    post<T.PaymentMethodResponse>(c, '/api/billing/payment-methods', body),
  setDefaultPaymentMethod: (c: Caller, id: string) =>
    post<T.PaymentMethodResponse>(c, `/api/billing/payment-methods/${id}/default`),
  removePaymentMethod: (c: Caller, id: string) => del<void>(c, `/api/billing/payment-methods/${id}`),
  upcomingInvoice: (c: Caller) => get<T.UpcomingInvoiceResponse>(c, '/api/billing/upcoming-invoice'),
  charges: (c: Caller, params?: { limit?: number }) => get<T.ChargeResponse[]>(c, '/api/billing/charges', params),
  checkout: (
    c: Caller,
    body: {
      plan_code: string;
      success_url?: string;
      cancel_url?: string;
      ui_mode?: 'hosted' | 'embedded';
      return_url?: string;
    },
  ) => post<T.CheckoutResponse>(c, '/api/billing/checkout', body),
  /** Save an instrument without buying anything — the card form's replacement. */
  setupSession: (c: Caller, body: { return_url?: string; ui_mode?: 'hosted' | 'embedded' } = {}) =>
    post<T.CheckoutResponse>(c, '/api/billing/setup-session', body),
  /** Confirm a session with the provider. A redirect back is not a receipt. */
  confirmCheckout: (c: Caller, sessionId: string) =>
    get<T.CheckoutStatusResponse>(c, `/api/billing/checkout/${encodeURIComponent(sessionId)}`),
  changePlan: (c: Caller, plan_code: string) => post<T.SubscriptionResponse>(c, '/api/billing/change-plan', { plan_code }),
  previewChangePlan: (c: Caller, params: { plan_code: string }) =>
    get<T.PlanChangePreview>(c, '/api/billing/change-plan/preview', params),
  cancel: (c: Caller, at_period_end = true) => post<T.SubscriptionResponse>(c, '/api/billing/cancel', { at_period_end }),
  resume: (c: Caller) => post<T.SubscriptionResponse>(c, '/api/billing/resume'),
  changeSeats: (c: Caller, delta: number) => post<T.SeatChangeResponse>(c, '/api/billing/seats', { delta }),
};

export const invoices = {
  list: (c: Caller, params?: { status?: string; scope?: string }) =>
    get<T.InvoiceResponse[]>(c, '/api/invoices', params),
  get: (c: Caller, id: string) => get<T.InvoiceResponse>(c, `/api/invoices/${id}`),
  pay: (c: Caller, id: string, payment_method_id?: string) =>
    post<T.InvoiceResponse>(c, `/api/invoices/${id}/pay`, { payment_method_id: payment_method_id ?? null }),
  pdfPath: (id: string) => `/api/invoices/${id}/pdf`,
  receiptPath: (id: string) => `/api/invoices/${id}/receipt`,
};

/* ── support ────────────────────────────────────────────────────────────── */

export const support = {
  tickets: (c: Caller, params?: { status?: string }) => get<T.TicketResponse[]>(c, '/api/support/tickets', params),
  ticketPage: (c: Caller, params?: {
    status?: string; priority?: string; q?: string; assignee_user_id?: string;
    scope?: string; organization_id?: string; limit?: number; offset?: number;
  }) => get<T.TicketPage>(c, '/api/support/tickets/page', params),
  ticket: (c: Caller, id: string) => get<T.TicketDetailResponse>(c, `/api/support/tickets/${id}`),
  create: (c: Caller, body: T.TicketCreate) => post<T.TicketDetailResponse>(c, '/api/support/tickets', body),
  reply: (c: Caller, id: string, body: { body: string; internal?: boolean }) =>
    post<T.TicketDetailResponse>(c, `/api/support/tickets/${id}/reply`, body),
  update: (c: Caller, id: string, body: Record<string, unknown>) =>
    patch<T.TicketDetailResponse>(c, `/api/support/tickets/${id}`, body),
  escalate: (c: Caller, id: string) => post<T.TicketDetailResponse>(c, `/api/support/tickets/${id}/escalate`),
  queue: (c: Caller, params?: { status?: string }) => get<T.PlatformTicketResponse[]>(c, '/api/support/queue', params),
  agents: (c: Caller) => get<T.SupportAgent[]>(c, '/api/support/agents'),
  stats: (c: Caller) => get<T.TenantTicketStats>(c, '/api/support/stats'),
  queueStats: (c: Caller) => get<T.QueueTicketStats>(c, '/api/support/queue/stats'),
  quickReplies: (c: Caller) => get<T.QuickReply[]>(c, '/api/support/quick-replies'),
};

/* ── activity, audit, logs ──────────────────────────────────────────────── */

export const activity = {
  list: (c: Caller, params?: { event_type?: string; search?: string; since_days?: number; limit?: number; offset?: number }) =>
    get<T.ActivityPage>(c, '/api/activity', params),
  platform: (c: Caller, params?: { event_type?: string; search?: string; since_days?: number; limit?: number; offset?: number }) =>
    get<T.ActivityPage>(c, '/api/activity/platform', params),
};

export const audit = {
  documentTrail: (c: Caller, documentId: string) =>
    get<T.AuditTrailEntry[]>(c, `/api/documents/${documentId}/audit-logs`),
  verifyChain: (c: Caller, documentId: string) =>
    get<T.AuditChainVerification>(c, `/api/documents/${documentId}/audit-logs/verify`),
  /** `GET /api/documents/{id}/certificate/summary` — the router mounts the
   *  certificate under a `/summary` action, not on the collection itself. */
  certificate: (c: Caller, documentId: string) =>
    get<T.CertificateSummaryResponse>(c, `/api/documents/${documentId}/certificate/summary`),
  /** `GET /api/documents/{id}/certificate/pdf` streams the certificate of
   *  completion — download it with `apiDownload`, don't JSON-fetch it. */
  certificatePdfPath: (documentId: string) => `/api/documents/${documentId}/certificate/pdf`,
  /** `GET /api/documents/{id}/certificate/full` — the document *and* its
   *  certificate as one PDF (for a sealed envelope, `final.pdf` itself). */
  documentWithCertificatePath: (documentId: string) => `/api/documents/${documentId}/certificate/full`,
};

export const logs = {
  tenant: (c: Caller, params?: T.LogParams) => get<T.SystemLogPage>(c, '/api/logs', params),
  platform: (c: Caller, params?: T.LogParams) => get<T.SystemLogPage>(c, '/api/saas/logs', params),
  platformDetail: (c: Caller, id: string) => get<T.SystemLogRow>(c, `/api/saas/logs/${id}`),
  platformAudit: (c: Caller, params?: { action?: string; organization_id?: string; q?: string; limit?: number; offset?: number }) =>
    get<T.PlatformAuditPage>(c, '/api/saas/audit', params),
};

export const notifications = {
  /** The feed, for both the header bell and the notifications page. `unread`
   *  is the badge and is independent of every filter here. */
  list: (c: Caller, params?: T.NotificationParams) =>
    get<T.NotificationFeed>(c, '/api/notifications', params),
  markRead: (c: Caller, id: string) =>
    post<T.NotificationWriteResponse>(c, `/api/notifications/${id}/read`),
  markUnread: (c: Caller, id: string) =>
    post<T.NotificationWriteResponse>(c, `/api/notifications/${id}/unread`),
  remove: (c: Caller, id: string) =>
    del<T.NotificationWriteResponse>(c, `/api/notifications/${id}`),
  markAllRead: (c: Caller) => post<T.NotificationWriteResponse>(c, '/api/notifications/read-all'),
  /** Deletes read rows only — unread ones are the only in-app record of an
   *  event nobody has seen yet. */
  clearRead: (c: Caller) => post<T.NotificationWriteResponse>(c, '/api/notifications/clear-read'),
  bulk: (c: Caller, ids: string[], action: T.NotificationBulkAction) =>
    post<T.NotificationWriteResponse>(c, '/api/notifications/bulk', { ids, action }),
};

/* ── platform: tenants, directory, flags, revenue ───────────────────────── */

export const tenants = {
  list: (c: Caller, params?: { q?: string; status?: string; plan?: string; limit?: number; offset?: number }) =>
    get<T.TenantPage>(c, '/api/saas/tenants', params),
  get: (c: Caller, orgId: string) => get<T.TenantDetail>(c, `/api/saas/tenants/${orgId}`),
  create: (c: Caller, body: Record<string, unknown>) => post<T.TenantDetail>(c, '/api/saas/tenants', body),
  suspend: (c: Caller, orgId: string, reason: string) =>
    post<T.TenantDetail>(c, `/api/saas/tenants/${orgId}/suspend`, { reason }),
  resume: (c: Caller, orgId: string) => post<T.TenantDetail>(c, `/api/saas/tenants/${orgId}/resume`),
  flagOverrides: (c: Caller, orgId: string) => get<T.TenantFlagOverride[]>(c, `/api/saas/tenants/${orgId}/flags`),
  setFlagOverride: (c: Caller, orgId: string, body: { key: string; enabled: boolean | null }) =>
    put<T.TenantFlagOverride[]>(c, `/api/saas/tenants/${orgId}/flags`, body),
  impersonate: (c: Caller, orgId: string, body: { justification: string; ttl_seconds?: number; scopes?: string[] }) =>
    post<T.ImpersonationSessionResponse>(c, `/api/saas/tenants/${orgId}/impersonate`, body),
  stopImpersonation: (c: Caller) => del<{ ended_sessions: number }>(c, '/api/saas/impersonation'),
  overview: (c: Caller) => get<T.PlatformOverview>(c, '/api/saas/overview'),
  metrics: (c: Caller) => get<T.SaaSMetrics>(c, '/api/saas/metrics'),
};

export const directory = {
  list: (c: Caller, params?: { q?: string; organization_id?: string; role?: string; mfa?: boolean; limit?: number; offset?: number }) =>
    get<T.DirectoryPage>(c, '/api/saas/directory', params),
  setRole: (c: Caller, userId: string, role: string) =>
    patch<T.DirectoryUser>(c, `/api/saas/directory/${userId}/role`, { role }),
  permissionMatrix: (c: Caller) => get<T.PermissionMatrix>(c, '/api/saas/roles'),
};

export const flags = {
  /** Platform-wide flag definitions. */
  list: (c: Caller, params?: { environment?: string }) => get<T.FeatureFlagResponse[]>(c, '/api/saas/flags', params),
  update: (c: Caller, key: string, body: { enabled?: boolean; rollout_pct?: number; environment?: string; description?: string }) =>
    patch<T.FeatureFlagResponse>(c, `/api/saas/flags/${key}`, body),
  overrides: (c: Caller, key: string) => get<T.FlagOverridesResponse>(c, `/api/saas/flags/${key}/overrides`),
  setOverrides: (c: Caller, key: string, organization_ids: string[]) =>
    put<T.FlagOverridesResponse>(c, `/api/saas/flags/${key}/overrides`, { organization_ids }),
  /** Flags resolved for the caller's own tenant. */
  resolved: (c: Caller) => get<Record<string, boolean>>(c, '/api/flags'),
  securityPosture: (c: Caller) => get<T.SecurityPostureRow[]>(c, '/api/saas/security-posture'),
  updateSecurityPosture: (c: Caller, body: Record<string, boolean>) =>
    patch<T.SecurityPostureRow[]>(c, '/api/saas/security-posture', body),
  compliance: (c: Caller) => get<T.ComplianceResponse>(c, '/api/saas/compliance'),
};

export const revenue = {
  summary: (c: Caller) => get<T.RevenueSummary>(c, '/api/saas/revenue'),
  churn: (c: Caller, params?: { range?: string }) => get<T.ChurnResponse>(c, '/api/saas/revenue/churn', params),
  balance: (c: Caller) => get<T.BalanceResponse>(c, '/api/saas/balance'),
  dunning: (c: Caller) => get<T.DunningRow[]>(c, '/api/saas/dunning'),
  billingEvents: (c: Caller, params?: { limit?: number }) => get<T.BillingEventResponse[]>(c, '/api/saas/billing-events', params),
  replayBillingEvent: (c: Caller, id: string) => post<T.BillingEventResponse>(c, `/api/saas/billing-events/${id}/replay`),
  health: (c: Caller) => get<T.HealthComponent[]>(c, '/api/saas/health'),
};

export const platformInvoices = {
  list: (c: Caller, params?: { status?: string }) => get<T.PlatformInvoiceResponse[]>(c, '/api/saas/invoices', params),
  markPaid: (c: Caller, id: string, amount_cents?: number) =>
    post<T.PlatformInvoiceResponse>(c, `/api/saas/invoices/${id}/mark-paid`, { amount_cents: amount_cents ?? null }),
  void: (c: Caller, id: string, reason?: string) =>
    post<T.PlatformInvoiceResponse>(c, `/api/saas/invoices/${id}/void`, { reason: reason ?? null }),
  retryPayment: (c: Caller, id: string) => post<T.PlatformInvoiceResponse>(c, `/api/saas/invoices/${id}/retry-payment`),
};

/* ── developer: api keys ────────────────────────────────────────────────── */

export const apiKeys = {
  list: (c: Caller) => get<T.ApiKeyResponse[]>(c, '/api/api-keys'),
  get: (c: Caller, id: string) => get<T.ApiKeyResponse>(c, `/api/api-keys/${id}`),
  scopes: (c: Caller) => get<T.ApiKeyScopeResponse[]>(c, '/api/api-keys/scopes'),
  usage: (c: Caller) => get<T.ApiKeyUsageResponse>(c, '/api/api-keys/usage'),
  create: (c: Caller, body: { label: string; mode?: 'live' | 'test'; scopes?: string[] }) =>
    post<T.ApiKeyCreated>(c, '/api/api-keys', body),
  roll: (c: Caller, id: string) => post<T.ApiKeyCreated>(c, `/api/api-keys/${id}/roll`),
  revoke: (c: Caller, id: string) => post<T.ApiKeyResponse>(c, `/api/api-keys/${id}/revoke`),
  restore: (c: Caller, id: string) => post<T.ApiKeyResponse>(c, `/api/api-keys/${id}/restore`),
  replaceScopes: (c: Caller, id: string, scopes: string[]) =>
    patch<T.ApiKeyResponse>(c, `/api/api-keys/${id}/scopes`, { scopes }),
  grantScopes: (c: Caller, id: string, scopes: string[]) =>
    post<T.ApiKeyResponse>(c, `/api/api-keys/${id}/scopes/grant`, { scopes }),
  revokeScopes: (c: Caller, id: string, scopes: string[]) =>
    post<T.ApiKeyResponse>(c, `/api/api-keys/${id}/scopes/revoke`, { scopes }),
};

/* ── reports ────────────────────────────────────────────────────────────── */

export type ReportRangeParams = { range?: string; start?: string; end?: string };

export const reports = {
  catalogue: (c: Caller) => get<T.ReportFieldCatalogueResponse>(c, '/api/reports/fields'),
  overview: (c: Caller, params?: ReportRangeParams) => get<T.ReportOverviewResponse>(c, '/api/reports/overview', params),
  invites: (c: Caller, params?: ReportRangeParams) => get<T.InviteReportResponse>(c, '/api/reports/invites', params),
  documents: (c: Caller, params?: ReportRangeParams & { limit?: number; offset?: number }) =>
    get<T.DocumentReportResponse>(c, '/api/reports/documents', params),
  templates: (c: Caller, params?: ReportRangeParams & { limit?: number; offset?: number }) =>
    get<T.TemplateReportResponse>(c, '/api/reports/templates', params),
  recipientsReport: (c: Caller, params?: ReportRangeParams & { limit?: number; offset?: number }) =>
    get<T.RecipientReportResponse>(c, '/api/reports/recipients', params),
  senders: (c: Caller, params?: ReportRangeParams) => get<T.SenderReportRow[]>(c, '/api/reports/senders', params),
  createExport: (c: Caller, body: { report: string; range?: string; format?: 'csv' | 'xlsx'; filters?: Record<string, unknown> }) =>
    post<T.ReportExportResponse>(c, '/api/reports/export', body),
  getExport: (c: Caller, id: string) => get<T.ReportExportResponse>(c, `/api/reports/exports/${id}`),
  customList: (c: Caller) => get<T.CustomReportResponse[]>(c, '/api/reports/custom'),
  customCreate: (c: Caller, body: { name: string; fields?: string[]; filters?: Record<string, unknown>; group_by?: string }) =>
    post<T.CustomReportResponse>(c, '/api/reports/custom', body),
  customUpdate: (c: Caller, id: string, body: Record<string, unknown>) =>
    patch<T.CustomReportResponse>(c, `/api/reports/custom/${id}`, body),
  customRemove: (c: Caller, id: string) => del<void>(c, `/api/reports/custom/${id}`),
  customRun: (c: Caller, id: string) => post<T.CustomReportRunResponse>(c, `/api/reports/custom/${id}/run`),
  customSchedule: (c: Caller, id: string, body: { cadence?: string; format?: string; recipients?: string[] }) =>
    post<T.ReportScheduleResponse>(c, `/api/reports/custom/${id}/schedule`, body),
};

/* ── webhooks ───────────────────────────────────────────────────────────── */

export const webhooks = {
  eventTypes: (c: Caller) => get<T.WebhookEventTypeResponse[]>(c, '/api/webhooks/event-types'),
};
