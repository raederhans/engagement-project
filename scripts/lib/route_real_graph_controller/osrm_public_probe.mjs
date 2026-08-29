import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { contentIdentity, fail, freezeData } from '../route_real_graph_authority/safe_data.mjs';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const FIXTURE_PATH =
  '/route/v1/walking/-75.163570,39.952583;-75.150282,39.948873'
  + '?alternatives=false&steps=false&geometries=geojson&overview=full';
const BUILD_ROOT =
  '.dfev1/route-real-graph-m5-1/build/osrm-26.8.0-foot-pennsylvania-260824';
const EVIDENCE_ROOT = '.dfev1/route-real-graph-m5-1-repair-p2/source-final-owned-queries';
const ROUTED_PATH =
  '.dfev1/route-real-graph-m5-1/toolchain/osrm-26.8.0-win32-x64/native/binding_napi_v8/osrm-routed.exe';
const TRANSCRIPT_SCHEMA = 'route-real-osrm-owned-public-probe-transcript/v2';
const REPLAY_SCHEMA = 'route-real-osrm-public-probe-replay/v2';

export async function runFixedPublicOsrmProbe() {
  if (arguments.length !== 0) {
    fail('osrm-probe-arguments', 'public probe accepts no caller coordinates, route, URL, or process options');
  }
  const projectRoot = process.cwd();
  const evidenceRoot = path.resolve(projectRoot, EVIDENCE_ROOT);
  const transcriptPath = path.join(evidenceRoot, 'probe-owned-transcript.json');
  if (existsSync(transcriptPath)) return inspectStoredFixedPublicProbe(projectRoot);

  const routed = path.resolve(projectRoot, ROUTED_PATH);
  const graph = path.resolve(projectRoot, BUILD_ROOT, 'graph.osrm');
  const session = await runOwnedLoopbackProbeSession({
    executable: routed,
    argumentsForPort: (port) => [
      '--algorithm', 'mld', '--ip', HOST, '--port', String(port), 'graph.osrm',
    ],
    cwd: path.resolve(projectRoot, BUILD_ROOT),
    requestPath: FIXTURE_PATH,
  });
  const firstValue = validateFixedPublicOsrmResponse(session.first);
  validateFixedPublicOsrmResponse(session.second);
  if (!Buffer.from(session.first).equals(Buffer.from(session.second))) {
    fail('osrm-probe-nondeterministic', 'fixed public route response changed across identical requests');
  }

  mkdirSync(evidenceRoot, { recursive: true });
  const run1Path = path.join(evidenceRoot, 'probe-run1.json');
  const run2Path = path.join(evidenceRoot, 'probe-run2.json');
  writeFileSync(run1Path, session.first, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(run2Path, session.second, { encoding: 'utf8', flag: 'wx' });
  const run1 = binding(projectRoot, run1Path, session.first);
  const run2 = binding(projectRoot, run2Path, session.second);
  const replayManifest = {
    schema: REPLAY_SCHEMA,
    equal: Buffer.from(session.first).equals(Buffer.from(session.second)),
    run1,
    run2,
  };
  writeFileSync(
    path.join(evidenceRoot, 'probe-replay-manifest.json'),
    `${JSON.stringify(replayManifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  const transcriptCore = {
    schema: TRANSCRIPT_SCHEMA,
    fixtureId: 'philadelphia-city-hall-to-independence-hall/public-v1',
    transport: session.transport,
    launch: {
      ...session.launch,
      cwd: path.relative(projectRoot, path.resolve(projectRoot, BUILD_ROOT)).replaceAll('\\', '/'),
      executable: binding(projectRoot, routed, readFileSync(routed)),
      graphPath: path.relative(projectRoot, graph).replaceAll('\\', '/'),
    },
    readiness: session.readiness,
    requests: [
      {
        sequence: 1,
        url: session.firstUrl,
        ownershipBefore: session.firstOwnershipBefore,
        ownershipAfter: session.firstOwnershipAfter,
        response: run1,
      },
      {
        sequence: 2,
        url: session.secondUrl,
        ownershipBefore: session.secondOwnershipBefore,
        ownershipAfter: session.secondOwnershipAfter,
        response: run2,
      },
    ],
    teardown: session.teardown,
    privateRuntimeProductPromotion: false,
    candidateGenerationAuthorized: false,
  };
  const transcript = { ...transcriptCore, transcriptIdentity: contentIdentity(transcriptCore) };
  writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return probeSummary(firstValue);
}

// This lower-level seam produces no receipt or authority. It exists so hostile
// process/port behavior can be exercised with synthetic child processes.
export async function runOwnedLoopbackProbeSessionForTest(options) {
  return runOwnedLoopbackProbeSession(options);
}

export function validateFixedPublicOsrmResponse(text) {
  if (arguments.length !== 1 || typeof text !== 'string') {
    fail('osrm-probe-response-arguments', 'fixed public response validation accepts one text value');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('osrm-probe-json', 'local OSRM response is not JSON');
  }
  const route = value?.routes?.[0];
  if (value?.code !== 'Ok' || value.routes?.length !== 1 || value.waypoints?.length !== 2
    || route?.distance !== 1_547.8 || route?.duration !== 1_114 || route?.weight !== 1_114
    || route?.weight_name !== 'duration' || route?.geometry?.type !== 'LineString'
    || route.geometry.coordinates?.length !== 84) {
    fail('osrm-probe-result-drift', 'fixed public route result no longer matches the admitted proof');
  }
  return value;
}

async function runOwnedLoopbackProbeSession(options) {
  const {
    executable,
    argumentsForPort,
    cwd,
    requestPath,
    candidatePort = await reserveOsAssignedLoopbackPort(),
  } = options;
  if (!Number.isSafeInteger(candidatePort) || candidatePort < 1 || candidatePort > 65_535) {
    fail('osrm-probe-port', 'candidate loopback port is invalid');
  }
  const args = argumentsForPort(candidatePort);
  const child = spawn(executable, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = captureBoundedOutput(child);
  let exit = null;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  await waitForSpawn(child);
  const childPid = child.pid;
  let readiness;
  let teardown;
  try {
    readiness = await waitForOwnedReadiness(child, () => exit, candidatePort);
    const firstUrl = `http://${HOST}:${candidatePort}${requestPath}`;
    assertChildAlive(child, exit, 'before first query');
    const firstOwnershipBefore = await assertOwnedPort(candidatePort, childPid);
    const first = await requestOnce(candidatePort, requestPath);
    assertChildAlive(child, exit, 'after first query');
    const firstOwnershipAfter = await assertOwnedPort(candidatePort, childPid);
    const secondUrl = `http://${HOST}:${candidatePort}${requestPath}`;
    const secondOwnershipBefore = await assertOwnedPort(candidatePort, childPid);
    const second = await requestOnce(candidatePort, requestPath);
    assertChildAlive(child, exit, 'after second query');
    const secondOwnershipAfter = await assertOwnedPort(candidatePort, childPid);
    teardown = await stopOwnedChild(child, () => exit, candidatePort);
    return freezeData({
      first,
      second,
      firstUrl,
      secondUrl,
      firstOwnershipBefore,
      firstOwnershipAfter,
      secondOwnershipBefore,
      secondOwnershipAfter,
      transport: {
        protocol: 'http',
        host: HOST,
        port: candidatePort,
        allocation: options.candidatePort === undefined
          ? 'os-assigned-loopback-candidate'
          : 'test-specified-loopback-candidate',
      },
      launch: {
        childPid,
        arguments: args,
        cwd: path.resolve(cwd),
        outputBoundBytes: output.limit,
      },
      readiness,
      teardown,
    }, 'owned loopback probe session');
  } finally {
    if (!teardown && child.exitCode === null && child.signalCode === null) {
      await stopOwnedChild(child, () => exit, candidatePort, { requireRelease: false });
    }
  }
}

async function reserveOsAssignedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!Number.isSafeInteger(port)) fail('osrm-probe-port', 'OS did not assign a loopback port');
  return port;
}

