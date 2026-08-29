import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { materializeDataFoundationArtifactBundle } from './bundle_v1.mjs';

export async function materializeBundleFromFilesystem({
  registryContract,
  m1Root,
  martRoot,
  evaluationRoot,
  protocolPath,
  m1Locations,
  m2Locations,
  createdAt,
}) {
  const receipt = await jsonArtifact(m1Root, 'receipt.json');
  const roles = {
    warehouse_manifest: receipt.value.artifacts.warehouse_manifest.path,
    backfill_checkpoint: receipt.value.artifacts.backfill_checkpoint.path,
    lineage_registry: receipt.value.artifacts.lineage_registry.path,
    latest_quality_report: receipt.value.artifacts.latest_quality_report.path,
    latest_revision_report: receipt.value.artifacts.latest_revision_report.path,
  };
  const controls = await Promise.all(Object.entries(roles).map(async ([role, relativePath]) => ({
    role,
    ...(await jsonArtifact(m1Root, relativePath)),
  })));
  const lineage = controls.find(({ role }) => role === 'lineage_registry').value;
  const acquisitions = await Promise.all(lineage.source_snapshots.map(async (entry) => {
    const manifest = await jsonArtifact(m1Root, relocateLineageManifestPath(entry));
    const checkpointRelative = path.posix.join(path.posix.dirname(manifest.file.relativePath), manifest.value.acquisition.checkpoint_path);
    return { manifest, checkpoint: await jsonArtifact(m1Root, checkpointRelative) };
  }));
  const protocol = await jsonArtifact(path.dirname(protocolPath), path.basename(protocolPath), { includeBytes: true });
  const martManifest = await jsonArtifact(martRoot, 'manifest.json');
  const martCheckpoint = await jsonArtifact(martRoot, 'checkpoint.json');
  const evaluationManifest = await jsonArtifact(evaluationRoot, 'manifest.json', { prefix: 'evaluation' });
  const evaluationCheckpoint = await jsonArtifact(evaluationRoot, 'checkpoint.json', { prefix: 'evaluation' });
  return materializeDataFoundationArtifactBundle({
    registryContract,
    createdAt,
    m1Locations,
    m2Locations,
    m1: { receipt, controls, acquisitions },
    m2: { protocol, martManifest, martCheckpoint, evaluationManifest, evaluationCheckpoint },
  });
}

export function relocateLineageManifestPath(entry) {
  const start = entry?.scope?.start;
  const end = entry?.scope?.end_exclusive;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start >= end) {
    throw new Error('Lineage source manifest scope is missing, invalid, or reversed.');
  }
  const expected = `acquisitions/${start}_${end}/manifest.json`;
  const declared = entry?.manifest_path;
  if (typeof declared !== 'string' || !declared) throw new Error('Lineage source manifest_path is required.');
  const normalized = declared.replaceAll('\\', '/');
  const absolute = path.posix.isAbsolute(normalized) || path.win32.isAbsolute(declared);
  if ((!absolute && normalized !== expected) || (absolute && !normalized.endsWith(`/${expected}`))) {
    throw new Error('Lineage source manifest path cannot be safely relocated to its exact scoped acquisition path.');
  }
  if (normalized.includes('/../') || normalized.endsWith('/..')) {
    throw new Error('Lineage source manifest path contains traversal material.');
  }
  return expected;
}

async function jsonArtifact(root, relativePath, { includeBytes = false, prefix = '' } = {}) {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error('Control artifact path is required.');
  const normalized = relativePath.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(relativePath)) {
    throw new Error('Control artifact path must be relative to its declared root.');
  }
  const absolute = await resolveExactArtifact(root, normalized);
  const bytes = await fs.readFile(absolute);
  const relative = prefix ? `${prefix}/${normalized}` : normalized;
  return {
    value: JSON.parse(bytes.toString('utf8')),
    file: { relativePath: relative, bytes: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` },
    ...(includeBytes ? { bytes } : {}),
  };
}

async function resolveExactArtifact(rootValue, relativePath) {
  const root = path.resolve(rootValue);
  const rootStat = await fs.lstat(root).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error('Control artifact root does not exist.', { cause: error });
    throw error;
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Control artifact root must be a real directory, not a symlink or junction.');
  }
  const realRoot = await fs.realpath(root);
  if (!samePath(realRoot, root)) {
    throw new Error('Control artifact root resolves through a symlink or junction.');
  }

  const absolute = path.resolve(root, ...relativePath.split('/'));
  const contained = path.relative(root, absolute);
  if (!contained || contained.startsWith('..') || path.isAbsolute(contained)) {
    throw new Error('Control artifact path escaped its root.');
  }

  let cursor = root;
  const segments = contained.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const stat = await fs.lstat(cursor).catch((error) => {
      if (error?.code === 'ENOENT') throw new Error('Control artifact path does not exist.', { cause: error });
      throw error;
    });
    if (stat.isSymbolicLink()) {
      throw new Error('Control artifact path contains a symlink or junction.');
    }
    const final = index === segments.length - 1;
    if (final ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error('Control artifact path has an unexpected filesystem type.');
    }
  }
  const realArtifact = await fs.realpath(absolute);
  if (!samePath(realArtifact, absolute)) {
    throw new Error('Control artifact resolves through a symlink or junction.');
  }
  const realRelative = path.relative(realRoot, realArtifact);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Control artifact resolved outside its root.');
  }
  return absolute;
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
