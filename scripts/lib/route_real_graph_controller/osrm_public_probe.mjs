import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { contentIdentity, fail, freezeData } from '../route_real_graph_authority/safe_data.mjs';

const PORT = 5_007;
const FIXTURE_URL =
  `http://127.0.0.1:${PORT}/route/v1/walking/`
  + '-75.163570,39.952583;-75.150282,39.948873'
  + '?alternatives=false&steps=false&geometries=geojson&overview=full';
const BUILD_ROOT =
  '.dfev1/route-real-graph-m5-1/build/osrm-26.8.0-foot-pennsylvania-260824';
const ROUTED_PATH =
  '.dfev1/route-real-graph-m5-1/toolchain/osrm-26.8.0-win32-x64/native/binding_napi_v8/osrm-routed.exe';

export async function runFixedPublicOsrmProbe() {
  if (arguments.length !== 0) {
    fail('osrm-probe-arguments', 'public probe accepts no caller coordinates, route, URL, or process options');
  }
  const projectRoot = process.cwd();
  const routed = path.resolve(projectRoot, ROUTED_PATH);
  const graph = path.resolve(projectRoot, BUILD_ROOT, 'graph.osrm');
  const child = spawn(routed, [
    '--algorithm', 'mld', '--ip', '127.0.0.1', '--port', String(PORT), graph,
  ], {
    cwd: path.resolve(projectRoot, BUILD_ROOT),
    stdio: 'ignore',
    windowsHide: true,
  });
  let exit = null;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  try {
    const first = await requestWhenReady(child, () => exit);
    const second = await requestOnce();
    if (first !== second) fail('osrm-probe-nondeterministic', 'fixed public route response changed across identical requests');
    const value = JSON.parse(first);
    const route = value?.routes?.[0];
    if (value?.code !== 'Ok' || value.routes?.length !== 1 || value.waypoints?.length !== 2
      || route?.distance !== 1_547.8 || route?.duration !== 1_114 || route?.weight !== 1_114
      || route?.weight_name !== 'duration' || route?.geometry?.type !== 'LineString'
      || route.geometry.coordinates?.length !== 84) {
      fail('osrm-probe-result-drift', 'fixed public route result no longer matches the admitted proof');
    }
    const run1Path = path.resolve(projectRoot, BUILD_ROOT, 'probe-run1.json');
    const run2Path = path.resolve(projectRoot, BUILD_ROOT, 'probe-run2.json');
    writeFileSync(run1Path, first, { encoding: 'utf8' });
    writeFileSync(run2Path, second, { encoding: 'utf8' });
    const binding = (filename, text) => ({
      path: path.relative(projectRoot, filename).replaceAll('\\', '/'),
      bytes: Buffer.byteLength(text),
      sha256: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    });
    const replayManifest = {
      schema: 'route-real-osrm-public-probe-replay/v1',
      equal: Buffer.from(first).equals(Buffer.from(second)),
      run1: binding(run1Path, first),
      run2: binding(run2Path, second),
    };
    writeFileSync(
      path.resolve(projectRoot, BUILD_ROOT, 'probe-replay-manifest.json'),
      `${JSON.stringify(replayManifest, null, 2)}\n`,
      { encoding: 'utf8' },
    );
    return freezeData({
      status: 'ready',
      fixtureId: 'philadelphia-city-hall-to-independence-hall/public-v1',
      loopbackOnly: true,
      repeatedResponseIdentical: true,
      responseIdentity: contentIdentity(JSON.parse(first)),
      distanceMetres: route.distance,
      durationSeconds: route.duration,
      geometryPoints: route.geometry.coordinates.length,
      privateRuntimeProductPromotion: false,
    }, 'fixed public OSRM route proof');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

async function requestWhenReady(child, exitState) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exitState()) fail('osrm-probe-process', 'local OSRM process exited before becoming ready');
    try {
      return await requestOnce();
    } catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill();
  fail('osrm-probe-timeout', 'local OSRM process did not become ready within the bounded wait');
}

function requestOnce() {
  return new Promise((resolve, reject) => {
    const request = http.get(FIXTURE_URL, { timeout: 5_000 }, (response) => {
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

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.length !== 2) fail('osrm-probe-cli', 'usage: node osrm_public_probe.mjs');
  process.stdout.write(`${JSON.stringify(await runFixedPublicOsrmProbe())}\n`);
}
