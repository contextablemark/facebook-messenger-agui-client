import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureAlgorithm = 'sha256' | 'sha1';

/** @internal */
const SUPPORTED_ALGORITHMS: readonly SignatureAlgorithm[] = ['sha256', 'sha1'];

export interface SignatureParts {
  algorithm: SignatureAlgorithm;
  hash: string;
}

const SIGNATURE_HEADER_PATTERN = /^([a-zA-Z0-9]+)=([a-fA-F0-9]+)$/;

export function parseSignatureHeader(header?: string | null): SignatureParts | null {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  const match = SIGNATURE_HEADER_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const algorithm = match[1].toLowerCase();
  if (!isSupportedAlgorithm(algorithm)) {
    return null;
  }

  return {
    algorithm,
    hash: match[2].toLowerCase(),
  };
}

export function createSignatureDigest(
  appSecret: string,
  payload: string | Buffer,
  algorithm: SignatureAlgorithm = 'sha256',
): Buffer {
  const hmac = createHmac(algorithm, appSecret);
  hmac.update(Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'));
  return hmac.digest();
}

export function createSignatureHeader(
  appSecret: string,
  payload: string | Buffer,
  algorithm: SignatureAlgorithm = 'sha256',
): string {
  const digest = createSignatureDigest(appSecret, payload, algorithm);
  return `${algorithm}=${digest.toString('hex')}`;
}

export function verifyRequestSignature({
  appSecret,
  signatureHeader,
  payload,
}: {
  appSecret: string;
  signatureHeader?: string | null;
  payload: string | Buffer;
}): boolean {
  const parts = parseSignatureHeader(signatureHeader);
  if (!parts) {
    return false;
  }

  const expected = createSignatureDigest(appSecret, payload, parts.algorithm);
  const provided = Buffer.from(parts.hash, 'hex');

  if (expected.length !== provided.length) {
    return false;
  }

  try {
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

function isSupportedAlgorithm(input: string): input is SignatureAlgorithm {
  return (SUPPORTED_ALGORITHMS as readonly string[]).includes(input.toLowerCase());
}
