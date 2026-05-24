"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api";
import { requireToken } from "@/lib/auth";
import type { DocumentRecord, WorkflowType } from "@/lib/types";

export default function NewDocumentPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("parallel");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    requireToken();
    if (!file) {
      setError("Choose a PDF file.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const document = await apiFetch<DocumentRecord>("/api/documents", {
        method: "POST",
        body: JSON.stringify({ title, workflow_type: workflowType })
      });
      const form = new FormData();
      form.append("upload", file);
      await apiFetch(`/api/documents/${document.id}/upload-pdf`, {
        method: "POST",
        body: form
      });
      router.push(`/documents/${document.id}/prepare`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Toast message={error} tone="error" />
      <h1 className="text-2xl font-semibold">New document</h1>
      <form onSubmit={submit} className="mt-6 rounded-md border border-border bg-white p-6 shadow-panel">
        <label className="mb-4 block text-sm font-medium">
          Document title
          <Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="mb-4 block text-sm font-medium">
          Signing workflow
          <Select className="mt-1" value={workflowType} onChange={(event) => setWorkflowType(event.target.value as WorkflowType)}>
            <option value="parallel">Parallel</option>
            <option value="sequential">Sequential</option>
          </Select>
        </label>
        <label className="mb-6 block text-sm font-medium">
          PDF
          <Input className="mt-1" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
        </label>
        <Button type="submit" loading={loading}>
          <Upload className="h-4 w-4" />
          Create and prepare
        </Button>
      </form>
    </main>
  );
}