async function waitForSpawn(child) {
  if (child.pid) return;
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

async function waitForOwnedReadiness(child, exitState, port) {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    assertChildAlive(child, exitState(), 'during readiness');
    const owners = await listeningOwners(port);
    if (owners.length > 0) {
      if (owners.length !== 1 || owners[0] !== child.pid) {
        fail('osrm-probe-responder-mismatch', 'loopback port is not exclusively owned by the spawned OSRM child');
      }
      return {
        method: 'windows-tcp-table-owning-process',
        command: 'netstat.exe -ano -p tcp',
        attempts: attempt,
        childPid: child.pid,
        owningProcessId: owners[0],
        childAlive: true,
        exclusiveOwnerMatch: true,
      };
    }
    await delay(50);
  }
  fail('osrm-probe-timeout', 'spawned OSRM child did not own its loopback port within the bounded wait');
}

async function assertOwnedPort(port, childPid) {
  const owners = await listeningOwners(port);
  if (owners.length !== 1 || owners[0] !== childPid) {
    fail('osrm-probe-responder-mismatch', 'query responder is not the spawned child that owns the loopback port');
  }
  return {
    method: 'windows-tcp-table-owning-process',
    childPid,
    owningProcessId: owners[0],
    exclusiveOwnerMatch: true,
  };
}

