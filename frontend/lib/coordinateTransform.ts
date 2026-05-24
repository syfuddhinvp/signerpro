export interface ToPdfCoordinatesInput {
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  displayedPageWidth: number;
  displayedPageHeight: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
}

export interface PdfCoordinates {
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
}

export function toPdfCoordinates(input: ToPdfCoordinatesInput): PdfCoordinates {
  const scaleX = input.pdfPageWidth / input.displayedPageWidth;
  const scaleY = input.pdfPageHeight / input.displayedPageHeight;
  return {
    pdfX: round(input.screenX * scaleX),
    pdfY: round(input.pdfPageHeight - (input.screenY + input.screenHeight) * scaleY),
    pdfWidth: round(input.screenWidth * scaleX),
    pdfHeight: round(input.screenHeight * scaleY)
  };
}

export interface FromPdfCoordinatesInput {
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  displayedPageWidth: number;
  displayedPageHeight: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
}

export interface ScreenCoordinates {
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
}

export function fromPdfCoordinates(input: FromPdfCoordinatesInput): ScreenCoordinates {
  const scaleX = input.pdfPageWidth / input.displayedPageWidth;
  const scaleY = input.pdfPageHeight / input.displayedPageHeight;
  return {
    screenX: round(input.pdfX / scaleX),
    screenY: round((input.pdfPageHeight - input.pdfY - input.pdfHeight) / scaleY),
    screenWidth: round(input.pdfWidth / scaleX),
    screenHeight: round(input.pdfHeight / scaleY)
  };
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

