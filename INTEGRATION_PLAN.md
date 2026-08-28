# SignForge Frontend ↔ SignFlow Backend Integration Plan

Status: design document. Other agents implement directly from this.
Backend: FastAPI, `backend/app` (title `SignFlow CRM API`, all routes prefixed `/api`).
Frontend: Next.js, `frontend/`, ported prototype in `frontend/components/sf` + `frontend/lib/sf`.

Conventions observed in the existing backend, which every proposed endpoint must follow:

- Router per resource in `backend/app/api/routes/*.py`, `APIRouter(prefix="/api/<thing>", tags=["<thing>"])`, registered in `app/main.py`.
- Auth via `Depends(get_current_user)` (any tenant member), `Depends(require_org_admin)` (tenant admin), `Depends(require_platform_admin)` (platform super admin). Public endpoints take no user dep (signing, register, login, invitation accept).
- Cross-tenant id ⇒ **404, never 403** (see `invoices.get_invoice`, `document_service.get_for_user`).
- Pydantic schemas in `app/schemas/`, `model_config = ConfigDict(from_attributes=True)` on response models.
- Business logic in a `*_service.py` singleton; routes stay thin.
- Models: `UUIDPrimaryKeyMixin` (str(uuid4) in `String(36)`), `TimestampMixin`, `now_utc()`. Money as integer cents. Secrets via `EncryptedString`. Enums as `StrEnum` stored in `String(n)` (newer models) or SQLAlchemy `Enum` (older models — prefer `String` + StrEnum for new tables).
- Alembic under `app/migrations/versions/` is the single source of schema truth (no `create_all` at startup).
- Writes that meter usage call `entitlement_service.check_entitlement(...)` before and `record_usage(...)` after.
- Audit-worthy actions call `audit_service.log(...)`.

---

## a. Endpoint inventory — everything that exists today

Auth column: `public` = no token; `user` = any authenticated member; `org admin` = `require_org_admin`; `platform` = `require_platform_admin`; `token` = signing-link bearer in path.

### auth — `app/api/routes/auth.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | public | `RegisterRequest{organization_name,name,email,password}` | 201 `TokenResponse{access_token,token_type,user:UserResponse}` |
| POST | `/api/auth/login` | public (IP + email rate limited) | `LoginRequest{email,password}` | `TokenResponse` |
| GET | `/api/auth/me` | user | — | `CurrentUserResponse{id,organization_id,name,email,role,is_platform_admin}` |

### documents — `app/api/routes/documents.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/documents` | user | `DocumentCreate{title,workflow_type,is_template}` | 201 `DocumentResponse` |
| GET | `/api/documents` | user | query `status` (`DocumentStatus`) | `list[DocumentResponse]` |
| GET | `/api/documents/templates/all` | user | — | `list[DocumentResponse]` |
| POST | `/api/documents/templates/{template_id}/use` | user | — | `DocumentResponse` |
| GET | `/api/documents/{document_id}` | user | — | `DocumentResponse` |
| PATCH | `/api/documents/{document_id}` | user | `DocumentUpdate{title?,workflow_type?,is_template?}` | `DocumentResponse` |
| DELETE | `/api/documents/{document_id}` | user | — | 204 |
| POST | `/api/documents/{document_id}/upload-pdf` | user | multipart `upload` | `UploadPdfResponse{document,sha256,page_count}` |
| GET | `/api/documents/{document_id}/pdf` | user | — | `application/pdf` |
| GET | `/api/documents/{document_id}/final-pdf` | user | — | `application/pdf` (404 unless completed) |
| POST | `/api/documents/{document_id}/send` | user | — | `SendDocumentResponse{document,signing_links[]}` |
| POST | `/api/documents/{document_id}/void` | user | query `reason?` | `DocumentResponse` |
| POST | `/api/documents/{document_id}/remind` | user | — | `{signing_links:[{recipient_id,email,signing_link}]}` |
| POST | `/api/documents/{document_id}/generate-final-pdf` | user | — | `DocumentResponse` |

`DocumentResponse` = `id, organization_id, sender_id, title, status, workflow_type, is_template, original_file_path, final_file_path, original_sha256, field_config_sha256, final_sha256, page_count, sent_at, completed_at, expires_at, created_at, updated_at, recipients_total, recipients_completed`.

### recipients — `app/api/routes/recipients.py` (prefix `/api/documents/{document_id}/recipients`)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `` | user | `RecipientCreate{name,email,role_name?,signing_order,otp_enabled,phone_number?}` | 201 `RecipientResponse` |
| GET | `` | user | — | `list[RecipientResponse]` |
| PATCH | `/{recipient_id}` | user | `RecipientUpdate` (all optional) | `RecipientResponse` |
| DELETE | `/{recipient_id}` | user | — | 204 |
| POST | `/{recipient_id}/resend` | user | — | `{email,signing_link}` |

### fields — `app/api/routes/fields.py` (prefix `/api/documents/{document_id}/fields`)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `` | user | `FieldCreate{recipient_id,type,label,required,page_number,x,y,width,height,placeholder?,default_value?,value?,options?}` | 201 `FieldResponse` |
| GET | `` | user | — | `list[FieldResponse]` |
| PATCH | `/{field_id}` | user | `FieldUpdate` | `FieldResponse` |
| DELETE | `/{field_id}` | user | — | 204 |

`FieldType` enum: `signature, initials, full_name, date, text, email, phone, checkbox, dropdown, title, company, address, currency, number, radio`.

### audit — `app/api/routes/audit.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/documents/{document_id}/audit-logs` | user | — | `list[AuditLogResponse{id,document_id,recipient_id,user_id,event_type,event_message,ip_address,user_agent,log_metadata,created_at}]` newest first |

### signing (public signer surface) — `app/api/routes/signing.py` (prefix `/api/sign`)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/{token}` | token (rate limited) | — | `SigningSessionResponse{document,recipient,current_recipient_id,fields[],read_only,expires_at,pdf_url,required_total,required_completed,otp_required,consent_required}` |
| GET | `/{token}/pdf` | token | — | `application/pdf` (403 until OTP+consent) |
| POST | `/{token}/viewed` | token | — | `SigningSessionResponse` |
| POST | `/{token}/fields/{field_id}/value` | token | `FieldValueRequest{value:str\|bool}` | `FieldResponse` |
| POST | `/{token}/fields/{field_id}/signature` | token | `SignatureRequest{signature_type,signature_text?,signature_image_base64?}` | `FieldResponse` |
| POST | `/{token}/complete` | token | — | `CompletionResponse{document_status,recipient_status,final_pdf_url?}` |
| POST | `/{token}/decline` | token | `DeclineRequest{reason}` | 204 |
| POST | `/{token}/otp/send` | token (rate limited) | — | 204 |
| POST | `/{token}/otp/verify` | token (rate limited) | `OtpVerifyRequest{code}` | `SigningSessionResponse` |
| POST | `/{token}/consent` | token | — | `SigningSessionResponse` |

### organizations — `app/api/routes/organizations.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/organizations/me` | user | — | `OrganizationResponse{id,name,smtp_host,smtp_port,smtp_username,smtp_from_email,sms_provider,twilio_account_sid,twilio_from_number,telnyx_from_number}` |
| PATCH | `/api/organizations/me` | org admin | `OrganizationSettingsUpdate` (name + SMTP + SMS incl. secrets) | `OrganizationResponse` |
| GET | `/api/organizations/me/members` | org admin | — | `list[UserResponse]` |
| PATCH | `/api/organizations/me/members/{user_id}/role` | org admin | `OrganizationMemberRoleUpdate{role}` | `UserResponse` (409 if last admin demoted) |

### saas (platform admin) — `app/api/routes/saas.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/saas/metrics` | platform | — | `SaaSMetrics{total_organizations,total_users,total_documents,active_subscriptions,tier_counts}` |
| GET | `/api/saas/organizations` | platform | — | `list[SaaSOrganizationResponse{id,name,subscription_tier,subscription_status,subscription_expires_at,created_at,users_count,documents_count}]` |
| PATCH | `/api/saas/organizations/{org_id}` | platform | `SaaSOrganizationUpdate{name?,subscription_tier?,subscription_status?,subscription_expires_at?}` | `SaaSOrganizationResponse` |
| GET | `/api/saas/users` | platform | — | `list[SaaSUserResponse{id,name,email,role,created_at,organization_id,organization_name}]` |
| PATCH | `/api/saas/users/{user_id}/role` | platform | `SaaSUserUpdate{role}` | `SaaSUserResponse` |

### invoices — `app/api/routes/invoices.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/invoices` | user | query `status?` | `list[InvoiceResponse]` |
| GET | `/api/invoices/{invoice_id}` | user | — | `InvoiceResponse` |
| GET | `/api/saas/invoices` | platform | query `status?` | `list[PlatformInvoiceResponse]` (+`organization_name`) |
| POST | `/api/saas/invoices/{invoice_id}/mark-paid` | platform | `InvoiceMarkPaid{amount_cents?}` | `PlatformInvoiceResponse` |

`InvoiceResponse` = `id, organization_id, number, status, currency, subtotal_cents, tax_cents, total_cents, amount_paid_cents, amount_due_cents, is_overdue, period_start, period_end, issued_at, due_at, paid_at, line_items, hosted_url`.

### support — `app/api/routes/support.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/support/tickets` | user | query `status?` (`open` = not resolved) | `list[TicketResponse]` |
| POST | `/api/support/tickets` | user | `TicketCreate{subject,body,category?,priority}` | 201 `TicketDetailResponse` |
| GET | `/api/support/tickets/{ticket_id}` | user | — | `TicketDetailResponse` |
| POST | `/api/support/tickets/{ticket_id}/reply` | user | `TicketReply{body}` | `TicketDetailResponse` |
| PATCH | `/api/support/tickets/{ticket_id}` | user (priority: platform only) | `TicketUpdate{status?,priority?}` | `TicketDetailResponse` |
| GET | `/api/support/queue` | platform | query `status?` | `list[PlatformTicketResponse]` |

`TicketResponse` = `id, organization_id, reference, subject, category, status, priority, created_at, updated_at, resolved_at, message_count`; detail adds `messages[{id,author_name,body,is_staff,created_at}]`. Statuses: `open, pending, resolved`. Priorities: `low, normal, high, urgent`.

### activity — `app/api/routes/activity.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/activity` | user | `event_type?, search?, since_days?(1-365), limit(1-500), offset` | `ActivityPage{entries[],total,event_types[]}` |
| GET | `/api/activity/platform` | platform | same | `ActivityPage` (entries carry `organization_id/name`) |

`ActivityEntry` = `id, created_at, event_type, event_message, document_id, document_title, actor, ip_address, organization_id?, organization_name?`.

### revenue — `app/api/routes/revenue.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/saas/revenue` | platform | — | `RevenueSummary{mrr_cents,arr_cents,collected_cents,outstanding_cents,overdue_cents,paying_tenants,trialing_tenants,series[{period,invoiced_cents,collected_cents}],by_plan[{plan_code,plan_name,subscribers,mrr_cents}]}` |

### webhooks (tenant outbound) — `app/api/routes/webhooks.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/webhooks/event-types` | user | — | `list[WebhookEventTypeResponse{event_type,description}]` |
| GET | `/api/webhooks` | user | — | `list[WebhookEndpointResponse]` |
| POST | `/api/webhooks` | user | `WebhookEndpointCreate{url,description?,event_types?,is_active}` | 201 `WebhookEndpointCreated` (+`secret`, shown once) |
| GET | `/api/webhooks/{endpoint_id}` | user | — | `WebhookEndpointResponse` |
| PATCH | `/api/webhooks/{endpoint_id}` | user | `WebhookEndpointUpdate` | `WebhookEndpointResponse` |
| POST | `/api/webhooks/{endpoint_id}/rotate-secret` | user | — | `WebhookEndpointCreated` |
| DELETE | `/api/webhooks/{endpoint_id}` | user | — | 204 |
| GET | `/api/webhooks/{endpoint_id}/deliveries` | user | `status?, limit(≤200)` | `list[WebhookDeliveryResponse]` |
| POST | `/api/webhooks/deliveries/{delivery_id}/replay` | user | — | `WebhookDeliveryResponse` |
| POST | `/api/webhooks/{endpoint_id}/test` | user | — | `list[WebhookDeliveryResponse]` |

### invitations — `app/api/routes/invitations.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/invitations/` | org admin | `InvitationCreate{email,role}` | 201 `InvitationCreateResponse{invitation,invite_link}` |
| GET | `/api/invitations/` | org admin | — | `list[InvitationResponse]` |
| DELETE | `/api/invitations/{invitation_id}` | org admin | — | 204 |
| POST | `/api/invitations/accept` | public | `InvitationAcceptRequest{token,name,password}` | 201 `TokenResponse` |