async function listeningOwners(port) {
  if (process.platform !== 'win32') {
    fail('osrm-probe-platform', 'this admitted native OSRM proof requires the frozen win32-x64 platform');
  }
  const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1_024 * 1_024,
    windowsHide: true,
  });
  const owners = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (!match) continue;
    const separator = match[1].lastIndexOf(':');
    const host = match[1].slice(0, separator);
    const localPort = Number(match[1].slice(separator + 1));
    if (host === HOST && localPort === port) owners.push(Number(match[2]));
  }
  return [...new Set(owners)].sort((left, right) => left - right);
}

function assertChildAlive(child, exit, stage) {
  if (exit || child.exitCode !== null || child.signalCode !== null) {
    fail('osrm-probe-process', `spawned OSRM child exited ${stage}`);
  }
}

async function stopOwnedChild(child, exitState, port, { requireRelease = true } = {}) {
  const terminationRequested = child.exitCode === null && child.signalCode === null;
  if (requireRelease && !terminationRequested) {
    fail('osrm-probe-process', 'spawned child exited before controlled teardown');
  }
  if (terminationRequested && !child.kill()) {
    fail('osrm-probe-teardown', 'spawned child rejected controlled teardown');
  }
  const observedExit = exitState() ?? await waitForExit(child, 5_000);
  const owners = await listeningOwners(port);
  if (requireRelease && owners.includes(child.pid)) {
    fail('osrm-probe-teardown', 'spawned child still owns the loopback port after bounded teardown');
  }
  return {
    targetedChildPid: child.pid,
    terminationRequested,
    exitCode: observedExit.code,
    signal: observedExit.signal,
    portReleasedByChild: !owners.includes(child.pid),
    foreignProcessTerminated: false,
  };
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Object.assign(
      new Error('spawned child did not exit during bounded teardown'),
      { code: 'osrm-probe-teardown' },
    )), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function captureBoundedOutput(child) {
  const limit = 64_000;
  for (const stream of [child.stdout, child.stderr]) {
    let bytes = 0;
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) child.kill();
    });
  }
  return { limit };
}

function requestOnce(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: HOST, port, path: requestPath, timeout: 5_000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Object.assign(new Error('local OSRM returned non-success HTTP status'), { code: 'HTTP_STATUS' }));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 64_000) {
          request.destroy(Object.assign(new Error('local OSRM response exceeded bound'), { code: 'RESPONSE_SIZE' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('local OSRM request timed out'), { code: 'REQUEST_TIMEOUT' })));
    request.on('error', reject);
  });
}

