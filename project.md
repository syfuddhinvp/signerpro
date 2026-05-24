Build a production-quality DocuSign-style e-signature web application for real estate and mortgage document workflows.

The application must allow a user to upload a PDF, place signer fields on the PDF, assign fields to different recipients/signers, send secure signing links, allow each signer to fill only their own fields, validate required fields, collect signatures, generate a final signed PDF, and maintain a complete audit trail.

Use this stack:

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- react-pdf or PDF.js for PDF rendering
- dnd-kit or react-draggable for draggable field placement
- Zustand or React Context for editor state

Backend:
- FastAPI
- Python 3.11+
- PostgreSQL
- SQLAlchemy 2.x
- Alembic migrations
- Pydantic schemas
- JWT authentication
- Secure token-based signer access
- Local file storage for development, but design storage abstraction so S3 can be added later

Email:
- For development, log email links to console
- Create an email service abstraction so SendGrid, Resend, Amazon SES, or SMTP can be added later

PDF processing:
- Store original uploaded PDF
- Store field coordinates in normalized PDF coordinates
- Generate final signed PDF after all required signers complete
- Burn signatures, dates, text fields, checkboxes, and other completed values into the final PDF
- Generate an audit certificate page and append it to the final PDF
- Create SHA-256 hashes for original PDF, field configuration, and final PDF

Important:
The system must not be broken or incomplete. Implement error handling, validation, database constraints, secure token logic, and clear API responses. Do not leave TODO placeholders for core features. If a feature is too large, implement the simplest working version instead of leaving it unfinished.

Application name:
SignFlow CRM

Primary use case:
Real estate agents, mortgage brokers, and CRM users can send contracts, disclosures, purchase agreements, buyer forms, seller forms, and mortgage documents for electronic signature.

Core user roles:
1. Admin
2. Sender
3. Signer

Admin and sender must log in.
Signer can access a document through a secure signing token link without creating an account.

Main entities:
- Organization
- User
- Document
- Recipient
- Field
- FieldValue
- Signature
- AuditLog
- DocumentVersion
- SigningToken

Document statuses:
- draft
- prepared
- sent
- viewed
- partially_completed
- completed
- declined
- expired
- voided

Recipient statuses:
- waiting
- sent
- viewed
- completed
- declined
- expired

Field types:
- signature
- initials
- full_name
- date
- text
- email
- phone
- checkbox
- dropdown
- title
- company
- address
- currency
- number
- radio

Minimum MVP field types that must work:
- signature
- full_name
- date
- text
- checkbox
- dropdown
- currency
- number
- radio

Signer workflow types:
1. Parallel signing:
   All recipients can sign at the same time.
2. Sequential signing:
   Recipients sign based on signing_order. Recipients with signing_order = 2 should only receive signing access after all recipients with signing_order = 1 are completed.

For MVP, implement both in backend logic, but frontend can default to parallel signing.

Security requirements:
- Authenticated users must use JWT access tokens.
- Signer links must use random secure tokens.
- Store only the hash of signer tokens in the database, never raw tokens.
- Signing token must expire.
- Signing token must be tied to one document and one recipient.
- Signer using a token must only edit fields assigned to that recipient.
- A completed recipient cannot edit fields again.
- A completed document cannot be edited.
- Original PDF should not be overwritten.
- Final signed PDF should be immutable after generation.
- Every meaningful action must create an audit log.
- Validate uploaded file type and size.
- Protect APIs from unauthorized document access.
- Avoid exposing internal database IDs when possible in public signer routes.

Audit log events:
- document_created
- document_uploaded
- field_added
- field_updated
- field_deleted
- recipient_added
- document_sent
- signer_email_sent
- document_viewed
- field_completed
- signature_added
- recipient_completed
- document_completed
- final_pdf_generated
- document_declined
- document_expired
- token_expired
- document_voided
- signer_otp_sent
- signer_otp_verified
- consent_accepted
- crm_internal_task_triggered
- crm_document_attached
- crm_loan_milestone_updated
- crm_realtor_pipeline_updated
- crm_notification_sent
- crm_reminder_sent

