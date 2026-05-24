"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { SignerField } from "@/components/signer/SignerField";
import { recipientColor } from "@/components/pdf-editor/RecipientPanel";
import { apiUrl } from "@/lib/api";
import { fromPdfCoordinates } from "@/lib/coordinateTransform";
import type { FieldRecord, RecipientRecord, SigningSession } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageSize {
  displayedWidth: number;
  displayedHeight: number;
  pdfWidth: number;
  pdfHeight: number;
}

export function SigningPdfViewer({
  session,
  fields,
  recipients,
  onSaveValue,
  onSaveSignature
}: {
  session: SigningSession;
  fields: FieldRecord[];
  recipients: RecipientRecord[];
  onSaveValue: (field: FieldRecord, value: string | boolean) => Promise<void>;
  onSaveSignature: (
    field: FieldRecord,
    payload: { signature_type: "typed" | "drawn"; signature_text?: string; signature_image_base64?: string }
  ) => Promise<void>;
}) {
  const [sizes, setSizes] = useState<Record<number, PageSize>>({});
  const pageWidth = 760;

  return (
    <Document file={apiUrl(session.pdf_url)} loading={<div className="p-6 text-sm">Loading PDF...</div>}>
      {Array.from({ length: session.document.page_count }, (_, index) => {
        const pageNumber = index + 1;
        const size = sizes[pageNumber];
        return (
          <div key={pageNumber} className="relative mx-auto mb-6 w-fit">
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(page) => {
                const view = page.view;
                setSizes((current) => ({
                  ...current,
                  [pageNumber]: {
                    displayedWidth: page.width,
                    displayedHeight: page.height,
                    pdfWidth: view[2] - view[0],
                    pdfHeight: view[3] - view[1]
                  }
                }));
              }}
            />
            {size ? (
              <div className="absolute left-0 top-0" style={{ width: size.displayedWidth, height: size.displayedHeight }}>
                {fields
                  .filter((field) => field.page_number === pageNumber)
                  .map((field) => {
                    const screen = fromPdfCoordinates({
                      pdfX: Number(field.x),
                      pdfY: Number(field.y),
                      pdfWidth: Number(field.width),
                      pdfHeight: Number(field.height),
                      displayedPageWidth: size.displayedWidth,
                      displayedPageHeight: size.displayedHeight,
                      pdfPageWidth: size.pdfWidth,
                      pdfPageHeight: size.pdfHeight
                    });
                    return (
                      <div
                        key={field.id}
                        style={{
                          position: "absolute",
                          left: screen.screenX,
                          top: screen.screenY,
                          width: screen.screenWidth,
                          height: screen.screenHeight
                        }}
                      >
                        <SignerField
                          field={field}
                          session={session}
                          color={recipientColor(field.recipient_id, recipients)}
                          onSaveValue={onSaveValue}
                          onSaveSignature={onSaveSignature}
                        />
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </div>
        );
      })}
    </Document>
  );
}

