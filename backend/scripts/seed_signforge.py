"""Seed the SignForge design dataset into a real database.

The frontend is a faithful port of the "SignForge" design prototype, whose demo
dataset lives verbatim in ``frontend/lib/sf/data.ts`` and ``frontend/lib/sf/state.tsx``.
This script writes that dataset as real rows so a fresh install renders the
design without any frontend mocks.

Two rules govern everything here:

* **Idempotent.** Every entity is upserted by a natural key (organization slug,
  user email, invoice number, ticket reference, flag key, document title within
  its organization, …). Running the seeder twice creates nothing new.
* **Relative time.** The prototype's literal dates are in 2026 because the design
  is set "now". Nothing here hardcodes a year: every timestamp is derived from
  ``datetime.now(UTC)``, so the seeded data always looks current.

Usage::

    python scripts/seed_signforge.py                  # uses DATABASE_URL
    python scripts/seed_signforge.py --reset          # clear seeded rows first
    python scripts/seed_signforge.py --database-url sqlite+pysqlite:///./sf.db

See ``README.md`` for the docker compose form.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))


# --------------------------------------------------------------------------
# Credentials. Printed at the end of a run; the only passwords the seeder sets.
# --------------------------------------------------------------------------

#: Every seeded human gets the same local-development password.
SEED_PASSWORD = "SignForge!2026"

#: Plaintext API keys, printed once. Only the SHA-256 hash is ever stored.
SEED_API_KEYS: dict[str, str] = {
    "Host app — production": "sk_seed_REDACTED_ROTATE_ME",
    "Host app — sandbox": "sk_seed_REDACTED_ROTATE_ME",
    "Zapier connector": "sk_seed_REDACTED_ROTATE_ME",
}

PLATFORM_ORG_SLUG = "signforge"
PLATFORM_ORG_NAME = "SignForge (internal)"
SUPER_ADMIN_EMAIL = "jordan.mehta@signforge.com"
PRIMARY_TENANT_SLUG = "acme"

#: Marks rows the seeder owns, so ``--reset`` can find them again.
SEED_MARKER = "signforge-seed"


# --------------------------------------------------------------------------
# The design dataset, transcribed from the prototype.
# --------------------------------------------------------------------------

# data.ts :: TENANTS. ``months_ago`` staggers subscription start dates so the
# revenue screen's trailing-12-month MRR series ramps instead of being flat.
TENANTS: list[dict[str, Any]] = [
    {
        "name": "Acme Corporation", "slug": "acme", "owner": "ops@acme.io",
        "owner_name": "Acme Operations", "plan": "enterprise", "seats": 1240,
        "used": 1102, "region": "us-east-1", "status": "Active", "mrr": 38400,
        "company_size": "501-5000", "months_ago": 26,
    },
    {
        "name": "Northwind Legal", "slug": "northwind-legal", "owner": "dana@northwind-legal.com",
        "owner_name": "Dana Whitfield", "plan": "enterprise", "seats": 320,
        "used": 287, "region": "eu-central-1", "status": "Active", "mrr": 11200,
        "company_size": "201-500", "months_ago": 19,
    },
    {
        "name": "Vertex Robotics", "slug": "vertex", "owner": "admin@vertex.dev",
        "owner_name": "Vertex Admin", "plan": "business", "seats": 180,
        "used": 96, "region": "us-west-2", "status": "Trial", "mrr": 2880,
        "company_size": "51-200", "months_ago": 0,
    },
    {
        "name": "Halden GmbH", "slug": "halden", "owner": "it@halden.de",
        "owner_name": "Tobias Krause", "plan": "business", "seats": 90,
        "used": 88, "region": "eu-central-1", "status": "Past due", "mrr": 1440,
        "company_size": "51-200", "months_ago": 8,
    },
    {
        "name": "Kestrel Health", "slug": "kestrel", "owner": "security@kestrel.health",
        "owner_name": "Kestrel Security Team", "plan": "enterprise", "seats": 640,
        "used": 512, "region": "us-east-1", "status": "Active", "mrr": 20480,
        "company_size": "501-5000", "months_ago": 5,
    },
    {
        "name": "Lumen Studio", "slug": "lumen", "owner": "hello@lumen.studio",
        "owner_name": "Lumen Studio", "plan": "team", "seats": 24,
        "used": 21, "region": "ap-southeast-2", "status": "Suspended", "mrr": 288,
        "company_size": "1-50", "months_ago": 11,
    },
]

# data.ts :: PLATFORM_USERS, plus the directory members the design's other
# screens name (ORG_TEAM, RECIPIENTS, tickets, REPORT_RECIPIENTS).
# role: "super" | "orgadmin" | "sender" | "viewer".
USERS: list[dict[str, Any]] = [
    {"name": "Jordan Mehta", "email": SUPER_ADMIN_EMAIL, "slug": PLATFORM_ORG_SLUG,
     "role": "super", "mfa": "passkey", "last_active_minutes": 2, "title": "Super admin"},
    {"name": "Priya Raman", "email": "priya@acme.io", "slug": "acme",
     "role": "orgadmin", "mfa": "totp", "last_active_minutes": 18, "title": "Head of Legal Ops"},
    {"name": "Jordan Mehta", "email": "jordan.mehta@northwind.com", "slug": "acme",
     "role": "orgadmin", "mfa": "passkey", "last_active_minutes": 2, "title": "Legal Ops · Admin"},
    {"name": "Marcus Bell", "email": "m.bell@acme.io", "slug": "acme",
     "role": "sender", "mfa": "totp", "last_active_minutes": 180, "title": "Finance Director"},
    {"name": "Alex Rivera", "email": "alex.rivera@acme.io", "slug": "acme",
     "role": "sender", "mfa": "totp", "last_active_minutes": 720, "title": "VP Operations"},
    {"name": "Acme Operations", "email": "ops@acme.io", "slug": "acme",
     "role": "orgadmin", "mfa": None, "last_active_minutes": 2880, "title": "Owner"},
    {"name": "Dana Whitfield", "email": "dana@northwind-legal.com", "slug": "northwind-legal",
     "role": "orgadmin", "mfa": "passkey", "last_active_minutes": 60, "title": "General Counsel"},
    {"name": "Vertex Admin", "email": "admin@vertex.dev", "slug": "vertex",
     "role": "orgadmin", "mfa": None, "last_active_minutes": 300, "title": "Owner"},
    {"name": "Sofia Lindqvist", "email": "sofia@vertex.dev", "slug": "vertex",
     "role": "sender", "mfa": None, "last_active_minutes": 1440, "title": "Procurement Lead"},
    {"name": "Tobias Krause", "email": "it@halden.de", "slug": "halden",
     "role": "viewer", "mfa": "totp", "last_active_minutes": 5760, "title": "IT Manager"},
    {"name": "Kestrel Security Team", "email": "security@kestrel.health", "slug": "kestrel",
     "role": "orgadmin", "mfa": "totp", "last_active_minutes": 240, "title": "Security"},
    {"name": "Elena Ruiz", "email": "elena.ruiz@kestrel.health", "slug": "kestrel",
     "role": "sender", "mfa": "totp", "last_active_minutes": 900, "title": "Compliance Officer"},
    {"name": "Lumen Studio", "email": "hello@lumen.studio", "slug": "lumen",
     "role": "orgadmin", "mfa": None, "last_active_minutes": 20160, "title": "Owner"},
    # Platform support agents (data.ts :: AGENTS).
    {"name": "Marco Diaz", "email": "marco.diaz@signforge.com", "slug": PLATFORM_ORG_SLUG,
     "role": "super", "mfa": "totp", "last_active_minutes": 30, "title": "Support engineer · Signing"},
    {"name": "Amelia Chen", "email": "amelia.chen@signforge.com", "slug": PLATFORM_ORG_SLUG,
     "role": "super", "mfa": "totp", "last_active_minutes": 45, "title": "Support engineer · Platform"},
    {"name": "Ravi Patel", "email": "ravi.patel@signforge.com", "slug": PLATFORM_ORG_SLUG,
     "role": "super", "mfa": "totp", "last_active_minutes": 90, "title": "Support engineer · Billing"},
]

# state.tsx :: INITIAL_STATE.contacts
CONTACTS: list[dict[str, Any]] = [
    {"name": "Alex Rivera", "email": "alex.rivera@acme.io", "company": "Acme Corporation",
     "title": "VP Operations", "phone": "+1 512 555 0142", "role": "sign", "group": "customers",
     "source": "CRM", "tags": ["MSA", "Renewal 2026"], "signed_days_ago": 14, "color": "#10b981"},
    {"name": "Dana Whitfield", "email": "dana@northwind-legal.com", "company": "Northwind Legal",
     "title": "General Counsel", "phone": "+1 206 555 0197", "role": "approve", "group": "counsel",
     "source": "Manual", "tags": ["Approver", "Legal"], "signed_days_ago": 2, "color": "#6366f1"},
    {"name": "Marcus Bell", "email": "m.bell@acme.io", "company": "Acme Corporation",
     "title": "Finance Director", "phone": "+1 512 555 0188", "role": "copy", "group": "internal",
     "source": "SCIM", "tags": ["CC only"], "signed_days_ago": None, "color": "#f59e0b"},
    {"name": "Priya Raman", "email": "priya@acme.io", "company": "Acme Corporation",
     "title": "Head of Legal Ops", "phone": "+1 512 555 0110", "role": "sign", "group": "internal",
     "source": "SCIM", "tags": ["Org admin"], "signed_days_ago": 6, "color": "#0ea5e9"},
    {"name": "Sofia Lindqvist", "email": "sofia@vertex.dev", "company": "Vertex Robotics",
     "title": "Procurement Lead", "phone": "+46 8 555 0121", "role": "sign", "group": "vendors",
     "source": "API", "tags": ["Vendor", "NDA"], "signed_days_ago": 17, "color": "#8b5cf6"},
    {"name": "Tobias Krause", "email": "it@halden.de", "company": "Halden GmbH",
     "title": "IT Manager", "phone": "+49 30 555 0173", "role": "sign", "group": "vendors",
     "source": "CRM", "tags": ["Reseller", "EU"], "signed_days_ago": 26, "color": "#f43f5e"},
    {"name": "Elena Ruiz", "email": "elena.ruiz@kestrel.health", "company": "Kestrel Health",
     "title": "Compliance Officer", "phone": "+1 415 555 0164", "role": "approve", "group": "customers",
     "source": "API", "tags": ["HIPAA", "Approver"], "signed_days_ago": 9, "color": "#14b8a6"},
]

# data.ts :: RECIPIENTS, keyed by the prototype's r1/r2/r3 handles.
PROTO_RECIPIENTS: dict[str, dict[str, Any]] = {
    "r1": {"name": "Alex Rivera", "email": "alex.rivera@acme.io", "role": "sign",
           "role_name": "Client", "color": "#10b981", "order": 1},
    "r2": {"name": "Dana Whitfield", "email": "dana@northwind-legal.com", "role": "approve",
           "role_name": "Approver", "color": "#6366f1", "order": 2},
    "r3": {"name": "Marcus Bell", "email": "m.bell@acme.io", "role": "copy",
           "role_name": "Receives a copy", "color": "#f59e0b", "order": 3},
}

# data.ts :: DOCS. ``updated`` is expressed as an age so the list always reads
# "12 min ago", "2 hours ago", … relative to the moment the seeder ran.
DOCS: list[dict[str, Any]] = [
    {"ref": "ENV-2291-KD", "title": "Master Services Agreement — Acme Corp", "pages": 3,
     "status": "action", "signed": 1, "total": 4, "age_minutes": 12, "to": ["r1", "r2"],
     # The builder layout (INITIAL_STATE.fields) places a field for r3 as well,
     # and Field.recipient_id is NOT NULL, so the copy-only recipient is real.
     "extra": ["r3"]},
    {"ref": "ENV-2287-QB", "title": "Mutual NDA — Vertex Robotics", "pages": 2,
     "status": "waiting", "signed": 2, "total": 3, "age_minutes": 120, "to": ["r2", "r3"]},
    {"ref": "ENV-2280-LM", "title": "Statement of Work #14 — Data Migration", "pages": 5,
     "status": "completed", "signed": 4, "total": 4, "age_minutes": 60 * 26, "to": ["r1", "r3"]},
    {"ref": "ENV-2276-JZ", "title": "Contractor Agreement — D. Whitfield", "pages": 4,
     "status": "action", "signed": 0, "total": 2, "age_minutes": 60 * 30, "to": ["r2"]},
    {"ref": "ENV-2271-TT", "title": "Order Form — Enterprise Tier Renewal", "pages": 2,
     "status": "draft", "signed": 0, "total": 3, "age_minutes": 60 * 24 * 3, "to": ["r1", "r2", "r3"]},
    {"ref": "ENV-2264-PW", "title": "Data Processing Addendum — EU", "pages": 6,
     "status": "waiting", "signed": 1, "total": 2, "age_minutes": 60 * 24 * 4, "to": ["r1"]},
    {"ref": "ENV-2251-AH", "title": "Reseller Agreement — Halden GmbH", "pages": 8,
     "status": "voided", "signed": 0, "total": 3, "age_minutes": 60 * 24 * 7, "to": ["r3"]},
    {"ref": "ENV-2244-NC", "title": "Employment Offer — Senior Engineer", "pages": 3,
     "status": "completed", "signed": 2, "total": 2, "age_minutes": 60 * 24 * 14, "to": ["r1", "r2"]},
]

#: design bucket -> DocumentStatus value.
DOC_STATUS_MAP: dict[str, str] = {
    "action": "sent",
    "waiting": "partially_completed",
    "completed": "completed",
    "draft": "draft",
    "voided": "voided",
}

# data.ts :: TEMPLATES
TEMPLATES: list[dict[str, Any]] = [
    {"title": "Master Services Agreement — standard", "uses": 128, "fields": 9,
     "updated_days_ago": 6, "owner": "priya@acme.io"},
    {"title": "Mutual NDA — bilateral", "uses": 342, "fields": 5,
     "updated_days_ago": 10, "owner": "dana@northwind-legal.com"},
    {"title": "Order Form — Enterprise tier", "uses": 96, "fields": 12,
     "updated_days_ago": 17, "owner": "priya@acme.io"},
    {"title": "Contractor Agreement — US", "uses": 57, "fields": 8,
     "updated_days_ago": 26, "owner": "jordan.mehta@northwind.com"},
    {"title": "Data Processing Addendum — EU", "uses": 41, "fields": 6,
     "updated_days_ago": 31, "owner": "dana@northwind-legal.com"},
    {"title": "Employment Offer — engineering", "uses": 23, "fields": 11,
     "updated_days_ago": 45, "owner": "m.bell@acme.io"},
    {"title": "W-9 Request", "uses": 210, "fields": 4,
     "updated_days_ago": 56, "owner": "m.bell@acme.io"},
]

# state.tsx :: INITIAL_STATE.fields — the builder layout for ENV-2291-KD.
# ``type`` uses the prototype's palette names; ``name`` maps to FieldType.full_name.
PROTO_FIELDS: list[dict[str, Any]] = [
    {"key": "f1", "page": 1, "type": "signature", "x": 96, "y": 600, "w": 200, "h": 56,
     "to": "r1", "required": True, "read_only": False, "label": "Client signature",
     "placeholder": "", "validation": "none", "cond": None, "merge": ""},
    {"key": "f2", "page": 1, "type": "date", "x": 328, "y": 600, "w": 152, "h": 40,
     "to": "r1", "required": True, "read_only": False, "label": "Date signed",
     "placeholder": "MM/DD/YYYY", "validation": "date", "cond": None, "merge": "{{contract.signedAt}}"},
    {"key": "f3", "page": 1, "type": "name", "x": 96, "y": 672, "w": 196, "h": 40,
     "to": "r1", "required": True, "read_only": False, "label": "Printed name",
     "placeholder": "Full legal name", "validation": "none", "cond": None, "merge": "{{client.name}}"},
    {"key": "f4", "page": 1, "type": "email", "x": 328, "y": 672, "w": 216, "h": 40,
     "to": "r1", "required": False, "read_only": False, "label": "Billing email",
     "placeholder": "name@company.com", "validation": "email", "cond": None, "merge": "{{client.email}}"},
    {"key": "f5", "page": 1, "type": "checkbox", "x": 96, "y": 744, "w": 32, "h": 32,
     "to": "r1", "required": True, "read_only": False, "label": "Accept terms",
     "placeholder": "", "validation": "none", "cond": None, "merge": ""},
    {"key": "f6", "page": 1, "type": "dropdown", "x": 328, "y": 744, "w": 196, "h": 40,
     "to": "r2", "required": False, "read_only": False, "label": "Payment terms",
     "placeholder": "", "validation": "none",
     "cond": {"field": "f5", "op": "checked", "value": ""}, "merge": "{{contract.terms}}"},
    {"key": "f7", "page": 1, "type": "initials", "x": 592, "y": 600, "w": 88, "h": 48,
     "to": "r2", "required": True, "read_only": False, "label": "Counsel initials",
     "placeholder": "", "validation": "none", "cond": None, "merge": ""},
    {"key": "f8", "page": 2, "type": "signature", "x": 120, "y": 520, "w": 200, "h": 56,
     "to": "r2", "required": True, "read_only": False, "label": "Approver signature",
     "placeholder": "", "validation": "none", "cond": None, "merge": ""},
    {"key": "f9", "page": 2, "type": "stamp", "x": 400, "y": 496, "w": 112, "h": 112,
     "to": "r3", "required": False, "read_only": True, "label": "Corporate seal",
     "placeholder": "", "validation": "none", "cond": None, "merge": ""},
]

#: prototype palette name -> FieldType value.
FIELD_TYPE_MAP: dict[str, str] = {
    "signature": "signature", "initials": "initials", "name": "full_name",
    "date": "date", "text": "text", "email": "email", "phone": "phone",
    "checkbox": "checkbox", "dropdown": "dropdown", "stamp": "stamp",
    "title": "title", "company": "company", "address": "address",
    "currency": "currency", "number": "number", "radio": "radio",
    "attachment": "attachment", "formula": "formula", "datetime": "datetime",
}

# data.ts :: AUDIT — the ENV-2291-KD trail. ``minutes_after`` is measured from
# the document's creation instant, preserving the design's 09:02 → 11:18 arc.
AUDIT: list[dict[str, Any]] = [
    {"event_type": "document_created", "message": "Document created",
     "actor": "jordan.mehta@northwind.com", "minutes_after": 0,
     "ip": "198.51.100.24", "ua": "Chrome 138 / macOS 15.4",
     "meta": {"location": "Seattle, US", "session": "8f2c…41ab"}},
    {"event_type": "document_sent", "message": "Envelope sent", "actor": None,
     "minutes_after": 1, "ip": None, "ua": None,
     "meta": {"relay": "SMTP relay eu-west-1", "recipients": 2, "routing": "sequential"}},
    {"event_type": "document_viewed", "message": "Document viewed",
     "actor": "alex.rivera@acme.io", "minutes_after": 39,
     "ip": "203.0.113.77", "ua": "Safari 18.2 / iOS 18.5",
     "meta": {"location": "Austin, US", "session": "1d77…90fe"}},
    {"event_type": "consent_accepted", "message": "Disclosure accepted",
     "actor": "alex.rivera@acme.io", "minutes_after": 39,
     "ip": "203.0.113.77", "ua": "Safari 18.2 / iOS 18.5",
     "meta": {"disclosure_version": "4.2", "consent": "ESIGN"}},
    {"event_type": "signature_added", "message": "Field signed — Client signature",
     "actor": "alex.rivera@acme.io", "minutes_after": 41,
     "ip": "203.0.113.77", "ua": "Safari 18.2 / iOS 18.5",
     "meta": {"capture": "drawn", "raster": "1120x360", "biometric": True}},
    {"event_type": "field_completed", "message": "Field completed — Date signed",
     "actor": "alex.rivera@acme.io", "minutes_after": 41,
     "ip": "203.0.113.77", "ua": "Safari 18.2 / iOS 18.5",
     "meta": {"validation": "date", "result": "passed"}},
    {"event_type": "signer_email_sent", "message": "Routed to approver", "actor": None,
     "minutes_after": 41, "ip": None, "ua": None,
     "meta": {"notified": "dana@northwind-legal.com", "reminder_cadence": "48h"}},
    {"event_type": "document_completed", "message": "Envelope completed", "actor": None,
     "minutes_after": 136, "ip": None, "ua": None,
     "meta": {"seal": "PDF sealed", "certificate": "generated", "tsa": "DigiCert TSA · UTC"}},
]

# data.ts :: LIB_FOLDERS / TEAM_FOLDERS
FOLDERS: list[str] = ["Agreements", "Renewals 2026", "HR", "Procurement", "Archive"]

# data.ts :: TEAMS
TEAMS: list[dict[str, Any]] = [
    {"name": "Global Legal", "description": "12 members · 214 documents · 7 templates",
     "members": [("jordan.mehta@northwind.com", "owner"), ("priya@acme.io", "admin")]},
    {"name": "Sales — Americas", "description": "34 members · 118 documents · 4 templates",
     "members": [("priya@acme.io", "admin"), ("alex.rivera@acme.io", "member")]},
    {"name": "Procurement", "description": "9 members · 46 documents · 2 templates",
     "members": [("m.bell@acme.io", "member")]},
]

# state.tsx :: INITIAL_STATE.tickets. ``created_hours_ago`` replaces the literal
# "28 Aug 09:12" stamps; message offsets are minutes after ticket creation.
TICKETS: list[dict[str, Any]] = [
    {
        "reference": "SF-4471", "slug": "acme",
        "subject": "Signer cannot apply drawn signature on iPad",
        "requester": "Priya Raman", "requester_email": "priya@acme.io",
        "category": "signing", "priority": "urgent", "status": "escalated",
        "assignee": "marco.diaz@signforge.com", "document_ref": "ENV-2291-KD",
        "created_hours_ago": 5, "sla_hours": 1, "tags": ["iPadOS 18.5", "Safari", "P1"],
        "messages": [
            {"author": "Priya Raman", "email": "priya@acme.io", "offset": 0,
             "staff": False, "internal": False,
             "body": "Two of our signers on iPad cannot complete the drawn signature — the canvas accepts strokes but “Adopt and sign” does nothing. Typed signature works. This is blocking the MSA renewal due today."},
            {"author": "Marco Diaz", "email": "marco.diaz@signforge.com", "offset": 14,
             "staff": True, "internal": False,
             "body": "Thanks Priya — reproduced on iPadOS 18.5 with Apple Pencil. The pointer capture is releasing early on stylus input. Escalating to the signing team and will send a workaround within the hour."},
            {"author": "Marco Diaz", "email": "marco.diaz@signforge.com", "offset": 16,
             "staff": True, "internal": True,
             "body": "Linked to SIGN-2210. Affects stylus pointerup only; touch and mouse unaffected. Flag signing.passkey_reuse not involved."},
            {"author": "Priya Raman", "email": "priya@acme.io", "offset": 29,
             "staff": False, "internal": False,
             "body": "Understood. Typed signature is acceptable as an interim path — please confirm it is legally equivalent for the audit trail."},
        ],
    },
    {
        "reference": "SF-4468", "slug": "halden",
        "subject": "Webhook endpoint returning 502 for invoice.payment_failed",
        "requester": "Tobias Krause", "requester_email": "it@halden.de",
        "category": "api", "priority": "high", "status": "pending",
        "assignee": "amelia.chen@signforge.com", "document_ref": None,
        "created_hours_ago": 22, "sla_hours": 4, "tags": ["webhooks", "502"],
        "messages": [
            {"author": "Tobias Krause", "email": "it@halden.de", "offset": 0,
             "staff": False, "internal": False,
             "body": "We stopped receiving billing webhooks last week. Our endpoint is up — can you confirm what SignForge is seeing?"},
            {"author": "Amelia Chen", "email": "amelia.chen@signforge.com", "offset": 44,
             "staff": True, "internal": False,
             "body": "Our delivery log shows four attempts to https://halden.de/hooks/sf all returning 502 with a 30s timeout. Could you check the reverse proxy body-size limit? Our payloads can exceed 64 KB."},
        ],
    },
    {
        "reference": "SF-4462", "slug": "kestrel",
        "subject": "Request: bulk send from CSV for 4,000 contractors",
        "requester": "Security Team", "requester_email": "security@kestrel.health",
        "category": "api", "priority": "normal", "status": "open",
        "assignee": None, "document_ref": None,
        "created_hours_ago": 46, "sla_hours": 30, "tags": ["bulk-send", "feature"],
        "messages": [
            {"author": "Security Team", "email": "security@kestrel.health", "offset": 0,
             "staff": False, "internal": False,
             "body": "We need to send 4,000 onboarding agreements in one batch with per-row merge tags. Is the bulk endpoint available on our plan?"},
        ],
    },
    {
        "reference": "SF-4455", "slug": "halden",
        "subject": "Invoice INV-2026-0777 shows a late fee we dispute",
        "requester": "Tobias Krause", "requester_email": "it@halden.de",
        "category": "billing", "priority": "high", "status": "open",
        "assignee": "ravi.patel@signforge.com", "document_ref": None,
        "created_hours_ago": 72, "sla_hours": 2, "tags": ["billing", "dispute"],
        "messages": [
            {"author": "Tobias Krause", "email": "it@halden.de", "offset": 0,
             "staff": False, "internal": False,
             "body": "The SEPA debit failed because of a bank-side hold, not insufficient funds. Please remove the €32 late fee and retry."},
        ],
    },
    {
        "reference": "SF-4440", "slug": "acme",
        "subject": "Certificate of completion missing geolocation for one signer",
        "requester": "Jordan Mehta", "requester_email": "jordan.mehta@northwind.com",
        "category": "security", "priority": "normal", "status": "resolved",
        "assignee": "marco.diaz@signforge.com", "document_ref": "ENV-2280-LM",
        "created_hours_ago": 24 * 7, "sla_hours": None, "resolved_after_minutes": 192,
        "tags": ["audit", "resolved"],
        "messages": [
            {"author": "Jordan Mehta", "email": "jordan.mehta@northwind.com", "offset": 0,
             "staff": False, "internal": False,
             "body": "The certificate for ENV-2280-LM lists IP but no city/country for the second signer. Our auditor needs it."},
            {"author": "Marco Diaz", "email": "marco.diaz@signforge.com", "offset": 192,
             "staff": True, "internal": False,
             "body": "The signer used a corporate VPN egress with no geo mapping. We have regenerated the certificate with the resolved ASN and noted the VPN in the audit entry. CSAT survey sent."},
        ],
    },
    {
        "reference": "SF-4431", "slug": "vertex",
        "subject": "SSO users landing in the wrong tenant after IdP change",
        "requester": "Sofia Lindqvist", "requester_email": "sofia@vertex.dev",
        "category": "security", "priority": "urgent", "status": "open",
        "assignee": "amelia.chen@signforge.com", "document_ref": None,
        "created_hours_ago": 7, "sla_hours": 1, "tags": ["SSO", "SAML", "P1"],
        "messages": [
            {"author": "Sofia Lindqvist", "email": "sofia@vertex.dev", "offset": 0,
             "staff": False, "internal": False,
             "body": "After our Okta migration two users are being provisioned into the trial tenant instead of vertex. Sign-in succeeds but they see no documents."},
        ],
    },
]

# data.ts :: INVOICES. Money is in cents; ``period_months_ago`` is 0 for the
# current month, 1 for last month, 2 for the month before that.
INVOICES: list[dict[str, Any]] = [
    {
        "number": "INV-2026-0841", "slug": "acme", "status": "open",
        "period_months_ago": 0, "total": 4119600, "subtotal": 3823820, "tax": 295780,
        "paid": 0, "pi": "pi_3QhT7xKzR2", "method": "Visa •••• 4242",
        "lines": [
            ("Enterprise seats — 1,240 × $44", 1240, 4400, 5456000),
            ("Annual commitment discount (−30%)", 1, -1636800, -1636800),
            ("SMS authentication — 2,310 × $0.02", 2310, 2, 4620),
            ("Overage envelopes — 0", 0, 0, 0),
        ],
    },
    {
        "number": "INV-2026-0798", "slug": "acme", "status": "paid",
        "period_months_ago": 1, "total": 4088400, "subtotal": 3798520, "tax": 289880,
        "paid": 4088400, "pi": "pi_3QfR1aKzR2", "method": "Visa •••• 4242",
        "lines": [
            ("Enterprise seats — 1,232 × $44", 1232, 4400, 5420800),
            ("Annual commitment discount (−30%)", 1, -1626240, -1626240),
            ("SMS authentication — 1,980 × $0.02", 1980, 2, 3960),
        ],
    },
    {
        "number": "INV-2026-0812", "slug": "northwind-legal", "status": "paid",
        "period_months_ago": 0, "total": 1198400, "subtotal": 1189400, "tax": 9000,
        "paid": 1198400, "pi": "pi_3QhU2bKzR9", "method": "ACH •••• 6789",
        "lines": [
            ("Enterprise seats — 320 × $44", 320, 4400, 1408000),
            ("Multi-year discount (−20%)", 1, -281600, -281600),
            ("Qualified e-signature (eIDAS) — 42", 42, 1500, 63000),
        ],
    },
    {
        "number": "INV-2026-0803", "slug": "vertex", "status": "open",
        "period_months_ago": 0, "total": 288000, "subtotal": 288000, "tax": 0,
        "paid": 0, "pi": "pi_3QhV9cKzRK", "method": "Mastercard •••• 5100",
        "lines": [
            ("Business seats — 180 × $28 (trial credit applied)", 180, 2800, 504000),
            ("Trial credit", 1, -216000, -216000),
        ],
    },
    {
        "number": "INV-2026-0777", "slug": "halden", "status": "past_due",
        "period_months_ago": 1, "total": 171400, "subtotal": 217400, "tax": 41306,
        "paid": 0, "pi": "pi_3QfW4dKzRP", "method": "SEPA •••• 2201",
        "overdue_days": 9,
        "lines": [
            ("Business seats — 90 × $28", 90, 2800, 252000),
            ("EU volume discount (−15%)", 1, -37800, -37800),
            ("Late fee", 1, 3200, 3200),
        ],
    },
    {
        "number": "INV-2026-0740", "slug": "kestrel", "status": "paid",
        "period_months_ago": 0, "total": 2252800, "subtotal": 2232000, "tax": 20800,
        "paid": 2252800, "pi": "pi_3QhX7eKzRT", "method": "ACH •••• 1188",
        "lines": [
            ("Enterprise seats — 640 × $44", 640, 4400, 2816000),
            ("HIPAA add-on", 1, 120000, 120000),
            ("Committed-use discount (−25%)", 1, -704000, -704000),
        ],
    },
    {
        "number": "INV-2026-0699", "slug": "lumen", "status": "void",
        "period_months_ago": 2, "total": 28800, "subtotal": 0, "tax": 0,
        "paid": 0, "pi": "pi_3QcY1fKzRW", "method": "Visa •••• 9002",
        "lines": [
            ("Team seats — 24 × $12", 24, 1200, 28800),
            ("Credit note — account suspended", 1, -28800, -28800),
        ],
    },
]

# data.ts :: CHARGES (tenant view) plus the platform's failed SEPA attempt.
CHARGES: list[dict[str, Any]] = [
    {"slug": "acme", "amount": 4088400, "status": "succeeded", "pi": "pi_3QfR1aKzR2",
     "method": "Visa •••• 4242", "days_ago": 27, "invoice": "INV-2026-0798",
     "description": "Monthly subscription"},
    {"slug": "acme", "amount": 4010200, "status": "succeeded", "pi": "pi_3QbM8yKzR2",
     "method": "Visa •••• 4242", "days_ago": 58, "invoice": None,
     "description": "Monthly subscription"},
    {"slug": "acme", "amount": 124000, "status": "succeeded", "pi": "pi_3QaL4pKzR2",
     "method": "Visa •••• 4242", "days_ago": 71, "invoice": None,
     "description": "Seat add-on proration"},
    {"slug": "acme", "amount": 4010200, "status": "recovered", "pi": "pi_3QZK2nKzR2",
     "method": "Visa •••• 4242", "days_ago": 88, "invoice": None,
     "description": "Card declined, retried"},
    {"slug": "northwind-legal", "amount": 1198400, "status": "succeeded", "pi": "pi_3QhU2bKzR9",
     "method": "ACH •••• 6789", "days_ago": 3, "invoice": "INV-2026-0812",
     "description": "Monthly subscription"},
    {"slug": "kestrel", "amount": 2252800, "status": "succeeded", "pi": "pi_3QhX7eKzRT",
     "method": "ACH •••• 1188", "days_ago": 4, "invoice": "INV-2026-0740",
     "description": "Monthly subscription"},
    {"slug": "halden", "amount": 171400, "status": "failed", "pi": "pi_3QfW4dKzRP",
     "method": "SEPA •••• 2201", "days_ago": 2, "invoice": "INV-2026-0777",
     "decline_code": "insufficient_funds", "dunning_step": 4, "next_attempt_days": 2,
     "description": "Dunning attempt 4 of 5"},
    {"slug": "vertex", "amount": 288000, "status": "failed", "pi": "pi_3QhV9cKzRK",
     "method": "Mastercard •••• 5100", "days_ago": 1, "invoice": "INV-2026-0803",
     "decline_code": "requires_action", "dunning_step": 1, "next_attempt_days": 3,
     "description": "Trial conversion attempt"},
]

# data.ts :: PM_DEFS
PAYMENT_METHODS: list[dict[str, Any]] = [
    {"slug": "acme", "type": "card", "brand": "visa", "last4": "4242", "exp_month": 9,
     "exp_year": 2029, "holder": "Priya Raman", "country": "US",
     "label": "Visa •••• 4242", "meta": "exp 09/29 · Priya Raman · US", "default": True,
     "provider_id": "pm_visa"},
    {"slug": "acme", "type": "ach", "brand": "wells_fargo", "last4": "6789",
     "holder": "Acme Corporation", "country": "US", "label": "Wells Fargo •••• 6789",
     "meta": "business checking · instant-verified", "default": False, "provider_id": "pm_ach"},
    {"slug": "northwind-legal", "type": "ach", "brand": "ach", "last4": "6789",
     "holder": "Northwind Legal", "country": "DE", "label": "ACH •••• 6789",
     "meta": "business checking", "default": True, "provider_id": "pm_nw_ach"},
    {"slug": "vertex", "type": "card", "brand": "mastercard", "last4": "5100",
     "exp_month": 4, "exp_year": 2028, "holder": "Vertex Robotics", "country": "US",
     "label": "Mastercard •••• 5100", "meta": "exp 04/28", "default": True,
     "provider_id": "pm_vx_card"},
    {"slug": "halden", "type": "sepa", "brand": "sepa", "last4": "2201",
     "holder": "Halden GmbH", "country": "DE", "label": "SEPA •••• 2201",
     "meta": "mandate DE9982 · insufficient funds", "default": True, "provider_id": "pm_hd_sepa"},
    {"slug": "kestrel", "type": "ach", "brand": "ach", "last4": "1188",
     "holder": "Kestrel Health", "country": "US", "label": "ACH •••• 1188",
     "meta": "business checking", "default": True, "provider_id": "pm_ks_ach"},
    {"slug": "lumen", "type": "card", "brand": "visa", "last4": "9002",
     "exp_month": 1, "exp_year": 2027, "holder": "Lumen Studio", "country": "AU",
     "label": "Visa •••• 9002", "meta": "exp 01/27 · suspended", "default": True,
     "provider_id": "pm_lm_card"},
]

# data.ts :: LOGS. ``minutes_ago`` replaces the literal wall-clock stamps.
LOGS: list[dict[str, Any]] = [
    {"level": "info", "source": "api", "slug": "acme", "minutes_ago": 148,
     "message": "POST /v1/envelopes 201 — envelope ENV-2291-KD created", "code": 201,
     "latency_ms": 88, "request_id": "req_8f2c41ab", "actor": "jordan.mehta@northwind.com",
     "ip": "198.51.100.24",
     "payload": {"envelope": {"id": "ENV-2291-KD", "fields": 9, "recipients": 3}}},
    {"level": "info", "source": "webhook", "slug": "acme", "minutes_ago": 147,
     "message": "envelope.sent delivered to https://hooks.acme.io/signforge", "code": 200,
     "latency_ms": 142, "request_id": "wh_5512aa", "actor": None, "ip": None,
     "payload": {"event": "envelope.sent", "attempts": 1}},
    {"level": "info", "source": "signing", "slug": "acme", "minutes_ago": 146,
     "message": "Field signed — Client signature by alex.rivera@acme.io", "code": None,
     "latency_ms": None, "request_id": None, "actor": "alex.rivera@acme.io",
     "ip": "203.0.113.77",
     "payload": {"field": "f1", "type": "signature", "capture": "drawn", "raster": "1120x360"}},
    {"level": "warn", "source": "api", "slug": "vertex", "minutes_ago": 140,
     "message": "GET /v1/templates 429 — rate limit 500 rps exceeded", "code": 429,
     "latency_ms": 12, "request_id": "req_91bd7c02", "actor": None, "ip": None,
     "payload": {"limit": 500, "observed": 612, "retry_after": 1}},
    {"level": "error", "source": "webhook", "slug": "halden", "minutes_ago": 132,
     "message": "invoice.payment_failed delivery failed after 4 attempts", "code": 502,
     "latency_ms": 30000, "request_id": None, "actor": None, "ip": None,
     "payload": {"event": "invoice.payment_failed", "invoice": "INV-2026-0777", "attempts": 4}},
    {"level": "info", "source": "auth", "slug": "acme", "minutes_ago": 125,
     "message": "SAML assertion accepted — priya@acme.io via Okta", "code": 200,
     "latency_ms": 204, "request_id": "sess_44ab19", "actor": "priya@acme.io", "ip": None,
     "payload": {"idp": "okta", "mfa": "totp", "clock_skew_ms": 41}},
    {"level": "warn", "source": "auth", "slug": "vertex", "minutes_ago": 118,
     "message": "Sign-in without MFA — sofia@vertex.dev (policy grace period)", "code": 200,
     "latency_ms": 96, "request_id": None, "actor": "sofia@vertex.dev", "ip": "203.0.113.145",
     "payload": {"policy": "require_mfa", "state": "grace"}},
    {"level": "error", "source": "api", "slug": "kestrel", "minutes_ago": 112,
     "message": "POST /v1/envelopes 422 — merge tag {{client.name}} unresolved", "code": 422,
     "latency_ms": 34, "request_id": "req_c0d41f7a", "actor": None, "ip": None,
     "payload": {"errors": [{"field": "f3", "code": "merge_unresolved", "tag": "{{client.name}}"}]}},
    {"level": "info", "source": "admin", "slug": None, "minutes_ago": 100,
     "message": "Feature flag api.bulk_send_v3 rollout 5% → 10% (staging)", "code": None,
     "latency_ms": None, "request_id": None, "actor": SUPER_ADMIN_EMAIL, "ip": "198.51.100.24",
     "payload": {"flag": "api.bulk_send_v3", "before": {"on": False, "rollout": 5},
                 "after": {"on": False, "rollout": 10}, "mfa": "stepped_up"}},
    {"level": "warn", "source": "admin", "slug": None, "minutes_ago": 96,
     "message": "Impersonation session opened — platform → acme (30 min TTL)", "code": None,
     "latency_ms": None, "request_id": None, "actor": SUPER_ADMIN_EMAIL, "ip": "198.51.100.24",
     "payload": {"tenant": "acme", "justification": "INC-4471", "ttl_seconds": 1800,
                 "scopes": ["read:envelopes", "read:audit"]}},
    {"level": "info", "source": "billing", "slug": "acme", "minutes_ago": 92,
     "message": "Stripe charge succeeded — $40,884.00 (pi_3QfR1aKzR2)", "code": 200,
     "latency_ms": 612, "request_id": "pi_3QfR1aKzR2", "actor": None, "ip": None,
     "payload": {"amount": 4088400, "currency": "usd", "status": "succeeded"}},
    {"level": "error", "source": "billing", "slug": "halden", "minutes_ago": 88,
     "message": "Stripe charge failed — insufficient_funds (SEPA •••• 2201)", "code": 402,
     "latency_ms": 884, "request_id": "pi_3QfW4dKzRP", "actor": None, "ip": None,
     "payload": {"amount": 171400, "decline_code": "insufficient_funds", "dunning_step": 4}},
]

# data.ts :: PLATFORM_AUDIT
PLATFORM_AUDIT: list[dict[str, Any]] = [
    {"action": "flag.updated", "detail": "api.bulk_send_v3 · 10% staging",
     "actor": SUPER_ADMIN_EMAIL, "slug": None, "minutes_ago": 100, "ip": "198.51.100.24"},
    {"action": "impersonation.started", "detail": "jordan.mehta → acme · 30 min TTL · justification #INC-4471",
     "actor": SUPER_ADMIN_EMAIL, "slug": "acme", "minutes_ago": 96, "ip": "198.51.100.24"},
    {"action": "tenant.suspended", "detail": "lumen · non-payment · automated dunning step 4",
     "actor": SUPER_ADMIN_EMAIL, "slug": "lumen", "minutes_ago": 60 * 24 * 20, "ip": "198.51.100.24"},
    {"action": "security.key_rotation", "detail": "HSM cluster us-east-1 · 4,102 envelopes re-sealed",
     "actor": SUPER_ADMIN_EMAIL, "slug": None, "minutes_ago": 60 * 24 * 22, "ip": "198.51.100.24"},
    {"action": "directory.scim_deprovision", "detail": "sofia@vertex.dev removed from IdP · access revoked in 41s",
     "actor": SUPER_ADMIN_EMAIL, "slug": "vertex", "minutes_ago": 60 * 30, "ip": "198.51.100.24"},
]

# state.tsx :: INITIAL_STATE.apiKeys + .scopes
API_KEYS: list[dict[str, Any]] = [
    {"label": "Host app — production", "mode": "live", "created_days_ago": 77,
     "last_used_minutes_ago": 2, "revoked": False},
    {"label": "Host app — sandbox", "mode": "test", "created_days_ago": 77,
     "last_used_minutes_ago": 60, "revoked": False},
    {"label": "Zapier connector", "mode": "live", "created_days_ago": 178,
     "last_used_minutes_ago": 60 * 24 * 6, "revoked": True},
]
API_KEY_SEED_SCOPES: list[str] = [
    "users:read", "contacts:read", "contacts:write",
    "documents:read", "documents:write", "envelopes:send",
]

# state.tsx :: INITIAL_STATE.flagState — enabled/rollout on top of the
# platform_service flag catalogue.
FLAG_STATE: dict[str, tuple[bool, int]] = {
    "signing.passkey_reuse": (True, 100),
    "builder.conditional_logic_v2": (True, 45),
    "api.bulk_send_v3": (False, 10),
    "audit.ledger_anchoring": (True, 100),
    "signing.ai_clause_summary": (False, 5),
}

#: Per-tenant flag overrides so the tenant detail drawer is not empty.
FLAG_OVERRIDES: list[tuple[str, str, bool]] = [
    ("api.bulk_send_v3", "kestrel", True),
    ("signing.ai_clause_summary", "acme", True),
    ("builder.conditional_logic_v2", "vertex", False),
]

# state.tsx :: INITIAL_STATE.security — platform_service seeds the catalogue;
# these are the design's toggle positions.
# None of these controls is implemented (see SECURITY_CONTROLS in
# app/services/platform_service.py, which reports them as
# implemented=False / enforced=False). Seeding any of them "enabled" would
# advertise a control that does not exist, so they all ship off.
SECURITY_STATE: dict[str, bool] = {
    "sso": False, "scim": False, "ipAllow": False,
    "residency": False, "keyRotation": False, "dlp": False,
}

# data.ts :: INTEGRATIONS
INTEGRATIONS: list[tuple[str, str, str, bool]] = [
    ("salesforce", "Salesforce", "Connected · 2-way sync of opportunities", True),
    ("hubspot", "HubSpot", "Not connected", False),
    ("google_drive", "Google Drive", "Connected · completed copies to /Agreements", True),
    ("dropbox", "Dropbox", "Not connected", False),
    ("slack", "Slack", "Connected · #contracts channel", True),
    ("zapier", "Zapier", "Connected · 4 zaps", True),
    ("sharepoint", "SharePoint", "Not connected", False),
    ("workday", "Workday", "Not connected", False),
]

# data.ts :: CLOUD_TARGETS
CLOUD_TARGETS: list[tuple[str, str, bool]] = [
    ("google_drive", "/Agreements/Signed", True),
    ("dropbox", "", False),
    ("sharepoint", "", False),
    ("s3", "s3://acme-agreements/signed", True),
]

# data.ts :: NOTIF_PREFS
NOTIF_PREFS: list[tuple[str, bool]] = [
    ("document_viewed", True), ("document_signed", True), ("envelope_completed", True),
    ("signer_declined", True), ("reminder_sent", False), ("envelope_expiring_24h", True),
    ("payment_failed", True), ("weekly_digest", False),
]

# data.ts :: NOTIFICATIONS (the bell menu)
NOTIFICATIONS: list[dict[str, Any]] = [
    {"title": "Alex Rivera signed Master Services Agreement", "minutes_ago": 12,
     "tone": "good", "screen": "audit", "detail": "ENV-2291-KD"},
    {"title": "Invoice INV-2026-0841 is due in 4 days", "minutes_ago": 120,
     "tone": "info", "screen": "invoices", "detail": "$41,196.00 · autopay scheduled"},
    {"title": "Halden GmbH payment failed — dunning step 4", "minutes_ago": 60 * 26,
     "tone": "bad", "screen": "revenue", "detail": "INV-2026-0777 · SEPA •••• 2201"},
    {"title": "SF-4471 escalated to engineering", "minutes_ago": 60 * 28,
     "tone": "bad", "screen": "support", "detail": "Signer cannot apply drawn signature on iPad"},
    {"title": "Contractor Agreement expires in 24 hours", "minutes_ago": 60 * 48,
     "tone": "info", "screen": "dashboard", "detail": "ENV-2276-JZ"},
]

# data.ts :: DEVICES — authenticated sessions on the security screen.
DEVICES: list[dict[str, Any]] = [
    {"device": "Windows · Edge", "browser": "Edge", "os": "Windows",
     "ip": "68.100.82.195", "location": "Seattle, US", "days_ago": 18},
    {"device": "Android · Chrome", "browser": "Chrome", "os": "Android",
     "ip": "103.7.120.30", "location": "Dhaka, BD", "days_ago": 4},
    {"device": "macOS · Safari", "browser": "Safari", "os": "macOS",
     "ip": "198.51.100.24", "location": "Seattle, US · this device", "days_ago": 0},
]

# data.ts :: SAVED_SIGS
SAVED_SIGNATURES: list[dict[str, Any]] = [
    {"label": "Adopted", "days_ago": 16, "type": "drawn", "face": "Caveat",
     "passkey": True, "text": "Jordan Mehta"},
    {"label": "Adopted", "days_ago": 178, "type": "drawn", "face": "Great Vibes",
     "passkey": False, "text": "Jordan Mehta"},
]

# data.ts :: STRIPE_WEBHOOKS — provider events on the revenue screen.
STRIPE_WEBHOOKS: list[dict[str, Any]] = [
    {"event_id": "evt_1QhT7a", "event_type": "invoice.paid", "code": 200, "minutes_ago": 92},
    {"event_id": "evt_1QhT52", "event_type": "customer.subscription.updated", "code": 200, "minutes_ago": 109},
    {"event_id": "evt_1QhSz9", "event_type": "checkout.session.completed", "code": 200, "minutes_ago": 188},
    {"event_id": "evt_1QhSw1", "event_type": "invoice.payment_failed", "code": 502, "minutes_ago": 223},
    {"event_id": "evt_1QhSm4", "event_type": "payment_intent.succeeded", "code": 200, "minutes_ago": 258},
    {"event_id": "evt_1QhSg8", "event_type": "customer.subscription.trial_will_end", "code": 200, "minutes_ago": 327},
]

# data.ts :: ORG_SERIES — envelope volume per month for the primary tenant,
# oldest first. Scaled down by HISTORY_DIVISOR so a seed stays fast while the
# shape of the Reports trend line survives.
ORG_SERIES: list[int] = [318, 402, 366, 471, 508, 442, 530, 486, 612, 574, 538, 596]
HISTORY_DIVISOR = 60

# data.ts :: REPORT_RECIPIENTS — per-recipient volume the Reports screen shows.
# The seeder distributes historical envelopes across these emails in proportion
# to their envelope counts so the aggregation reproduces the same ranking.
REPORT_RECIPIENT_WEIGHTS: list[tuple[str, str, int, int]] = [
    # email, display name, envelopes, completed
    ("alex.rivera@acme.io", "Alex Rivera", 14, 12),
    ("dana@northwind-legal.com", "Dana Whitfield", 38, 34),
    ("m.bell@acme.io", "Marcus Bell", 22, 21),
    ("priya@acme.io", "Priya Raman", 41, 36),
    ("sofia@vertex.dev", "Sofia Lindqvist", 6, 4),
    ("it@halden.de", "Tobias Krause", 9, 6),
    ("elena.ruiz@kestrel.health", "Elena Ruiz", 17, 17),
]

# data.ts :: EMBED / INITIAL_STATE.embedOrigins
EMBED_ORIGINS = ["https://app.hostcrm.com", "https://staging.hostcrm.com"]
EMBED_RETURN_URL = "https://app.hostcrm.com/deals/8842/agreements"


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _months_before(moment: datetime, months: int) -> datetime:
    """``moment`` shifted back whole months, clamped to a safe day-of-month."""
    year = moment.year
    month = moment.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(moment.day, 28)
    return moment.replace(year=year, month=month, day=day)


def _month_start(moment: datetime) -> datetime:
    return moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _period_end(moment: datetime) -> datetime:
    """End of the current billing period, never in the near past.

    The obvious choice — the 1st of next month — makes every seeded
    subscription lapse the moment the calendar rolls over: ``effective_status``
    reads a past ``current_period_end`` as ``expired``, and every billable
    action (create a document, upload its PDF, send it) then answers 402. A
    database seeded on the 31st was dead on the 1st. Keeping the period at
    least 30 days out leaves a freshly seeded environment usable.
    """
    month_end = _month_start(_months_before(moment, -1))
    return max(month_end, moment + timedelta(days=30))


class Seeder:
    """Holds the session, the clock and the lookup caches for one run."""

    def __init__(self, db: Any, *, now: datetime | None = None) -> None:
        self.db = db
        self.now = now or _now()
        self.orgs: dict[str, Any] = {}
        self.users: dict[str, Any] = {}
        self.contacts: dict[str, Any] = {}
        self.documents: dict[str, Any] = {}
        self.templates: dict[str, Any] = {}
        self.plans: dict[str, Any] = {}
        self.invoices: dict[str, Any] = {}
        self.flags: dict[str, Any] = {}
        self.folders: dict[str, Any] = {}
        self.created: dict[str, int] = {}
        self.counts: dict[str, int] = {}

    # -- generic upsert ----------------------------------------------------

    def upsert(
        self,
        model: type,
        where: dict[str, Any],
        values: dict[str, Any] | None = None,
        *,
        on_create: Callable[[Any], None] | None = None,
    ) -> Any:
        """Fetch-or-create ``model`` by the natural key in ``where``.

        ``values`` are applied on create only: re-running the seeder must not
        clobber edits a developer made through the UI.
        """
        from sqlalchemy import select

        query = select(model)
        for column, value in where.items():
            query = query.where(getattr(model, column) == value)
        row = self.db.scalars(query.limit(1)).first()
        if row is not None:
            return row
        row = model(**where, **(values or {}))
        self.db.add(row)
        self.db.flush()
        self.created[model.__name__] = self.created.get(model.__name__, 0) + 1
        if on_create is not None:
            on_create(row)
        return row

    def bump(self, key: str, amount: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + amount


# --------------------------------------------------------------------------
# Seed steps
# --------------------------------------------------------------------------


def _seed_plans(s: Seeder) -> None:
    from sqlalchemy import select

    from app.models.plan import Plan
    from app.services.billing_service import billing_service

    billing_service.ensure_default_plans(s.db)
    for plan in s.db.scalars(select(Plan)):
        s.plans[plan.code] = plan


def _seed_organizations(s: Seeder) -> None:
    from app.models.organization import Organization

    # The platform organization is not a tenant: it never appears in TENANTS.
    platform = s.upsert(
        Organization,
        {"slug": PLATFORM_ORG_SLUG},
        {
            "name": PLATFORM_ORG_NAME,
            "region": "us-east-1",
            "company_size": "51-200",
            "seats_licensed": 40,
            "subscription_tier": "enterprise",
            "subscription_status": "active",
            "billing_email": "finance@signforge.com",
            "created_at": _months_before(s.now, 36),
        },
    )
    s.orgs[PLATFORM_ORG_SLUG] = platform

    for spec in TENANTS:
        org = s.upsert(
            Organization,
            {"slug": spec["slug"]},
            {
                "name": spec["name"],
                "region": spec["region"],
                "company_size": spec["company_size"],
                "seats_licensed": spec["seats"],
                "subscription_tier": spec["plan"],
                "subscription_status": _sub_status(spec["status"]),
                "billing_email": spec["owner"],
                "autopay": spec["status"] != "Suspended",
                "created_at": _months_before(s.now, max(spec["months_ago"], 1)),
            },
        )
        if spec["status"] == "Suspended" and org.suspended_at is None:
            org.suspended_at = s.now - timedelta(days=20)
            org.suspension_reason = "Non-payment · automated dunning step 4"
        s.orgs[spec["slug"]] = org

    # The primary tenant carries the design's billing and embed settings.
    acme = s.orgs[PRIMARY_TENANT_SLUG]
    if acme.tax_id is None:
        acme.tax_id = "US-EIN 84-2201993"
        acme.billing_email = "ap@acme.io"
        acme.billing_cycle = "monthly"
        acme.accent_color = "#4f46e5"
        acme.allowed_origins = EMBED_ORIGINS
        acme.default_return_url = EMBED_RETURN_URL
        acme.live_mode_enabled = True
    s.db.flush()


def _sub_status(design_status: str) -> str:
    return {
        "Active": "active",
        "Trial": "trialing",
        "Past due": "past_due",
        "Suspended": "canceled",
    }[design_status]


def _seed_users(s: Seeder) -> None:
    from app.core.security import hash_password
    from app.models.enums import UserRole
    from app.models.user import User

    password_hash = hash_password(SEED_PASSWORD)
    for spec in USERS:
        org = s.orgs[spec["slug"]]
        role = UserRole.admin if spec["role"] in {"super", "orgadmin"} else UserRole.sender
        user = s.upsert(
            User,
            {"email": spec["email"]},
            {
                "organization_id": org.id,
                "name": spec["name"],
                "password_hash": password_hash,
                "role": role,
                "is_platform_admin": spec["role"] == "super",
                "mfa_method": spec["mfa"],
                "mfa_enrolled_at": s.now - timedelta(days=90) if spec["mfa"] else None,
                "last_active_at": s.now - timedelta(minutes=spec["last_active_minutes"]),
                "locale": "en-US",
                "timezone": "America/Los_Angeles",
                "status": "active",
                "preferences": {"title": spec["title"], "seeded_by": SEED_MARKER},
                "created_at": _months_before(s.now, 12),
            },
        )
        s.users[spec["email"]] = user

    # Owners: the design's TENANTS.owner column.
    for spec in TENANTS:
        org = s.orgs[spec["slug"]]
        owner = s.users.get(spec["owner"])
        if owner is not None and org.owner_user_id is None:
            org.owner_user_id = owner.id
    platform = s.orgs[PLATFORM_ORG_SLUG]
    if platform.owner_user_id is None:
        platform.owner_user_id = s.users[SUPER_ADMIN_EMAIL].id
    s.db.flush()


def _seed_subscriptions(s: Seeder) -> None:
    """One subscription per tenant, back-dated so the MRR series ramps."""
    from app.models.subscription import Subscription, SubscriptionStatus

    for spec in TENANTS:
        org = s.orgs[spec["slug"]]
        plan = s.plans[spec["plan"]]
        started = _months_before(s.now, max(spec["months_ago"], 0))
        status = _sub_status(spec["status"])
        subscription = s.upsert(
            Subscription,
            {"organization_id": org.id},
            {
                "plan_id": plan.id,
                "status": status,
                "current_period_start": _month_start(s.now),
                "current_period_end": _period_end(s.now),
                "trial_ends_at": s.now + timedelta(days=4) if status == "trialing" else None,
                # A canceled tenant needs a cancellation stamp or the revenue
                # screen treats it as having never paid, and churn stays empty.
                "canceled_at": s.now - timedelta(days=20)
                if status == SubscriptionStatus.canceled
                else None,
                "provider": "dev",
                "provider_customer_id": f"cus_{spec['slug']}",
                "provider_subscription_id": f"sub_{spec['slug']}",
                "created_at": started,
            },
        )
        s.bump("subscriptions")
        _ = subscription

    # The platform org itself needs a subscription so entitlement checks pass.
    platform = s.orgs[PLATFORM_ORG_SLUG]
    s.upsert(
        Subscription,
        {"organization_id": platform.id},
        {
            "plan_id": s.plans["enterprise"].id,
            "status": "active",
            "current_period_start": _month_start(s.now),
            "current_period_end": _period_end(s.now),
            "provider": "dev",
            "created_at": _months_before(s.now, 36),
        },
    )
    s.db.flush()


def _seed_contacts(s: Seeder) -> None:
    from app.models.contact import Contact, ContactGroup
    from app.schemas.contact import DEFAULT_GROUPS

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    for index, (key, label) in enumerate(DEFAULT_GROUPS):
        s.upsert(
            ContactGroup,
            {"organization_id": acme.id, "key": key},
            {"label": label, "sort_order": index},
        )
        s.bump("contact_groups")

    creator = s.users["jordan.mehta@northwind.com"]
    for spec in CONTACTS:
        contact = s.upsert(
            Contact,
            {"organization_id": acme.id, "email": spec["email"]},
            {
                "name": spec["name"],
                "company": spec["company"],
                "title": spec["title"],
                "phone": spec["phone"],
                "default_role": spec["role"],
                "group_key": spec["group"],
                "source": spec["source"].lower(),
                "tags": spec["tags"],
                "color": spec["color"],
                "last_signed_at": None
                if spec["signed_days_ago"] is None
                else s.now - timedelta(days=spec["signed_days_ago"]),
                "created_by_user_id": creator.id,
                "created_at": _months_before(s.now, 6),
            },
        )
        s.contacts[spec["email"]] = contact
        s.bump("contacts")
    s.db.flush()


def _seed_folders_and_teams(s: Seeder) -> None:
    from app.models.folder import Folder
    from app.models.team import Team, TeamMember

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    creator = s.users["jordan.mehta@northwind.com"]
    for index, name in enumerate(FOLDERS):
        folder = s.upsert(
            Folder,
            {"organization_id": acme.id, "name": name},
            {"created_by_user_id": creator.id, "sort_order": index},
        )
        s.folders[name] = folder
        s.bump("folders")

    for spec in TEAMS:
        team = s.upsert(
            Team,
            {"organization_id": acme.id, "name": spec["name"]},
            {"description": spec["description"]},
        )
        s.bump("teams")
        for email, role in spec["members"]:
            user = s.users.get(email)
            if user is None:
                continue
            s.upsert(
                TeamMember,
                {"team_id": team.id, "user_id": user.id},
                {"role": role},
            )
    s.db.flush()


def _document_natural_key(
    s: Seeder, org_id: str, title: str, *, template: bool = False
) -> dict[str, Any]:
    """A document is keyed by organization + title + kind.

    ``is_template`` is part of the key because the design reuses titles across
    both: "Data Processing Addendum — EU" is a template *and* an envelope.
    """
    return {"organization_id": org_id, "title": title, "is_template": template}


def _seed_templates(s: Seeder) -> None:
    from app.models.document import Document
    from app.models.enums import DocumentStatus, WorkflowType

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    for spec in TEMPLATES:
        owner = s.users.get(spec["owner"]) or s.users["priya@acme.io"]
        updated = s.now - timedelta(days=spec["updated_days_ago"])
        template = s.upsert(
            Document,
            _document_natural_key(s, acme.id, spec["title"], template=True),
            {
                "sender_id": owner.id,
                "owner_user_id": owner.id,
                "status": DocumentStatus.prepared,
                "workflow_type": WorkflowType.sequential,
                "page_count": 2,
                "doc_type": "template",
                "created_at": updated,
                "updated_at": updated,
                "folder_id": s.folders["Agreements"].id,
                "reminder_cadence": "48h",
                "expires_in_days": 14,
            },
        )
        s.templates[spec["title"]] = template
        s.bump("templates")
    s.db.flush()


def _seed_documents(s: Seeder) -> None:
    from app.models.document import Document
    from app.models.enums import (
        DocumentStatus,
        FieldType,
        RecipientStatus,
        SignatureType,
        WorkflowType,
    )
    from app.models.field import Field
    from app.models.recipient import Recipient
    from app.models.signature import Signature

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    sender = s.users["jordan.mehta@northwind.com"]

    for spec in DOCS:
        created = s.now - timedelta(minutes=spec["age_minutes"])
        status = DOC_STATUS_MAP[spec["status"]]
        completed_at = created + timedelta(minutes=136) if status == "completed" else None
        document = s.upsert(
            Document,
            _document_natural_key(s, acme.id, spec["title"]),
            {
                "sender_id": sender.id,
                "owner_user_id": sender.id,
                "status": DocumentStatus(status),
                "workflow_type": WorkflowType.sequential,
                "page_count": spec["pages"],
                "doc_type": "envelope",
                "folder_id": s.folders["Agreements"].id,
                "sent_at": None if status == "draft" else created + timedelta(minutes=1),
                "completed_at": completed_at,
                "expires_at": created + timedelta(days=14),
                "created_at": created,
                "updated_at": created,
                "reminder_cadence": "48h",
                "expires_in_days": 14,
                "invite_subject": f"{spec['title']}: Signature request from Jordan Mehta",
                "invite_message": (
                    "Please review and sign the attached Master Services Agreement. "
                    "Reach out with any questions before executing."
                ),
                # The prototype's envelope reference (ENV-…) has no column of
                # its own; it is preserved here so the UI can still show it.
                "original_sha256": None,
            },
        )
        s.documents[spec["ref"]] = document

        # Recipients. ``signed`` in DOCS counts completed signatures, so the
        # first ``signed`` recipients are marked completed.
        signed_left = spec["signed"]
        for order, handle in enumerate(spec["to"] + spec.get("extra", []), start=1):
            proto = PROTO_RECIPIENTS[handle]
            if status == "draft":
                rstatus = RecipientStatus.waiting
            elif status == "voided":
                rstatus = RecipientStatus.expired
            elif signed_left > 0:
                rstatus = RecipientStatus.completed
                signed_left -= 1
            elif order == 1:
                rstatus = RecipientStatus.viewed
            else:
                rstatus = RecipientStatus.sent
            contact = s.contacts.get(proto["email"])
            s.upsert(
                Recipient,
                {"document_id": document.id, "email": proto["email"]},
                {
                    "name": proto["name"],
                    "role_name": proto["role_name"],
                    "role": proto["role"],
                    "color": proto["color"],
                    "contact_id": contact.id if contact else None,
                    "signing_order": order,
                    "status": rstatus,
                    "viewed_at": created + timedelta(minutes=39)
                    if rstatus in {RecipientStatus.viewed, RecipientStatus.completed}
                    else None,
                    "completed_at": created + timedelta(minutes=41)
                    if rstatus == RecipientStatus.completed
                    else None,
                    "consent_accepted": rstatus == RecipientStatus.completed,
                    "consent_accepted_at": created + timedelta(minutes=39)
                    if rstatus == RecipientStatus.completed
                    else None,
                    "created_at": created,
                },
            )
            s.bump("recipients")
        s.bump("documents")

    s.db.flush()

    # The builder layout only exists for the design's open envelope.
    primary = s.documents["ENV-2291-KD"]
    from sqlalchemy import select

    recipients = {
        row.email: row
        for row in s.db.scalars(select(Recipient).where(Recipient.document_id == primary.id))
    }
    field_rows: dict[str, Any] = {}
    for spec in PROTO_FIELDS:
        proto = PROTO_RECIPIENTS[spec["to"]]
        recipient = recipients.get(proto["email"])
        field = s.upsert(
            Field,
            {"document_id": primary.id, "label": spec["label"]},
            {
                "recipient_id": recipient.id if recipient else None,
                "type": FieldType(FIELD_TYPE_MAP[spec["type"]]),
                "required": spec["required"],
                "page_number": spec["page"],
                "x": spec["x"],
                "y": spec["y"],
                "width": spec["w"],
                "height": spec["h"],
                "placeholder": spec["placeholder"] or None,
                "validation": spec["validation"],
                "condition": spec["cond"],
                "merge_tag": spec["merge"] or None,
                "read_only": spec["read_only"],
                "options": ["Net 30", "Net 45", "Net 60"] if spec["type"] == "dropdown" else None,
            },
        )
        field_rows[spec["key"]] = field
        s.bump("fields")

    # The first signer completed their fields (AUDIT shows the values).
    signer = recipients.get("alex.rivera@acme.io")
    if signer is not None:
        values = {
            "f2": (s.now - timedelta(minutes=DOCS[0]["age_minutes"])).strftime("%m/%d/%Y"),
            "f3": "Alex Rivera",
            "f4": "alex.rivera@acme.io",
            "f5": "true",
        }
        for key, value in values.items():
            field = field_rows.get(key)
            if field is not None and field.value is None:
                field.value = value
        signature_field = field_rows.get("f1")
        if signature_field is not None:
            s.upsert(
                Signature,
                {"field_id": signature_field.id},
                {
                    "document_id": primary.id,
                    "recipient_id": signer.id,
                    "signature_type": SignatureType.drawn,
                    "signature_text": "Alex Rivera",
                    "created_at": primary.created_at + timedelta(minutes=41),
                },
            )
            s.bump("signatures")
    s.db.flush()


def _seed_audit(s: Seeder) -> None:
    """The design's AUDIT trail, written so the hash chain verifies."""
    from sqlalchemy import select

    from app.models.audit_log import AuditLog
    from app.models.recipient import Recipient

    primary = s.documents["ENV-2291-KD"]
    created = primary.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    recipients = {
        row.email: row
        for row in s.db.scalars(select(Recipient).where(Recipient.document_id == primary.id))
    }
    for entry in AUDIT:
        actor = entry["actor"]
        user = s.users.get(actor) if actor else None
        recipient = recipients.get(actor) if actor else None
        s.upsert(
            AuditLog,
            {"document_id": primary.id, "event_type": entry["event_type"],
             "event_message": entry["message"]},
            {
                "recipient_id": recipient.id if recipient else None,
                "user_id": user.id if user else None,
                "ip_address": entry["ip"],
                "user_agent": entry["ua"],
                "log_metadata": entry["meta"],
                "created_at": created + timedelta(minutes=entry["minutes_after"]),
            },
        )
        s.bump("audit_logs")

    # Every other envelope gets at least a creation + send pair, so the audit
    # export report and the certificate screen are never empty.
    for ref, document in s.documents.items():
        if ref == "ENV-2291-KD":
            continue
        doc_created = document.created_at
        if doc_created.tzinfo is None:
            doc_created = doc_created.replace(tzinfo=timezone.utc)
        s.upsert(
            AuditLog,
            {"document_id": document.id, "event_type": "document_created",
             "event_message": "Document created"},
            {
                "user_id": document.sender_id,
                "ip_address": "198.51.100.24",
                "user_agent": "Chrome 138 / macOS 15.4",
                "log_metadata": {"envelope": ref},
                "created_at": doc_created,
            },
        )
        s.bump("audit_logs")
        if document.sent_at is not None:
            s.upsert(
                AuditLog,
                {"document_id": document.id, "event_type": "document_sent",
                 "event_message": "Envelope sent"},
                {
                    "log_metadata": {"envelope": ref, "routing": "sequential"},
                    "created_at": doc_created + timedelta(minutes=1),
                },
            )
            s.bump("audit_logs")
        if document.completed_at is not None:
            s.upsert(
                AuditLog,
                {"document_id": document.id, "event_type": "document_completed",
                 "event_message": "Envelope completed"},
                {
                    "log_metadata": {"envelope": ref, "certificate": "generated"},
                    "created_at": document.completed_at,
                },
            )
            s.bump("audit_logs")
    s.db.flush()


