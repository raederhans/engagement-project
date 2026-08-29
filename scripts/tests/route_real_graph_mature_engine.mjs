import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import net from 'node:net';
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
import {
  runOwnedLoopbackProbeSessionForTest,
  validateFixedPublicOsrmResponse,
} from '../lib/route_real_graph_controller/osrm_public_probe.mjs';

const RECEIPT_PATH = path.resolve(
  '.dfev1/route-real-graph-m5-1-repair-p2/source-final-owned-queries/mature-engine-receipt-v3.json',
);
const PROBE_FIXTURE = path.resolve(
  'scripts/tests/fixtures/route_real_graph_osrm_probe_fixture.mjs',
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
  assert.equal(receipt.publicProbe.transport.protocol, 'http');
  assert.equal(receipt.publicProbe.transport.host, '127.0.0.1');
  assert.equal(receipt.publicProbe.transport.allocation, 'os-assigned-loopback-candidate');
  assert.equal(receipt.publicProbe.endpoint,
    `http://127.0.0.1:${receipt.publicProbe.transport.port}/route/v1/walking`);
  assert.equal(receipt.publicProbe.responderOwnershipVerified, true);
  assert.equal(receipt.publicProbe.readiness.childPid, receipt.publicProbe.launch.childPid);
  assert.equal(receipt.publicProbe.readiness.owningProcessId, receipt.publicProbe.launch.childPid);
  assert.equal(receipt.publicProbe.teardown.targetedChildPid, receipt.publicProbe.launch.childPid);
  assert.equal(receipt.publicProbe.teardown.portReleasedByChild, true);
  assert.equal(receipt.publicProbe.teardown.foreignProcessTerminated, false);
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
    (value) => { value.publicProbe.transport.port += 1; },
    (value) => { value.publicProbe.readiness.owningProcessId += 1; },
    (value) => { value.publicProbe.teardown.portReleasedByChild = false; },
    (value) => { value.publicProbe.transcriptIdentity = fakeIdentity('8'); },
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

test('byte-identical canned responder occupying the target port cannot impersonate the spawned child', async (t) => {
  if (process.platform !== 'win32') return t.skip('the admitted native responder ownership proof is Windows-specific');
  const root = mkdtempSync(path.join(tmpdir(), 'route-real-hostile-port-'));
  const payload = path.join(root, 'canned.json');
  writeFileSync(payload, validResponseText());
  const port = await freeLoopbackPort();
  const preexisting = spawn(process.execPath, [PROBE_FIXTURE, 'canned', String(port), payload], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await waitForHttp(port);
    await assert.rejects(
      runFixtureSession('canned', { candidatePort: port, payload }),
      ({ code }) => ['osrm-probe-responder-mismatch', 'osrm-probe-process'].includes(code),
    );
    assert.equal(preexisting.exitCode, null);
    assert.equal(await requestText(port), validResponseText());
  } finally {
    if (preexisting.exitCode === null) preexisting.kill();
    await waitForChildExit(preexisting);
    rmSync(root, { recursive: true, force: true });
  }
});

test('child early exit fails closed before readiness', async (t) => {
  if (process.platform !== 'win32') return t.skip('the admitted native responder ownership proof is Windows-specific');
  await assert.rejects(
    runFixtureSession('early-exit'),
    ({ code }) => code === 'osrm-probe-process',
  );
});

test('non-JSON and erroneous JSON responders fail fixed public result validation', async (t) => {
  if (process.platform !== 'win32') return t.skip('the admitted native responder ownership proof is Windows-specific');
  for (const [mode, expectedCode] of [['non-json', 'osrm-probe-json'], ['error-json', 'osrm-probe-result-drift']]) {
    const session = await runFixtureSession(mode);
    assert.throws(
      () => validateFixedPublicOsrmResponse(session.first),
      ({ code }) => code === expectedCode,
    );
    assert.equal(session.teardown.portReleasedByChild, true);
    assert.equal(session.teardown.foreignProcessTerminated, false);
  }
});

test('owned child teardown releases only its dynamic port and repeat replay stays byte exact', async (t) => {
  if (process.platform !== 'win32') return t.skip('the admitted native responder ownership proof is Windows-specific');
  const root = mkdtempSync(path.join(tmpdir(), 'route-real-repeat-probe-'));
  const payload = path.join(root, 'canned.json');
  writeFileSync(payload, validResponseText());
  try {
    const firstSession = await runFixtureSession('canned', { payload });
    const secondSession = await runFixtureSession('canned', { payload });
    for (const session of [firstSession, secondSession]) {
      assert.deepEqual(validateFixedPublicOsrmResponse(session.first).routes[0].distance, 1_547.8);
      assert.equal(session.first, session.second);
      assert.equal(session.readiness.childPid, session.launch.childPid);
      assert.equal(session.readiness.owningProcessId, session.launch.childPid);
      assert.equal(session.readiness.exclusiveOwnerMatch, true);
      for (const ownership of [
        session.firstOwnershipBefore,
        session.firstOwnershipAfter,
        session.secondOwnershipBefore,
        session.secondOwnershipAfter,
      ]) {
        assert.equal(ownership.childPid, session.launch.childPid);
        assert.equal(ownership.owningProcessId, session.launch.childPid);
        assert.equal(ownership.exclusiveOwnerMatch, true);
      }
      assert.equal(session.teardown.targetedChildPid, session.launch.childPid);
      assert.equal(session.teardown.portReleasedByChild, true);
      assert.equal(session.teardown.foreignProcessTerminated, false);
    }
    assert.equal(firstSession.first, secondSession.first);
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

function runFixtureSession(mode, { candidatePort, payload = 'unused' } = {}) {
  return runOwnedLoopbackProbeSessionForTest({
    executable: process.execPath,
    argumentsForPort: (port) => [PROBE_FIXTURE, mode, String(port), payload],
    cwd: process.cwd(),
    requestPath: '/fixed-public-probe',
    ...(candidatePort === undefined ? {} : { candidatePort }),
  });
}

function validResponseText() {
  return JSON.stringify({
    code: 'Ok',
    routes: [{
      distance: 1_547.8,
      duration: 1_114,
      weight: 1_114,
      weight_name: 'duration',
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 84 }, (_, index) => [-75 + index / 10_000, 39.9]),
      },
    }],
    waypoints: [{}, {}],
  });
}

async function freeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHttp(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await requestText(port);
      return;
    } catch (error) {
      if (error?.code !== 'ECONNREFUSED') throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error('fixture did not become ready');
}

function requestText(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/fixed-public-probe' }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
  });
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}
