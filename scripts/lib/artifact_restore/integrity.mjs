import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import { restoreError } from './errors.mjs';

export function normalizeSha256(value, label = 'sha256') {
  if (typeof value !== 'string') {
    throw restoreError('INVALID_SHA256', `${label} must be a SHA-256 string.`);
  }
  const hex = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw restoreError('INVALID_SHA256', `${label} must be 64 lowercase hexadecimal characters.`);
  }
  return hex;
}
export function validateExpectedIntegrity(expected, label = 'artifact') {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw restoreError('INVALID_INTEGRITY', `${label} integrity must be an object.`);
  }
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0) {
    throw restoreError('INVALID_BYTES', `${label} bytes must be a non-negative safe integer.`);
  }
  const sha256 = normalizeSha256(expected.sha256, `${label} sha256`);
  if (expected.row_count !== undefined
    && (!Number.isSafeInteger(expected.row_count) || expected.row_count < 0)) {
    throw restoreError('INVALID_ROW_COUNT', `${label} row_count must be a non-negative safe integer.`);
  }
  return Object.freeze({
    bytes: expected.bytes,
    sha256,
    ...(expected.row_count === undefined ? {} : { row_count: expected.row_count }),
  });
}

export async function inspectArtifact(filePath, expected, {
  fileSystem = fs,
  label = 'artifact',
} = {}) {
  const admitted = validateExpectedIntegrity(expected, label);
  const before = await fileSystem.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink?.()) {
    throw restoreError('UNSAFE_ARTIFACT_FILE', `${label} must be a regular non-link file.`);
  }

  const handle = await fileSystem.open(filePath, 'r');
  let bytes = 0;
  let rowCount = 0;
  let lineHasContent = false;
  const hash = createHash('sha256');
  let opened;
  let afterHandle;
  try {
    opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw restoreError('ARTIFACT_CHANGED_DURING_OPEN', `${label} changed while it was opened.`);
    }
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      bytes += chunk.length;
      hash.update(chunk);
      if (admitted.row_count !== undefined) {
        for (const byte of chunk) {
          if (byte === 10) {
            if (lineHasContent) rowCount += 1;
            lineHasContent = false;
          } else if (byte !== 9 && byte !== 13 && byte !== 32) {
            lineHasContent = true;
          }
        }
      }
    }
    if (admitted.row_count !== undefined && lineHasContent) rowCount += 1;
    afterHandle = await handle.stat();
  } finally {
    await handle.close();
  }

  const afterPath = await fileSystem.lstat(filePath);
  if (!afterPath.isFile() || afterPath.isSymbolicLink?.()
    || !sameFileIdentity(opened, afterHandle) || !sameFileIdentity(opened, afterPath)) {
    throw restoreError('ARTIFACT_CHANGED_DURING_READ', `${label} changed while it was verified.`);
  }

  const sha256 = hash.digest('hex');
  const mismatches = [];
  if (bytes !== admitted.bytes) mismatches.push('bytes');
  if (sha256 !== admitted.sha256) mismatches.push('sha256');
  if (admitted.row_count !== undefined && rowCount !== admitted.row_count) {
    mismatches.push('row_count');
  }
  if (mismatches.length > 0) {
    throw restoreError(
      'ARTIFACT_INTEGRITY_MISMATCH',
      `${label} failed ${mismatches.join(', ')} verification.`,
      {
        mismatches,
        expected: admitted,
        actual: {
          bytes,
          sha256,
          ...(admitted.row_count === undefined ? {} : { row_count: rowCount }),
        },
      },
    );
  }

  return Object.freeze({
    bytes,
    sha256,
    ...(admitted.row_count === undefined ? {} : { row_count: rowCount }),
  });
}

function sameFileIdentity(left, right) {
  if (!left || !right || left.size !== right.size || left.mtimeMs !== right.mtimeMs) return false;
  if (Number.isFinite(left.dev) && Number.isFinite(right.dev)
    && Number.isFinite(left.ino) && Number.isFinite(right.ino)
    && (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0)) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return true;
}
