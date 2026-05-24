"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Download, Edit3, Link2, Send, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toast, toast } from "@/components/ui/Toast";
import { StatusBadge } from "@/components/documents/StatusBadge";
import { apiFetch, downloadAuthenticated } from "@/lib/api";
import { requireToken } from "@/lib/auth";
import type { AuditLog, DocumentRecord, RecipientRecord } from "@/lib/types";

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [recipients, setRecipients] = useState<RecipientRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});

  async function load() {
    requireToken();
    const [doc, recips, audit] = await Promise.all([
      apiFetch<DocumentRecord>(`/api/documents/${params.id}`),
      apiFetch<RecipientRecord[]>(`/api/documents/${params.id}/recipients`),
      apiFetch<AuditLog[]>(`/api/documents/${params.id}/audit-logs`)
    ]);
    setDocument(doc);
    setRecipients(recips);
    setAuditLogs(audit);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load document"));
  }, [params.id]);

  useEffect(() => {
    if (document) {
      setTempTitle(document.title);
    }
  }, [document]);

  async function handleSaveTitle() {
    if (!tempTitle.trim()) {
      toast.error("Document name cannot be empty.");
      return;
    }
    try {
      await apiFetch(`/api/documents/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: tempTitle.trim() })
      });
      setDocument((prev) => prev ? { ...prev, title: tempTitle.trim() } : null);
      setIsEditingTitle(false);
      toast.success("Document name updated successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update document name");
    }
  }

  async function handleResendAndGetLink(recipientId: string) {
    setResendingId(recipientId);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiFetch<{ email: string; signing_link: string }>(
        `/api/documents/${params.id}/recipients/${recipientId}/resend`,
        { method: "POST" }
      );
      setGeneratedLinks((prev) => ({
        ...prev,
        [recipientId]: response.signing_link
      }));
      setSuccess("Signing link generated!");
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(response.signing_link);
        setSuccess("Signing email resent & link copied to clipboard!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend link");
    } finally {
      setResendingId(null);
    }
  }

  async function action(name: string, fn: () => Promise<unknown>, done: string) {
    setLoadingAction(name);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(done);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoadingAction(null);
    }
  }

  if (!document) return <main className="p-6 text-sm">Loading document...</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <Toast message={error} tone="error" />
      <Toast message={success} tone="success" />
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="secondary" asChild className="p-2.5 h-auto text-slate-500 hover:text-slate-900 border border-slate-200 shadow-sm">
            <Link href="/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="border-l border-slate-200 pl-3">
            <div className="mb-1 flex items-center gap-3">
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    className="h-9 w-64 bg-white border-slate-300 font-medium text-slate-800"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        await handleSaveTitle();
                      } else if (e.key === "Escape") {
                        setIsEditingTitle(false);
                        setTempTitle(document.title);
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    type="button"
                    onClick={handleSaveTitle}
                    className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsEditingTitle(false);
                      setTempTitle(document.title);
                    }}
                    className="h-9 px-3"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-2xl font-semibold text-slate-800">{document.title}</h1>
                  {(document.status === "draft" || document.status === "prepared" || document.is_template) && (
                    <button
                      onClick={() => {
                        setIsEditingTitle(true);
                        setTempTitle(document.title);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                      title="Edit Document Name"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              <StatusBadge status={document.status} />
              {document.is_template ? (
                <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-semibold text-indigo-800 shadow-sm border border-indigo-200 animate-pulse">
                  TEMPLATE
                </span>
              ) : null}
            </div>
            <p className="text-sm text-mutedForeground">Created {new Date(document.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {document.is_template ? (
            <>
              <Button
                type="button"
                onClick={async () => {
                  setLoadingAction("use-template");
                  try {
                    const newDoc = await apiFetch<DocumentRecord>(`/api/documents/templates/${document.id}/use`, {
                      method: "POST"
                    });
                    toast.success("Created a new copy from template successfully!");
                    router.push(`/documents/${newDoc.id}/prepare`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to use template");
                  } finally {
                    setLoadingAction(null);
                  }
                }}
                loading={loadingAction === "use-template"}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                <Edit3 className="h-4 w-4" />
                Use Template
              </Button>
              <Button asChild variant="secondary">
                <Link href={`/documents/${document.id}/prepare`}>
                  <Edit3 className="h-4 w-4" />
                  Prepare Blueprint
                </Link>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => action("original", () => downloadAuthenticated(`/api/documents/${document.id}/pdf`, `${document.title}.pdf`), "Original PDF downloaded.")}
                loading={loadingAction === "original"}
              >
                <Download className="h-4 w-4" />
                Original
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={loadingAction === "delete"}
                onClick={() => {
                  if (confirm("Are you sure you want to delete this template?")) {
                    action(
                      "delete",
                      async () => {
                        await apiFetch(`/api/documents/${document.id}`, { method: "DELETE" });
                        router.push("/dashboard");
                      },
                      "Template deleted successfully."
                    );
                  }
                }}
              >
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  action(
                    "save-template",
                    () =>
                      apiFetch(`/api/documents/${document.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ is_template: true })
                      }),
                    "Saved as a reusable template successfully!"
                  )
                }
                loading={loadingAction === "save-template"}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              >
                Save as Template
              </Button>
              {document.status === "draft" || document.status === "prepared" ? (
                <Button asChild variant="secondary">
                  <Link href={`/documents/${document.id}/prepare`}>
                    <Edit3 className="h-4 w-4" />
                    Prepare
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => action("original", () => downloadAuthenticated(`/api/documents/${document.id}/pdf`, `${document.title}.pdf`), "Original PDF downloaded.")}
                loading={loadingAction === "original"}
              >
                <Download className="h-4 w-4" />
                Original
              </Button>
              {document.status === "completed" ? (
                <Button
                  type="button"
                  onClick={() =>
                    action("final", () => downloadAuthenticated(`/api/documents/${document.id}/final-pdf`, `${document.title}-signed.pdf`), "Final PDF downloaded.")
                  }
                  loading={loadingAction === "final"}
                >
                  <Download className="h-4 w-4" />
                  Final PDF
                </Button>
              ) : null}
              <Button
                variant="secondary"
                loading={loadingAction === "remind"}
                onClick={() => action("remind", () => apiFetch(`/api/documents/${document.id}/remind`, { method: "POST" }), "Reminder links sent.")}
                disabled={!["sent", "viewed", "partially_completed"].includes(document.status)}
              >
                <Bell className="h-4 w-4" />
                Remind
              </Button>
              <Button
                variant="danger"
                loading={loadingAction === "void"}
                onClick={() => action("void", () => apiFetch(`/api/documents/${document.id}/void`, { method: "POST" }), "Document voided.")}
                disabled={document.status === "completed" || document.status === "voided"}
              >
                <ShieldOff className="h-4 w-4" />
                Void
              </Button>
              {(document.status === "draft" || document.status === "prepared") && (
                <Button
                  type="button"
                  variant="danger"
                  loading={loadingAction === "delete"}
                  onClick={() => {
                    if (confirm("Are you sure you want to delete this draft?")) {
                      action(
                        "delete",
                        async () => {
                          await apiFetch(`/api/documents/${document.id}`, { method: "DELETE" });
                          router.push("/dashboard");
                        },
                        "Draft deleted successfully."
                      );
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={`grid gap-6 ${document.is_template ? "grid-cols-1" : "lg:grid-cols-[1fr_1.2fr]"}`}>
        <section className="rounded-md border border-border bg-white p-5 shadow-panel">
          <h2 className="mb-4 text-lg font-semibold">
            {document.is_template ? "Template Recipient Roles" : "Recipients"}
          </h2>
          <div className="space-y-3">
            {recipients.map((recipient) => {
              const showResend = !document.is_template &&
                                ["sent", "viewed", "partially_completed"].includes(document.status) &&
                                ["sent", "viewed"].includes(recipient.status);

              return (
                <div key={recipient.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{recipient.name || "Recipient Placeholder"}</div>
                      <div className="text-sm text-mutedForeground">
                        {recipient.email || "No email assigned yet (Blueprint Role)"}
                      </div>
                      {recipient.role_name && (
                        <span className="mt-1 inline-block rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          Role: {recipient.role_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-mutedForeground">Order {recipient.signing_order}</span>
                      {!document.is_template && <StatusBadge status={recipient.status} />}
                    </div>
                  </div>

                  {showResend && (
                    <div className="pt-1">
                      {!generatedLinks[recipient.id] ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-xs px-2.5 py-1.5 h-auto flex items-center gap-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium"
                          onClick={() => handleResendAndGetLink(recipient.id)}
                          loading={resendingId === recipient.id}
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Resend & Get Shareable Link
                        </Button>
                      ) : (
                        <div className="mt-2 flex flex-col gap-1.5 p-2 bg-slate-50 border border-slate-100 rounded-md">
                          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Shareable Signing Link:</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={generatedLinks[recipient.id]}
                              className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs select-all font-mono outline-none text-slate-700"
                              onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <Button
                              type="button"
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-2.5 py-1 h-auto"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedLinks[recipient.id]);
                                setSuccess("Signing link copied to clipboard!");
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {!document.is_template && (
          <section className="rounded-md border border-border bg-white p-5 shadow-panel">
            <h2 className="mb-4 text-lg font-semibold">Audit trail</h2>
            <div className="max-h-[520px] space-y-3 overflow-auto pr-1">
              {auditLogs.map((log) => (
                <div key={log.id} className="border-l-2 border-primary/30 pl-3 text-sm">
                  <div className="font-medium">{log.event_type.replaceAll("_", " ")}</div>
                  <div className="text-mutedForeground">{log.event_message}</div>
                  <div className="mt-1 text-xs text-mutedForeground">{new Date(log.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