Audit logs must store:
- document_id
- recipient_id, nullable
- user_id, nullable
- event_type
- event_message
- ip_address
- user_agent
- metadata JSON
- created_at timestamp

Database schema:

organizations:
- id UUID primary key
- name string
- smtp_host string nullable
- smtp_port integer nullable
- smtp_username string nullable
- smtp_password string nullable
- smtp_from_email string nullable
- sms_provider string nullable
- twilio_account_sid string nullable
- twilio_auth_token string nullable
- twilio_from_number string nullable
- telnyx_api_key string nullable
- telnyx_from_number string nullable
- created_at
- updated_at

users:
- id UUID primary key
- organization_id foreign key
- name string
- email string unique
- password_hash string
- role enum: admin, sender
- created_at
- updated_at

documents:
- id UUID primary key
- organization_id foreign key
- sender_id foreign key users.id
- title string
- status enum
- workflow_type enum: parallel, sequential
- original_file_path string
- final_file_path string nullable
- original_sha256 string
- field_config_sha256 string nullable
- final_sha256 string nullable
- page_count integer
- sent_at nullable
- completed_at nullable
- expires_at nullable
- created_at
- updated_at

recipients:
- id UUID primary key
- document_id foreign key
- name string
- email string
- role_name string nullable
- signing_order integer default 1
- status enum
- viewed_at nullable
- completed_at nullable
- declined_at nullable
- decline_reason nullable
- phone_number string nullable
- otp_enabled boolean default false
- otp_code string nullable
- otp_expires_at timestamp nullable
- otp_verified boolean default false
- consent_accepted boolean default false
- consent_accepted_at timestamp nullable
- created_at
- updated_at

fields:
- id UUID primary key
- document_id foreign key
- recipient_id foreign key recipients.id
- type enum
- label string
- required boolean default true
- page_number integer
- x numeric
- y numeric
- width numeric
- height numeric
- placeholder string nullable
- default_value text nullable
- value text nullable
- options JSON nullable
- is_locked boolean default false
- created_at
- updated_at

signatures:
- id UUID primary key
- document_id foreign key
- recipient_id foreign key
- field_id foreign key fields.id
- signature_type enum: drawn, typed
- signature_text nullable
- signature_image_path nullable
- created_at

signing_tokens:
- id UUID primary key
- document_id foreign key
- recipient_id foreign key
- token_hash string unique
- expires_at timestamp
- used_at nullable
- revoked_at nullable
- created_at

document_versions:
- id UUID primary key
- document_id foreign key
- version_type enum: original, prepared, final
- file_path string
- sha256 string
- created_at

audit_logs:
- id UUID primary key
- document_id foreign key
- recipient_id nullable foreign key
- user_id nullable foreign key
- event_type string
- event_message text
- ip_address string nullable
- user_agent string nullable
- metadata JSON nullable
- created_at

Backend API routes:

Authentication:
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me

Documents:
POST /api/documents
GET /api/documents
GET /api/documents/{document_id}
PATCH /api/documents/{document_id}
DELETE /api/documents/{document_id}
POST /api/documents/{document_id}/upload-pdf
GET /api/documents/{document_id}/pdf
GET /api/documents/{document_id}/final-pdf

Recipients:
POST /api/documents/{document_id}/recipients
GET /api/documents/{document_id}/recipients
PATCH /api/documents/{document_id}/recipients/{recipient_id}
DELETE /api/documents/{document_id}/recipients/{recipient_id}

Fields:
POST /api/documents/{document_id}/fields
GET /api/documents/{document_id}/fields
PATCH /api/documents/{document_id}/fields/{field_id}
DELETE /api/documents/{document_id}/fields/{field_id}

Sending:
POST /api/documents/{document_id}/send
POST /api/documents/{document_id}/void
POST /api/documents/{document_id}/remind

