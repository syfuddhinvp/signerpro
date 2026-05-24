import type { FieldRecord, SigningSession } from "@/lib/types";

export function canSignerEditField(session: SigningSession, field: FieldRecord) {
  if (session.read_only) return false;
  if (field.is_locked) return false;
  return field.recipient_id === session.current_recipient_id;
}
