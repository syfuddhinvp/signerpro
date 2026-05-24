"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { apiFetch } from "@/lib/api";
import type { FieldRecord, RecipientRecord } from "@/lib/types";

export function FieldPropertiesPanel({
  documentId,
  field,
  recipients,
  onChanged,
  onDeleted,
  onError
}: {
  documentId: string;
  field: FieldRecord | null;
  recipients: RecipientRecord[];
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [required, setRequired] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabel(field?.label ?? "");
    setRecipientId(field?.recipient_id ?? "");
    setPlaceholder(field?.placeholder ?? "");
    setDefaultValue(field?.default_value ?? "");
    setRequired(field?.required ?? true);
  }, [field]);

  if (!field) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-mutedForeground">Select a field to edit properties.</div>;
  }

  async function save() {
    if (!field) return;
    setSaving(true);
    try {
      await apiFetch(`/api/documents/${documentId}/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          label,
          recipient_id: recipientId,
          required,
          placeholder: placeholder || null,
          default_value: defaultValue || null
        })
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save field");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!field) return;
    try {
      await apiFetch(`/api/documents/${documentId}/fields/${field.id}`, { method: "DELETE" });
      onDeleted();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete field");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-white p-4">
      <label className="block text-sm font-medium">
        Label
        <Input className="mt-1" value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Recipient
        <Select className="mt-1" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
          {recipients.map((recipient) => (
            <option key={recipient.id} value={recipient.id}>
              {recipient.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-sm font-medium">
        Placeholder
        <Input className="mt-1" value={placeholder} onChange={(event) => setPlaceholder(event.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Default value
        <Input className="mt-1" value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />
        Required
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={save} loading={saving}>
          Save
        </Button>
        <Button type="button" variant="danger" onClick={remove}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}

