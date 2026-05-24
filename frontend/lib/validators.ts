import type { FieldRecord, RecipientRecord } from "@/lib/types";

export function validateDocumentBeforeSend(recipients: RecipientRecord[], fields: FieldRecord[]) {
  const errors: string[] = [];
  if (recipients.length === 0) errors.push("Add at least one recipient.");
  if (fields.length === 0) errors.push("Place at least one field.");
  for (const recipient of recipients) {
    const recipientFields = fields.filter((field) => field.recipient_id === recipient.id);
    if (!recipientFields.some((field) => field.required || field.type === "signature")) {
      errors.push(`${recipient.email} needs at least one required or signature field.`);
    }
  }
  for (const field of fields) {
    if (!field.recipient_id) errors.push(`${field.label} needs a recipient.`);
    if (Number(field.width) <= 0 || Number(field.height) <= 0) errors.push(`${field.label} must have a valid size.`);
  }
  return errors;
}

export function requiredFieldCompleted(field: FieldRecord) {
  if (!field.required) return true;
  if (field.type === "checkbox") return String(field.value).toLowerCase() === "true";
  return Boolean(field.value && field.value.trim().length > 0);
}