### billing — `app/api/routes/billing.py`

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/billing/plans` | public | — | `list[PlanResponse{id,code,name,description,price_cents,currency,billing_interval,trial_days,is_active,entitlements}]` |
| GET | `/api/billing/subscription` | user | — | `SubscriptionResponse{id?,organization_id,plan_code,plan_name,status,current_period_start,current_period_end,trial_ends_at,cancel_at_period_end,canceled_at,provider,entitlements}` |
| GET | `/api/billing/usage` | user | — | `UsageResponse{organization_id,plan_code,plan_name,subscription_status,period_start,period_end,limits{key:{limit,used,remaining,exceeded}},period_totals,features}` |
| POST | `/api/billing/checkout` | org admin | `CheckoutRequest{plan_code,success_url?,cancel_url?}` | `CheckoutResponse{session_id,url,provider,plan_code}` |
| POST | `/api/billing/change-plan` | org admin | `ChangePlanRequest{plan_code}` | `SubscriptionResponse` |
| POST | `/api/billing/cancel` | org admin | `CancelRequest{at_period_end}` | `SubscriptionResponse` |
| POST | `/api/billing/resume` | org admin | — | `SubscriptionResponse` |
| POST | `/api/billing/webhook` | public (`X-Signature`) | raw provider body | `{status}` |

### misc

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/health` | public | `{status:"ok"}` |

**Existing surface total: 63 endpoints.** Entitlement keys available today: `max_documents_per_month, max_users, max_storage_bytes, max_recipients_per_document, custom_branding, api_access, webhooks`. Plan codes seeded by `billing_service.ensure_default_plans`: `free, growth, enterprise`.

---

## b. Screen → data map

Legend: **C** = mock constant in `frontend/lib/sf/data.ts`; **S** = key in `SFState` (`frontend/lib/sf/state.tsx`). "GAP" refers to the gap ids in section (c).

### Auth — `components/sf/Auth.tsx`
- Reads: **C** `AUTH_TABS, AUTH_ROLES, AUTH_TITLES, STRENGTH_COLORS, STRENGTH_WORDS` (all static copy — keep static).
- Reads **S**: `authMode, authEmail, authPassword, authRole, remember, mfaCode, reg{name,company,email,password,size,terms}`.
- Mutates **S**: `authMode, authEmail, authPassword, authRole, authed, mfaCode, reg`.
- Served by: `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`.
- **GAP**: MFA step (`mfaCode`) → AUTH-3/AUTH-4. Forgot-password mode → AUTH-6/AUTH-7. `remember` (token lifetime / refresh) → AUTH-2. `authRole` ('tenant' | 'platform') must be *derived* from `CurrentUserResponse.is_platform_admin`, not chosen by the user — the picker becomes cosmetic. `reg.company` → `organization_name`; `reg.size` has no backing column → ORG-1.

### Shell — `components/sf/Shell.tsx`
- Reads **C**: `RAIL_DEFS_TENANT, RAIL_DEFS_PLATFORM, SCREEN_RAIL, QUICK_ACCESS, LIB_FOLDERS, TEAM_FOLDERS, NOTIFICATIONS, HELP_ITEMS, ORG_OPTIONS, DOC_NAV, REPORT_NAV, ACCOUNT_NAV, PLATFORM_TABS, TOUR, TENANTS, TEMPLATES, INVOICES, LOGS, AUDIT`.
- Reads **S**: `wide, screen, workspace, org, orgOpen, notifOpen, helpOpen, trialBanner, libFolder, apiSection, reportsSection, platformTab, user, contacts, tickets, fields, activeRecipient, dragTool, ghost, embedSession, embedReturnUrl, toast`.
- Mutates **S**: `screen, workspace, org, orgOpen, notifOpen, helpOpen, trialBanner, libFolder, libSelected, apiSection, reportsSection, platformTab, accountOpen, accountSection, menuDoc, modal, tourStep, authed, authMode, authPassword, mfaCode, embedSession`.
- Served by: `GET /api/auth/me` (user name/role), `GET /api/organizations/me` (org name), `GET /api/billing/subscription` (trial banner).
- **GAP**: notification bell feed → RPT-8/NOTIF (ACT-4). Org switcher list (`ORG_OPTIONS`) → ORG-3. Sidebar counts (`QUICK_ACCESS`, `LIB_FOLDERS`, `TEAM_FOLDERS`) → DOC-1/DOC-11. Rail/nav definitions and `SCREEN_RAIL` stay static.

### Library — `components/sf/screens/Library.tsx`
- Reads **C**: `QUICK_ACCESS, LIB_FOLDERS, LIB_FILTER_DEFS, LIB_SORT_OPTIONS, ROW_ACTIONS, STATUS, TEMPLATES` and `DOCS` via `libDocsFiltered()`/`FOLDER_STATUS_MAP`.
- Reads **S**: `libFolder, libView, libSort, libStatus, libType, libTime, libOwner, libSelected, query, menuDoc, screen`.
- Mutates **S**: same filter keys + `libSelected, menuDoc, query, screen, wizardStep`.
- Served by: `GET /api/documents?status=`, `GET /api/documents/templates/all`, `DELETE /api/documents/{id}`, `POST /api/documents/{id}/void`, `POST /api/documents/{id}/remind`.
- **GAP**: folder/archive/trash/favourites model, type + time + owner filters, sort, pagination, per-folder counts → DOC-1…DOC-11. Of the 20 `ROW_ACTIONS`, only Open / Prepare-and-send / Add-fields / Download / Delete / Open-audit-trail map to existing endpoints; Make-template, Duplicate, Rename, Archive, Move-to-folder, Merge, Export-to-cloud, Download-with-certificate, Invite-link, Freeform-invite, Notarize, Print, Share, Email-a-copy are all GAPs (DOC-2…DOC-10, SIGN-1, SIGN-5).

### Builder — `components/sf/screens/Builder.tsx`
- Reads **C**: `TYPES` (15 palette types), `ROLE_LABEL`, `PALETTE_TABS`, `PAGE_THUMB_MENU`, `VALIDATION_REGEX_MAP`, `MERGE_SUGGESTIONS`, `BLANK_PNG`.
- Reads **S**: `fields, selected, activeRecipient, page, zoom, grid, guides, marquee, dragTool, favTypes, paletteTab, paletteQuery, wizardStep, routing, cadence, expiry, message`; recipients via `recips()`.
- Mutates **S**: `fields` (via `setField`), `selected, activeRecipient, page, zoom, grid, paletteQuery, paletteTab, wizardStep, recipients, routing, cadence, expiry, message, modal, screen`.
- Served by: fields CRUD `POST/GET/PATCH/DELETE /api/documents/{id}/fields`, recipients CRUD, `GET /api/documents/{id}/pdf`, `POST /api/documents/{id}/send`.
- **GAP**: `TYPES` ids `name, stamp, attachment, formula, datetime` are not in the backend `FieldType` enum → FLD-1. Per-field `validation`, `cond` (conditional logic), `merge` (merge tag), `readOnly` have no columns (`is_locked` is the closest to `readOnly`) → FLD-2. Bulk field save (drag many, then persist) → FLD-3. Page operations (insert/duplicate/rotate/delete page) and page thumbnails → DOC-12/DOC-13. Palette favourites (`favTypes`) → PREF-1 (or keep purely client-side in `localStorage`). Routing/cadence/expiry/message persistence → RTE-1.

### Routing — `components/sf/screens/Routing.tsx`
- Reads **S**: `routing, cadence, expiry, message`, recipients via `recips()`; mutates those + `recipients, screen` and calls `reorder()`.
- Served by: recipients CRUD (`signing_order`), `PATCH /api/documents/{id}` (`workflow_type` ⇄ `routing`).
- **GAP**: `cadence` (reminder cadence), `expiry` (days), `message` (invite message), atomic reorder → RTE-1, RTE-2. Recipient `color` and prototype roles `sign/approve/copy/inperson` vs backend free-text `role_name` → RTE-3.

### Signer — `components/sf/screens/Signer.tsx`
- Reads **S**: `signValues, activeSignField, fields`, `signable()`, `isDone()`, `recip()`, `meta()`.
- Mutates **S**: `signValues, activeSignField, sigTab, modal, screen`.
- Served by: the whole `/api/sign/{token}` family (session, pdf, viewed, field value, signature, complete, decline, otp, consent).
- **GAP**: saved signatures / passkey reuse (`SAVED_SIGS`) → SIGN-3. Reassign signer → SIGN-4. Conditional-field evaluation is client-only today; server must enforce it → FLD-2.

### Audit — `components/sf/screens/Audit.tsx`
- Reads **C**: `AUDIT` (8 rows: `action, actor, time, meta, checksum, kind`), `CERT_ROWS`, `STATUS`; recipients via `recips()`. No state.
- Served by: `GET /api/documents/{id}/audit-logs`.
- **GAP**: `checksum` per entry, `kind` (neutral/info/good) classification, geo/device enrichment in `meta`, and the certificate-of-completion panel (`CERT_ROWS`: sealed-at, hash algorithm, TSA time source, CA) → SIGN-1, SIGN-2, SIGN-6.

### TenantHome — `components/sf/screens/TenantHome.tsx`
- Reads **C**: `ORG_STATS, ORG_SERIES, ORG_ATTENTION, ORG_SPEND_LINES, ORG_TEAM, ACCENT_DEFAULT, TOUR`. No state reads; mutates `screen, accountOpen, helpOpen, tourStep`.
- Served by: partly `GET /api/billing/usage`, `GET /api/organizations/me/members`, `GET /api/documents?status=`.
- **GAP**: the whole tile/series/attention/spend payload → RPT-1 (`GET /api/reports/overview`), BIL-4 (upcoming spend), RPT-7 (per-member send counts).

### PlatformHome — `components/sf/screens/PlatformHome.tsx`
- Reads **C**: `PLATFORM_STATS_META, MRR_SERIES, TENANTS, DUNNING, HEALTH, PLATFORM_AUDIT`. No state.
- Served by: `GET /api/saas/metrics`, `GET /api/saas/organizations`, `GET /api/saas/revenue` (series), `GET /api/activity/platform`.
- **GAP**: seats provisioned/activated, envelopes·30d, incidents·90d → ORG-4 / ORG-9. Dunning queue → REV-2. Service-health board → REV-6. Platform audit rows (`PLATFORM_AUDIT`) are administrative, not document-scoped, so `AuditLog` (which requires `document_id`) cannot hold them → ACT-1.

### Platform — `components/sf/screens/Platform.tsx`
- Reads **C**: `PLATFORM_TABS, TENANTS, PLAN_TONE, STATUS_TONE, PLATFORM_USERS, ROLE_LABEL, PERMS, PERM_COLUMNS, FLAG_META, FLAG_ENV_TONE, PLANS, USAGE_ROWS, SEC_DEFS, CERTIFICATIONS, PLATFORM_AUDIT, AUDIT`.
- Reads **S**: `platformTab, tenantQuery, tenantOverrides, userRoles, flagState, security`; mutates all of those.
- Served by: `GET /api/saas/organizations`, `PATCH /api/saas/organizations/{id}`, `GET /api/saas/users`, `PATCH /api/saas/users/{id}/role`, `GET /api/billing/plans`.
- **GAP**: tenant `slug, owner, seats, used, volume, region, mrr` → ORG-4. Suspend/impersonate → ORG-6, ORG-7. `PLATFORM_USERS.mfa`/`last` → AUTH-9. Permission matrix (`PERMS`) → ORG-10. Feature flags → FLG-1…FLG-4. Security posture toggles + certifications → FLG-5, FLG-6. Marketing plan cards (`PLANS`, `USAGE_ROWS`) → BIL-1, BIL-11.

### Billing — `components/sf/screens/Billing.tsx`
- Reads **C**: `PM_DEFS, UPCOMING_LINES, CHARGES, SUB_TILES_META, PLAN_PRICES, PLANS`.
- Reads **S**: `autopay, billingEmail, taxId, cycle, defaultPm`; mutates those + `modal, screen`.
- Served by: `GET /api/billing/subscription`, `GET /api/billing/plans`, `GET /api/billing/usage`, `POST /api/billing/change-plan`, `POST /api/billing/checkout`.
- **GAP**: payment methods → BIL-2, BIL-3. Upcoming invoice preview → BIL-4. Charge history → BIL-5. Autopay/billing email/tax id/cycle/default PM settings → BIL-6. Seat counts and add-seats → BIL-7, BIL-8.

### Invoices — `components/sf/screens/Invoices.tsx`
- Reads **C**: `INVOICES` (with `lines, sub, tax, pi, method, tenant, slug, period, due`), `INVOICE_FILTERS, INV_STATUS_TONE, INV_STATUS_LABEL`.
- Reads **S**: `invoiceFilter, openInvoice, billingEmail`; mutates `invoiceFilter, openInvoice, modal`.
- Served by: `GET /api/invoices`, `GET /api/invoices/{id}`, `GET /api/saas/invoices`, `POST /api/saas/invoices/{id}/mark-paid`.
- **GAP**: prototype status `past_due` is not an `InvoiceStatus` (backend derives `is_overdue` from `open` + `due_at`) — map in the client, or add BIL-12. Payment-intent id + method label on the invoice → BIL-9. Pay-invoice action → BIL-10. Receipt/PDF download → BIL-13.

