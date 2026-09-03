'use server';

/**
 * Mutations for the public signing session.
 *
 * These run on the server against the token endpoints in
 * `backend/app/api/routes/signing.py`. The signing token — not a session
 * cookie — is the credential, so `apiFetchPublic` is the right transport:
 * `apiCall` would go through `/api/proxy`, which refuses a request with no
 * `sf_session`, and the recipient has no account at all.
 *
 * Each action returns a plain `{ ok, message }` so the client surface can show
 * the prototype's toast and then `router.refresh()` to re-read the session.
 */

import { revalidatePath } from 'next/cache';
import { apiFetchPublic } from '@/lib/api/client';
import { backendUrl } from '@/lib/auth/session';
import type { CompletionResponse, ReassignResponse, SigningSessionResponse } from './types';

export type ActionResult = { ok: boolean; message: string };

const base = (token: string) => `/api/sign/${encodeURIComponent(token)}`;

function refresh(token: string): void {
  revalidatePath(`/sign/${token}`);
}

async function run<T>(token: string, path: string, body: unknown, success: string): Promise<ActionResult> {
  const result = await apiFetchPublic<T>(path, { method: 'POST', body });
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh(token);
  return { ok: true, message: success };
}

/** Records `document_viewed` in the audit trail, once per session open. */
export async function markViewed(token: string): Promise<ActionResult> {
  return run<SigningSessionResponse>(token, `${base(token)}/viewed`, undefined, 'Envelope opened');
}

export async function acceptConsent(token: string): Promise<ActionResult> {
  return run<SigningSessionResponse>(token, `${base(token)}/consent`, undefined, 'Disclosure accepted · consent recorded');
}

export async function sendOtp(token: string): Promise<ActionResult> {
  return run<void>(token, `${base(token)}/otp/send`, undefined, 'Access code sent');
}

export async function verifyOtp(token: string, code: string): Promise<ActionResult> {
  return run<SigningSessionResponse>(token, `${base(token)}/otp/verify`, { code }, 'Identity verified');
}

export async function saveFieldValue(token: string, fieldId: string, value: string | boolean): Promise<ActionResult> {
  return run(token, `${base(token)}/fields/${fieldId}/value`, { value }, 'Saved');
}

/**
 * Typed and drawn signatures both land here. A drawn signature is sent as the
 * canvas `data:` URL, which the backend stores as a PNG next to the envelope.
 */
export async function saveSignature(
  token: string,
  fieldId: string,
  payload: { signature_type: 'typed' | 'drawn'; signature_text?: string | null; signature_image_base64?: string | null },
): Promise<ActionResult> {
  return run(token, `${base(token)}/fields/${fieldId}/signature`, payload, 'Signature applied · sealed with SHA-256 and logged');
}

/**
 * A signer's file upload for an `attachment` field
 * (`POST /api/sign/{token}/fields/{id}/attachment`, multipart).
 *
 * This one cannot go through `apiFetchPublic`, which serialises JSON bodies —
 * the endpoint takes a `multipart/form-data` part named `upload`. The `File`
 * arrives here inside a `FormData` the client built, and is streamed straight
 * on; the `content-type` header is deliberately not set so `fetch` generates
 * the multipart boundary.
 */
export async function uploadAttachment(token: string, fieldId: string, form: FormData): Promise<ActionResult> {
  const file = form.get('upload');
  if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose a file first' };
  const outbound = new FormData();
  outbound.append('upload', file, file.name);
  let response: Response;
  try {
    response = await fetch(
      `${backendUrl()}${base(token)}/fields/${encodeURIComponent(fieldId)}/attachment`,
      { method: 'POST', body: outbound, cache: 'no-store' },
    );
  } catch {
    return { ok: false, message: 'The signing service is unreachable.' };
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = detail && typeof detail.detail === 'string' ? detail.detail : 'The file could not be uploaded.';
    return { ok: false, message };
  }
  refresh(token);
  return { ok: true, message: `${file.name} attached · sealed with SHA-256 and logged` };
}

export async function completeSigning(token: string): Promise<ActionResult> {
  return run<CompletionResponse>(token, `${base(token)}/complete`, undefined, 'Signing complete · certificate sealed');
}

export async function declineSigning(token: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, message: 'A reason is required to decline' };
  return run<void>(token, `${base(token)}/decline`, { reason: reason.trim() }, 'Signing declined · sender notified');
}

export async function reassignSigning(
  token: string,
  payload: { name: string; email: string; reason: string },
): Promise<ActionResult> {
  if (!payload.name.trim() || payload.email.indexOf('@') < 1 || !payload.reason.trim()) {
    return { ok: false, message: 'Name, a valid email and a reason are all required' };
  }
  return run<ReassignResponse>(token, `${base(token)}/reassign`, {
    name: payload.name.trim(), email: payload.email.trim(), reason: payload.reason.trim(),
  }, 'Envelope reassigned · your link is now retired');
}