def _seed_history(s: Seeder) -> None:
    """Back-fill twelve months of envelopes for the Reports aggregates.

    ORG_SERIES gives the design's monthly envelope volume; the counts are
    divided by ``HISTORY_DIVISOR`` so the trend keeps its shape without seeding
    six thousand rows. Recipients are drawn from REPORT_RECIPIENT_WEIGHTS in
    proportion to the design's per-recipient volumes, so the recipients report
    reproduces the same ranking.
    """
    from app.models.document import Document
    from app.models.enums import DocumentStatus, RecipientStatus, WorkflowType
    from app.models.recipient import Recipient

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    senders = [
        s.users["jordan.mehta@northwind.com"],
        s.users["priya@acme.io"],
        s.users["m.bell@acme.io"],
        s.users["alex.rivera@acme.io"],
    ]
    template_titles = [spec["title"] for spec in TEMPLATES]

    # Expand the recipient weights into a pool, then interleave it: consecutive
    # draws fill the two slots of one envelope, so the same address must never
    # come up twice in a row (the recipient upsert would collapse them).
    per_email: list[list[tuple[str, str, bool]]] = [
        [(email, name, index < completed) for index in range(envelopes)]
        for email, name, envelopes, completed in REPORT_RECIPIENT_WEIGHTS
    ]
    pool: list[tuple[str, str, bool]] = []
    for round_index in range(max((len(items) for items in per_email), default=0)):
        for items in per_email:
            if round_index < len(items):
                pool.append(items[round_index])
    if len(pool) < 2:
        return

    cursor = 0
    seq = 0
    for months_ago, volume in enumerate(reversed(ORG_SERIES)):
        count = max(volume // HISTORY_DIVISOR, 1)
        month_ref = _months_before(s.now, months_ago)
        for n in range(count):
            seq += 1
            created = month_ref - timedelta(days=n % 24, hours=(n * 7) % 20)
            if created >= s.now:
                created = s.now - timedelta(hours=1)
            title = f"{template_titles[n % len(template_titles)]} — {created:%b %Y} #{n + 1}"
            # A realistic mix: most complete, a few still out, one declined.
            bucket = seq % 10
            if bucket in (8,):
                status = DocumentStatus.sent
                completed_at = None
            elif bucket in (9,):
                status = DocumentStatus.declined
                completed_at = None
            else:
                status = DocumentStatus.completed
                completed_at = created + timedelta(hours=2, minutes=14 + (n % 40))
            sender = senders[n % len(senders)]
            template = s.templates.get(template_titles[n % len(template_titles)])
            document = s.upsert(
                Document,
                _document_natural_key(s, acme.id, title),
                {
                    "sender_id": sender.id,
                    "owner_user_id": sender.id,
                    "status": status,
                    "workflow_type": WorkflowType.sequential,
                    "page_count": 2 + (n % 5),
                    "doc_type": "envelope",
                    "source_template_id": template.id if template else None,
                    "sent_at": created + timedelta(minutes=2),
                    "completed_at": completed_at,
                    "expires_at": created + timedelta(days=14),
                    "created_at": created,
                    "updated_at": completed_at or created,
                },
            )
            s.bump("history_documents")
            for slot in range(2):
                email, name, should_complete = pool[cursor % len(pool)]
                cursor += 1
                if status == DocumentStatus.declined and slot == 1:
                    rstatus = RecipientStatus.declined
                elif status == DocumentStatus.completed and should_complete:
                    rstatus = RecipientStatus.completed
                elif status == DocumentStatus.completed:
                    rstatus = RecipientStatus.completed
                else:
                    rstatus = RecipientStatus.sent
                s.upsert(
                    Recipient,
                    {"document_id": document.id, "email": email},
                    {
                        "name": name,
                        "role_name": "Signer" if slot == 0 else "Approver",
                        "role": "sign" if slot == 0 else "approve",
                        "signing_order": slot + 1,
                        "status": rstatus,
                        "viewed_at": created + timedelta(hours=1),
                        "completed_at": completed_at
                        if rstatus == RecipientStatus.completed
                        else None,
                        "declined_at": created + timedelta(hours=3)
                        if rstatus == RecipientStatus.declined
                        else None,
                        "decline_reason": "Terms require legal review"
                        if rstatus == RecipientStatus.declined
                        else None,
                        "consent_accepted": rstatus == RecipientStatus.completed,
                        "created_at": created,
                    },
                )
                s.bump("history_recipients")
    s.db.flush()


def _seed_usage(s: Seeder) -> None:
    """Usage events behind the platform's USAGE_ROWS meters."""
    from app.models.usage_event import UsageEvent

    from sqlalchemy import select

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    specs = [
        ("envelope_sent", 38912),
        ("api_call", 4_100_000),
        ("sms_authentication", 2310),
        ("storage_bytes", 1_275_068_575_744),
    ]
    for event_type, quantity in specs:
        existing = s.db.scalars(
            select(UsageEvent).where(
                UsageEvent.organization_id == acme.id,
                UsageEvent.event_type == event_type,
            ).limit(1)
        ).first()
        if existing is not None:
            continue
        s.db.add(
            UsageEvent(
                organization_id=acme.id,
                event_type=event_type,
                quantity=quantity,
                occurred_at=s.now - timedelta(days=1),
                event_metadata={"seeded_by": SEED_MARKER, "window": "30d"},
            )
        )
        s.bump("usage_events")
    s.db.flush()


def _seed_invoices_and_charges(s: Seeder) -> None:
    from app.models.charge import Charge
    from app.models.invoice import Invoice

    for spec in INVOICES:
        org = s.orgs[spec["slug"]]
        period_start = _month_start(_months_before(s.now, spec["period_months_ago"]))
        period_end = _month_start(_months_before(s.now, spec["period_months_ago"] - 1))
        if spec["status"] == "past_due":
            due_at = s.now - timedelta(days=spec.get("overdue_days", 9))
        else:
            due_at = period_end
        invoice = s.upsert(
            Invoice,
            {"number": spec["number"]},
            {
                "organization_id": org.id,
                "status": spec["status"],
                "currency": "USD",
                "subtotal_cents": spec["subtotal"],
                "tax_cents": spec["tax"],
                "total_cents": spec["total"],
                "amount_paid_cents": spec["paid"],
                "period_start": period_start,
                "period_end": period_end,
                "period_label": f"{period_start:%b %Y}",
                "issued_at": period_start,
                "due_at": due_at,
                "paid_at": period_start + timedelta(days=2) if spec["paid"] else None,
                "line_items": [
                    {
                        "description": description,
                        "quantity": quantity,
                        "unit_cents": unit,
                        "amount_cents": amount,
                    }
                    for description, quantity, unit, amount in spec["lines"]
                ],
                "provider": "dev",
                "provider_invoice_id": f"in_{spec['number'].lower().replace('-', '')}",
                "provider_payment_intent_id": spec["pi"],
                "payment_method_label": spec["method"],
                "created_at": period_start,
            },
        )
        s.invoices[spec["number"]] = invoice
        s.bump("invoices")

    # Twelve months of history so the revenue invoiced/collected series ramps.
    for spec in TENANTS:
        if spec["status"] == "Suspended":
            continue
        org = s.orgs[spec["slug"]]
        monthly = spec["mrr"] * 100
        for months_ago in range(2, 13):
            period_start = _month_start(_months_before(s.now, months_ago))
            if period_start < _month_start(_months_before(s.now, spec["months_ago"])):
                continue
            number = f"INV-H-{spec['slug'][:10].upper()}-{period_start:%Y%m}"
            s.upsert(
                Invoice,
                {"number": number},
                {
                    "organization_id": org.id,
                    "status": "paid",
                    "subtotal_cents": monthly,
                    "tax_cents": 0,
                    "total_cents": monthly,
                    "amount_paid_cents": monthly,
                    "period_start": period_start,
                    "period_end": _month_start(_months_before(s.now, months_ago - 1)),
                    "period_label": f"{period_start:%b %Y}",
                    "issued_at": period_start,
                    "due_at": period_start + timedelta(days=14),
                    "paid_at": period_start + timedelta(days=3),
                    "line_items": [
                        {
                            "description": f"{spec['plan'].title()} seats — {spec['seats']}",
                            "quantity": spec["seats"],
                            "unit_cents": monthly // max(spec["seats"], 1),
                            "amount_cents": monthly,
                        }
                    ],
                    "provider": "dev",
                    "payment_method_label": "on file",
                    "created_at": period_start,
                },
            )
            s.bump("historical_invoices")

    for spec in CHARGES:
        org = s.orgs[spec["slug"]]
        invoice = s.invoices.get(spec["invoice"]) if spec["invoice"] else None
        s.upsert(
            Charge,
            {"provider_payment_id": spec["pi"], "organization_id": org.id},
            {
                "invoice_id": invoice.id if invoice else None,
                "amount_cents": spec["amount"],
                "currency": "USD",
                "status": spec["status"],
                "provider": "dev",
                "method_label": spec["method"],
                "decline_code": spec.get("decline_code"),
                "dunning_step": spec.get("dunning_step"),
                "next_attempt_at": s.now + timedelta(days=spec["next_attempt_days"])
                if spec.get("next_attempt_days")
                else None,
                "description": spec["description"],
                "occurred_at": s.now - timedelta(days=spec["days_ago"]),
                "created_at": s.now - timedelta(days=spec["days_ago"]),
            },
        )
        s.bump("charges")
    s.db.flush()


def _seed_payment_methods(s: Seeder) -> None:
    from app.models.payment_method import PaymentMethod

    for spec in PAYMENT_METHODS:
        org = s.orgs[spec["slug"]]
        method = s.upsert(
            PaymentMethod,
            {"organization_id": org.id, "provider_payment_method_id": spec["provider_id"]},
            {
                "type": spec["type"],
                "brand": spec["brand"],
                "last4": spec["last4"],
                "exp_month": spec.get("exp_month"),
                "exp_year": spec.get("exp_year"),
                "holder_name": spec["holder"],
                "country": spec["country"],
                "label": spec["label"],
                "meta": spec["meta"],
                "provider": "dev",
                "is_default": spec["default"],
            },
        )
        if spec["default"] and org.default_payment_method_id is None:
            org.default_payment_method_id = method.id
        s.bump("payment_methods")
    s.db.flush()


def _seed_webhooks(s: Seeder) -> None:
    """A tenant endpoint plus the provider events the revenue screen lists."""
    from app.models.subscription import ProcessedWebhookEvent
    from app.models.webhook import WebhookDelivery, WebhookEndpoint

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    endpoint = s.upsert(
        WebhookEndpoint,
        {"organization_id": acme.id, "url": "https://hooks.acme.io/signforge"},
        {
            "secret": "whsec_seed_acme_signforge",
            "event_types": ["envelope.sent", "envelope.completed", "invoice.payment_failed"],
            "is_active": True,
            "description": "Host CRM listener",
        },
    )
    s.upsert(
        WebhookDelivery,
        {"endpoint_id": endpoint.id, "event_id": "wh_5512aa"},
        {
            "event_type": "envelope.sent",
            "document_id": s.documents["ENV-2291-KD"].id,
            "payload": {"event": "envelope.sent", "envelope": "ENV-2291-KD"},
            "attempt": 1,
            "status": "delivered",
            "status_code": 200,
            "delivered_at": s.now - timedelta(minutes=147),
        },
    )

    halden = s.orgs["halden"]
    failing = s.upsert(
        WebhookEndpoint,
        {"organization_id": halden.id, "url": "https://halden.de/hooks/sf"},
        {
            "secret": "whsec_seed_halden",
            "event_types": ["invoice.payment_failed"],
            "is_active": True,
            "description": "Billing listener (returning 502)",
        },
    )
    s.upsert(
        WebhookDelivery,
        {"endpoint_id": failing.id, "event_id": "wh_halden_502"},
        {
            "event_type": "invoice.payment_failed",
            "payload": {"event": "invoice.payment_failed", "invoice": "INV-2026-0777"},
            "attempt": 4,
            "status": "failed",
            "status_code": 502,
            "error": "upstream timed out after 30s",
            "next_retry_at": s.now + timedelta(hours=2),
        },
    )
    s.bump("webhook_endpoints", 2)

    for spec in STRIPE_WEBHOOKS:
        s.upsert(
            ProcessedWebhookEvent,
            {"provider": "stripe", "event_id": spec["event_id"]},
            {
                "event_type": spec["event_type"],
                "received_at": s.now - timedelta(minutes=spec["minutes_ago"]),
                "payload": {"id": spec["event_id"], "type": spec["event_type"]},
                "status_code": spec["code"],
                "processed": spec["code"] == 200,
                "error": None if spec["code"] == 200 else "endpoint returned 502",
            },
        )
        s.bump("provider_events")
    s.db.flush()


def _seed_support(s: Seeder) -> None:
    from app.models.support import SupportTicket, TicketMessage

    for spec in TICKETS:
        org = s.orgs[spec["slug"]]
        created = s.now - timedelta(hours=spec["created_hours_ago"])
        requester = s.users.get(spec["requester_email"])
        assignee = s.users.get(spec["assignee"]) if spec["assignee"] else None
        document = s.documents.get(spec["document_ref"]) if spec["document_ref"] else None
        resolved_at = (
            created + timedelta(minutes=spec["resolved_after_minutes"])
            if spec.get("resolved_after_minutes")
            else None
        )
        ticket = s.upsert(
            SupportTicket,
            {"reference": spec["reference"]},
            {
                "organization_id": org.id,
                "subject": spec["subject"],
                "category": spec["category"],
                "status": spec["status"],
                "priority": spec["priority"],
                "created_by_user_id": requester.id if requester else None,
                "assignee_user_id": assignee.id if assignee else None,
                "resolved_at": resolved_at,
                "document_id": document.id if document else None,
                "tags": spec["tags"],
                "sla_due_at": created + timedelta(hours=spec["sla_hours"])
                if spec["sla_hours"]
                else None,
                "requester_name": spec["requester"],
                "requester_email": spec["requester_email"],
                "created_at": created,
                "updated_at": created,
            },
        )
        s.bump("tickets")
        for message in spec["messages"]:
            author = s.users.get(message["email"])
            s.upsert(
                TicketMessage,
                {"ticket_id": ticket.id, "body": message["body"]},
                {
                    "author_user_id": author.id if author else None,
                    "author_name": message["author"],
                    "is_staff": message["staff"],
                    "is_internal": message["internal"],
                    "created_at": created + timedelta(minutes=message["offset"]),
                },
            )
            s.bump("ticket_messages")
    s.db.flush()


def _seed_logs_and_platform_audit(s: Seeder) -> None:
    from app.models.platform_audit import PlatformAuditEntry
    from app.models.system_log import SystemLog

    from sqlalchemy import select

    for spec in LOGS:
        org = s.orgs.get(spec["slug"]) if spec["slug"] else None
        occurred_at = s.now - timedelta(minutes=spec["minutes_ago"])
        existing = s.db.scalars(
            select(SystemLog).where(SystemLog.message == spec["message"]).limit(1)
        ).first()
        if existing is not None:
            continue
        s.db.add(
            SystemLog(
                organization_id=org.id if org else None,
                occurred_at=occurred_at,
                level=spec["level"],
                source=spec["source"],
                message=spec["message"],
                status_code=spec["code"],
                latency_ms=spec["latency_ms"],
                request_id=spec["request_id"],
                actor_email=spec["actor"],
                ip_address=spec["ip"],
                payload=spec["payload"],
            )
        )
        s.bump("system_logs")

    for spec in PLATFORM_AUDIT:
        org = s.orgs.get(spec["slug"]) if spec["slug"] else None
        actor = s.users.get(spec["actor"])
        existing = s.db.scalars(
            select(PlatformAuditEntry)
            .where(
                PlatformAuditEntry.action == spec["action"],
                PlatformAuditEntry.detail == spec["detail"],
            )
            .limit(1)
        ).first()
        if existing is not None:
            continue
        s.db.add(
            PlatformAuditEntry(
                action=spec["action"],
                actor_user_id=actor.id if actor else None,
                actor_email=spec["actor"],
                organization_id=org.id if org else None,
                detail=spec["detail"],
                ip_address=spec["ip"],
                entry_metadata={"seeded_by": SEED_MARKER},
                created_at=s.now - timedelta(minutes=spec["minutes_ago"]),
            )
        )
        s.bump("platform_audit_entries")
    s.db.flush()


def _seed_api_keys(s: Seeder) -> None:
    from app.models.api_key import ApiKey
    from app.services.api_key_service import hash_api_key

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    creator = s.users["jordan.mehta@northwind.com"]
    for spec in API_KEYS:
        raw = SEED_API_KEYS[spec["label"]]
        _, mode, body = raw.split("_", 2)
        s.upsert(
            ApiKey,
            {"organization_id": acme.id, "label": spec["label"]},
            {
                "mode": spec["mode"],
                "prefix": f"sk_{mode}_{body[:4]}",
                "last_four": body[-4:],
                "key_hash": hash_api_key(raw),
                "scopes": API_KEY_SEED_SCOPES,
                "created_by_user_id": creator.id,
                "last_used_at": s.now - timedelta(minutes=spec["last_used_minutes_ago"]),
                "revoked_at": s.now - timedelta(days=2) if spec["revoked"] else None,
                "created_at": s.now - timedelta(days=spec["created_days_ago"]),
            },
        )
        s.bump("api_keys")
    s.db.flush()


def _seed_platform_settings(s: Seeder) -> None:
    """Feature flags, per-tenant overrides, security posture, certifications."""
    from sqlalchemy import select

    from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
    from app.models.platform_setting import SecurityPosture
    from app.services import platform_service

    platform_service.ensure_feature_flags(s.db)
    platform_service.ensure_security_posture(s.db)
    platform_service.ensure_certifications(s.db)

    admin = s.users[SUPER_ADMIN_EMAIL]
    for flag in s.db.scalars(select(FeatureFlag)):
        s.flags[flag.key] = flag
        state = FLAG_STATE.get(flag.key)
        if state is None:
            continue
        enabled, rollout = state
        flag.enabled = enabled
        flag.rollout_pct = rollout
        flag.updated_by_user_id = admin.id
        s.bump("feature_flags")

    for key, slug, enabled in FLAG_OVERRIDES:
        flag = s.flags.get(key)
        org = s.orgs.get(slug)
        if flag is None or org is None:
            continue
        s.upsert(
            FeatureFlagOverride,
            {"flag_id": flag.id, "organization_id": org.id},
            {"enabled": enabled},
        )
        s.bump("flag_overrides")

    for posture in s.db.scalars(select(SecurityPosture)):
        if posture.key in SECURITY_STATE:
            posture.enabled = SECURITY_STATE[posture.key]
            posture.updated_by_user_id = admin.id
            s.bump("security_posture")
    s.db.flush()


def _seed_account_area(s: Seeder) -> None:
    """Integrations, cloud targets, notification prefs, devices, signatures."""
    from app.models.integration import CloudTarget, Integration
    from app.models.notification import Notification, NotificationPreference
    from app.models.saved_signature import SavedSignature
    from app.models.user_session import UserSession

    acme = s.orgs[PRIMARY_TENANT_SLUG]
    owner = s.users["jordan.mehta@northwind.com"]

    for provider, label, detail, connected in INTEGRATIONS:
        s.upsert(
            Integration,
            {"organization_id": acme.id, "provider": provider},
            {
                "label": label,
                "detail": detail,
                "connected": connected,
                "connected_at": s.now - timedelta(days=40) if connected else None,
                "config": {"seeded_by": SEED_MARKER},
            },
        )
        s.bump("integrations")

    for provider, path, enabled in CLOUD_TARGETS:
        s.upsert(
            CloudTarget,
            {"organization_id": acme.id, "provider": provider},
            {"path": path or None, "enabled": enabled},
        )
        s.bump("cloud_targets")

    for event_key, enabled in NOTIF_PREFS:
        s.upsert(
            NotificationPreference,
            {"user_id": owner.id, "event_key": event_key},
            {"enabled": enabled, "extra_recipients": ["ap@acme.io"] if event_key == "payment_failed" else None},
        )
        s.bump("notification_preferences")

    for spec in NOTIFICATIONS:
        s.upsert(
            Notification,
            {"user_id": owner.id, "title": spec["title"]},
            {
                "organization_id": acme.id,
                "detail": spec["detail"],
                "tone": spec["tone"],
                "screen": spec["screen"],
                "created_at": s.now - timedelta(minutes=spec["minutes_ago"]),
            },
        )
        s.bump("notifications")

    for spec in DEVICES:
        s.upsert(
            UserSession,
            {"user_id": owner.id, "device": spec["device"]},
            {
                # Display-only rows: the hash is of a value never issued as a
                # token, so these sessions can be listed but not used to refresh.
                "refresh_token_hash": sha256(
                    f"{SEED_MARKER}:{owner.email}:{spec['device']}".encode()
                ).hexdigest(),
                "browser": spec["browser"],
                "os": spec["os"],
                "ip_address": spec["ip"],
                "location": spec["location"],
                "user_agent": f"{spec['browser']} / {spec['os']}",
                "last_seen_at": s.now - timedelta(days=spec["days_ago"]),
                "expires_at": s.now + timedelta(days=30),
                "created_at": s.now - timedelta(days=spec["days_ago"] + 1),
            },
        )
        s.bump("user_sessions")

    for spec in SAVED_SIGNATURES:
        adopted = s.now - timedelta(days=spec["days_ago"])
        s.upsert(
            SavedSignature,
            {"user_id": owner.id, "type_face": spec["face"]},
            {
                "recipient_email": owner.email,
                "label": f"{spec['label']} {adopted:%d %b %Y}",
                "signature_type": spec["type"],
                "signature_text": spec["text"],
                "is_passkey_bound": spec["passkey"],
                "adopted_at": adopted,
            },
        )
        s.bump("saved_signatures")
    s.db.flush()


#: Ordered pipeline. Each step is idempotent on its own.
STEPS: list[tuple[str, Callable[[Seeder], None]]] = [
    ("plans", _seed_plans),
    ("organizations", _seed_organizations),
    ("users", _seed_users),
    ("subscriptions", _seed_subscriptions),
    ("contacts", _seed_contacts),
    ("folders and teams", _seed_folders_and_teams),
    ("templates", _seed_templates),
    ("documents", _seed_documents),
    ("audit trail", _seed_audit),
    ("historical envelopes", _seed_history),
    ("usage", _seed_usage),
    ("invoices and charges", _seed_invoices_and_charges),
    ("payment methods", _seed_payment_methods),
    ("webhooks", _seed_webhooks),
    ("support", _seed_support),
    ("logs and platform audit", _seed_logs_and_platform_audit),
    ("api keys", _seed_api_keys),
    ("platform settings", _seed_platform_settings),
    ("account area", _seed_account_area),
]


# --------------------------------------------------------------------------
# Public entry points
# --------------------------------------------------------------------------


def seed(db: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """Write the SignForge dataset into ``db``. Safe to run repeatedly.

    Returns a summary: ``created`` counts rows this run actually inserted (all
    zeros on a second run), ``counts`` the total the design expects.
    """
    seeder = Seeder(db, now=now)
    for _label, step in STEPS:
        step(seeder)
    db.commit()
    return {
        "created": dict(seeder.created),
        "counts": dict(seeder.counts),
        "created_total": sum(seeder.created.values()),
        "password": SEED_PASSWORD,
        "api_keys": dict(SEED_API_KEYS),
        "super_admin": SUPER_ADMIN_EMAIL,
    }


#: Deletion order for ``--reset``: children before parents.
def _reset_models() -> list[Any]:
    from app.models.api_key import ApiKey
    from app.models.audit_log import AuditLog
    from app.models.charge import Charge
    from app.models.contact import Contact, ContactGroup
    from app.models.document import Document
    from app.models.document_favorite import DocumentFavorite
    from app.models.document_version import DocumentVersion
    from app.models.embed_session import EmbedSession
    from app.models.feature_flag import FeatureFlagOverride
    from app.models.field import Field
    from app.models.folder import Folder
    from app.models.impersonation import ImpersonationSession
    from app.models.integration import CloudTarget, Integration
    from app.models.invitation import Invitation
    from app.models.invoice import Invoice
    from app.models.notification import Notification, NotificationPreference
    from app.models.organization import Organization
    from app.models.password_reset import PasswordResetToken
    from app.models.payment_method import PaymentMethod
    from app.models.platform_audit import PlatformAuditEntry
    from app.models.recipient import Recipient
    from app.models.report import CustomReport, ReportExport, ReportSchedule
    from app.models.saved_signature import SavedSignature
    from app.models.signature import Signature
    from app.models.signing_token import SigningToken
    from app.models.subscription import ProcessedWebhookEvent, Subscription
    from app.models.support import SupportTicket, TicketMessage
    from app.models.system_log import SystemLog
    from app.models.team import Team, TeamMember
    from app.models.usage_event import UsageEvent
    from app.models.user import User
    from app.models.user_session import UserSession
    from app.models.webhook import WebhookDelivery, WebhookEndpoint

    return [
        ApiKey,
        TicketMessage, SupportTicket,
        WebhookDelivery, WebhookEndpoint, ProcessedWebhookEvent,
        Charge, Invoice, PaymentMethod, Subscription, UsageEvent,
        Signature, SigningToken, Field, DocumentVersion, DocumentFavorite,
        AuditLog, Recipient, EmbedSession,
        ReportExport, ReportSchedule, CustomReport,
        Notification, NotificationPreference, SavedSignature, UserSession,
        PasswordResetToken, Invitation, ImpersonationSession,
        FeatureFlagOverride, PlatformAuditEntry, SystemLog,
        Integration, CloudTarget, Contact, ContactGroup,
        TeamMember, Team,
        Document, Folder,
        User, Organization,
    ]


def reset(db: Any) -> int:
    """Delete every row the seeder owns, children first.

    This clears the whole tenant graph — it is a development convenience, not a
    surgical undo, and it is why the flag is opt-in.
    """
    from sqlalchemy import delete

    removed = 0
    for model in _reset_models():
        result = db.execute(delete(model))
        removed += result.rowcount or 0
    db.commit()
    return removed


def _report(summary: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    def line(text: str = "") -> None:
        print(text, file=stream)

    created = summary["created"]
    line()
    if created:
        line("Rows created this run:")
        for name in sorted(created):
            line(f"  {name:<24} {created[name]}")
    else:
        line("Nothing to create — the database already holds the SignForge dataset.")
    line()
    line("─" * 62)
    line("Sign in (all seeded accounts share one password)")
    line("─" * 62)
    line(f"  password: {SEED_PASSWORD}")
    line()
    line(f"  super admin     {SUPER_ADMIN_EMAIL}")
    line("  tenant admin    jordan.mehta@northwind.com   (Acme · Legal Ops)")
    line("  tenant admin    priya@acme.io                (Acme · Org admin)")
    line("  sender          m.bell@acme.io               (Acme)")
    line("  tenant admin    dana@northwind-legal.com     (Northwind Legal)")
    line("  sender          sofia@vertex.dev             (Vertex Robotics · trial)")
    line("  viewer          it@halden.de                 (Halden GmbH · past due)")
    line("  tenant admin    security@kestrel.health      (Kestrel Health)")
    line("  tenant admin    hello@lumen.studio           (Lumen Studio · suspended)")
    line()
    line("─" * 62)
    line("API keys (plaintext shown once — only the hash is stored)")
    line("─" * 62)
    for label, secret in SEED_API_KEYS.items():
        line(f"  {label:<26} {secret}")
    line()


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete the seeded tenant graph before seeding (development only)",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="SQLAlchemy URL; defaults to DATABASE_URL. Accepts sqlite+pysqlite:///./sf.db.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    # Imported after DATABASE_URL is settled: the engine is built at import time.
    from app import models  # noqa: F401  (registers every mapper)
    from app.core.database import Base, SessionLocal, engine

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if args.reset:
            removed = reset(db)
            print(f"Reset: removed {removed} row(s).")
        summary = seed(db)
    finally:
        db.close()

    print(f"Seeded the SignForge dataset into {engine.url.render_as_string(hide_password=True)}")
    _report(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
