"use client";

import { useMemo } from "react";
import { Document, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfPage } from "@/components/pdf-editor/PdfPage";
import { apiUrl } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import type { DocumentRecord, FieldRecord, FieldType, RecipientRecord } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export function PdfViewer({
  document,
  fields,
  recipients,
  selectedTool,
  selectedRecipientId,
  selectedFieldId,
  zoom,
  onSelectField,
  onAddField,
  onUpdateField
}: {
  document: DocumentRecord;
  fields: FieldRecord[];
  recipients: RecipientRecord[];
  selectedTool: FieldType;
  selectedRecipientId: string | null;
  selectedFieldId: string | null;
  zoom: number;
  onSelectField: (fieldId: string | null) => void;
  onAddField: Parameters<typeof PdfPage>[0]["onAddField"];
  onUpdateField: (field: FieldRecord, values: Partial<FieldRecord>) => void;
}) {
  const file = useMemo(() => {
    const token = getAuthToken();
    return {
      url: apiUrl(`/api/documents/${document.id}/pdf`),
      httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined
    };
  }, [document.id]);
  const pageWidth = Math.round(760 * zoom);

  return (
    <Document file={file} loading={<div className="p-6 text-sm">Loading PDF...</div>} error={<div className="p-6 text-sm text-red-700">Could not load PDF.</div>}>
      {Array.from({ length: document.page_count }, (_, index) => (
        <PdfPage
          key={index + 1}
          pageNumber={index + 1}
          width={pageWidth}
          fields={fields.filter((field) => field.page_number === index + 1)}
          recipients={recipients}
          selectedFieldId={selectedFieldId}
          selectedRecipientId={selectedRecipientId}
          selectedTool={selectedTool}
          onSelectField={onSelectField}
          onAddField={onAddField}
          onUpdateField={onUpdateField}
        />
      ))}
    </Document>
  );
}

