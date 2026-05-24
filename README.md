# SignFlow CRM

Production-oriented MVP for real estate and mortgage e-signature workflows. The app includes a FastAPI backend, PostgreSQL data model, token-based signer access, PDF field placement with normalized PDF coordinates, secure final PDF generation, and a Next.js sender/signer interface.

---

## 🚀 Key Features

* **Multi-Party Parallel & Sequential Signing:** Highly flexible workflows for buyers, sellers, realtors, and loan officers.
* **UETA & ESIGN Regulatory Compliance:** Includes standard Electronic Record & Signature Disclosures preventing document viewing until consent is accepted.
* **Identity Verification Layer (OTP):** Security verification through email and SMS OTP generation, requiring validation before loading fields and downloading documents.
* **Interactive PDF View & Field Placement:** Drag-and-drop support for Signature, Initials, Date, Text, Checkboxes, Dropdowns, Currency, Numbers, and Radio Buttons.
* **Tamper-Evident Finalization:** Auto-locks documents upon completion, computes a final SHA-256 integrity hash, and appends a compliance Audit Certificate.
* **CRM Webhook & Workflow Integrations:** Simulates status triggers for attaching final files to contacts, advancing loan milestones to Underwriting, and updating realtor pipelines.

---

## 🛠️ Whole Workflow & System Mechanics

### 1. Document Preparation & Send
1. The sender (Realtor/Loan Officer) logs in, uploads a PDF document, and enters signer details.
2. Signers can be configured with **OTP Verification** enabled.
3. The sender prepares field overlays (signatures, checkboxes, text fields, currency fields) and clicks **Send**.
4. Unique secure signing tokens are generated, hashed (SHA-256), and stored. Secure links are sent to the recipients.

### 2. Signer Authentication & Consent
1. The signer visits their unique secure link (`http://localhost:3000/sign/{token}`).
2. **If OTP is enabled**:
   * The signer is presented with an **Identity Verification** panel.
   * Clicking "Send Code" dispatches a 6-digit code (simulated in development by printing to the backend terminal).
   * Signer enters the code to authenticate, setting `otp_verified = True`.
3. The signer is presented with the **ESIGN & UETA Disclosure**.
4. Checking the box and clicking "Accept and Continue" sets `consent_accepted = True` and logs their IP, Browser User Agent, and timestamp to the compliance ledger.
5. The PDF viewer and fields are unlocked.

### 3. Signing & Finalization
1. The signer fills out their assigned fields.
2. Signature fields can be drawn or styled with distinct typography signatures.
3. Once all required fields are complete, the signer clicks **Finish signing**.
4. The system updates the recipient status to `completed` and logs the action.
5. **CRM Webhooks Triggered**:
   * Simulates back-office processing team tasks.
   * On final recipient completion, updates loan stages to **"Underwriting Review"** and advances realtor deals to **"Pending"**.
   * Saves the final locked PDF directly into the CRM Deal record.

---

## 📦 Run With Docker

### Standard Boot
```bash
docker compose up --build
```

### All-in-One Boot & Seed (Recommended)
Boot the environment in the background, run database migrations, and pre-load demo datasets in a single line:
```bash
docker compose up -d --build && docker compose exec backend alembic upgrade head && docker compose exec backend python scripts/seed.py
```

* **Frontend:** `http://localhost:3000`
* **Backend API:** `http://localhost:8000`
* **API Health check:** `http://localhost:8000/api/health`

*Note: In development, generated email links and OTP codes are printed directly to the backend terminal console for quick access.*

---

## ⚙️ Local Development Setup

### Local Backend

1. Navigate to the backend directory, create a virtual environment, and install dependencies:
   ```bash
   cd backend
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Run database migrations:
   **Local Setup:**
   ```bash
   alembic upgrade head
   ```
   **Docker Setup:**
   ```bash
   docker compose exec backend alembic upgrade head
   ```
3. Boot the development API server:
   ```bash
   uvicorn app.main:app --reload
   ```

### Local Frontend

1. Navigate to the frontend directory and install Node.js packages:
   ```bash
   cd frontend
   pnpm install # or npm install
   ```
2. Start the hot-reloading development server:
   ```bash
   pnpm dev # or npm run dev
   ```

### Seed Demo Data

Pre-load the database with configured test deals and workflows:

**Local Setup:**
```bash
cd backend
python scripts/seed.py
```

**Docker Setup:**
```bash
docker compose exec backend python scripts/seed.py
```

* **Demo Admin Email:** `admin@signflow.com`
* **Password:** `password123`

### Reset Database

If you need to wipe and reset the database schema and re-seed all default tables:

**Local Setup:**
```bash
cd backend
alembic downgrade base
alembic upgrade head
python scripts/seed.py
```

**Docker Setup:**
```bash
# Tears down volume, restarts database, migrates, and seeds:
docker compose down -v && docker compose up -d --build && docker compose exec backend alembic upgrade head && docker compose exec backend python scripts/seed.py
```

---

## 🧪 Running Tests

### Backend Test Suite (FastAPI, PyTest)
Executes unit, integration, permission, and compliance tests:

**Local Setup:**
```bash
cd backend
PYTHONPATH=. ./.venv/bin/pytest
```

**Docker Setup:**
```bash
docker compose exec backend pytest
```

### Frontend Test Suite (React, Vitest)
Executes component validation and coordinate transformation tests:

**Local Setup:**
```bash
cd frontend
pnpm test # or npm test
```

**Docker Setup:**
```bash
docker compose exec frontend pnpm test
```
