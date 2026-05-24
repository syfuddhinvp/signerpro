import { describe, expect, it } from "vitest";
import { canSignerEditField } from "@/lib/fieldPermissions";
import { requiredFieldCompleted, validateDocumentBeforeSend } from "@/lib/validators";
import type { FieldRecord, RecipientRecord, SigningSession } from "@/lib/types";

const recipient: RecipientRecord = {
  id: "recipient-1",
  document_id: "document-1",
  name: "Buyer",
  email: "buyer@example.com",
  role_name: "Buyer",
  signing_order: 1,
  status: "waiting",
  viewed_at: null,
  completed_at: null,
  declined_at: null,
  decline_reason: null,
  created_at: "",
  updated_at: ""
};

const field: FieldRecord = {
  id: "field-1",
  document_id: "document-1",
  recipient_id: "recipient-1",
  type: "full_name",
  label: "Buyer name",
  required: true,
  page_number: 1,
  x: "72",
  y: "72",
  width: "180",
  height: "32",
  placeholder: null,
  default_value: null,
  value: "",
  options: null,
  is_locked: false,
  created_at: "",
  updated_at: ""
};

describe("validators", () => {
  it("requires every recipient to have a required or signature field", () => {
    expect(validateDocumentBeforeSend([recipient], [])).toContain("Place at least one field.");
    expect(validateDocumentBeforeSend([recipient], [field])).toEqual([]);
  });

  it("treats required checkbox as complete only when checked", () => {
    expect(requiredFieldCompleted({ ...field, type: "checkbox", value: "false" })).toBe(false);
    expect(requiredFieldCompleted({ ...field, type: "checkbox", value: "true" })).toBe(true);
  });

  it("allows a signer to edit only their assigned fields", () => {
    const session: SigningSession = {
      document: { title: "Packet", status: "sent", workflow_type: "parallel", page_count: 1 },
      recipient: { name: "Buyer", email: "buyer@example.com", role_name: "Buyer", status: "viewed" },
      current_recipient_id: "recipient-1",
      fields: [field],
      read_only: false,
      expires_at: "",
      pdf_url: "",
      required_total: 1,
      required_completed: 0
    };
    expect(canSignerEditField(session, field)).toBe(true);
    expect(canSignerEditField(session, { ...field, id: "field-2", recipient_id: "recipient-2" })).toBe(false);
  });
});