Signer public routes:
- GET /api/sign/{token}
- POST /api/sign/{token}/viewed
- POST /api/sign/{token}/fields/{field_id}/value
- POST /api/sign/{token}/fields/{field_id}/signature
- POST /api/sign/{token}/complete
- POST /api/sign/{token}/decline
- POST /api/sign/{token}/otp/send
- POST /api/sign/{token}/otp/verify
- POST /api/sign/{token}/consent

Audit:
GET /api/documents/{document_id}/audit-logs

PDF:
POST /api/documents/{document_id}/generate-final-pdf

Frontend pages:

1. Login page
Route: /login
- Email/password login
- Store JWT securely
- Redirect to dashboard after login

2. Register page
Route: /register
- Create organization and admin user

3. Dashboard
Route: /dashboard
- Show document list
- Status badges
- Create new document button
- Search/filter by status
- Columns:
  - title
  - status
  - recipients completed
  - created date
  - last updated
  - actions

4. New document page
Route: /documents/new
- Enter document title
- Upload PDF
- Create document

5. Document preparation/editor page
Route: /documents/[id]/prepare
This is the most important page.

Layout:
- Left sidebar: field tools
- Center: PDF viewer with pages
- Right sidebar: recipients and selected field properties

Left field tools:
- Signature
- Full Name
- Date
- Text
- Checkbox

PDF editor behavior:
- Render PDF pages.
- Allow dragging fields from left sidebar onto PDF pages.
- Allow moving and resizing fields.
- Store each field with:
  - page_number
  - x
  - y
  - width
  - height
  - recipient_id
  - type
  - required
  - label
- Use displayed page size to calculate normalized PDF coordinates.
- Must handle zoom correctly.
- Must not store raw screen coordinates only.
- Must convert screen coordinates to PDF coordinates before saving.

Coordinate rules:
- Browser coordinate origin is top-left.
- PDF coordinate origin is bottom-left.
- When saving a field, convert:
  pdf_x = screen_x * scale_x
  pdf_y = pdf_page_height - ((screen_y + field_height) * scale_y)
  pdf_width = field_width * scale_x
  pdf_height = field_height * scale_y
- When displaying a saved field, convert back:
  screen_x = pdf_x / scale_x
  screen_y = (pdf_page_height - pdf_y - pdf_height) / scale_y
  screen_width = pdf_width / scale_x
  screen_height = pdf_height / scale_y

Recipient manager:
- Add recipient name/email
- Assign color per recipient
- Set signing_order
- Choose workflow_type parallel or sequential

Field property editor:
- Change label
- Change recipient
- Toggle required
- Delete field
- Edit placeholder/default value

Send button:
- Validate that document has at least one recipient.
- Validate that each recipient has at least one required field or signature field.
- Validate required field properties.
- Call send API.
- Show generated signing links in development mode.

6. Signer page
Route: /sign/[token]
This page does not require login.

Flow:
- Load signer session from token.
- Show document title.
- Show recipient name and email.
- Render PDF with fields overlay.
- Current signer can edit only assigned fields.
- Other signer fields are visible but locked or shown as pending.
- Required fields for current signer are highlighted.
- Provide “Next required field” button.
- Provide “Finish signing” button.

Signer field behavior:
- signature field:
  - allow typed signature
  - allow drawn signature using canvas
  - save signature value
- full_name:
  - auto-fill recipient name but allow editing if needed
- date:
  - default to current date
- text:
  - normal text input
- checkbox:
  - toggle checked/unchecked

Completion behavior:
- On finish, validate all required fields assigned to current recipient.
- Save all field values.
- Mark recipient completed.
- Create audit logs.
- If parallel workflow:
  - If all recipients completed, generate final PDF.
- If sequential workflow:
  - If all recipients in current signing_order completed, send next signing_order.
  - If all recipients completed, generate final PDF.
- Show completion screen.

7. Completion page
Route: /sign/[token]/completed
- Show success message
- If document is complete, allow download of final PDF if policy allows

8. Document detail page
Route: /documents/[id]
- Show document metadata
- Recipients and statuses
- Audit trail
- Download original PDF
- Download final PDF if completed
- Send reminders
- Void document