### Revenue — `components/sf/screens/Revenue.tsx`
- Reads **C**: `REVENUE_STATS, BALANCE_TILES, SUBS_BY_PLAN, CHURN_ROWS, STRIPE_WEBHOOKS`.
- Reads **S**: `liveMode`; mutates `liveMode`.
- Served by: `GET /api/saas/revenue` covers MRR, ARR, `by_plan`, collected/outstanding/overdue.
- **GAP**: gross volume + failed payments → REV-1. Balance and payouts → REV-3. Churn/NRR/trial-conversion → REV-4. Provider webhook event log → REV-5. Live/test mode → API-9.

### Reports — `components/sf/screens/Reports.tsx`
- Reads **C**: `REPORT_NAV, REPORT_TILES, REPORT_RANGES, INVITE_SPLIT, REPORT_RECIPIENTS, ALL_REPORT_CARDS, CUSTOM_REPORT_FIELDS, TEMPLATES, DOCS, RECIPIENTS, STATUS`.
- Reads **S**: `reportsSection, reportRange`; mutates `reportRange`.
- Served by: nothing directly.
- **GAP**: every number → RPT-1…RPT-8 (overview tiles, invite split, documents report, template usage, recipients report, audit export, custom builder, scheduled exports).

### Contacts — `components/sf/screens/Contacts.tsx`
- Reads **C**: `GROUP_LABELS, ROLE_WORDS, SRC_TONE, CT_HISTORY, CONTACT_PALETTE`.
- Reads **S**: `contacts` (7 seeded rows), `contactQuery, contactGroup, openContact`; mutates those + `recipients, modal, screen`.
- Served by: **nothing — the address book does not exist in the backend at all.**
- **GAP**: CNT-1…CNT-8 (full CRUD, groups, search, source, tags, envelope history, import, use-as-recipient).

### ApiScreen — `components/sf/screens/ApiScreen.tsx`
- Reads **C**: `API_TABS, API_DEFS, API_STATS_META, EMBED_SNIPPET`.
- Reads **S**: `apiSection, apiTab, apiKeys, scopes, embedOrigins, embedReturnUrl, contacts`; mutates `apiKeys, scopes, embedOrigins, embedReturnUrl, embedSession, apiSection, apiTab, docsPage, contacts, screen`.
- Served by: nothing (`/api/webhooks/*` serves the *webhooks* guide only).
- **GAP**: API-1…API-10 (keys CRUD/reveal/revoke, scopes, embed sessions, allowed origins, usage stats, live/test mode). `API_DEFS` is documentation copy — keep static.

### Sandbox — `components/sf/screens/Sandbox.tsx`
- Reads **C**: `SB_PATH_OPTIONS, SB_LANG_TABS, SANDBOX_RESPONSES, SB_FALLBACK_RESPONSE`.
- Reads/mutates **S**: `sbMethod, sbPath, sbEnv, sbLang, sbBody, sbParams, sbResponse, sbSending, sbHistory`.
- **GAP**: API-8 (`POST /api/dev/sandbox/execute`) to execute against seeded test data. Snippet generation and language tabs stay client-side.

### Guides — `components/sf/screens/Guides.tsx`
- Reads **C**: `DOC_NAV, DOCS_PAGES` (6 pages of prose/code). Reads/mutates **S**: `docsPage`.
- Served by: nothing needed. **Stays 100% static** — this is documentation copy, not server data.

### Support — `components/sf/screens/Support.tsx`
- Reads **C**: `TICKET_FILTERS, TK_STATUS_TONE, TK_STATUS_LABEL, TK_PRIO_TONE, TK_PRIO_LABEL, AGENTS, SLA_MAP, TICKET_STATS_PLATFORM, TICKET_STATS_TENANT, TICKET_QUICK_REPLIES_PLATFORM, TICKET_QUICK_REPLIES_TENANT, NEW_TICKET_SLA_NOTE`.
- Reads **S**: `tickets` (6 seeded), `openTicket, ticketFilter, ticketQuery, replyDraft, replyInternal`; mutates those + `tickets, modal, screen, workspace`.
- Served by: the `/api/support/*` family — closest match of any screen.
- **GAP**: `escalated` status, `assignee`, `sla`, `tags`, `envelope`, `requester/requesterEmail`, `tenant/slug`, internal notes (`replyInternal`), agent roster, ticket stats → SUP-1…SUP-8.

### Logs — `components/sf/screens/Logs.tsx`
- Reads **C**: `LOG_SOURCES, LOG_LEVELS, LEVEL_TONE, LOGS` (via `logsFiltered`).
- Reads **S**: `logSource, logLevel, logQuery, openLog`; mutates those.
- Served by: `GET /api/activity` / `GET /api/activity/platform` — but the shape does not match: prototype rows carry `ts, level, source, slug, msg, code, latency, payload`.
- **GAP**: ACT-1…ACT-4 (request/system log store with level+source+status+latency+payload, tenant-scoped and platform-wide).

### AccountArea — `components/sf/AccountArea.tsx`
- Reads **C**: `ACCOUNT_NAV, ACCOUNT_TITLES, DEVICES, NOTIF_PREFS, INTEGRATIONS, CLOUD_TARGETS, TEAMS, ORGS, INVITE_DEFAULTS, AUDIT`.
- Reads **S**: `accountOpen, accountSection, org, user`; mutates `accountOpen, accountSection, modal, screen, workspace`.
- Served by: `GET /api/auth/me`, `GET /api/billing/subscription`.
- **GAP**: profile update → AUTH-10. Password/2FA/device list → AUTH-5, AUTH-8, AUTH-9. Notification prefs → PREF-2. Integrations → PREF-3. Cloud storage targets → PREF-4. Teams → ORG-8. My organizations → ORG-3. Invite defaults → RTE-1. Account-level audit → ACT-1.

### Modals — `components/sf/Modals.tsx`
Twelve modal kinds; per modal:
- `send` — reads `fields, routing, cadence, expiry`, recips → `POST /api/documents/{id}/send`; cadence/expiry are **GAP** RTE-1.
- `signature` — `sigTab, sigInk, sigStroke, typedName, typeFace, uploadSrc`, `SIG_TABS, TYPE_FACES, INKS, SAVED_SIGS` → `POST /api/sign/{token}/fields/{id}/signature`; saved/passkey tab is **GAP** SIGN-3.
- `disclosure` — `MODAL_COPY_STATIC.disclosure` → `POST /api/sign/{token}/consent` (copy stays static; version string is **GAP** SIGN-6).
- `decline` — `declineReason` → `POST /api/sign/{token}/decline`.
- `reassign` — **GAP** SIGN-4.
- `card` / `ach` — `card{}, ach{}, payTab, poNumber, PAY_TITLES` → **GAP** BIL-2.
- `seats` — `addSeats` → **GAP** BIL-8.
- `plan` — `checkoutPlan, PLAN_PRICES` → `POST /api/billing/change-plan`.
- `pay` — `openInvoice`, `INVOICES` → **GAP** BIL-10.
- `ticket` — `newTicket{}`, `SLA_MAP, TK_PRIO_LABEL` → `POST /api/support/tickets` (+ SUP-2 for envelope link/SLA).
- `contact` — `newContact{}`, `GROUP_LABELS, CONTACT_PALETTE` → **GAP** CNT-2.
- `tour` — `TOUR`, `tourStep`: static.

### Tour — `components/sf/Tour.tsx`
Reads `TOUR` + `tourStep`. Pure UI. **Stays static.**

---

## c. Gap list — endpoints that must be built

Every proposal follows the existing conventions (section a preamble). Auth column as before. Ids are stable and referenced from section (b).

### Module 1 — auth / session (10 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| AUTH-1 | `POST /api/auth/logout` | user | — | 204 (revokes the current `user_sessions` row) |
| AUTH-2 | `POST /api/auth/refresh` | public (refresh cookie/body) | `{refresh_token}` | `TokenResponse` — `remember` extends refresh TTL |
| AUTH-3 | `POST /api/auth/mfa/challenge` | public | `{mfa_token}` (returned by login when MFA enrolled) | `{delivery:"totp"\|"sms", masked_target?}` |
| AUTH-4 | `POST /api/auth/mfa/verify` | public (rate limited) | `{mfa_token, code}` | `TokenResponse` |
| AUTH-5 | `POST /api/auth/mfa/enroll` | user | `{method:"totp"}` | `{secret, otpauth_url, recovery_codes[]}`; `POST /api/auth/mfa/enroll/confirm{code}` → 204 |
| AUTH-6 | `POST /api/auth/password/forgot` | public (rate limited) | `{email}` | 204 always (no account enumeration) |
| AUTH-7 | `POST /api/auth/password/reset` | public | `{token, password}` | `TokenResponse` |
| AUTH-8 | `PATCH /api/auth/password` | user | `{current_password, password}` | 204 |
| AUTH-9 | `GET /api/auth/sessions` | user | — | `list[SessionResponse{id,device,browser,os,ip_address,location,last_seen_at,created_at,is_current}]` |
| AUTH-10 | `PATCH /api/auth/me` + `DELETE /api/auth/sessions/{id}` | user | `{name?,locale?,timezone?,avatar_url?,signature_default?}` / — | `CurrentUserResponse` / 204 |

Login must gain: `TokenResponse` OR `{mfa_required:true, mfa_token}` when the user has MFA enrolled.

### Module 2 — organizations & tenants (10 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| ORG-1 | `PATCH /api/organizations/me` extension | org admin | add `slug?, region?, company_size?, seats_licensed?, accent_color?, logo_url?` | `OrganizationResponse` (extended) |
| ORG-2 | `GET /api/organizations/me/overview` | user | `range?=7d\|30d\|90d\|12m` | `{stats:{action_required,out_for_signature,seats_activated,seats_licensed,completion_rate},series:int[12],attention:[{title,detail,screen,tone}],spend_lines:[{label,amount_cents}],team:[{name,role_label,last_active_at,sent_count}]}` |
| ORG-3 | `GET /api/me/organizations` | user | — | `list[{id,name,slug,plan_name,seats_licensed,region,my_role}]` — powers the org switcher and Account → My organizations |
| ORG-4 | `GET /api/saas/organizations` extension | platform | add `q?, status?, plan?, limit, offset` | rows extended with `slug, owner_email, region, seats_licensed, seats_activated, envelope_volume_30d, mrr_cents, plan_name` |
| ORG-5 | `POST /api/saas/organizations` | platform | `{name, slug, region, plan_code, owner_email, owner_name}` | 201 extended `SaaSOrganizationResponse` |
| ORG-6 | `POST /api/saas/organizations/{org_id}/suspend` and `/resume` | platform | `{reason}` / — | extended `SaaSOrganizationResponse` |
| ORG-7 | `POST /api/saas/organizations/{org_id}/impersonate` | platform | `{justification, ttl_seconds<=3600}` | `{access_token, expires_at, scopes[]}`; `DELETE /api/saas/impersonation` ends it. Writes an `ImpersonationSession` row + platform-audit entry |
| ORG-8 | `GET/POST /api/teams`, `GET/PATCH/DELETE /api/teams/{id}`, `POST /api/teams/{id}/members` | user / org admin | `{name}` / `{user_id, role}` | `TeamResponse{id,name,member_count,document_count,template_count,my_role}` |
| ORG-9 | `GET /api/saas/overview` | platform | — | `{tenants:{total,trial,suspended}, seats:{provisioned,activated}, envelopes_30d, mrr_cents, incidents_90d, uptime_pct, mrr_series:int[12], health:[{component,detail,tone}]}` |
| ORG-10 | `GET /api/saas/roles` | platform | — | `{columns:["super","orgadmin","sender","viewer"], permissions:[{label, allowed:[bool×4]}]}` — server-owned so the matrix cannot drift from the actual dependency checks |

