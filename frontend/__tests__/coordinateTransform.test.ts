import { describe, expect, it } from "vitest";
import { fromPdfCoordinates, toPdfCoordinates } from "@/lib/coordinateTransform";

describe("coordinate transforms", () => {
  it("converts screen coordinates to PDF coordinates with bottom-left origin", () => {
    const pdf = toPdfCoordinates({
      screenX: 100,
      screenY: 200,
      screenWidth: 180,
      screenHeight: 40,
      displayedPageWidth: 612,
      displayedPageHeight: 792,
      pdfPageWidth: 612,
      pdfPageHeight: 792
    });

    expect(pdf).toEqual({ pdfX: 100, pdfY: 552, pdfWidth: 180, pdfHeight: 40 });
  });

  it("round-trips coordinates across zoomed page display", () => {
    const pdf = toPdfCoordinates({
      screenX: 80,
      screenY: 140,
      screenWidth: 120,
      screenHeight: 32,
      displayedPageWidth: 306,
      displayedPageHeight: 396,
      pdfPageWidth: 612,
      pdfPageHeight: 792
    });
    const screen = fromPdfCoordinates({
      pdfX: pdf.pdfX,
      pdfY: pdf.pdfY,
      pdfWidth: pdf.pdfWidth,
      pdfHeight: pdf.pdfHeight,
      displayedPageWidth: 306,
      displayedPageHeight: 396,
      pdfPageWidth: 612,
      pdfPageHeight: 792
    });

    expect(screen).toEqual({ screenX: 80, screenY: 140, screenWidth: 120, screenHeight: 32 });
  });
});

