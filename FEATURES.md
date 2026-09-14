# SignerPro — Feature List

A multi-tenant e-signature SaaS (FastAPI + PostgreSQL backend, Next.js frontend) with
document preparation, multi-party signing, compliance, billing, embedding, and a
platform-operator control plane.

---

## 1. Authentication & Identity

- Email/password registration and login with JWT access + refresh tokens (`/api/auth/*`).
- Session management: list active sessions, revoke one or all (`/auth/sessions`).
- Password reset by email token and in-app password change.
- Multi-factor authentication: MFA challenge/verify/enroll flow (`MfaChallenge` model).
- Passkeys / WebAuthn: register and authenticate with platform authenticators (`/api/passkeys`).
- SAML SSO per tenant: IdP-initiated and SP-initiated login, ACS endpoint, per-org connection
  config (`/api/sso`, `SsoConnection`).
- SCIM 2.0 user provisioning (`/scim/Users` CRUD + PATCH) with scoped SCIM tokens.
- Roles: `admin`, `sender`; plus platform-operator roles for the control plane.
- Support-staff impersonation of a tenant user, with an audited impersonation record.

## 2. Documents

- PDF upload, page management, and per-page replacement/append.
- Document lifecycle statuses: `draft → prepared → sent → viewed → partially_completed →
  completed`, plus `declined`, `expired`, `voided`.
- Actions: rename, duplicate, archive/unarchive, trash/restore, empty trash, move to folder,
  favorite, void, remind, bulk operations, bulk download.
- Folder tree with nested folders, move, and per-folder document counts.
- Document versioning (`original`, `prepared`, `final`) with retained artifacts.
- Original and final PDF download endpoints; final PDF generation on demand.
- Expiry sweep job that expires envelopes past their deadline.
- Document library and template catalogue views.

## 3. Templates

- Create a reusable template from any document, or promote a document to a template.
- Template duplicate, archive, restore, and usage tracking.
- "Use template" to spawn a new prepared document with fields and roles pre-placed.

## 4. Field Placement & Preparation

- Drag-and-drop field editor over the rendered PDF using normalized PDF coordinates.
- Field types: signature, initials, full name, date, datetime, text, email, phone, checkbox,
  dropdown, radio, title, company, address, currency, number, stamp, attachment.
- Sender annotations that are never recipient obligations: freehand `drawing` and `textbox`.
- Payment fields — a signer-facing amount collected during signing.
- Required/optional flags, per-recipient assignment, and field favorites saved per user.
- File-attachment fields with upload and retrieval on both sender and signer sides.

## 5. Recipients & Routing

- Recipient roles: `sign`, `approve`, `copy` (CC), `inperson`.
- Only signing roles gate completion; CC recipients are `notified` and never block routing.
- Parallel and sequential workflow types, with drag-to-reorder routing order.
- Bulk recipient add, per-recipient resend, and per-recipient signing-link copy from the
  audit trail.
- Recipient reassignment (delegate signing to someone else) from the signing page.
- Recipient statuses: waiting, sent, notified, viewed, completed, declined, expired.

## 6. Signing Experience

- Tokenized public signing links (SHA-256 hashed tokens, no login required).
- ESIGN/UETA electronic record & signature disclosure gate before the document is viewable.
- Identity verification via email/SMS OTP before fields unlock.
- Signature capture: drawn or typed (styled typography), with saved/reusable signatures and a
  default signature per user.
- Field value entry, attachment upload, decline-to-sign with reason, and finish-signing.
- Per-signer branding applied to the signing page.
- Signer-side payment collection with payment status refresh.

## 7. Payments (Signer-Facing)

- Stripe Connect onboarding per tenant, with account link, refresh, and a way back into
  unfinished onboarding.
- `PaymentRequest` with split modes: `single`, `equal`, `custom` allocations across recipients.
- `SignerPayment` lifecycle mirroring a Stripe PaymentIntent: requires_payment, processing,
  succeeded, failed, refunded.