function inspectStoredFixedPublicProbe(projectRoot) {
  const evidenceRoot = path.resolve(projectRoot, EVIDENCE_ROOT);
  const first = readFileSync(path.join(evidenceRoot, 'probe-run1.json'), 'utf8');
  const second = readFileSync(path.join(evidenceRoot, 'probe-run2.json'), 'utf8');
  const replay = JSON.parse(readFileSync(path.join(evidenceRoot, 'probe-replay-manifest.json'), 'utf8'));
  const transcript = JSON.parse(readFileSync(path.join(evidenceRoot, 'probe-owned-transcript.json'), 'utf8'));
  const { transcriptIdentity, ...transcriptCore } = transcript;
  const expectedRun1 = binding(projectRoot, path.join(evidenceRoot, 'probe-run1.json'), first);
  const expectedRun2 = binding(projectRoot, path.join(evidenceRoot, 'probe-run2.json'), second);
  if (!Buffer.from(first).equals(Buffer.from(second))) {
    fail('osrm-probe-nondeterministic', 'stored fixed public route responses differ');
  }
  if (replay?.schema !== REPLAY_SCHEMA || replay.equal !== true
    || JSON.stringify(replay.run1) !== JSON.stringify(expectedRun1)
    || JSON.stringify(replay.run2) !== JSON.stringify(expectedRun2)
    || transcript?.schema !== TRANSCRIPT_SCHEMA
    || transcriptIdentity !== contentIdentity(transcriptCore)
    || transcript.transport?.protocol !== 'http' || transcript.transport?.host !== HOST
    || transcript.transport?.allocation !== 'os-assigned-loopback-candidate'
    || transcript.readiness?.childPid !== transcript.launch?.childPid
    || transcript.readiness?.owningProcessId !== transcript.launch?.childPid
    || transcript.readiness?.exclusiveOwnerMatch !== true
    || transcript.teardown?.targetedChildPid !== transcript.launch?.childPid
    || transcript.teardown?.portReleasedByChild !== true
    || transcript.teardown?.foreignProcessTerminated !== false
    || transcript.requests?.length !== 2
    || !requestOwnershipIntact(transcript.requests[0], transcript.launch?.childPid)
    || !requestOwnershipIntact(transcript.requests[1], transcript.launch?.childPid)
    || JSON.stringify(transcript.requests[0]?.response) !== JSON.stringify(expectedRun1)
    || JSON.stringify(transcript.requests[1]?.response) !== JSON.stringify(expectedRun2)) {
    fail('osrm-probe-replay-evidence', 'stored public probe replay lacks intact child ownership evidence');
  }
  return probeSummary(validateFixedPublicOsrmResponse(first));
}

function requestOwnershipIntact(request, childPid) {
  return ['ownershipBefore', 'ownershipAfter'].every((key) => (
    request?.[key]?.method === 'windows-tcp-table-owning-process'
    && request[key].childPid === childPid
    && request[key].owningProcessId === childPid
    && request[key].exclusiveOwnerMatch === true
  ));
}

function binding(projectRoot, filename, bytesValue) {
  const bytes = Buffer.isBuffer(bytesValue) ? bytesValue : Buffer.from(bytesValue, 'utf8');
  return {
    path: path.relative(projectRoot, filename).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function probeSummary(value) {
  const route = value.routes[0];
  return freezeData({
    status: 'ready',
    fixtureId: 'philadelphia-city-hall-to-independence-hall/public-v1',
    loopbackOnly: true,
    repeatedResponseIdentical: true,
    responderOwnershipVerified: true,
    responseIdentity: contentIdentity(value),
    distanceMetres: route.distance,
    durationSeconds: route.duration,
    geometryPoints: route.geometry.coordinates.length,
    privateRuntimeProductPromotion: false,
    candidateGenerationAuthorized: false,
  }, 'fixed public OSRM route proof');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.length !== 2) fail('osrm-probe-cli', 'usage: node osrm_public_probe.mjs');
  process.stdout.write(`${JSON.stringify(await runFixedPublicOsrmProbe())}\n`);
}