### Module 3 — documents / envelopes (13 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| DOC-1 | `GET /api/documents` extension | user | add `folder_id?, quick?(inbox\|outbox\|completed\|drafts\|favorites\|expiring\|shared\|mine), status?, doc_type?, owner?(me\|team\|shared), since_days?, q?, sort?(recent\|name\|status\|owner), limit, offset` | `{items:[DocumentResponse+{owner_name,folder_id,is_favorite,doc_type}], total, counts:{all,action,waiting,completed,draft,voided}}` |
| DOC-2 | `POST /api/documents/{id}/duplicate` | user | `{title?}` | 201 `DocumentResponse` (copies fields + recipients, status back to `draft`) |
| DOC-3 | `POST /api/documents/{id}/make-template` | user | `{title?}` | 201 `DocumentResponse{is_template:true}` |
| DOC-4 | `POST /api/documents/{id}/archive` / `POST /api/documents/{id}/restore` | user | — | `DocumentResponse` (new `archived_at` column) |
| DOC-5 | `DELETE /api/documents/{id}` change + `POST /api/documents/{id}/trash` / `/restore` / `DELETE /api/documents/trash` | user | — | soft delete via `deleted_at`; hard purge only from trash |
| DOC-6 | `POST /api/documents/{id}/move` | user | `{folder_id\|null}` | `DocumentResponse` |
| DOC-7 | `POST /api/documents/{id}/favorite` / `DELETE …/favorite` | user | — | 204 |
| DOC-8 | `POST /api/documents/{id}/merge` | user | `{source_document_id, position:"append"\|"prepend"}` | `DocumentResponse` (new page_count) |
| DOC-9 | `POST /api/documents/{id}/share` and `POST /api/documents/{id}/email-copy` | user | `{emails[], message?}` | `{sent:[{email}]}` |
| DOC-10 | `POST /api/documents/{id}/invite-link` (public link, freeform invite) | user | `{role_name?, expires_in_days?, freeform:bool}` | `{url, expires_at}` |
| DOC-11 | `GET/POST /api/folders`, `PATCH/DELETE /api/folders/{id}` | user | `{name, parent_id?, team_id?}` | `FolderResponse{id,name,parent_id,team_id,document_count}` |
| DOC-12 | `GET /api/documents/{id}/pages` | user | — | `list[{page_number, width, height, thumbnail_url, rotation}]` |
| DOC-13 | `POST /api/documents/{id}/pages/{n}/{insert-above\|insert-below\|duplicate\|rotate\|delete}` | user | `{degrees?}` for rotate | `DocumentResponse` + re-anchored fields |

### Module 4 — fields (4 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| FLD-1 | extend `FieldType` enum | — | add `stamp, attachment, formula, datetime`; alias prototype `name` → existing `full_name` in the client mapper | — |
| FLD-2 | `FieldCreate`/`FieldUpdate`/`FieldResponse` extension | user | add `validation:"none"\|"email"\|"date"\|"numeric"\|"custom"`, `validation_pattern?`, `condition:{field_id,op:"checked"\|"equals"\|"notEmpty",value}?`, `merge_tag?`, `read_only:bool` | `FieldResponse` (extended). Server must re-evaluate `condition` and `validation` in `signing_service.save_field_value` |
| FLD-3 | `PUT /api/documents/{id}/fields` | user | `{fields:[FieldCreate&{id?}]}` — full replace, one transaction | `list[FieldResponse]`. Lets the builder persist a whole drag/marquee session in one call |
| FLD-4 | `POST /api/documents/{id}/merge-tags/preview` | user | `{contact_id?}` | `{resolved:{tag:value}, unresolved:[tag]}` — backs the “unmapped merge tags” attention item |

### Module 5 — recipients & routing (4 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| RTE-1 | `GET/PUT /api/documents/{id}/routing` | user | `{workflow_type, reminder_cadence:"24h"\|"48h"\|"7d"\|"none", expires_in_days, invite_subject, invite_message}` | `RoutingResponse` (same shape). Also `GET/PUT /api/organizations/me/invite-defaults` for the Account-area defaults |
| RTE-2 | `POST /api/documents/{id}/recipients/reorder` | user | `{recipient_ids:[...]}` in final order | `list[RecipientResponse]` — atomic, replaces N PATCHes |
| RTE-3 | `RecipientCreate/Response` extension | user | add `role:"sign"\|"approve"\|"copy"\|"inperson"` (typed, alongside free-text `role_name`), `color?`, `contact_id?` | `RecipientResponse` (extended) |
| RTE-4 | `POST /api/documents/{id}/recipients/bulk` | user | `{recipients:[RecipientCreate], from_contact_ids?:[...]}` | `list[RecipientResponse]` — powers “use contact as recipient” |

### Module 6 — signing & audit (6 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| SIGN-1 | `GET /api/documents/{id}/certificate` | user | — | `application/pdf`; `GET /api/documents/{id}/certificate/summary` → `{envelope_id, signers_completed, signers_total, sealed_at, hash_algorithm, time_source, certificate_authority, final_sha256}` (backs `CERT_ROWS`) |
| SIGN-2 | `AuditLogResponse` extension | user | — | add `checksum` (per-entry hash chain), `kind:"neutral"\|"info"\|"good"\|"bad"` (derived from `event_type`), and `log_metadata.geo{city,country}`, `.device`, `.session_id` |
| SIGN-3 | `GET/POST /api/me/signatures`, `DELETE /api/me/signatures/{id}` | user | `{signature_type, signature_text?, signature_image_base64?, is_passkey_bound}` | `SavedSignatureResponse{id,label,adopted_at,method,face,preview_url,is_passkey_bound}`; signer side reads them via `GET /api/sign/{token}/signatures` |
| SIGN-4 | `POST /api/sign/{token}/reassign` | token | `{name, email, reason}` | 204 — revokes the caller's token, mints one for the delegate, writes both addresses to the audit trail |
| SIGN-5 | `GET /api/documents/{id}/final-pdf?with_certificate=true` | user | — | `application/pdf` with the certificate appended (“Download with certificate”) |
| SIGN-6 | `GET /api/legal/disclosure` | public | `?version?` | `{version, title, subtitle, body}` — so the consent version recorded in the audit trail is server-owned rather than a frontend constant |

### Module 7 — contacts / address book (8 gaps) — **no backend exists at all**

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| CNT-1 | `GET /api/contacts` | user | `q?, group?, source?, tag?, limit, offset` | `{items:[ContactResponse], total, counts:{all, customers, internal, counsel, vendors}}` |
| CNT-2 | `POST /api/contacts` | user | `ContactCreate{name,email,company?,title?,phone?,default_role,group,tags[],color?}` | 201 `ContactResponse` |
| CNT-3 | `GET /api/contacts/{id}` | user | — | `ContactResponse{id,name,email,company,title,phone,default_role,group,source,tags,color,envelope_count,last_signed_at,created_at,updated_at}` |
| CNT-4 | `PATCH /api/contacts/{id}` | user | `ContactUpdate` (all optional) | `ContactResponse` |
| CNT-5 | `DELETE /api/contacts/{id}` | user | — | 204 |
| CNT-6 | `GET /api/contacts/{id}/history` | user | `limit, offset` | `list[{document_id, title, status, event:"signed"\|"sent"\|"viewed", occurred_at}]` (joins `recipients` on email within the tenant) |
| CNT-7 | `GET/POST /api/contacts/groups`, `PATCH/DELETE /api/contacts/groups/{id}` | user | `{key,label}` | `list[{key,label,contact_count}]` |
| CNT-8 | `POST /api/contacts/import` | user | multipart CSV or `{contacts:[ContactCreate], dry_run:bool}` | `{created,updated,skipped,errors:[{row,message}]}` |

### Module 8 — templates (4 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| TPL-1 | `GET /api/templates` | user | `q?, owner?, sort?, limit, offset` | `{items:[TemplateResponse{id,title,use_count,field_count,owner_name,updated_at}], total}` — the prototype's `TEMPLATES` shape; `/api/documents/templates/all` stays as the raw list |
| TPL-2 | `PATCH /api/templates/{id}` | user | `{title?, description?, doc_type?}` | `TemplateResponse` |
| TPL-3 | `POST /api/templates/{id}/duplicate` | user | `{title?}` | 201 `TemplateResponse` |
| TPL-4 | `GET /api/templates/{id}/usage` | user | `range?` | `{use_count, completed_copies, by_sender:[{name,count}], series:int[]}` — feeds the Reports template-usage cards |

`use_count` needs a `use_count` column on `documents` (incremented by `use_template`) or a derived count from a `template_id` FK on the created document; prefer the FK (`documents.source_template_id`).

### Module 9 — billing, plans & invoices (13 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| BIL-1 | `PlanResponse` extension | public | — | add `tag` (“Self-serve”, “Most adopted”), `marketing_lines:[{label,value}]`, `seat_price_cents`, `is_seat_based` — so `PLANS`/`PLAN_PRICES` come from `plans.entitlements`/new columns |
| BIL-2 | `POST /api/billing/payment-methods` | org admin | `{type:"card"\|"ach"\|"sepa"\|"invoice", provider_token?, po_number?}` | 201 `PaymentMethodResponse{id,type,brand,last4,exp_month,exp_year,holder_name,country,label,meta,is_default}` — provider token only; raw PAN never reaches the API |
| BIL-3 | `GET /api/billing/payment-methods`, `POST /{id}/default`, `DELETE /{id}` | user / org admin | — | `list[PaymentMethodResponse]` / `PaymentMethodResponse` / 204 |
| BIL-4 | `GET /api/billing/upcoming-invoice` | user | — | `{period_start, period_end, currency, line_items:[{description,quantity,unit_cents,amount_cents}], subtotal_cents, tax_cents, total_cents, due_at}` |
| BIL-5 | `GET /api/billing/charges` | user | `limit, offset` | `list[{id, amount_cents, currency, provider_payment_id, method_label, status:"succeeded"\|"recovered"\|"failed", occurred_at, description}]` |
| BIL-6 | `GET/PATCH /api/billing/settings` | user / org admin | `{autopay?, billing_email?, tax_id?, cycle?:"monthly"\|"annual", default_payment_method_id?}` | `BillingSettingsResponse` |
| BIL-7 | `SubscriptionResponse` extension | user | — | add `seats_licensed, seats_activated, next_invoice_total_cents, next_invoice_at` |
| BIL-8 | `POST /api/billing/seats` | org admin | `{delta:int}` | `{subscription:SubscriptionResponse, proration_cents, effective_at}` |
| BIL-9 | `InvoiceResponse` extension | user | — | add `provider_payment_intent_id, payment_method_label, period_label, organization_name?` (already on the platform variant) |
| BIL-10 | `POST /api/invoices/{id}/pay` | org admin | `{payment_method_id?}` | `InvoiceResponse` — idempotent, delegates to `billing_service`/`PaymentProvider` |
| BIL-11 | `GET /api/billing/usage` extension | user | — | add `rows:[{key,label,used,limit,pct,display}]` so `USAGE_ROWS` (envelopes / API calls / storage / SMS) renders straight from the entitlement engine; needs `api_call` and `sms_sent` `UsageEventType` members |
| BIL-12 | `GET /api/invoices` filter alias | user | `status=past_due` | treat as `status=open AND is_overdue` server-side, so the UI's four filter chips work unchanged |
| BIL-13 | `GET /api/invoices/{id}/pdf` and `/receipt` | user | — | `application/pdf` |

### Module 10 — revenue (platform) (6 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| REV-1 | `RevenueSummary` extension | platform | — | add `gross_volume_30d_cents, charge_count_30d, failed_payment_count, at_risk_cents, mrr_change_pct` |
| REV-2 | `GET /api/saas/dunning` | platform | — | `list[{organization_id, organization_name, invoice_number, amount_cents, dunning_step, max_step, reason, next_attempt_at}]` |
| REV-3 | `GET /api/saas/balance` | platform | — | `{available_cents, pending_cents, pending_settles_at, next_payout_cents, next_payout_at, payout_destination, disputes_cents, dispute_count, dispute_rate_pct}` |
| REV-4 | `GET /api/saas/revenue/churn` | platform | `range?` | `{gross_logo_churn_pct, net_revenue_retention_pct, involuntary_churn_pct, trial_conversion_pct}` |
| REV-5 | `GET /api/saas/billing-events` | platform | `limit, status?` | `list[{id, provider, event_id, event_type, status_code, received_at, processed:bool}]` — reads `billing_webhook_events` (already exists), needs `status_code`/`processed` columns |
| REV-6 | `GET /api/saas/health` | platform | — | `list[{component, detail, tone:"good"\|"warn"\|"bad"}]` — signing API p95, PDF workers, webhook delivery success, provider connectivity, ledger anchoring |

### Module 11 — support tickets (8 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| SUP-1 | add `escalated` to `TicketStatus` | — | — | `open, pending, escalated, resolved` — the UI has four filter chips and a tone map for all four |
| SUP-2 | `TicketCreate`/`TicketResponse` extension | user | add `document_id?` (envelope link), `tags:[str]` | response adds `document_id, document_title, tags, sla_due_at, sla_label, requester_name, requester_email, organization_name` |
| SUP-3 | `POST /api/support/tickets/{id}/reply` extension | user | add `internal:bool=false` | internal notes are stored on `ticket_messages.is_internal` and **filtered out of tenant responses** — only platform callers see them |
| SUP-4 | `PATCH /api/support/tickets/{id}` extension | platform | add `assignee_user_id?`, `tags?` | `TicketDetailResponse` |
| SUP-5 | `GET /api/support/agents` | platform | — | `list[{id, name, specialty}]` — replaces the `AGENTS` constant |
| SUP-6 | `GET /api/support/stats` | user | — | tenant: `{open_count, escalated_count, avg_first_response_minutes, sla_target_minutes, resolved_90d, avg_resolution_minutes}` |
| SUP-7 | `GET /api/support/queue/stats` | platform | — | `{open_count, breaching_soon_count, first_response_minutes, target_minutes, csat_30d, csat_responses}` |
| SUP-8 | `GET /api/support/quick-replies` | user | — | `list[{label, body}]`, scoped by caller kind (tenant vs platform) so canned responses are editable without a deploy |

