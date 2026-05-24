"use client";

import { useRef, useState } from "react";
import { Page } from "react-pdf";
import { FieldOverlay } from "@/components/pdf-editor/FieldOverlay";
import { toPdfCoordinates } from "@/lib/coordinateTransform";
import type { FieldRecord, FieldType, RecipientRecord } from "@/lib/types";

interface PageSize {
  displayedWidth: number;
  displayedHeight: number;
  pdfWidth: number;
  pdfHeight: number;
}

const defaultSizes: Record<FieldType, { width: number; height: number; label: string }> = {
  signature: { width: 180, height: 48, label: "Signature" },
  full_name: { width: 180, height: 34, label: "Full Name" },
  date: { width: 120, height: 34, label: "Date" },
  text: { width: 180, height: 38, label: "Text" },
  checkbox: { width: 26, height: 26, label: "Checkbox" },
  currency: { width: 140, height: 38, label: "Currency" },
  number: { width: 120, height: 38, label: "Number" },
  dropdown: { width: 160, height: 38, label: "Dropdown" },
  radio: { width: 140, height: 38, label: "Radio" }
};

export function PdfPage({
  pageNumber,
  width,
  fields,
  recipients,
  selectedFieldId,
  selectedRecipientId,
  selectedTool,
  onSelectField,
  onAddField,
  onUpdateField
}: {
  pageNumber: number;
  width: number;
  fields: FieldRecord[];
  recipients: RecipientRecord[];
  selectedFieldId: string | null;
  selectedRecipientId: string | null;
  selectedTool: FieldType;
  onSelectField: (fieldId: string | null) => void;
  onAddField: (field: Omit<FieldRecord, "id" | "document_id" | "value" | "is_locked" | "created_at" | "updated_at" | "options">) => void;
  onUpdateField: (field: FieldRecord, values: Partial<FieldRecord>) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PageSize | null>(null);

  function dropped(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!selectedRecipientId || !size || !pageRef.current) return;
    const type = (event.dataTransfer.getData("application/signflow-field") || selectedTool) as FieldType;
    const defaults = defaultSizes[type];
    const bounds = pageRef.current.getBoundingClientRect();
    const screenX = event.clientX - bounds.left;
    const screenY = event.clientY - bounds.top;
    const pdf = toPdfCoordinates({
      screenX,
      screenY,
      screenWidth: defaults.width,
      screenHeight: defaults.height,
      displayedPageWidth: size.displayedWidth,
      displayedPageHeight: size.displayedHeight,
      pdfPageWidth: size.pdfWidth,
      pdfPageHeight: size.pdfHeight
    });
    onAddField({
      recipient_id: selectedRecipientId,
      type,
      label: defaults.label,
      required: true,
      page_number: pageNumber,
      x: String(pdf.pdfX),
      y: String(pdf.pdfY),
      width: String(pdf.pdfWidth),
      height: String(pdf.pdfHeight),
      placeholder: null,
      default_value: type === "date" ? new Date().toISOString().slice(0, 10) : null
    });
  }

  return (
    <div
      ref={pageRef}
      className="relative mx-auto mb-6 w-fit"
      onDrop={dropped}
      onDragOver={(event) => event.preventDefault()}
      onClick={() => onSelectField(null)}
    >
      <Page
        pageNumber={pageNumber}
        width={width}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={(page) => {
          const view = page.view;
          setSize({
            displayedWidth: page.width,
            displayedHeight: page.height,
            pdfWidth: view[2] - view[0],
            pdfHeight: view[3] - view[1]
          });
        }}
      />
      {size ? (
        <div className="absolute left-0 top-0" style={{ width: size.displayedWidth, height: size.displayedHeight }}>
          <FieldOverlay
            fields={fields}
            recipients={recipients}
            selectedFieldId={selectedFieldId}
            displayedPageWidth={size.displayedWidth}
            displayedPageHeight={size.displayedHeight}
            pdfPageWidth={size.pdfWidth}
            pdfPageHeight={size.pdfHeight}
            onSelectField={onSelectField}
            onMoveField={(field, rect) => {
              onUpdateField(field, {
                x: String(rect.x),
                y: String(rect.y),
                width: String(rect.width),
                height: String(rect.height)
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

