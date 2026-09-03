/**
 * Whether a value a signer has typed satisfies the field it was typed into.
 *
 * This mirrors `field_service.validate_value` on the backend, which is the
 * authority — the API rejects a bad value with a 400 and nothing invalid can
 * reach the executed PDF. What the backend cannot do is tell the signer *while
 * they are typing*: before this the surface accepted "dfghgdfhfdh" in an Email
 * field, counted it towards the progress bar, and only surfaced a problem when
 * the value was saved.
 *
 * The rules, and the reason each is here rather than stricter:
 * - `email` — the same shape the backend enforces, not a full RFC 5322 parse.
 * - `numeric` — thousands separators allowed, as the backend strips them.
 * - `date` — the three formats the backend's `strptime` loop accepts.
 * - `custom` — the pattern lives on the API row, not on the builder's field,
 *   so it is left to the server rather than guessed at here.
 */

/** A field type that *is* a format carries it even with `validation: 'none'` —
 *  the same implication `field_service.effective_validation` applies. */
const TYPE_IMPLIED_VALIDATION: Record<string, string> = {
  email: 'email',
  number: 'numeric',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_FORMATS = [
  /^\d{4}-\d{2}-\d{2}$/,                          // 2026-08-20 (what a date input emits)
  /^\d{2}\/\d{2}\/\d{4}$/,                        // 20/08/2026 or 08/20/2026
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,     // 2026-08-20T14:30 (datetime-local)
];

/** The `<input type=…>` that lets the browser do the picking and the checking. */
export function nativeInputType(field: ValidatableField): string {
  if (field.type === 'date') return 'date';
  if (field.type === 'datetime') return 'datetime-local';
  if (effectiveValidation(field) === 'email') return 'email';
  return 'text';
}

/** True when a stored value fits the native control's required format; a value
 *  authored earlier in another shape ("20 Aug 2026") must stay editable, so the
 *  surface falls back to a plain text box for it rather than blanking it. */
export function fitsNativeInput(field: ValidatableField, value: unknown): boolean {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return true;
  if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (field.type === 'datetime') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text);
  return true;
}

export type ValidatableField = { type: string; validation?: string; label?: string };

/** The validation kind actually enforced for a field. */
export function effectiveValidation(field: ValidatableField): string {
  const kind = field.validation || 'none';
  if (kind !== 'none') return kind;
  return TYPE_IMPLIED_VALIDATION[field.type] ?? 'none';
}

/**
 * A short, signer-facing reason the value is not acceptable, or null when it
 * is. An empty value is never a problem here — that is what `required` is for.
 */
export function fieldValueProblem(field: ValidatableField, value: unknown): string | null {
  if (value === true || value === false || value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  // A signature is stored as `typed:<face>:<text>` or a data URL, never as a
  // value the format rules apply to.
  if (field.type === 'signature' || field.type === 'initials') return null;

  switch (effectiveValidation(field)) {
    case 'email':
      return EMAIL.test(text) ? null : 'Enter an email address, like name@company.com';
    case 'numeric':
      return Number.isFinite(Number(text.replace(/,/g, ''))) ? null : 'Enter a number';
    case 'date':
      return DATE_FORMATS.some(re => re.test(text)) ? null : 'Enter a date as MM/DD/YYYY';
    default:
      return null;
  }
}