PDF generation requirements:
Implement a PDF service that:
1. Loads original PDF.
2. Loops through all completed fields.
3. Writes field values at exact PDF coordinates.
4. For signature:
   - If typed signature, render text in cursive-like font or normal italic if cursive unavailable.
   - If drawn signature, place image at field coordinates.
5. For full_name/text/email/phone/title/company/address:
   - Render text inside field box.
6. For date:
   - Render formatted date.
7. For checkbox:
   - Render checkmark if true.
8. Append audit certificate page with:
   - Document title
   - Document ID
   - Original hash
   - Final hash
   - Sender
   - Recipient list
   - Each recipient email
   - Viewed timestamp
   - Signed timestamp
   - IP address
   - User agent summary
   - Audit events timeline
9. Save final PDF to storage.
10. Save final hash.
11. Set document status to completed.
12. Lock all fields.

Important PDF coordinate requirement:
Fields are stored in PDF coordinates, not browser coordinates. This is required so final PDF rendering is accurate.

Backend validation rules:
- Cannot send document without PDF.
- Cannot send document without recipients.
- Cannot send document without fields.
- Cannot send document if any field has invalid page number or coordinates.
- Cannot edit fields after document is sent, unless document is returned to draft.
- Cannot edit completed document.
- Cannot complete signer if required fields assigned to signer are empty.
- Cannot generate final PDF until all required recipients completed.
- Cannot access signer route with expired, revoked, or invalid token.
- Cannot sign another recipient’s fields.
- Cannot reuse signing token after recipient completed, except for read-only view if allowed.

Recommended backend folder structure:

backend/
  app/
    main.py
    core/
      config.py
      security.py
      database.py
      storage.py
      email.py
      hashing.py
    models/
      organization.py
      user.py
      document.py
      recipient.py
      field.py
      signature.py
      signing_token.py
      audit_log.py
      document_version.py
    schemas/
      auth.py
      document.py
      recipient.py
      field.py
      signer.py
      audit.py
    api/
      deps.py
      routes/
        auth.py
        documents.py
        recipients.py
        fields.py
        signing.py
        audit.py
    services/
      auth_service.py
      document_service.py
      recipient_service.py
      field_service.py
      signing_service.py
      pdf_service.py
      audit_service.py
      email_service.py
      token_service.py
    migrations/
    tests/

Frontend folder structure:

frontend/
  app/
    login/
    register/
    dashboard/
    documents/
      new/
      [id]/
        page.tsx
        prepare/
    sign/
      [token]/
  components/
    ui/
    pdf-editor/
      PdfViewer.tsx
      PdfPage.tsx
      FieldOverlay.tsx
      DraggableField.tsx
      FieldToolbar.tsx
      FieldPropertiesPanel.tsx
      RecipientPanel.tsx
    signer/
      SigningPdfViewer.tsx
      SignerField.tsx
      SignatureModal.tsx
      RequiredFieldsNavigator.tsx
    documents/
      DocumentTable.tsx
      StatusBadge.tsx
  lib/
    api.ts
    auth.ts
    coordinateTransform.ts
    validators.ts
  stores/
    documentEditorStore.ts

Coordinate transform utility:
Create a reusable frontend utility:

toPdfCoordinates({
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  displayedPageWidth,
  displayedPageHeight,
  pdfPageWidth,
  pdfPageHeight
})

fromPdfCoordinates({
  pdfX,
  pdfY,
  pdfWidth,
  pdfHeight,
  displayedPageWidth,
  displayedPageHeight,
  pdfPageWidth,
  pdfPageHeight
})

Must include unit tests for coordinate conversion.

Backend services:

AuthService:
- register organization and user
- login
- hash password
- verify password
- create JWT

DocumentService:
- create document
- upload PDF
- calculate original PDF hash
- get page count and page sizes
- update document
- enforce document status rules

RecipientService:
- add/update/delete recipients
- manage signing order
- update recipient statuses

