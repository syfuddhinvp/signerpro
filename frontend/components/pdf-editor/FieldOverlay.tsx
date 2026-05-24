"use client";

import { DraggableField, type ScreenRect } from "@/components/pdf-editor/DraggableField";
import { recipientColor } from "@/components/pdf-editor/RecipientPanel";
import { fromPdfCoordinates, toPdfCoordinates } from "@/lib/coordinateTransform";
import type { FieldRecord, RecipientRecord } from "@/lib/types";

export function FieldOverlay({
  fields,
  recipients,
  selectedFieldId,
  displayedPageWidth,
  displayedPageHeight,
  pdfPageWidth,
  pdfPageHeight,
  onSelectField,
  onMoveField
}: {
  fields: FieldRecord[];
  recipients: RecipientRecord[];
  selectedFieldId: string | null;
  displayedPageWidth: number;
  displayedPageHeight: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
  onSelectField: (fieldId: string | null) => void;
  onMoveField: (field: FieldRecord, pdfRect: { x: number; y: number; width: number; height: number }) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const screen = fromPdfCoordinates({
          pdfX: Number(field.x),
          pdfY: Number(field.y),
          pdfWidth: Number(field.width),
          pdfHeight: Number(field.height),
          displayedPageWidth,
          displayedPageHeight,
          pdfPageWidth,
          pdfPageHeight
        });
        const rect: ScreenRect = {
          x: screen.screenX,
          y: screen.screenY,
          width: screen.screenWidth,
          height: screen.screenHeight
        };
        return (
          <DraggableField
            key={field.id}
            rect={rect}
            label={field.label}
            color={recipientColor(field.recipient_id, recipients)}
            selected={selectedFieldId === field.id}
            locked={field.is_locked}
            onSelect={() => onSelectField(field.id)}
            onCommit={(nextRect) => {
              const pdf = toPdfCoordinates({
                screenX: nextRect.x,
                screenY: nextRect.y,
                screenWidth: nextRect.width,
                screenHeight: nextRect.height,
                displayedPageWidth,
                displayedPageHeight,
                pdfPageWidth,
                pdfPageHeight
              });
              onMoveField(field, {
                x: pdf.pdfX,
                y: pdf.pdfY,
                width: pdf.pdfWidth,
                height: pdf.pdfHeight
              });
            }}
          />
        );
      })}
    </>
  );
}

