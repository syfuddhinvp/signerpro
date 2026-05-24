"use client";

import { FormEvent, useState } from "react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/documents/StatusBadge";
import { apiFetch } from "@/lib/api";
import type { DocumentRecord, RecipientRecord, WorkflowType } from "@/lib/types";

const colors = ["#0f766e", "#d97706", "#2563eb", "#be123c", "#6d28d9", "#15803d"];

export function recipientColor(recipientId: string, recipients: RecipientRecord[]) {
  const index = Math.max(0, recipients.findIndex((recipient) => recipient.id === recipientId));
  return colors[index % colors.length];
}

export function RecipientPanel({
  document,
  recipients,
  selectedRecipientId,
  onSelectedRecipientChange,
  onReload,
  onError
}: {
  document: DocumentRecord;
  recipients: RecipientRecord[];
  selectedRecipientId: string | null;
  onSelectedRecipientChange: (recipientId: string | null) => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState("");
  const [signingOrder, setSigningOrder] = useState(1);
  const [workflowType, setWorkflowType] = useState<WorkflowType>(document.workflow_type);
  const [loading, setLoading] = useState(false);
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      if (editingRecipientId) {
        await apiFetch(`/api/documents/${document.id}/recipients/${editingRecipientId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            email,
            role_name: roleName || null,
            signing_order: signingOrder
          })
        });
        setEditingRecipientId(null);
      } else {
        const recipient = await apiFetch<RecipientRecord>(`/api/documents/${document.id}/recipients`, {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            role_name: roleName || null,
            signing_order: signingOrder
          })
        });
        onSelectedRecipientChange(recipient.id);
      }
      setName("");
      setEmail("");
      setRoleName("");
      setSigningOrder(1);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save recipient");
    } finally {
      setLoading(false);
    }
  }

  function cancelEdit() {
    setEditingRecipientId(null);
    setName("");
    setEmail("");
    setRoleName("");
    setSigningOrder(1);
  }

  async function updateWorkflow(next: WorkflowType) {
    setWorkflowType(next);
    try {
      await apiFetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ workflow_type: next })
      });
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update workflow");
    }
  }

  async function deleteRecipient(recipientId: string) {
    try {
      await apiFetch(`/api/documents/${document.id}/recipients/${recipientId}`, { method: "DELETE" });
      if (selectedRecipientId === recipientId) onSelectedRecipientChange(null);
      await onReload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete recipient");
    }
  }

  return (
    <div className="space-y-5">
      <label className="block text-sm font-medium">
        Workflow
        <Select className="mt-1" value={workflowType} onChange={(event) => updateWorkflow(event.target.value as WorkflowType)}>
          <option value="parallel">Parallel</option>
          <option value="sequential">Sequential</option>
        </Select>
      </label>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-border p-3">
        <div className="font-semibold text-sm mb-1">{editingRecipientId ? "Edit Recipient" : "New Recipient"}</div>
        <Input placeholder="Recipient name" value={name} onChange={(event) => setName(event.target.value)} required />
        <Input placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Input placeholder="Role" value={roleName} onChange={(event) => setRoleName(event.target.value)} />
        <Input
          type="number"
          min={1}
          value={signingOrder}
          onChange={(event) => setSigningOrder(Number(event.target.value))}
          aria-label="Signing order"
        />
        <div className="flex gap-2">
          <Button type="submit" loading={loading} className="w-full">
            {!editingRecipientId && <Plus className="h-4 w-4" />}
            {editingRecipientId ? "Save Changes" : "Add recipient"}
          </Button>
          {editingRecipientId && (
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-2">
        {recipients.map((recipient) => (
          <button
            key={recipient.id}
            type="button"
            onClick={() => onSelectedRecipientChange(recipient.id)}
            className={`w-full rounded-md border p-3 text-left text-sm transition ${
              selectedRecipientId === recipient.id ? "border-primary bg-primary/5" : "border-border bg-white hover:bg-muted"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: recipientColor(recipient.id, recipients) }} />
                  <span className="truncate">{recipient.name}</span>
                </div>
                <div className="truncate text-mutedForeground">{recipient.email}</div>
                <div className="mt-1 text-xs text-mutedForeground">Order {recipient.signing_order}</div>
              </div>
              <div className="flex items-center gap-1">
                <StatusBadge status={recipient.status} />
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-md p-1 hover:bg-slate-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingRecipientId(recipient.id);
                    setName(recipient.name);
                    setEmail(recipient.email);
                    setRoleName(recipient.role_name || "");
                    setSigningOrder(recipient.signing_order);
                  }}
                >
                  <Edit2 className="h-4 w-4 text-slate-500" />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-md p-1 hover:bg-red-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteRecipient(recipient.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

