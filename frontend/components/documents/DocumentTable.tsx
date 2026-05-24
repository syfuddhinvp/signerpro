"use client";

import Link from "next/link";
import { Edit3, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/documents/StatusBadge";
import type { DocumentRecord } from "@/lib/types";

export function DocumentTable({ documents }: { documents: DocumentRecord[] }) {
  if (documents.length === 0) {
    return (
      <div className="rounded-md border border-border bg-white p-8 text-center text-sm text-mutedForeground">
        No documents match the current view.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white shadow-panel">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wide text-mutedForeground">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Recipients</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id} className="border-t border-border">
              <td className="px-4 py-3 font-medium">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" aria-hidden />
                  {document.title}
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={document.status} />
              </td>
              <td className="px-4 py-3">
                {document.recipients_completed} / {document.recipients_total}
              </td>
              <td className="px-4 py-3">{new Date(document.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-3">{new Date(document.updated_at).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button asChild variant="secondary" className="h-8 px-2" title="Open document">
                    <Link href={`/documents/${document.id}`}>
                      <Eye className="h-4 w-4" />
                    </Link>
                  </Button>
                  {document.status === "draft" || document.status === "prepared" ? (
                    <Button asChild variant="secondary" className="h-8 px-2" title="Prepare document">
                      <Link href={`/documents/${document.id}/prepare`}>
                        <Edit3 className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

