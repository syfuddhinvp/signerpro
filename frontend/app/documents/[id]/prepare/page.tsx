"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Minus, Plus, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Toast, toast } from "@/components/ui/Toast";
import { FieldToolbar } from "@/components/pdf-editor/FieldToolbar";
import { FieldPropertiesPanel } from "@/components/pdf-editor/FieldPropertiesPanel";
import { PdfViewer } from "@/components/pdf-editor/PdfViewer";
import { RecipientPanel } from "@/components/pdf-editor/RecipientPanel";
import { apiFetch } from "@/lib/api";
import { requireToken } from "@/lib/auth";
import { validateDocumentBeforeSend } from "@/lib/validators";
import { useDocumentEditorStore } from "@/stores/documentEditorStore";
import type { DocumentRecord, FieldRecord, RecipientRecord } from "@/lib/types";

type FieldCreatePayload = Omit<FieldRecord, "id" | "document_id" | "value" | "is_locked" | "created_at" | "updated_at" | "options">;

export default function PrepareDocumentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [recipients, setRecipients] = useState<RecipientRecord[]>([]);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [signingLinks, setSigningLinks] = useState<Array<{ email: string; signing_link: string }>>([]);
  const {
    selectedTool,
    selectedRecipientId,
    selectedFieldId,
    zoom,
    setSelectedTool,
    setSelectedRecipientId,
    setSelectedFieldId,
    setZoom
  } = useDocumentEditorStore();

  async function load() {
    requireToken();
    const [doc, recips, loadedFields] = await Promise.all([
      apiFetch<DocumentRecord>(`/api/documents/${params.id}`),
      apiFetch<RecipientRecord[]>(`/api/documents/${params.id}/recipients`),
      apiFetch<FieldRecord[]>(`/api/documents/${params.id}/fields`)
    ]);
    setDocument(doc);
    setRecipients(recips);
    setFields(loadedFields);
    if (!selectedRecipientId && recips[0]) setSelectedRecipientId(recips[0].id);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load editor"))
      .finally(() => setLoading(false));
  }, [params.id]);

  const selectedField = useMemo(() => fields.find((field) => field.id === selectedFieldId) ?? null, [fields, selectedFieldId]);
  const sendErrors = validateDocumentBeforeSend(recipients, fields);

  async function addField(payload: FieldCreatePayload) {
    if (!document) return;
    try {
      const field = await apiFetch<FieldRecord>(`/api/documents/${document.id}/fields`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setFields((current) => [...current, field]);
      setSelectedFieldId(field.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place field");
    }
  }

  async function updateField(field: FieldRecord, values: Partial<FieldRecord>) {
    if (!document) return;
    setFields((current) => current.map((item) => (item.id === field.id ? { ...item, ...values } : item)));
    try {
      const updated = await apiFetch<FieldRecord>(`/api/documents/${document.id}/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      setFields((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update field");
      await load();
    }
  }

  async function sendDocument() {
    if (!document || sendErrors.length > 0) {
      setError(sendErrors[0] ?? "Document is not ready to send");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await apiFetch<{ signing_links: Array<{ email: string; signing_link: string }> }>(`/api/documents/${document.id}/send`, {
        method: "POST"
      });
      setSigningLinks(response.signing_links);
      setSuccess("Document sent.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send document");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <main className="p-6 text-sm">Loading editor...</main>;
  if (!document) return <main className="p-6 text-sm">Document not found.</main>;

  const editorLocked = !["draft", "prepared"].includes(document.status);

  return (
    <main className="min-h-screen">
      <Toast message={error} tone="error" />
      <Toast message={success} tone="success" />
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" className="px-2">
              <Link href={`/documents/${document.id}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{document.title}</h1>
              <p className="text-xs text-mutedForeground">{document.workflow_type} signing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" className="px-2" onClick={() => setZoom(zoom - 0.1)} title="Zoom out">
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="secondary" className="px-2" onClick={() => setZoom(zoom + 0.1)} title="Zoom in">
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                toast.success("Draft saved successfully.");
                router.push(`/documents/${document.id}`);
              }}
              disabled={editorLocked}
            >
              Save Draft
            </Button>
            <Button type="button" onClick={sendDocument} loading={sending} disabled={editorLocked || sendErrors.length > 0}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </header>

      {signingLinks.length ? (
        <div className="border-b border-border bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="mx-auto max-w-7xl space-y-1">
            {signingLinks.map((link) => (
              <div key={link.email}>
                {link.email}:{" "}
                <a href={link.signing_link} className="font-medium underline">
                  {link.signing_link}
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid h-[calc(100vh-58px)] grid-cols-[260px_minmax(0,1fr)_340px] overflow-hidden">
        <aside className="border-r border-border bg-white p-4 overflow-y-auto h-full">
          <h2 className="mb-3 text-sm font-semibold">Fields</h2>
          <FieldToolbar selectedTool={selectedTool} onSelect={setSelectedTool} />
          {sendErrors.length ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {sendErrors[0]}
            </div>
          ) : null}
        </aside>

        <section className="overflow-auto bg-muted px-6 py-6 h-full">
          <PdfViewer
            document={document}
            fields={fields}
            recipients={recipients}
            selectedTool={selectedTool}
            selectedRecipientId={selectedRecipientId}
            selectedFieldId={selectedFieldId}
            zoom={zoom}
            onSelectField={setSelectedFieldId}
            onAddField={addField}
            onUpdateField={updateField}
          />
        </section>

        <aside className="space-y-5 overflow-y-auto border-l border-border bg-white p-4 h-full">
          <section>
            <h2 className="mb-3 text-sm font-semibold">Recipients</h2>
            <RecipientPanel
              document={document}
              recipients={recipients}
              selectedRecipientId={selectedRecipientId}
              onSelectedRecipientChange={setSelectedRecipientId}
              onReload={load}
              onError={setError}
            />
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold">Field properties</h2>
            <FieldPropertiesPanel
              documentId={document.id}
              field={selectedField}
              recipients={recipients}
              onChanged={load}
              onDeleted={() => setSelectedFieldId(null)}
              onError={setError}
            />
          </section>
        </aside>
      </div>
    </main>
  );
}