SLA derivation: `sla_due_at = created_at + interval(priority)` with the plan's SLA table; `sla_label` computed server-side (“1h 12m left”, “met in 3h 12m”) so the UI never does clock math.

### Module 12 — activity & logs (4 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| ACT-1 | `GET /api/logs` (tenant) and `GET /api/saas/logs` (platform) | user / platform | `source?(api\|webhook\|auth\|billing\|signing\|admin), level?(info\|warn\|error), q?, since?, limit, offset` | `{items:[{id, occurred_at, level, source, organization_id?, organization_slug?, message, status_code, latency_ms, payload}], total}` — new `system_logs` table written by `RequestLoggingMiddleware` and the services |
| ACT-2 | `GET /api/saas/logs/{id}` | platform | — | full row incl. pretty-printed `payload` (the Logs drawer) |
| ACT-3 | `GET /api/saas/audit` | platform | `limit, offset` | `list[{id, action, actor_email, detail, ip_address, occurred_at}]` — administrative audit for flag flips, impersonation, suspensions, key rotation, SCIM events (`PLATFORM_AUDIT`). Cannot live in `audit_logs` (that table requires `document_id`) |
| ACT-4 | `GET /api/notifications` and `POST /api/notifications/{id}/read` | user | `limit, unread_only?` | `list[{id, title, detail, tone, created_at, read_at, screen, target_id}]` — the Shell bell |

### Module 13 — API keys, scopes & embed sessions (10 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| API-1 | `GET /api/api-keys` | user | — | `list[ApiKeyResponse{id,label,mode,prefix,masked,created_at,last_used_at,revoked_at,scopes[]}]` |
| API-2 | `POST /api/api-keys` | org admin | `{label, mode:"live"\|"test", scopes[]}` | 201 `ApiKeyCreated` = `ApiKeyResponse` + `secret` (**full value returned exactly once**, stored only as a SHA-256 hash) |
| API-3 | `POST /api/api-keys/{id}/reveal` | org admin | `{password}` | `{secret}` — only possible if you keep an `EncryptedString` copy; **recommended alternative:** drop reveal, and change the UI's “reveal” affordance to “roll key” (API-4). Decide before implementing |
| API-4 | `POST /api/api-keys/{id}/roll` | org admin | — | `ApiKeyCreated` |
| API-5 | `POST /api/api-keys/{id}/revoke` | org admin | — | `ApiKeyResponse{revoked_at}` |
| API-6 | `PATCH /api/api-keys/{id}/scopes` | org admin | `{scopes:[str]}` | `ApiKeyResponse`. Catalogue at `GET /api/api-keys/scopes` → `list[{scope,label,description}]` covering `users:read, contacts:read, contacts:write, documents:read, documents:write, envelopes:send, audit:read` |
| API-7 | `POST /api/embed/sessions` | user (or API key) | `{landing:"builder"\|"routing"\|"signing", document:{template_id?,document_id?,title?,file_url?,external_id?}, contacts:[id\|{name,email,role}], return_url}` | 201 `{id, url, expires_at, landing, document{...}, contacts[...]}`. `GET /api/embed/sessions/{id}` resolves it; origin-locked against the tenant allow-list |
| API-8 | `POST /api/dev/sandbox/execute` | user | `{method, path, env:"test"\|"live", query:[{k,v}], body?}` | `{status, latency_ms, body}` — executes against the tenant's own data in `live`, against a seeded sandbox org in `test`. Replaces `SANDBOX_RESPONSES` |
| API-9 | `GET/PATCH /api/organizations/me/api-settings` | user / org admin | `{allowed_origins:[str], default_return_url, live_mode_enabled}` | `ApiSettingsResponse` |
| API-10 | `GET /api/api-keys/usage` | user | `range?` | `{requests_24h, p95_latency_ms, error_rate_pct, error_count, active_key_count, revoked_key_count, embed_sessions_24h, embed_avg_seconds}` — `API_STATS_META` |

Authenticating *with* an API key also needs a `get_api_key_principal` dependency in `app/api/deps.py` alongside `get_current_user`, and scope enforcement returning 403 with the missing scope named (the documented behaviour in `DOCS_PAGES.reference`).

