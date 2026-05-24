"use client";

import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SignatureModal } from "@/components/signer/SignatureModal";
import { canSignerEditField } from "@/lib/fieldPermissions";
import type { FieldRecord, SigningSession } from "@/lib/types";

export function SignerField({
  field,
  session,
  color,
  onSaveValue,
  onSaveSignature
}: {
  field: FieldRecord;
  session: SigningSession;
  color: string;
  onSaveValue: (field: FieldRecord, value: string | boolean) => Promise<void>;
  onSaveSignature: (
    field: FieldRecord,
    payload: { signature_type: "typed" | "drawn"; signature_text?: string; signature_image_base64?: string }
  ) => Promise<void>;
}) {
  const editable = canSignerEditField(session, field);
  const [value, setValue] = useState(field.value ?? field.default_value ?? defaultValue(field, session));
  const [signatureOpen, setSignatureOpen] = useState(false);
  const isMine = field.recipient_id === session.current_recipient_id;

  useEffect(() => {
    setValue(field.value ?? field.default_value ?? defaultValue(field, session));
  }, [field, session]);

  async function commit(next: string | boolean = value) {
    if (!editable) return;
    await onSaveValue(field, next);
  }

  if (field.type === "checkbox") {
    return (
      <label
        data-field-id={field.id}
        className={`flex h-full w-full items-center justify-center rounded border-2 bg-white/95 ${editable ? "cursor-pointer" : "opacity-55"}`}
        style={{ borderColor: color, color }}
      >
        <input
          type="checkbox"
          className="h-4 w-4"
          disabled={!editable}
          checked={String(value).toLowerCase() === "true"}
          onChange={(event) => {
            setValue(String(event.target.checked));
            commit(event.target.checked);
          }}
        />
      </label>
    );
  }

  if (field.type === "signature") {
    return (
      <>
        <button
          type="button"
          data-field-id={field.id}
          className={`flex h-full w-full items-center justify-center gap-2 rounded border-2 bg-white/95 px-2 text-sm font-medium ${editable ? "" : "opacity-55"}`}
          style={{ borderColor: color, color }}
          disabled={!editable}
          onClick={() => setSignatureOpen(true)}
        >
          <PenLine className="h-4 w-4" />
          {field.value || (isMine ? "Sign" : "Pending")}
        </button>
        <SignatureModal
          open={signatureOpen}
          signerName={session.recipient.name}
          onClose={() => setSignatureOpen(false)}
          onSave={(payload) => onSaveSignature(field, payload)}
        />
      </>
    );
  }

  return (
    <Input
      data-field-id={field.id}
      className={`h-full w-full border-2 bg-white/95 text-sm ${editable ? "" : "opacity-55"}`}
      style={{ borderColor: color, color }}
      disabled={!editable}
      value={value}
      placeholder={field.placeholder ?? field.label}
      type={field.type === "date" ? "date" : "text"}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit()}
    />
  );
}

function defaultValue(field: FieldRecord, session: SigningSession) {
  if (field.recipient_id !== session.current_recipient_id) return "";
  if (field.type === "full_name") return session.recipient.name;
  if (field.type === "date") return new Date().toISOString().slice(0, 10);
  return "";
}
