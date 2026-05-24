# 🤖 SignFlow CRM Agent Handoff Guide

Welcome, Agent! This guide serves as your immediate technical orientation for the **SignFlow CRM E-Signature platform**. Use it to quickly understand the architecture, verify the codebase, and proceed with updates.

---

## 🗺️ System Overview & Architecture

SignFlow CRM is a secure e-signature application designed for real estate and mortgage brokers.

```
                  ┌────────────────┐
                  │ Next.js Client │
                  └───────┬────────┘
                           │ (REST API & Settings UI)
                           ▼
                  ┌────────────────┐
                  │ FastAPI Server │
                  └─┬────────────┬─┘
                    │            │
                    ▼            ▼
             ┌──────────┐   ┌──────────────┐
             │ SQLite / │   │ Local File   │
             │ Postgres │   │ Storage (PDF)│
             └──────────┘   └──────────────┘
```

* **Backend (`/backend`)**: FastAPI, Python 3.12, SQLAlchemy 2.0 (UUIDs, enums, timezone-aware UTC timestamps), Alembic migrations, PyTest.
* **Frontend (`/frontend`)**: Next.js 15, React, TypeScript, Tailwind CSS, Vitest.
* **Storage Abstraction**: Uses a local file storage helper designed for easy swap to S3 or Google Cloud Storage in production.
* **Multi-Tenant Gateway Support**: Both outgoing emails and verification SMS/OTP challenges read custom credentials from the tenant's `Organization` database record. If empty, the system falls back to default global settings, and finally prints to the terminal console.

---

## 🔐 Core Security & Compliance Flow

SignFlow implements a three-factor security framework to fulfill UETA and Federal ESIGN Act criteria:

1. **Token Hashing**: Public signing tokens are generated as high-entropy URL-safe random strings. Only their SHA-256 hashes are stored in the database.
2. **OTP Identity Verification**: If `otp_enabled = True` on a recipient:
   * The signer must request a 6-digit verification code (`POST /api/sign/{token}/otp/send`).
   * They must submit the code (`POST /api/sign/{token}/otp/verify`) to obtain `otp_verified = True`.
   * **Security Rule:** PDF URLs and assigned field values are withheld (empty) in `session_response` until OTP verification succeeds.
3. **UETA / ESIGN Consent**:
   * The signer must check the disclosure box and submit (`POST /api/sign/{token}/consent`).
   * Sets `consent_accepted = True` and writes an immutable audit record containing the signer's IP address, device user agent (fingerprint), and precise timestamp.
   * **Security Rule:** Field edits (`/value`, `/signature`) yield `403 Forbidden` until consent is confirmed.
4. **Tamper-Evident Hashing**: Generates an SHA-256 hash of the final PDF and prepended coordinates, locking them from modifications upon completion.

---

## ⚙️ Multi-Tenant Gateways (SMTP, Twilio & Telnyx)

Organizations manage their custom SMTP servers and SMS gateways directly via `/dashboard/settings`. 

### 1. Database Schema Extensions
* **Table `organizations`** contains configuration fields:
  * **SMTP Email:** `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password` (stored securely), and `smtp_from_email`.
  * **SMS Dispatch:** `sms_provider` (string `"twilio"` or `"telnyx"`), `twilio_account_sid`, `twilio_auth_token`, `twilio_from_number`, `telnyx_api_key`, and `telnyx_from_number`.

### 2. API Routes (`/api/organizations`)
* **`GET /api/organizations/me`**: Reads current settings. Filters out sensitive fields (`smtp_password`, `twilio_auth_token`, `telnyx_api_key`) to prevent leaking secrets.
* **`PATCH /api/organizations/me`**: Updates settings. Enforces **`admin` role-based protection**; other roles are blocked with `403 Forbidden`.

### 3. SMS Dual Gateway Delivery (`sms_service.py`)
Sends SMS using direct, zero-dependency REST requests:
* **Telnyx Mode:** If `sms_provider == "telnyx"`, maps coordinates to `POST https://api.telnyx.com/v2/messages` using `Authorization: Bearer <key>`.
* **Twilio Mode:** If `sms_provider == "twilio"`, maps to `POST https://api.twilio.com/2010-04-01/Accounts/...` using Basic Authentication.

---

## 🔄 CRM Milestone & Trigger Webhooks

The platform features a built-in `CRMIntegrationService` (`backend/app/services/crm_service.py`) that maps signing events into the mock CRM database:
* **`crm_internal_task_triggered`**: Dispatches task alerts for processing teams when individual signers complete.
* **`crm_document_attached`**: Auto-saves the finalized, locked PDF directly onto the CRM Deal record.
* **`crm_loan_milestone_updated`**: Advances mortgage processing pipelines automatically to **"Underwriting Review"**.
* **`crm_realtor_pipeline_updated`**: Shifts realtor transaction deal stages to **"Pending / Under Contract"**.

---

## 📂 Key Technical Files

Refer to these primary files when debugging, maintaining, or expanding the application:

* **Backend Models & Schemas**:
  * `backend/app/models/organization.py`: Schema columns holding multi-tenant gateway configurations.
  * `backend/app/schemas/organization.py`: Pydantic validation schemas.
  * `backend/app/models/recipient.py`: Recipient columns for OTP credentials and ESIGN consent records.
* **Backend Services**:
  * `backend/app/core/email.py`: Dynamic SMTP client which respects custom tenant settings.
  * `backend/app/services/sms_service.py`: Double SMS client supporting Twilio & Telnyx REST.
  * `backend/app/services/signing_service.py`: Enforces OTP checkups, checks consent, and handles signer field updates.
* **Backend API Routes**:
  * `backend/app/api/routes/organizations.py`: Exposes secure REST endpoints `/me` for retrieving and patching settings.
* **Frontend Signer & Settings Engines**:
  * `frontend/app/dashboard/settings/page.tsx`: Premium Admin settings dashboard allowing credentials customization.
  * `frontend/components/pdf-editor/PdfPage.tsx`: Default sizes for standard and custom fields (including radio, currency, and dropdown).
  * `frontend/lib/types.ts`: TypeScript type definitions matching backend models.

---

## 🧪 Quick Command Cheat-Sheet

Ensure both test environments are green to maintain CI/CD integrity.

### 1. Boot Environment (Docker)
```bash
docker compose up --build
```

### 2. Verify Backend (FastAPI, PyTest)
```bash
cd backend
# Run test suite
PYTHONPATH=. ./.venv/bin/pytest
```

### 3. Verify Frontend (React, Vitest & Build)
```bash
cd frontend
# Run tests
pnpm test

# Check Next.js production build validation
npm run build
```

---

## 🔑 Default Global Credentials Fallback (.env)

If an organization has not configured its custom SMTP/SMS credentials, the backend will fall back to reading these global settings:

```bash
# To activate global SMS via Twilio:
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1555XXXXXXX

# To activate global Email via SMTP:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_username@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM_EMAIL=noreply@yourdomain.com

# OR to activate global Email via Resend:
RESEND_API_KEY=re_your_api_key
SMTP_FROM_EMAIL=onboarding@resend.dev
```