### Module 14 — feature flags & security posture (6 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| FLG-1 | `GET /api/saas/flags` | platform | — | `list[{key, description, environment:"prod"\|"staging"\|"canary", enabled, rollout_pct, updated_at, updated_by}]` |
| FLG-2 | `PATCH /api/saas/flags/{key}` | platform | `{enabled?, rollout_pct?}` | flag row; writes an ACT-3 audit entry (matching the prototype's “stepped_up MFA” log) |
| FLG-3 | `GET/PUT /api/saas/flags/{key}/overrides` | platform | `{organization_ids:[str]}` | per-tenant force-on/off list |
| FLG-4 | `GET /api/flags` | user | — | `{key: bool}` resolved for the caller's tenant (enabled ∧ rollout ∧ override) — lets the frontend gate features |
| FLG-5 | `GET/PATCH /api/saas/security-posture` | platform | `{sso?, scim?, ip_allowlist?, residency?, key_rotation?, dlp?}` | `list[{key, label, detail, enabled}]` — `SEC_DEFS` + `security` state |
| FLG-6 | `GET /api/saas/compliance` | platform | — | `{certifications:[{name,status:"certified"\|"in_process"}], last_key_rotation_at, rotation_interval_days}` |

### Module 15 — reports / analytics (8 gaps)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| RPT-1 | `GET /api/reports/overview` | user | `range=7d\|30d\|90d\|12m` | `{tiles:[{key,label,value,meta}], completion_rate_pct, median_completion_seconds, templates_created, templates_uses, documents_created, sender_count, recipient_count, first_time_recipients}` — `REPORT_TILES` |
| RPT-2 | `GET /api/reports/invites` | user | `range` | `{total, split:[{label:"pending_expired"\|"completed"\|"declined"\|"cancelled", count}]}` — `INVITE_SPLIT` |
| RPT-3 | `GET /api/reports/documents` | user | `range, status?, limit, offset` | `{items:[{document_id,title,status,signed,total,age_days,sender_name,updated_at}], total}` |
| RPT-4 | `GET /api/reports/templates` | user | `range` | `{items:[{template_id,title,use_count,field_count,owner_name,updated_at,completed_copies}]}` |
| RPT-5 | `GET /api/reports/recipients` | user | `range` | `{items:[{email, sent, delivered, viewed, completed, declined, expired, median_completion_label, completion_rate_pct}]}` — the 9-column `REPORT_RECIPIENTS` grid |
| RPT-6 | `POST /api/reports/export` | user | `{report:"documents"\|"templates"\|"template_usage"\|"completed_copies"\|"recipients"\|"audit", range, format:"csv"\|"xlsx", filters?}` | 202 `{export_id, status}`; `GET /api/reports/exports/{id}` → `{status, download_url}` |
| RPT-7 | `GET /api/reports/senders` | user | `range` | `list[{user_id,name,role_label,last_active_at,sent_count,approved_count}]` — `ORG_TEAM` |
| RPT-8 | `GET/POST /api/reports/custom`, `PATCH/DELETE /api/reports/custom/{id}`, `POST /api/reports/custom/{id}/schedule` | user | `{name, fields:[...], filters, group_by?}` / `{cadence, format, recipients:[email]}` | `CustomReportResponse` — `CUSTOM_REPORT_FIELDS` + scheduled CSV exports |

### Cross-cutting: preferences (4 gaps, counted under their owning modules above where noted)

| id | Method + path | Auth | Request | Response |
|---|---|---|---|---|
| PREF-1 | `GET/PATCH /api/me/preferences` | user | `{favorite_field_types?, library_view?, library_sort?, accent_color?, locale?, timezone?}` | `PreferencesResponse` (or keep entirely in `localStorage` — acceptable) |
| PREF-2 | `GET/PUT /api/me/notification-preferences` | user | `{prefs:{event_key:bool}, extra_recipients:[email]}` | `list[{event_key,label,enabled}]` — `NOTIF_PREFS` |
| PREF-3 | `GET /api/integrations`, `POST /api/integrations/{provider}/connect`, `DELETE /api/integrations/{provider}` | user / org admin | OAuth callback payload | `list[{provider, label, detail, connected, connected_at}]` — `INTEGRATIONS` |
| PREF-4 | `GET/PUT /api/integrations/cloud-targets` | org admin | `{targets:[{provider, path, enabled}]}` | `list[{provider,path,enabled}]` — `CLOUD_TARGETS` |

### Gap totals

| module | gaps |
|---|---|
| 1 · auth / session | 10 |
| 2 · organizations & tenants | 10 |
| 3 · documents / envelopes | 13 |
| 4 · fields | 4 |
| 5 · recipients & routing | 4 |
| 6 · signing & audit | 6 |
| 7 · contacts (address book) | 8 |
| 8 · templates | 4 |
| 9 · billing, plans & invoices | 13 |
| 10 · revenue (platform) | 6 |
| 11 · support tickets | 8 |
| 12 · activity & logs | 4 |
| 13 · API keys, scopes & embed | 10 |
| 14 · feature flags & security | 6 |
| 15 · reports / analytics | 8 |
| cross-cutting preferences | 4 |
| **total** | **118** |

---

## d. Model / migration gaps

All new models use `UUIDPrimaryKeyMixin` + `TimestampMixin` unless stated, `String(36)` FKs, money in integer cents, `StrEnum` values persisted as `String(n)`, and must be registered in `app/models/__init__.py`. One Alembic revision per group below keeps the chain reviewable; each must be **safe on a fresh database** (the existing `605d934` / `938dbae` revisions carry defensive inspector checks — follow that pattern).

### d.1 Columns added to existing tables

`organizations` (`app/models/organization.py`) — for ORG-1, ORG-4, ORG-9, BIL-6, API-9:
```
slug                  String(80)  unique, nullable=False (backfill from name)
region                String(40)  nullable
company_size          String(30)  nullable
seats_licensed        Integer     nullable=False default 0
accent_color          String(9)   nullable
logo_url              String(1024) nullable
owner_user_id         String(36)  FK users.id nullable
suspended_at          DateTime(tz) nullable
suspension_reason     String(255) nullable
autopay               Boolean     nullable=False default True
billing_email         String(320) nullable
tax_id                String(60)  nullable
billing_cycle         String(20)  nullable=False default "monthly"
default_payment_method_id String(36) nullable
allowed_origins       JSON        nullable   # embed origin allow-list
default_return_url    String(1024) nullable
live_mode_enabled     Boolean     nullable=False default True
```

`users` — for AUTH-3/5/9, PREF-1, Platform users grid:
```
mfa_method            String(20)  nullable       # "totp" | "sms" | null
mfa_secret            EncryptedString(255) nullable
mfa_enrolled_at       DateTime(tz) nullable
mfa_recovery_codes    JSON        nullable       # hashed
last_active_at        DateTime(tz) nullable
locale                String(20)  nullable
timezone              String(60)  nullable
avatar_url            String(1024) nullable
status                String(20)  nullable=False default "active"  # active|invited|deprovisioned
preferences           JSON        nullable
```

`documents` — for DOC-1…DOC-8, TPL-1/TPL-4:
```
owner_user_id         String(36)  FK users.id nullable   # distinct from sender_id after reassignment
folder_id             String(36)  FK folders.id nullable, index
source_template_id    String(36)  FK documents.id nullable, index
doc_type              String(30)  nullable        # agreement|nda|order|hr
archived_at           DateTime(tz) nullable, index
deleted_at            DateTime(tz) nullable, index  # soft delete / trash
reminder_cadence      String(10)  nullable=False default "48h"
expires_in_days       Integer     nullable=False default 14
invite_subject        String(255) nullable
invite_message        Text        nullable
+ Index("ix_documents_org_deleted_status", "organization_id", "deleted_at", "status")
```

`fields` — for FLD-1/FLD-2:
```
validation            String(20)  nullable=False default "none"
validation_pattern    String(255) nullable
condition             JSON        nullable        # {field_id, op, value}
merge_tag             String(120) nullable
read_only             Boolean     nullable=False default False   # is_locked stays for post-send locking
# FieldType enum gains: stamp, attachment, formula, datetime
```

`recipients` — for RTE-3:
```
role                  String(20)  nullable=False default "sign"   # sign|approve|copy|inperson
color                 String(9)   nullable
contact_id            String(36)  FK contacts.id nullable, index
```

`support_tickets` — for SUP-1/2/4:
```
document_id           String(36)  FK documents.id nullable
tags                  JSON        nullable
sla_due_at            DateTime(tz) nullable
requester_name        String(255) nullable
requester_email       String(320) nullable
# TicketStatus enum gains: escalated
```

`ticket_messages` — for SUP-3: `is_internal Boolean nullable=False default False`.

`invoices` — for BIL-9/BIL-12: `payment_method_label String(80) nullable`, `period_label String(30) nullable`, `provider_payment_intent_id String(255) nullable`.

`plans` — for BIL-1: `tag String(60) nullable`, `marketing_lines JSON nullable`, `seat_price_cents Integer nullable`, `is_seat_based Boolean default False`.

`billing_webhook_events` — for REV-5: `status_code Integer nullable`, `processed Boolean nullable=False default False`, `error Text nullable`.

`UsageEventType` — for BIL-11: add `api_call`, `sms_sent`.

### d.2 New tables

```python
# app/models/contact.py                                  (CNT-1…CNT-8)
class Contact(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_organization_id", "organization_id"),
        Index("uq_contacts_org_email", "organization_id", "email", unique=True),
        Index("ix_contacts_group", "group_key"),
    )
    organization_id: str   = FK("organizations.id"), not null
    name: str              = String(255), not null
    email: str             = String(320), not null
    company: str | None    = String(255)
    title: str | None      = String(120)
    phone: str | None      = String(30)
    default_role: str      = String(20), not null, default "sign"
    group_key: str         = String(40), not null, default "customers"
    source: str            = String(20), not null, default "manual"   # crm|scim|api|manual
    tags: list | None      = JSON
    color: str | None      = String(9)
    last_signed_at: datetime | None = DateTime(tz)
    external_id: str | None = String(255)          # host-CRM link
    created_by_user_id: str | None = FK("users.id")

class ContactGroup(Base, UUIDPrimaryKeyMixin, TimestampMixin):   # CNT-7
    __tablename__ = "contact_groups"
    __table_args__ = (Index("uq_contact_groups_org_key", "organization_id", "key", unique=True),)
    organization_id, key: String(40), label: String(80), sort_order: Integer
```
`envelope_count` is **derived**, not stored: `COUNT(recipients WHERE email = contact.email AND document.organization_id = …)`.

```python
# app/models/folder.py                                   (DOC-6, DOC-11)
class Folder(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "folders"
    organization_id (FK, index), name String(120), parent_id (FK folders.id, nullable),
    team_id (FK teams.id, nullable), created_by_user_id (FK users.id), sort_order Integer

# app/models/document_favorite.py                        (DOC-7)
class DocumentFavorite(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "document_favorites"
    __table_args__ = (Index("uq_document_favorites", "user_id", "document_id", unique=True),)
    user_id (FK users.id), document_id (FK documents.id), created_at

# app/models/team.py                                     (ORG-8)
class Team(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "teams"
    organization_id (FK, index), name String(120), description String(255) nullable
class TeamMember(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "team_members"
    __table_args__ = (Index("uq_team_members", "team_id", "user_id", unique=True),)
    team_id (FK teams.id), user_id (FK users.id), role String(20) default "member", created_at

# app/models/api_key.py                                  (API-1…API-6, API-10)
class ApiKey(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "api_keys"
    __table_args__ = (Index("ix_api_keys_organization_id", "organization_id"),
                      Index("ix_api_keys_key_hash", "key_hash", unique=True))
    organization_id (FK, not null), label String(120) not null,
    mode String(10) not null default "test",          # live|test
    prefix String(16) not null,                       # "sk_live_9f2b" — what the UI masks around
    key_hash String(64) not null,                     # sha256 of the full secret; the secret is never stored
    scopes JSON not null default list,
    created_by_user_id (FK users.id, nullable),
    last_used_at DateTime(tz) nullable,
    revoked_at   DateTime(tz) nullable

# app/models/embed_session.py                            (API-7)
class EmbedSession(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "embed_sessions"
    __table_args__ = (Index("ix_embed_sessions_token_hash", "token_hash", unique=True),
                      Index("ix_embed_sessions_organization_id", "organization_id"))
    organization_id (FK), document_id (FK documents.id, nullable), token_hash String(64) unique,
    landing String(20), external_id String(255) nullable, return_url String(1024) nullable,
    allowed_origins JSON nullable, contact_ids JSON nullable,
    expires_at DateTime(tz) not null, consumed_at DateTime(tz) nullable, created_at

# app/models/feature_flag.py                             (FLG-1…FLG-4)
class FeatureFlag(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "feature_flags"
    key String(120) unique not null, description String(500), environment String(20) default "prod",
    enabled Boolean default False, rollout_pct Integer default 0,
    updated_by_user_id (FK users.id, nullable)
class FeatureFlagOverride(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "feature_flag_overrides"
    __table_args__ = (Index("uq_flag_override", "flag_id", "organization_id", unique=True),)
    flag_id (FK feature_flags.id), organization_id (FK organizations.id), enabled Boolean

# app/models/platform_setting.py                         (FLG-5, FLG-6)
class SecurityPosture(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "security_posture"
    key String(40) unique,       # sso|scim|ipAllow|residency|keyRotation|dlp
    label String(160), detail String(255), enabled Boolean default False,
    updated_by_user_id (FK users.id, nullable)
class Certification(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "certifications"
    name String(80) unique, status String(20) default "certified", sort_order Integer

# app/models/payment_method.py                           (BIL-2, BIL-3)
class PaymentMethod(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "payment_methods"
    __table_args__ = (Index("ix_payment_methods_organization_id", "organization_id"),)
    organization_id (FK), type String(20),            # card|ach|sepa|invoice
    brand String(30) nullable, last4 String(4) nullable,
    exp_month Integer nullable, exp_year Integer nullable,
    holder_name String(255) nullable, country String(2) nullable,
    label String(120), meta String(255) nullable,
    provider String(50) nullable, provider_payment_method_id String(255) nullable,
    is_default Boolean default False
# No PAN, CVC or full account number is ever persisted — provider token only.

# app/models/charge.py                                   (BIL-5)
class Charge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "charges"
    __table_args__ = (Index("ix_charges_organization_id", "organization_id"),)
    organization_id (FK), invoice_id (FK invoices.id, nullable),
    amount_cents Integer, currency String(3) default "USD",
    status String(20),                                # succeeded|recovered|failed
    provider String(50) nullable, provider_payment_id String(255) nullable,
    method_label String(80) nullable, decline_code String(60) nullable,
    dunning_step Integer nullable, next_attempt_at DateTime(tz) nullable,
    description String(255) nullable, occurred_at DateTime(tz) not null

# app/models/system_log.py                               (ACT-1, ACT-2)
class SystemLog(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "system_logs"
    __table_args__ = (Index("ix_system_logs_occurred_at", "occurred_at"),
                      Index("ix_system_logs_org_source_level", "organization_id", "source", "level"))
    organization_id (FK organizations.id, nullable),   # null for platform-only events
    occurred_at DateTime(tz) default now_utc, level String(10), source String(20),
    message String(1024), status_code Integer nullable, latency_ms Integer nullable,
    request_id String(64) nullable, actor_email String(320) nullable,
    ip_address String(80) nullable, payload JSON nullable
# Written by RequestLoggingMiddleware (app/core/logging.py) + webhook/billing/signing services.
# Needs a retention job: DELETE WHERE occurred_at < now() - retention_days.

# app/models/platform_audit.py                           (ACT-3)
class PlatformAuditEntry(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "platform_audit_entries"
    action String(80), actor_user_id (FK users.id, nullable), actor_email String(320),
    organization_id (FK, nullable), detail String(512), ip_address String(80) nullable,
    entry_metadata ("metadata", JSON) nullable, created_at

# app/models/impersonation.py                            (ORG-7)
class ImpersonationSession(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "impersonation_sessions"
    admin_user_id (FK users.id), organization_id (FK organizations.id),
    justification String(255), scopes JSON, token_hash String(64) unique,
    expires_at DateTime(tz), ended_at DateTime(tz) nullable, created_at

# app/models/user_session.py                             (AUTH-1, AUTH-2, AUTH-9)
class UserSession(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "user_sessions"
    __table_args__ = (Index("ix_user_sessions_user_id", "user_id"),
                      Index("ix_user_sessions_refresh_hash", "refresh_token_hash", unique=True))
    user_id (FK users.id), refresh_token_hash String(64) unique,
    device String(120) nullable, browser String(80) nullable, os String(80) nullable,
    ip_address String(80) nullable, location String(120) nullable,
    user_agent String(512) nullable, last_seen_at DateTime(tz),
    expires_at DateTime(tz), revoked_at DateTime(tz) nullable, created_at

# app/models/password_reset.py                           (AUTH-6, AUTH-7)
class PasswordResetToken(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "password_reset_tokens"
    user_id (FK users.id), token_hash String(64) unique, expires_at DateTime(tz),
    used_at DateTime(tz) nullable, created_at
# Mirror app/models/invitation.py exactly: hash only, single use, short TTL.

# app/models/saved_signature.py                          (SIGN-3)
class SavedSignature(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "saved_signatures"
    user_id (FK users.id, nullable), recipient_email String(320) nullable,
    label String(120), signature_type String(20),      # drawn|typed|uploaded
    signature_text String(255) nullable, type_face String(60) nullable,
    image_path String(1024) nullable, is_passkey_bound Boolean default False,
    adopted_at DateTime(tz)

# app/models/notification.py                             (ACT-4)
class Notification(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "read_at"),)
    user_id (FK users.id), organization_id (FK organizations.id),
    title String(255), detail String(512) nullable, tone String(10) default "info",
    screen String(40) nullable, target_id String(64) nullable,
    read_at DateTime(tz) nullable, created_at
class NotificationPreference(Base, UUIDPrimaryKeyMixin, TimestampMixin):   # PREF-2
    __tablename__ = "notification_preferences"
    __table_args__ = (Index("uq_notif_pref", "user_id", "event_key", unique=True),)
    user_id (FK users.id), event_key String(60), enabled Boolean default True

# app/models/integration.py                              (PREF-3, PREF-4)
class Integration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "integrations"
    __table_args__ = (Index("uq_integrations_org_provider", "organization_id", "provider", unique=True),)
    organization_id (FK), provider String(40), label String(80), detail String(255) nullable,
    connected Boolean default False, connected_at DateTime(tz) nullable,
    credentials EncryptedString(2048) nullable, config JSON nullable
class CloudTarget(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "cloud_targets"
    organization_id (FK), provider String(40), path String(512) nullable, enabled Boolean default False

# app/models/report.py                                   (RPT-6, RPT-8)
class CustomReport(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "custom_reports"
    organization_id (FK), created_by_user_id (FK users.id),
    name String(120), fields JSON, filters JSON nullable, group_by String(60) nullable
class ReportSchedule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "report_schedules"
    custom_report_id (FK custom_reports.id, nullable), report_key String(40) nullable,
    organization_id (FK), cadence String(20), format String(10) default "csv",
    recipients JSON, last_run_at DateTime(tz) nullable, next_run_at DateTime(tz) nullable
class ReportExport(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "report_exports"
    organization_id (FK), requested_by_user_id (FK users.id),
    report_key String(40), range_key String(10), format String(10),
    status String(20) default "pending", file_path String(1024) nullable, error Text nullable
```

### d.3 Suggested migration ordering

1. `xxxx_contacts_and_folders` — `contacts`, `contact_groups`, `folders`, `document_favorites`, `documents.folder_id/doc_type/archived_at/deleted_at/source_template_id/owner_user_id`, `recipients.contact_id/role/color`.
2. `xxxx_field_logic` — `fields.validation/validation_pattern/condition/merge_tag/read_only`, `FieldType` enum extension, `documents.reminder_cadence/expires_in_days/invite_subject/invite_message`.
3. `xxxx_auth_sessions` — `user_sessions`, `password_reset_tokens`, `users.mfa_*/status/last_active_at/locale/timezone/avatar_url/preferences`, `saved_signatures`.
4. `xxxx_api_platform` — `api_keys`, `embed_sessions`, `feature_flags`, `feature_flag_overrides`, `security_posture`, `certifications`, `impersonation_sessions`, `platform_audit_entries`, `organizations.allowed_origins/default_return_url/live_mode_enabled/slug/region/seats_licensed/…`.
5. `xxxx_billing_ops` — `payment_methods`, `charges`, `plans` marketing columns, `invoices` extras, `billing_webhook_events` extras, `organizations` billing settings, `UsageEventType` additions.
6. `xxxx_support_and_logs` — support/ticket columns + `escalated`, `system_logs`, `notifications`, `notification_preferences`, `integrations`, `cloud_targets`, `teams`, `team_members`.
7. `xxxx_reports` — `custom_reports`, `report_schedules`, `report_exports`.

**Enum caveat:** older models use SQLAlchemy `Enum` (native PG type) for `FieldType`, `DocumentStatus`, `RecipientStatus`, `UserRole`. Adding members needs `ALTER TYPE … ADD VALUE` on PostgreSQL (non-transactional — run it in its own migration step with `op.execute` and `autocommit_block`). `TicketStatus` is a plain `String(20)`, so `escalated` needs no DDL.

---

## e. Frontend wiring strategy

Objective: the ported UI stays **byte-identical**. Nothing in `components/sf/**` changes shape; only where the data comes from changes. Three mechanisms:

### e.1 A typed client — `frontend/lib/sf/api.ts`

Single module, no data-fetching library, mirrors the backend one-to-one:

```ts
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';   // '' → Next rewrite to the API
export class ApiError extends Error { constructor(public status: number, public detail: string) { super(detail); } }

let token: string | null = null;
export function setToken(t: string | null) { token = t; try { t ? localStorage.setItem('sf.token', t) : localStorage.removeItem('sf.token'); } catch {} }
export function loadToken() { try { token = localStorage.getItem('sf.token'); } catch {} return token; }

async function req<T>(method: string, path: string, body?: unknown, opts?: { form?: FormData }): Promise<T> { /* JSON, Bearer, 401 → setToken(null), throw ApiError(detail) */ }

/* one namespace per backend router, named exactly after the route function */
export const api = {
  auth:     { login, register, me, logout, refresh, mfaVerify, forgot, reset },
  org:      { me: getOrg, update: patchOrg, members, setMemberRole, overview },
  documents:{ list, create, get, update, remove, uploadPdf, send, void_, remind, finalPdf, templates, useTemplate, duplicate, makeTemplate, archive, move, favorite, pages },
  fields:   { list, create, update, remove, replaceAll },
  recipients:{ list, create, update, remove, resend, reorder, bulk },
  routing:  { get: getRouting, put: putRouting },
  audit:    { list: auditLogs, certificate },
  sign:     { session, viewed, value, signature, complete, decline, otpSend, otpVerify, consent, reassign },
  contacts: { list, create, get, update, remove, history, groups, import_ },
  templates:{ list, update, duplicate, usage },
  billing:  { plans, subscription, usage, checkout, changePlan, cancel, resume, settings, paymentMethods, upcoming, charges, seats },
  invoices: { list, get, pay, pdf, markPaid },
  support:  { tickets, ticket, create, reply, update, queue, agents, stats, quickReplies },
  activity: { list, platform },
  logs:     { list, platform, get },
  apiKeys:  { list, create, roll, revoke, scopes, usage, settings },
  embed:    { createSession },
  sandbox:  { execute },
  reports:  { overview, invites, documents: reportDocuments, templates: reportTemplates, recipients: reportRecipients, senders, export_, custom },
  saas:     { metrics, overview, organizations, updateOrganization, createOrganization, suspend, impersonate, users, setUserRole, revenue, dunning, balance, churn, billingEvents, health, invoices: saasInvoices, flags, setFlag, securityPosture, compliance, roles, audit: saasAudit, logs: saasLogs },
  notifications: { list, read },
  me:       { preferences, notificationPreferences, signatures, organizations, sessions, revokeSession },
  flags:    { resolved },
  teams:    { list, create, update, remove, addMember },
  folders:  { list, create, update, remove },
  integrations: { list, connect, disconnect, cloudTargets },
};
```
Types live in `frontend/lib/sf/apiTypes.ts`, generated from the OpenAPI schema (`GET /openapi.json` → `openapi-typescript`) and committed, so drift shows up as a TypeScript error rather than a runtime blank screen.

### e.2 Adapters — `frontend/lib/sf/adapters.ts`

The prototype shapes are the contract the UI is written against, so **never change `SFState` field names**; translate at the boundary instead. One pure function per shape, each fully typed and unit-testable:

```ts
toDoc(d: DocumentResponse): Doc                 // status: DocumentStatus → 'action'|'waiting'|'completed'|'draft'|'voided'
toRecipient(r: RecipientResponse, i: number): Recipient   // color from CONTACT_PALETTE[i % 7] if the server sends none
toField(f: FieldResponse): SFField              // full_name→'name'; x/y/width/height (Decimal strings) → numbers; condition→cond; merge_tag→merge; read_only→readOnly
toContact(c: ContactResponse): Contact
toTicket(t: TicketDetailResponse): Ticket       // reference→id, organization_name→tenant, sla_label→sla
toInvoice(i: InvoiceResponse): InvoiceRow       // cents→dollars, line_items→lines[[label, "$x"]], is_overdue→'past_due'
toLog(l: SystemLogResponse): LogRow             // occurred_at→ts 'HH:mm:ss.SSS', payload→JSON.stringify(_, null, 2)
toTenant(o: SaaSOrganizationResponse): Tenant
toApiKey(k: ApiKeyResponse): ApiKey             // masked→secret, full stays '' (see API-3 decision)
```
Status mapping table (documents), single source of truth in `adapters.ts`:
`draft|prepared → 'draft'`; `sent|viewed|partially_completed → 'waiting'` (or `'action'` when the current user is a pending recipient — the server should say so via a `needs_my_action` boolean on `DocumentResponse`, cheaper than guessing client-side); `completed → 'completed'`; `voided|declined|expired → 'voided'`.

### e.3 Hydration — `frontend/lib/sf/useHydrate.ts`

`SFProvider` gains an optional `hydrate` pass. It **overwrites only server-owned keys**; UI keys (`wide, screen, workspace, zoom, page, grid, selected, modal, toast, sigTab, …`) keep their `INITIAL_STATE` values.

```ts
export function useHydrateSF() {
  const { s, set } = useSF();
  // 1. boot: token → /api/auth/me + /api/organizations/me + /api/flags + /api/billing/subscription
  //    → set({ authed:true, user:{name,role}, org, workspace: me.is_platform_admin ? 'platform' : 'tenant' })
  // 2. per-screen effect, keyed on s.screen (+ its filter keys), so nothing loads until its screen mounts
  // 3. every fetch: set a *_loading flag, patch on success, flash(err.detail) on ApiError
}
```
Per-screen load matrix (fires on mount / filter change):

| screen | calls | patches |
|---|---|---|
| tenantHome | `org.overview`, `billing.subscription` | `orgOverview` |
| dashboard / library | `documents.list(filters)`, `templates.list`, `folders.list` | `docs, docCountsData, templatesData, folders` |
| builder | `documents.get`, `fields.list`, `recipients.list`, `routing.get` | `fields, recipients, routing, cadence, expiry, message` |
| routing | `recipients.list`, `routing.get` | same |
| sign | `sign.session(token)` | `signValues, fields, recipients` |
| audit | `audit.list(docId)`, `audit.certificate.summary` | `auditEntries, certRows` |
| contacts | `contacts.list(q,group)` | `contacts, contactCountsData` |
| reports | `reports.overview/invites/recipients/templates(range)` | `reportData` |
| billing | `billing.subscription/usage/settings/paymentMethods/upcoming/charges` | `autopay, billingEmail, taxId, cycle, defaultPm, billingData` |
| invoices | `invoices.list(filter)` (or `saas.invoices` when platform) | `invoicesData` |
| api | `apiKeys.list/scopes/usage`, `apiKeys.settings` | `apiKeys, scopes, embedOrigins, embedReturnUrl, apiStats` |
| sandbox | `sandbox.execute` on Send only | `sbResponse, sbHistory, sbSending` |
| support | `support.tickets\|queue(filter)`, `support.agents/stats/quickReplies` | `tickets, agents, ticketStats` |
| logs | `logs.list\|platform(source,level,q)` | `logsData` |
| platform | `saas.organizations(q)`, `saas.users`, `saas.flags`, `saas.securityPosture`, `saas.compliance`, `saas.roles` | `tenants, platformUsers, flagState, security, certifications, perms` |
| platformHome | `saas.overview`, `saas.revenue`, `saas.dunning`, `saas.health`, `saas.audit` | `platformOverview` |
| revenue | `saas.revenue`, `saas.balance`, `saas.churn`, `saas.billingEvents` | `revenueData` |
| guides | none | — |

Mutating screens call the API **then** patch state from the response (never optimistic-then-diverge), keeping `flash()` for the toast — which is what the prototype already does, so the call sites barely change:

```ts
// before
set(st => ({ contacts: [...st.contacts, made] })); flash('Contact created');
// after
const made = toContact(await api.contacts.create(payload));
set(st => ({ contacts: [...st.contacts, made] })); flash('Contact created');
```

### e.4 New state keys for server payloads

Rather than reshaping the screens, add read-only keys that default to the existing constants, so an un-hydrated render is pixel-identical to today:

```ts
docs: Doc[] | null            // null → fall back to DOCS
templatesData: Template[] | null
auditEntries: AuditRow[] | null
invoicesData: InvoiceRow[] | null
logsData: LogRow[] | null
tenants: Tenant[] | null
platformUsers: PlatformUser[] | null
agents / perms / certifications / folders / apiStats / reportData / billingData / revenueData / platformOverview / orgOverview: … | null
```
and change the existing selectors in `state.tsx` to read them with a fallback — a two-line edit each, no screen touched:

```ts
export function docsSource(s: SFState) { return s.docs ?? DOCS; }
export function docsFiltered(s: SFState) { /* …docsSource(s).filter(…) */ }
```
Same for `libDocsFiltered`, `invoicesScoped`, `logsScoped`, `templates()`, `auditEntries()`, `tenantsFiltered`, `recipsOf` (already `s.recipients || RECIPIENTS`, the pattern to copy everywhere).

### e.5 Which constants stay static vs become server data

**Stay static forever — pure UI metadata, copy, tone maps, nav:**
`TYPES` (geometry/icons; ids map to server enum), `STATUS`, `PLAN_TONE`, `STATUS_TONE`, `INV_STATUS_TONE`, `INV_STATUS_LABEL`, `TK_STATUS_TONE`, `TK_STATUS_LABEL`, `TK_PRIO_TONE`, `TK_PRIO_LABEL`, `FLAG_ENV_TONE`, `LEVEL_TONE`, `SRC_TONE`, `GROUP_LABELS` (labels only; membership is server data), `ROLE_LABEL`, `ROLE_WORDS`, `PERM_COLUMNS`, `DOC_FILTER_DEFS`, `LIB_FILTER_DEFS`, `LIB_SORT_OPTIONS`, `LIB_FOLDERS` (labels; counts server), `INVOICE_FILTERS`, `TICKET_FILTERS`, `LOG_SOURCES`, `LOG_LEVELS`, `PLATFORM_TABS`, `API_TABS`, `PALETTE_TABS`, `SIG_TABS`, `AUTH_TABS`, `AUTH_TITLES`, `AUTH_ROLES`, `ACCOUNT_NAV`, `ACCOUNT_TITLES`, `REPORT_NAV`, `REPORT_RANGES`, `DOC_NAV`, `DOCS_PAGES`, `API_DEFS`, `EMBED_SNIPPET`, `SB_PATH_OPTIONS`, `SB_LANG_TABS`, `SB_FALLBACK_RESPONSE`, `MODAL_COPY_STATIC`, `PAY_TITLES`, `TOUR`, `HELP_ITEMS`, `RAIL_DEFS_*`, `SCREEN_RAIL`, `FOLDER_STATUS_MAP`, `PAGE_THUMB_MENU`, `ROW_ACTIONS`, `DOC_ROW_ACTIONS`, `VALIDATION_REGEX_MAP`, `MERGE_SUGGESTIONS`, `TYPE_FACES`, `INKS`, `CADENCES`, `STRENGTH_COLORS`, `STRENGTH_WORDS`, `CONTACT_PALETTE`, `ACCENT_DEFAULT`, `BLANK_PNG`, `CUSTOM_REPORT_FIELDS`, `ALL_REPORT_CARDS`, `NEW_TICKET_SLA_NOTE`, `CERTIFICATIONS`* (*until FLG-6 lands).

**Must become server data:**
`DOCS`, `TEMPLATES`, `RECIPIENTS`, `AUDIT`, `CERT_ROWS`, `TENANTS`, `PLATFORM_USERS`, `INVOICES`, `LOGS`, `PLANS`, `PLAN_PRICES`, `USAGE_ROWS`, `PM_DEFS`, `UPCOMING_LINES`, `CHARGES`, `SUB_TILES_META`, `DASHBOARD_STATS`, `QUICK_ACCESS` counts, `TEAM_FOLDERS`, `ORG_STATS`, `ORG_SERIES`, `ORG_ATTENTION`, `ORG_SPEND_LINES`, `ORG_TEAM`, `MRR_SERIES`, `DUNNING`, `HEALTH`, `PLATFORM_STATS_META`, `PLATFORM_AUDIT`, `REVENUE_STATS`, `BALANCE_TILES`, `SUBS_BY_PLAN`, `CHURN_ROWS`, `STRIPE_WEBHOOKS`, `REPORT_TILES`, `REPORT_RECIPIENTS`, `INVITE_SPLIT`, `CT_HISTORY`, `AGENTS`, `SLA_MAP`, `TICKET_STATS_*`, `TICKET_QUICK_REPLIES_*`, `API_STATS_META`, `SANDBOX_RESPONSES`, `FLAG_META`, `SEC_DEFS`, `PERMS`, `DEVICES`, `NOTIF_PREFS`, `INTEGRATIONS`, `CLOUD_TARGETS`, `TEAMS`, `ORGS`, `INVITE_DEFAULTS`, `NOTIFICATIONS`, `ORG_OPTIONS`, `SAVED_SIGS`, and the seeded `contacts`, `tickets`, `apiKeys`, `scopes`, `flagState`, `security`, `fields` arrays inside `INITIAL_STATE`.

**Delete after wiring:** `docCounts()` in `data.ts` (duplicated in `state.tsx`; the server returns counts).

### e.6 Rollout order (keeps the app runnable at every step)

1. `api.ts` + `apiTypes.ts` + `adapters.ts`, auth boot (login/register/me/logout) — real session, everything else still mock.
2. Documents / fields / recipients / signing / audit — the core loop, all backed by endpoints that already exist.
3. Contacts (CNT-*) — highest-value gap; a whole screen currently has no server at all.
4. Support, invoices, activity/logs, billing read-only — existing endpoints + light extensions.
5. Reports, revenue, platform, API keys / embed / flags — the aggregate and platform surfaces.
6. Preferences, teams, integrations, cloud targets — last, lowest risk.

Add `NEXT_PUBLIC_API_BASE` to `frontend/.env.example`, and a `rewrites()` entry in `next.config` mapping `/api/*` to the backend origin, so the browser sees a same-origin API and `CORS_ORIGINS` stays a dev-only concern.

---

## f. Seed strategy

Goal: after `python scripts/seed.py`, the running app is **visually identical to the prototype** — same tenants, documents, contacts, tickets, invoices, flags, keys and logs. The prototype constants are the fixture spec.

### f.1 Structure

Extend `backend/scripts/seed.py` (today it only makes plans, one org, one admin) into an idempotent, ordered set of seeders under `backend/scripts/seed/`:

```
backend/scripts/seed/
  __init__.py        # run_all(db, *, demo: bool)
  fixtures.py        # the prototype data, transcribed 1:1 from frontend/lib/sf/data.ts + INITIAL_STATE
  core.py            # plans, platform admin, security posture, certifications, feature flags
  tenants.py         # 6 organizations + owners + users, subscriptions, seats
  contacts.py        # 7 contacts + 4 groups
  documents.py       # 8 documents + recipients + 9 fields + templates + folders
  audit.py           # audit_logs per document, system_logs, platform_audit_entries
  billing.py         # invoices + line items, payment methods, charges, usage events
  support.py         # 6 tickets + their messages (incl. internal notes)
  api.py             # api keys, scopes, embed session
```
`main()` keeps its current guard shape: everything upserts on a natural key (`organizations.slug`, `users.email`, `documents.title`+org, `invoices.number`, `support_tickets.reference`, `contacts.email`+org, `api_keys.prefix`, `feature_flags.key`) so re-running is safe. Gate the demo volume behind `SEED_DEMO=1` / `--demo` so production seeding stays plans + admin only.

### f.2 Fixture mapping, constant by constant

| prototype source | seeds into | notes |
|---|---|---|
| `TENANTS` (6) | `organizations` + one owner `users` row each + `subscriptions` | `slug, region, seats_licensed=seats`, `subscription_tier` from `plan` (`Enterprise→enterprise`, `Business→growth`, `Team→free`), `subscription_status` from `status` (`Active→active`, `Trial→trialing`, `Past due→past_due`, `Suspended→canceled` + `suspended_at`). `mrr` is **not** stored — it must fall out of `plans.price_cents × seats`, so set `seat_price_cents` on the plans (`12/28/44` USD) and let `/api/saas/revenue` compute it |
| `PLATFORM_USERS` (6) | `users` | `role`: `super→admin + is_platform_admin=True`, `orgadmin→admin`, `sender→sender`, `viewer→sender` (add a `viewer` member to `UserRole` if the read-only role must be real). `mfa`→`mfa_method`, `last`→`last_active_at` (relative → absolute at seed time) |
| `PLANS` + `PLAN_PRICES` + backend `DEFAULT_PLANS` | `plans` | Reconcile the two catalogues: keep codes `free/growth/enterprise`, set `name` to `Team/Business/Enterprise`, `tag`, `marketing_lines` from `PLANS[].lines`, `seat_price_cents` |
| `INITIAL_STATE.contacts` (7) | `contacts` | `source` `CRM/SCIM/API/Manual` → lower-case; `lastSigned` → `last_signed_at` (`'—'` → null); `color` verbatim |
| `GROUP_LABELS` (4) | `contact_groups` | `customers, internal, counsel, vendors` |
| `DOCS` (8) | `documents` (+ `recipients` from `to[]` via `RECIPIENTS`) | status reverse-map: `action→sent`, `waiting→sent`, `completed→completed`, `draft→draft`, `voided→voided`; `pages→page_count`; `updated` relative → `updated_at`; `signed/total` realised by setting that many recipients to `completed`. Owner = Acme org |
| `RECIPIENTS` (3) | `recipients` | `role sign/approve/copy` → `role` + `role_name`; `order→signing_order`; `status Viewed/Sent/Pending` → `viewed/sent/waiting`; `color` |
| `INITIAL_STATE.fields` (9) | `fields` on `ENV-2291-KD` | type map `name→full_name`, `stamp/datetime/…` need FLD-1 first; `x,y,w,h→x,y,width,height`; `cond→condition`, `merge→merge_tag`, `readOnly→read_only`, `validation` |
| `TEMPLATES` (7) | `documents{is_template:true}` | `uses` seeded by creating that many `source_template_id` children **or** (cheaper) a `use_count` column; `fields` count realised by seeding that many field rows; `owner`→`owner_user_id` |
| `AUDIT` (8) | `audit_logs` on `ENV-2291-KD` | `action→event_message`, derive `event_type` (`document_created, document_sent, document_viewed, consent_accepted, field_signed, field_completed, recipient_routed, document_completed`), `time`→`created_at` (2026 dates as given), parse `meta` into `ip_address`/`user_agent`/`log_metadata{geo,session,disclosure_version}`, `checksum` verbatim |
| `CERT_ROWS` | derived, not seeded | comes from `documents.final_sha256`, `completed_at`, and static algorithm/CA strings in the certificate service |
| `INVOICES` (7) | `invoices` (+ `charges`) | `total/sub/tax` × 100 → cents; `lines[[label,"$x"]]` → `line_items[{description, amount_cents}]`; `status past_due` → `open` + `due_at` in the past; `void→void`; `pi`→`provider_payment_intent_id`; `method`→`payment_method_label`; `period`→`period_label` + `period_start/end` |
| `CHARGES` (4) | `charges` | `Succeeded→succeeded`, `Recovered→recovered` |
| `PM_DEFS` (2) | `payment_methods` on Acme | `pm_visa` default; no real tokens — `provider="null"`, synthetic `provider_payment_method_id` |
| `USAGE_ROWS` | `usage_events` | Emit enough `document_sent` / `api_call` / `storage_bytes_added` / `sms_sent` events for the current period that `/api/billing/usage` reports ≈74% / 41% / 58% / 23%. Seed as a few aggregate rows with large `quantity`, not 38,912 rows |
| `INITIAL_STATE.tickets` (6) | `support_tickets` + `ticket_messages` | `id→reference`, `slug`→org, `tenant` derived, `status escalated` needs SUP-1, `assignee ag*`→`assignee_user_id` (seed the 3 named agents as platform-admin users; `ag1 Unassigned`→null), `envelope`→`document_id`, `tags`, `sla`→`sla_due_at` back-computed, `internal:true` messages → `is_internal` |
| `AGENTS` (4) | `users{is_platform_admin:true}` | Marco Diaz / Amelia Chen / Ravi Patel |
| `LOGS` (12) | `system_logs` | `ts` (time only) → today's date + that time; `level`, `source`, `slug`→org (`platform`→null), `msg`, `code`→`status_code` (`'—'`→null), `latency`→`latency_ms` (`'30s'`→30000), `payload` → parsed JSON |
| `PLATFORM_AUDIT` (5) | `platform_audit_entries` | `[action, detail]` → `action`, `detail`, `actor_email` parsed out of the detail string |
| `FLAG_META` + `flagState` (5) | `feature_flags` | `key`, `description`, `environment`, `enabled`, `rollout_pct` |
| `SEC_DEFS` + `security` (6) | `security_posture` | `[key,label,detail]` + the boolean |
| `CERTIFICATIONS` (8) | `certifications` | `FedRAMP (in process)` → `status:"in_process"` |
| `INITIAL_STATE.apiKeys` (3) + `scopes` | `api_keys` | Seed `prefix` + `key_hash = sha256(full)` using the fixture `full` values so a developer can actually call the API with `sk_test_41ab…`; `k3` gets `revoked_at`. Scopes from the `scopes` map (`audit:read` false → omitted) |
| `embedOrigins`, `embedReturnUrl` | `organizations.allowed_origins`, `default_return_url` | Acme |
| `NOTIFICATIONS` (5) | `notifications` for the demo admin | tone `good/info/bad` |
| `NOTIF_PREFS` (8) | `notification_preferences` | label → stable `event_key` |
| `INTEGRATIONS` (8), `CLOUD_TARGETS` (4) | `integrations`, `cloud_targets` | `connected` flag only; no credentials |
| `TEAMS` (3) + `TEAM_FOLDERS` (3) | `teams`, `team_members`, `folders` | Global Legal / Sales — Americas / Procurement |
| `ORGS` (2) | second organization `acme-eu` + membership | needs ORG-3's multi-org membership; until then seed it as a sibling org the admin also owns |
| `INVITE_DEFAULTS` (5) | `organizations.invite_*` / routing defaults | subject/message templates verbatim |
| `SAVED_SIGS` (2) | `saved_signatures` for `alex.rivera@acme.io` | `Caveat` / `Great Vibes` faces, one passkey-bound |
| `DEVICES` (3) | `user_sessions` | for the demo admin; the third is “this device” — mark it current at login instead of seeding it |
| `REPORT_RECIPIENTS`, `REPORT_TILES`, `INVITE_SPLIT`, `ORG_*`, `MRR_SERIES`, `DASHBOARD_STATS`, `REVENUE_STATS`, `BALANCE_TILES`, `SUBS_BY_PLAN`, `CHURN_ROWS`, `HEALTH`, `DUNNING`, `STRIPE_WEBHOOKS`, `PLATFORM_STATS_META`, `API_STATS_META`, `TICKET_STATS_*`, `CT_HISTORY`, `USAGE_ROWS` | **not seeded directly** | These are *aggregates*. Seed the underlying rows (documents, recipients, usage events, invoices, charges, subscriptions, logs) and let the report/revenue endpoints compute them. Where a number cannot be derived from any row (uptime, incidents, CSAT, p95 latency, payout balance), seed a small `platform_metrics` key/value table or return a documented constant from the service — do not fake it in the frontend |

### f.3 Login accounts after seeding

| email | password | role | lands on |
|---|---|---|---|
| `jordan.mehta@signforge.com` | `password123` | platform admin | `platformHome` |
| `priya@acme.io` | `password123` | Acme org admin | `tenantHome` |
| `m.bell@acme.io` | `password123` | Acme sender | `tenantHome` |
| `dana@northwind-legal.com` | `password123` | Northwind org admin | `tenantHome` |
| `admin@signflow.com` | `password123` | existing platform admin | preserved for backward compatibility |

`INITIAL_STATE.authEmail` is already `priya@acme.io`, so the prototype's prefilled sign-in form works against the seeded data with no UI change.

### f.4 Rules the seeder must respect

- Idempotent: upsert on natural keys; safe to run repeatedly and after each migration.
- Deterministic ids where the frontend fixtures reference them (`ENV-2291-KD`, `TPL-014`, `INV-2026-0841`, `SF-4471`, `ct1`, `f1`, `r1`) — store them in the natural-key columns (`reference`, `number`, `external_id`) and let the DB own the UUID `id`, rather than forcing prototype ids into `String(36)` primary keys.
- Dates: the prototype is set in Aug 2026. Seed **relative to `now_utc()`** (e.g. “12 min ago”, “Yesterday”) so the demo does not read as stale, but keep the fixed 2026 stamps for the audit trail and invoices where the exact strings appear in the design.
- PDFs: ship 2–3 small sample PDFs under `backend/scripts/seed/assets/` and run them through `document_service.upload_pdf` so `page_count`, `original_sha256` and storage paths are real. `page_count` must match the fixture (`DOCS[].pages`) for the builder's page rail to look right.
- No real secrets: SMTP/Twilio/provider credentials stay null; `BILLING_PROVIDER=null` keeps `billing_service` on the `NullPaymentProvider`.
- `SECRET_ENCRYPTION_KEY` must be set before seeding anything with an `EncryptedString` column (`verify_encryption_configured()` already enforces this at startup).