FieldService:
- create/update/delete fields
- validate coordinates
- validate page number
- enforce recipient ownership
- lock fields after send/completion

TokenService:
- generate secure random signing token
- hash token with SHA-256
- validate token
- expire/revoke token

SigningService:
- load signing session
- mark document viewed
- save field values
- save signatures
- validate required fields
- complete recipient
- trigger next signing order
- trigger final PDF generation
- create audit logs
- send OTP
- verify OTP
- accept consent

CRMIntegrationService:
- trigger signer completed workflows
- trigger document fully completed workflows
- trigger reminder notifications

PdfService:
- generate final signed PDF
- burn field values into PDF
- append audit certificate
- calculate final hash

AuditService:
- write audit events consistently
- never silently skip audit logs for important actions

EmailService:
- in development, print signing links to console
- later replace with SendGrid/Resend/SES

Frontend UX requirements:
- Clean, professional SaaS UI
- Real estate/mortgage friendly wording
- Use status badges
- Use loading states
- Use error toasts
- Use success toasts
- Prevent double submissions
- Disable buttons when actions are invalid
- Show clear validation errors
- Show signer progress:
  Example: “3 of 5 required fields completed”
- Show next required field button
- Highlight current signer’s fields
- Lock other recipients’ fields

Development environment:
Create docker-compose.yml with:
- PostgreSQL
- backend
- frontend

Environment variables:
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_MINUTES
APP_BASE_URL
UPLOAD_DIR
SIGNING_TOKEN_EXPIRE_DAYS
ENVIRONMENT

Seed data:
Create a seed script that:
- creates one organization
- creates one admin user
- creates one sample document record if possible
- creates demo recipients

Testing:
Add backend tests for:
- auth login/register
- document creation
- PDF upload validation
- recipient creation
- field creation
- signer token generation
- invalid token rejection
- signer cannot edit another signer’s field
- required field validation
- recipient completion
- final PDF generation trigger
- audit log creation

Add frontend tests or at least utility tests for:
- coordinate conversion
- required field validation
- signer field permission logic

Acceptance criteria:
The app is considered complete when this full flow works:

1. Admin registers and logs in.
2. Admin creates a document.
3. Admin uploads a PDF.
4. Admin adds two recipients:
   - Buyer
   - Seller
5. Admin places fields on PDF:
   - Buyer full name
   - Buyer signature
   - Buyer date
   - Seller full name
   - Seller signature
   - Seller date
6. Admin sends the document.
7. System generates secure signing links.
8. Buyer opens their link.
9. Buyer can only fill Buyer fields.
10. Buyer cannot edit Seller fields.
11. Buyer completes signing.
12. Seller opens their link.
13. Seller can only fill Seller fields.
14. Seller completes signing.
15. System detects all recipients completed.
16. System generates final signed PDF.
17. System appends audit certificate.
18. Admin can download final signed PDF.
19. Audit trail shows every major action.
20. Completed document cannot be edited.

Implementation priorities:
1. Data model and migrations
2. Authentication
3. Document upload
4. Recipient management
5. Field placement editor
6. Token-based signing
7. Field completion
8. Multi-signer permissions
9. Final PDF generation
10. Audit trail
11. UI polish

Do not implement:
- Payment billing
- Enterprise SSO
- Notary workflows
- Government ID verification
- DOCX editing
- Bulk sending
- Conditional logic
- Advanced template marketplace

But design the database and services so these can be added later.

Important quality rules:
- Do not hardcode business logic in UI only.
- Backend must enforce permissions.
- Frontend validation is helpful but backend validation is mandatory.
- Use transactions for send, complete signing, and final PDF generation.
- If final PDF generation fails, document should not be marked completed.
- Return clear error messages.
- Use consistent API response formats.
- Use enums for statuses and field types.
- Add database indexes for document_id, recipient_id, email, status, and token_hash.
- Use timezone-aware timestamps.
- Store dates in UTC.
- Use UUID primary keys.
- Never store raw signing tokens.
- Never allow editing a completed document.
- Never allow signer A to submit signer B’s field.
