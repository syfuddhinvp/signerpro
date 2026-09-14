/* What the upload boundary accepts.
 *
 * The backend converts anything it supports to PDF at the upload boundary
 * (`conversion_service.SUPPORTED_EXTENSIONS`), so the picker and the guard in
 * front of it have to agree with that list — a client-side "PDFs only" check
 * in front of a server that happily converts a photo just hides the feature.
 * Both places that grow a document from a file read these: the first upload
 * into an envelope, and adding pages to one that already has its original.
 */

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp'] as const;
export const OFFICE_EXTENSIONS = [
  '.doc', '.docx', '.odt', '.rtf', '.txt', '.md',
  '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp',
] as const;
export const UPLOAD_EXTENSIONS: readonly string[] = ['.pdf', ...IMAGE_EXTENSIONS, ...OFFICE_EXTENSIONS];

/** For an `<input type="file" accept>`. */
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(',');

/** Mirrors `settings.max_upload_bytes` — checked client-side so a 40 MB file
 *  is refused before it is pushed over the wire only to come back a 413. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isImageUpload(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && (IMAGE_EXTENSIONS as readonly string[]).includes(filename.slice(dot).toLowerCase());
}

export function isSupportedUpload(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && UPLOAD_EXTENSIONS.includes(filename.slice(dot).toLowerCase());
}

/** `Master services agreement.docx` → `Master services agreement`. */
export function titleFromFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const stripped = (dot > 0 ? name.slice(0, dot) : name).trim();
  return (stripped || 'Untitled document').slice(0, 200);
}