- Refunds issued by the sender from the payments view.
- Multi-currency support via a currency service.

## 8. Compliance, Audit & Security

- Immutable audit log for every document, recipient, and signing action, with IP and user agent.
- Audit certificate appended to the finalized PDF; SHA-256 integrity hash on completion.
- Public document verification page (`/verify/{id}`) for third-party integrity checks.
- PAdES digital signing service for signed-PDF conformance.
- DLP scanning with recorded findings.
- GDPR-style right-to-erasure endpoint.
- Per-user audit trail of their own activity.
- System logs and platform audit log for operator actions.

## 9. Contacts / Lightweight CRM

- Contact records with groups, create/edit/delete, and per-contact signing history.
- CSV and structured import.
- "Add as recipients" to push contacts straight into an envelope.
- CRM integration service for pushing final documents and status changes outward.

## 10. Notifications & Email

- In-app notification center: read/unread, bulk actions, clear-read, delete.
- Per-user notification preferences.
- Transactional email service with an email log, plus SMS delivery for OTP and reminders.
- Local development email capture via Mailpit.

## 11. Branding

- Per-org branding themes: colors, logo upload/removal, multiple themes.
- Public brand/logo endpoints used by signing and embed surfaces.

## 12. Teams & Organizations

- Organization profile, settings, and an overview dashboard.
- Member directory with role changes.
- Teams with membership add/remove.
- Email invitations with accept flow and invitation revocation.

## 13. Billing & Subscriptions (Tenant-Facing)

- Plan catalogue, subscription state, and usage metering (`UsageEvent`).
- Stripe checkout, setup sessions, plan change with proration preview, cancel, resume.
- Seat management, saved payment methods with a default, upcoming invoice preview, charges.
- Entitlement enforcement gating features by plan.
- Invoice list, detail, pay, PDF, and receipt.

## 14. Developer Platform

- API keys with scopes, usage stats, roll, revoke, restore, and scope grant/revoke.
- Public REST API (`/whoami`, documents, audit logs, users, contacts).
- Webhooks: endpoint CRUD, event-type catalogue, secret rotation, delivery log, test send,
  and delivery replay.
- Sandbox environment with seed and reset.
- In-app API reference, guides, and request logs.

## 15. Embedding

- Embedded signing/sending sessions with scoped, revocable session tokens.
- Session listing, detail, and revoke; context and PDF resolution endpoints.
- `frame-ancestors` allowlist so tenants can control who may iframe the app.
- Standalone `/embed/[landing]` surface.

## 16. Reporting & Analytics

- Prebuilt reports: overview, documents, templates, recipients, senders, invites, fields.
- Custom report builder: create, edit, run, schedule, delete.
- CSV export per report plus async export jobs with download links.

## 17. Support Desk

- Tenant-side ticket creation, threads, and replies.
- Operator-side queue, agent assignment, escalation, quick replies, and queue statistics.

## 18. Platform / Operator Control Plane

- Tenant directory: list, create, inspect, suspend, resume.
- Per-tenant feature flags, read and write.
- Impersonation start/stop.
- Cross-tenant user directory and role management.
- Revenue: MRR/ARR, churn, balance, dunning, billing events with replay.
- SaaS metrics, organizations, and user administration.
- Platform invoices: list, mark paid, void, retry payment.
- Mail, logs, developer, and support operator consoles.

## 19. Account Settings

- Profile edit, avatar upload/removal.
- Saved signatures management.
- Notification preferences, field favorites, personal audit trail.
- Cloud storage integrations: connect/disconnect providers and pick cloud export targets.

## 20. Platform & Infrastructure

- Multi-tenant data isolation across every model.
- Feature flags per tenant and platform settings.
- Docker Compose for local development and production.
- Backend test suite covering signing, payments, billing enforcement, SSO, webhooks,
  contacts, org settings, platform admin, embed API keys, and field routing.
