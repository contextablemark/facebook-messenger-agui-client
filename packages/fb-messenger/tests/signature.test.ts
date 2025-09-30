import { describe, expect, it } from 'vitest';

import {
  createSignatureDigest,
  createSignatureHeader,
  parseSignatureHeader,
  verifyRequestSignature,
} from '../src/signature';

const SECRET = 'top-secret';
const PAYLOAD = JSON.stringify({ hello: 'world', count: 2 });

describe('signature helpers', () => {
  it('verifies sha256 signatures', () => {
    const header = createSignatureHeader(SECRET, PAYLOAD, 'sha256');

    expect(
      verifyRequestSignature({
        appSecret: SECRET,
        signatureHeader: header,
        payload: PAYLOAD,
      }),
    ).toBe(true);
  });

  it('verifies sha1 signatures', () => {
    const header = createSignatureHeader(SECRET, PAYLOAD, 'sha1');

    expect(
      verifyRequestSignature({
        appSecret: SECRET,
        signatureHeader: header,
        payload: PAYLOAD,
      }),
    ).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const header = createSignatureHeader(SECRET, PAYLOAD, 'sha256');

    expect(
      verifyRequestSignature({
        appSecret: SECRET,
        signatureHeader: header,
        payload: PAYLOAD + 'tampered',
      }),
    ).toBe(false);
  });

  it('parses valid signature headers', () => {
    const digest = createSignatureDigest(SECRET, PAYLOAD, 'sha1');
    const header = `sha1=${digest.toString('hex')}`;

    expect(parseSignatureHeader(header)).toEqual({
      algorithm: 'sha1',
      hash: digest.toString('hex'),
    });
  });

  it('returns null for malformed headers', () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader('badheader')).toBeNull();
    expect(parseSignatureHeader('sha512=abc')).toBeNull();
  });
});
