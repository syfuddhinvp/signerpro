/**
 * Browser-side WebAuthn plumbing.
 *
 * The whole ceremony is base64url on the wire and `ArrayBuffer` in the DOM
 * API, and getting a single conversion wrong fails at the authenticator with
 * an opaque `NotAllowedError` that looks identical to the user declining. So
 * the conversions live here as pure functions with tests, rather than inline
 * in a component where they cannot be exercised without a real security key.
 */

export function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type ServerOptions = {
  challenge: string;
  user?: { id: string; name: string; displayName: string };
  excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
  [key: string]: unknown;
};

/** Server JSON → the shape `navigator.credentials.create()` demands. */
export function toCreationOptions(options: ServerOptions): PublicKeyCredentialCreationOptions {
  return {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64urlToBuffer(options.challenge),
    user: {
      ...(options.user as unknown as PublicKeyCredentialUserEntity),
      id: base64urlToBuffer(options.user?.id ?? ''),
    },
    excludeCredentials: (options.excludeCredentials ?? []).map(item => ({
      ...item,
      id: base64urlToBuffer(item.id),
      type: 'public-key' as const,
      transports: item.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

/** Server JSON → the shape `navigator.credentials.get()` demands. */
export function toRequestOptions(options: ServerOptions): PublicKeyCredentialRequestOptions {
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map(item => ({
      ...item,
      id: base64urlToBuffer(item.id),
      type: 'public-key' as const,
      transports: item.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

/**
 * The credential the browser returns → the JSON the server verifies.
 *
 * `PublicKeyCredential` is not a plain object: `JSON.stringify` on it yields
 * `{}`, and the buffers inside it have to be converted individually. Sending
 * the raw object is the single most common way this integration silently
 * fails.
 */
export function credentialToJson(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  const json: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
  const inner = json.response as Record<string, unknown>;
  if (response.attestationObject) {
    inner.attestationObject = bufferToBase64url(response.attestationObject);
  }
  if (response.authenticatorData) {
    inner.authenticatorData = bufferToBase64url(response.authenticatorData);
  }
  if (response.signature) inner.signature = bufferToBase64url(response.signature);
  if (response.userHandle) inner.userHandle = bufferToBase64url(response.userHandle);
  return json;
}

/** Whether this browser can do the ceremony at all. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}
