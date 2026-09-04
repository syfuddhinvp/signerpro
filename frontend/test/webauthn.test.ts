import { describe, expect, it } from 'vitest';
import {
  base64urlToBuffer, bufferToBase64url, credentialToJson, toCreationOptions, toRequestOptions,
} from '@/lib/sf/webauthn';

const bytes = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe('webauthn encoding', () => {
  it('round-trips base64url without padding', () => {
    const original = new Uint8Array([0, 1, 250, 255, 128, 64]).buffer;
    expect(bytes(base64urlToBuffer(bufferToBase64url(original)))).toEqual(bytes(original));
  });

  it('decodes base64url that uses - and _ instead of + and /', () => {
    // The whole reason the alphabet differs: a raw atob() on this throws.
    expect(bytes(base64urlToBuffer('-_8'))).toEqual([251, 255]);
  });

  it('handles every padding length', () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const source = new Uint8Array(length).fill(7).buffer;
      expect(bytes(base64urlToBuffer(bufferToBase64url(source)))).toEqual(bytes(source));
    }
  });

  it('converts creation options, including the user handle', () => {
    const options = toCreationOptions({
      challenge: 'AAEC',
      user: { id: 'AAEC', name: 'a@b.test', displayName: 'A' },
      excludeCredentials: [{ id: 'AAEC', type: 'public-key' }],
    });
    expect(options.challenge).toBeInstanceOf(ArrayBuffer);
    expect(options.user.id).toBeInstanceOf(ArrayBuffer);
    expect(options.excludeCredentials?.[0].id).toBeInstanceOf(ArrayBuffer);
  });

  it('converts request options', () => {
    const options = toRequestOptions({
      challenge: 'AAEC',
      allowCredentials: [{ id: 'AAEC', type: 'public-key' }],
    });
    expect(options.challenge).toBeInstanceOf(ArrayBuffer);
    expect(options.allowCredentials?.[0].id).toBeInstanceOf(ArrayBuffer);
  });

  it('serialises a credential the server can actually read', () => {
    // JSON.stringify on a real PublicKeyCredential yields {} -- this is the
    // conversion that stops the integration failing silently.
    const credential = {
      id: 'abc',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: new Uint8Array([4, 5]).buffer,
        attestationObject: new Uint8Array([6, 7]).buffer,
      },
    } as unknown as PublicKeyCredential;

    const json = credentialToJson(credential);
    expect(json.rawId).toBe('AQID');
    const response = json.response as Record<string, unknown>;
    expect(response.clientDataJSON).toBe('BAU');
    expect(response.attestationObject).toBe('Bgc');
    expect(response.signature).toBeUndefined();
  });
});
