import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OSRM_RECEIPT_HASH_BLOCK_BYTES,
  digestFileInFixedBlocks,
  validateInstalledOsrmMatureEngineReceipt,
} from '../lib/route_real_graph_build/osrm_mature_engine_receipt.mjs';
import {
  authorizeInstalledMatureEngine,
  inspectInstalledMatureEngineRegistry,
  matchMatureEngineReceiptAgainstInstalledRegistry,
  prepareInstalledMatureEngineAuthority,
} from '../lib/route_real_graph_authority/index.mjs';
import { contentIdentity } from '../lib/route_real_graph_authority/safe_data.mjs';

const RECEIPT_PATH = path.resolve(
  '.dfev1/route-real-graph-m5-1/build/osrm-26.8.0-foot-pennsylvania-260824/mature-engine-receipt-v2.json',
);

test('installed mature-engine registry exposes one exact non-caller-extensible local entry', () => {
  const registry = inspectInstalledMatureEngineRegistry();
  assert.equal(registry.configured, true);
  assert.equal(registry.entryCount, 1);
  assert.equal(registry.callerExtensible, false);
  assert.equal(registry.privateRuntimeProductPromotion, false);
  assert.equal(registry.publicationAuthorized, false);
  assert.equal(registry.redistributionAuthorized, false);
});

test('receipt validates copied relative M4 input and mechanically equal replay files', (t) => {
  if (!existsSync(RECEIPT_PATH)) return t.skip('ignored source-final receipt is not present');
  const receipt = validateInstalledOsrmMatureEngineReceipt();
  assert.equal(receipt.m4Handoff.path,
    '.dfev1/route-real-graph-m5-1/input/m4-source-final-b4fcc63/final-handoff.json');
  assert.equal(path.isAbsolute(receipt.m4Handoff.path), false);
  assert.equal(receipt.publicProbe.run1.bytes, receipt.publicProbe.run2.bytes);
  assert.equal(receipt.publicProbe.run1.sha256, receipt.publicProbe.run2.sha256);
  assert.deepEqual(
    readFileSync(path.resolve(receipt.publicProbe.run1.path)),
    readFileSync(path.resolve(receipt.publicProbe.run2.path)),
  );
  const replay = JSON.parse(readFileSync(path.resolve(receipt.publicProbe.replayManifest.path), 'utf8'));
  assert.equal(replay.equal, true);
  assert.deepEqual(replay.run1, receipt.publicProbe.run1);
  assert.deepEqual(replay.run2, receipt.publicProbe.run2);
});

test('tool input boundary profile licence artifact receipt M4 and path drift cannot match private authority', (t) => {
  if (!existsSync(RECEIPT_PATH)) return t.skip('ignored source-final receipt is not present');
  const original = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  assert.equal(matchMatureEngineReceiptAgainstInstalledRegistry(JSON.stringify(original)).exactMatch, true);
  const mutations = [
    (value) => { value.engine.nativeAsset.sha256 = fakeIdentity('1'); },
    (value) => { value.input.pbf.sha256 = fakeIdentity('2'); },
    (value) => { value.authorityBoundary.file.sha256 = fakeIdentity('3'); },
    (value) => { value.profile.profileIdentity = fakeIdentity('4'); },
    (value) => { value.licensing.inputAndGraph.license = 'ambiguous'; },
    (value) => { value.graph.inventory[0].sha256 = fakeIdentity('5'); },
    (value) => { value.graph.artifactRoot = '.dfev1/route-real-graph-m5-1/build/replaced'; },
    (value) => { value.publicProbe.run2.sha256 = fakeIdentity('6'); },
    (value) => { value.m4Handoff.handoffIdentity = fakeIdentity('7'); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(original);
    mutate(candidate);
    reSign(candidate);
    assert.equal(
      matchMatureEngineReceiptAgainstInstalledRegistry(JSON.stringify(candidate)).exactMatch,
      false,
    );
  }
});

test('caller receipt paths and deserialized or replayed handles cannot issue authority', (t) => {
  assert.throws(
    () => prepareInstalledMatureEngineAuthority(RECEIPT_PATH),
    ({ code }) => code === 'mature-engine-prepare-arguments',
  );
  if (!existsSync(RECEIPT_PATH)) return t.skip('ignored source-final receipt is not present');
  const handle = prepareInstalledMatureEngineAuthority();
  assert.throws(
    () => authorizeInstalledMatureEngine(JSON.parse(JSON.stringify(handle))),
    ({ code }) => code === 'mature-engine-handle-unavailable',
  );
  const authorization = authorizeInstalledMatureEngine(handle);
  assert.equal(authorization.status, 'authorized-local-build');
  assert.equal(authorization.engineAuthority.localRouting, true);
  assert.equal(authorization.engineAuthority.mode, 'walking');
  assert.equal(authorization.engineAuthority.travelTime, true);
  assert.equal(authorization.engineAuthority.accessibility, false);
  assert.equal(authorization.sourceHealthProjection.status, 'not-applied');
  assert.equal(authorization.sourceHealthProjection.proposedStatus, 'current');
  assert.equal(authorization.sourceHealthProjection.applied, false);
  assert.equal(authorization.privateRuntimeProductPromotion, false);
  assert.throws(
    () => authorizeInstalledMatureEngine(handle),
    ({ code }) => code === 'mature-engine-handle-replay',
  );
});

test('large-file digest helper reads fixed-size blocks and returns exact SHA-256', () => {
  assert.equal(OSRM_RECEIPT_HASH_BLOCK_BYTES, 4 * 1_024 * 1_024);
  const root = mkdtempSync(path.join(tmpdir(), 'route-real-stream-hash-'));
  try {
    const filename = path.join(root, 'bounded.bin');
    const bytes = Buffer.alloc(OSRM_RECEIPT_HASH_BLOCK_BYTES * 2 + 17, 0x5a);
    writeFileSync(filename, bytes);
    assert.equal(
      digestFileInFixedBlocks(filename),
      createHash('sha256').update(bytes).digest('hex'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function reSign(receipt) {
  delete receipt.receiptIdentity;
  receipt.receiptIdentity = contentIdentity(receipt);
}

function fakeIdentity(character) {
  return `sha256:${character.repeat(64)}`;
}
