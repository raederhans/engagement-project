import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const LOCAL_ROUTE_SESSION_SECRET_ENV = 'M7_LOCAL_ROUTE_SESSION_SECRET';
export const LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION = 'mainline-m7-local-auth-challenge/v1';
export const LOCAL_ROUTE_AUTH_PROOF_SCHEMA_VERSION = 'mainline-m7-local-auth-proof/v1';
export const LOCAL_ROUTE_SESSION_SECRET_BYTES = 32;

const SERVER_PROOF_CONTEXT = 'mainline-m7-local-route-server-proof/v1';
const ROUTE_PROOF_CONTEXT = 'mainline-m7-local-route-request-proof/v1';
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function createSessionSecret() {
  return randomBytes(LOCAL_ROUTE_SESSION_SECRET_BYTES);
}

export function encodeSessionSecret(secret) {
  const admitted = admitSessionSecret(secret);
  try {
    return admitted.toString('base64url');
  } finally {
    admitted.fill(0);
  }
}

export function decodeSessionSecret(encoded) {
  if (typeof encoded !== 'string' || !BASE64URL_256_PATTERN.test(encoded)) {
    throw new TypeError('Local route session secret is invalid.');
  }
  const decoded = Buffer.from(encoded, 'base64url');
  if (decoded.length !== LOCAL_ROUTE_SESSION_SECRET_BYTES
    || decoded.toString('base64url') !== encoded) {
    decoded.fill(0);
    throw new TypeError('Local route session secret is invalid.');
  }
  return decoded;
}

export function copySessionSecret(secret) {
  return admitSessionSecret(secret);
}

export function createChallengeNonce() {
  return randomBytes(LOCAL_ROUTE_SESSION_SECRET_BYTES).toString('base64url');
}

export function admitChallengeNonce(nonce) {
  if (typeof nonce !== 'string' || !BASE64URL_256_PATTERN.test(nonce)) {
    throw new TypeError('Local route challenge nonce is invalid.');
  }
  const decoded = Buffer.from(nonce, 'base64url');
  const canonical = decoded.length === LOCAL_ROUTE_SESSION_SECRET_BYTES
    && decoded.toString('base64url') === nonce;
  decoded.fill(0);
  if (!canonical) throw new TypeError('Local route challenge nonce is invalid.');
  return nonce;
}

export function createServerProof(secret, nonce) {
  return createProof(secret, SERVER_PROOF_CONTEXT, admitChallengeNonce(nonce));
}

export function createRouteAuthorization(secret, nonce, body) {
  admitChallengeNonce(nonce);
  if (typeof body !== 'string') throw new TypeError('Local route request body must be a string.');
  const bodyDigest = `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  return Object.freeze({
    bodyDigest,
    proof: createProof(secret, ROUTE_PROOF_CONTEXT, nonce, bodyDigest),
  });
}

export function verifyServerProof(secret, nonce, proof) {
  return proofsEqual(createServerProof(secret, nonce), proof);
}

export function verifyRouteProof(secret, nonce, bodyDigest, proof) {
  try {
    admitChallengeNonce(nonce);
    if (typeof bodyDigest !== 'string' || !SHA256_IDENTITY_PATTERN.test(bodyDigest)) return false;
    return proofsEqual(
      createProof(secret, ROUTE_PROOF_CONTEXT, nonce, bodyDigest),
      proof,
    );
  } catch {
    return false;
  }
}

export function bodyMatchesDigest(body, bodyDigest) {
  if (!Buffer.isBuffer(body) || typeof bodyDigest !== 'string'
    || !SHA256_IDENTITY_PATTERN.test(bodyDigest)) return false;
  const actual = Buffer.from(`sha256:${createHash('sha256').update(body).digest('hex')}`, 'utf8');
  const expected = Buffer.from(bodyDigest, 'utf8');
  const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
  actual.fill(0);
  expected.fill(0);
  return matches;
}

function createProof(secret, ...parts) {
  const key = admitSessionSecret(secret);
  try {
    const hmac = createHmac('sha256', key);
    for (const part of parts) {
      hmac.update(part, 'utf8');
      hmac.update('\0', 'utf8');
    }
    return hmac.digest('base64url');
  } finally {
    key.fill(0);
  }
}

function proofsEqual(expectedProof, suppliedProof) {
  if (typeof suppliedProof !== 'string' || !BASE64URL_256_PATTERN.test(suppliedProof)) return false;
  const expected = Buffer.from(expectedProof, 'base64url');
  const supplied = Buffer.from(suppliedProof, 'base64url');
  const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
  expected.fill(0);
  supplied.fill(0);
  return matches;
}

function admitSessionSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.byteLength !== LOCAL_ROUTE_SESSION_SECRET_BYTES) {
    throw new TypeError('Local route session secret must contain 32 bytes.');
  }
  return Buffer.from(secret);
}
