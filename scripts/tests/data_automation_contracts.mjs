#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildTractSourceAudit,
  isCadenceDue,
} from '../lib/data_automation.mjs';

const contract = {
  schema_version: 1,
  service_url: 'https://example.test/MapServer',
  current_layer_id: 0,
  expected_current_vintage: 2025,
  expected_geoid_count: 2,
  required_fields: ['STATE', 'COUNTY', 'TRACT', 'GEOID', 'NAME'],
};

const localTracts = featureCollection(['42101000100', '42101000200']);
const remoteTracts = featureCollection(['42101000200', '42101000100']);
const serviceMetadata = {
  layers: [
    { id: 3, name: 'ACS 2025', parentLayerId: -1 },
    { id: 4, name: 'Census Tracts', parentLayerId: 3 },
  ],
};
const layerMetadata = {
  id: 0,
  name: 'Census Tracts',
  description: 'Census Tracts; January 1, 2025 vintage',
  fields: contract.required_fields.map((name) => ({ name })),
};

const execFileAsync = promisify(execFile);

test('the anchored schedule runs exactly every 7 UTC days', () => {
  const cadence = { anchor: '2026-08-03', intervalDays: 7 };
  assert.equal(isCadenceDue('2026-08-02', cadence), false);
  assert.equal(isCadenceDue('2026-08-03', cadence), true);
  assert.equal(isCadenceDue('2026-08-09', cadence), false);
  assert.equal(isCadenceDue('2026-08-10', cadence), true);
  assert.equal(isCadenceDue('2026-08-11', cadence), false);
  assert.equal(isCadenceDue('2026-08-17', cadence), true);
  assert.equal(isCadenceDue('2026-09-14', cadence), true);
});

test('the anchored schedule rejects ambiguous or invalid dates', () => {
  assert.throws(() => isCadenceDue('2026-08-03T00:00:00Z'), /YYYY-MM-DD/);
  assert.throws(() => isCadenceDue('2026-02-30'), /valid/);
  assert.throws(() => isCadenceDue('2026-08-03', { anchor: 'bad-date' }), /YYYY-MM-DD/);
});

test('the cadence command defaults to the weekly policy and writes the Actions output', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'engagement-cadence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'github-output.txt');
  const script = fileURLToPath(new URL('../check_data_refresh_due.mjs', import.meta.url));
  const run = (date) => execFileAsync(process.execPath, [script, '--date', date], {
    env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });

  assert.match((await run('2026-08-10')).stdout, /^due=true\s*$/);
  assert.match((await run('2026-08-11')).stdout, /^due=false\s*$/);
  assert.equal(await readFile(outputFile, 'utf8'), 'due=true\ndue=false\n');
});

test('tract audit stays stable when vintage, schema, count, and GEOIDs match', () => {
  const report = buildTractSourceAudit({
    contract,
    localTracts,
    remoteTracts,
    serviceMetadata,
    layerMetadata,
    checkedAt: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(report.status, 'stable');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.latest_acs_vintage, 2025);
  assert.equal(report.current_layer_vintage, 2025);
  assert.equal(report.local_geoid_count, 2);
  assert.equal(report.remote_geoid_count, 2);
});

test('tract audit reports new vintages, schema drift, and GEOID drift together', () => {
  const report = buildTractSourceAudit({
    contract,
    localTracts,
    remoteTracts: featureCollection(['42101000100', '42101000300']),
    serviceMetadata: {
      layers: [{ id: 20, name: 'ACS 2026', parentLayerId: -1 }],
    },
    layerMetadata: {
      ...layerMetadata,
      description: 'Census Tracts; January 1, 2026 vintage',
      fields: layerMetadata.fields.filter(({ name }) => name !== 'TRACT'),
    },
    checkedAt: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(report.status, 'drift');
  assert.deepEqual(report.added_geoids, ['42101000300']);
  assert.deepEqual(report.removed_geoids, ['42101000200']);
  assert.deepEqual(report.missing_fields, ['TRACT']);
  assert.match(report.reasons.join('\n'), /ACS 2026/);
  assert.match(report.reasons.join('\n'), /vintage 2026/);
});

test('refresh and source-audit workflows preserve review and permission boundaries', async () => {
  const [refresh, audit] = await Promise.all([
    readFile(new URL('../../.github/workflows/refresh-tract-data.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/audit-tract-source.yml', import.meta.url), 'utf8'),
  ]);

  assert.match(refresh, /cron:\s*['"]23 6 \* \* 1['"]/);
  assert.match(refresh, /workflow_dispatch:/);
  assert.match(refresh, /check_data_refresh_due\.mjs --anchor 2026-08-03 --interval 7/);
  assert.match(refresh, /github\.event_name == 'workflow_dispatch' \|\| steps\.cadence\.outputs\.due == 'true'/);
  assert.match(refresh, /contents:\s*write/);
  assert.match(refresh, /pull-requests:\s*write/);
  assert.match(refresh, /set -euo pipefail\s+npm run data:refresh:tract-crime\s+npm run validate/);
  assert.match(refresh, /if: steps\.changes\.outputs\.changed == 'true'/);
  assert.match(refresh, /git switch -c "\$branch"/);
  assert.match(refresh, /git push origin "\$branch"/);
  assert.match(refresh, /gh pr create[\s\S]*--base main[\s\S]*Review and merge manually/);
  assert.doesNotMatch(refresh, /push origin (?:HEAD:)?main/);
  assert.doesNotMatch(refresh, /peter-evans\/create-pull-request/);
  assert.doesNotMatch(refresh, /continue-on-error|\|\|\s*true/);
  assert.match(refresh, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(refresh, /actions\/setup-node@[0-9a-f]{40}/);

  assertOrdered(refresh, [
    'npm run data:refresh:tract-crime',
    'npm run validate',
    'Detect semantic data changes',
    'Create review branch and pull request',
  ]);
  assert.match(
    refresh,
    /if \[\[ "\$tract_changed" == false && "\$snapshot_changed" == false \]\]; then[\s\S]*git restore -- public\/data\/tracts_phl\.geojson public\/data\/tract_crime_counts_last12m\.json[\s\S]*changed=false/,
  );
  assert.match(
    refresh,
    /git diff --quiet -- public\/data\/tract_crime_counts_last12m\.json[\s\S]*execFileSync\('git', \['show', `HEAD:\$\{artifact\}`\][\s\S]*delete previous\.meta\.generated_at;[\s\S]*delete current\.meta\.generated_at;[\s\S]*function canonicalize[\s\S]*JSON\.stringify\(canonicalize\(previous\)\) !== JSON\.stringify\(canonicalize\(current\)\)[\s\S]*snapshot_changed=true/,
  );
  assert.doesNotMatch(refresh, /ignore-matching-lines/);

  assert.match(audit, /cron:\s*['"]41 7 2 1,4,7,10 \*['"]/);
  assert.match(audit, /contents:\s*read/);
  assert.match(audit, /issues:\s*write/);
  assert.match(audit, /audit_tract_source\.mjs/);
  assert.match(audit, /gh issue (?:create|comment)/);
  assert.match(audit, /actions\/checkout@[0-9a-f]{40}/);
});

test('workflow semantic comparison ignores generated_at only', async (t) => {
  const refresh = await readFile(
    new URL('../../.github/workflows/refresh-tract-data.yml', import.meta.url),
    'utf8',
  );
  const embedded = /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n\s{10}NODE/.exec(refresh)?.[1];
  assert.ok(embedded, 'workflow must retain an executable semantic snapshot comparison');
  const comparisonScript = embedded.replace(/^ {10}/gm, '');

  const directory = await mkdtemp(path.join(tmpdir(), 'engagement-semantic-diff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactDirectory = path.join(directory, 'public', 'data');
  const artifact = path.join(artifactDirectory, 'tract_crime_counts_last12m.json');
  await mkdir(artifactDirectory, { recursive: true });
  const baseline = {
    meta: {
      generated_at: '2026-08-03T00:00:00.000Z',
      coverage_date: '2026-08-02',
      provenance: { dataset: 'incidents_part1_part2', owner: 'City of Philadelphia' },
    },
    rows: [
      { geoid: '42101000100', total: 1 },
      { geoid: '42101000200', total: 2 },
    ],
  };
  await writeFile(artifact, JSON.stringify(baseline));
  await execFileAsync('git', ['init'], { cwd: directory });
  await execFileAsync('git', ['add', '--', 'public/data/tract_crime_counts_last12m.json'], { cwd: directory });
  await execFileAsync('git', [
    '-c', 'user.name=contract-test',
    '-c', 'user.email=contract@example.test',
    'commit', '-m', 'baseline',
  ], { cwd: directory });

  await writeFile(artifact, JSON.stringify({
    ...baseline,
    meta: { ...baseline.meta, generated_at: '2026-08-10T00:00:00.000Z' },
  }));
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', comparisonScript], {
    cwd: directory,
  });

  await writeFile(artifact, JSON.stringify({
    rows: [
      { total: 1, geoid: '42101000100' },
      { total: 2, geoid: '42101000200' },
    ],
    meta: {
      provenance: { owner: 'City of Philadelphia', dataset: 'incidents_part1_part2' },
      coverage_date: '2026-08-02',
      generated_at: '2026-08-10T00:00:00.000Z',
    },
  }, null, 2));
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', comparisonScript], {
    cwd: directory,
  });

  await writeFile(artifact, JSON.stringify({
    ...baseline,
    meta: { ...baseline.meta, generated_at: '2026-08-10T00:00:00.000Z' },
    rows: [...baseline.rows].reverse(),
  }));
  await assert.rejects(
    execFileAsync(process.execPath, ['--input-type=module', '--eval', comparisonScript], {
      cwd: directory,
    }),
    ({ code }) => code === 1,
  );

  await writeFile(artifact, JSON.stringify({
    ...baseline,
    meta: { ...baseline.meta, generated_at: '2026-08-10T00:00:00.000Z' },
    rows: [{ geoid: '42101000100', total: 9 }, baseline.rows[1]],
  }));
  await assert.rejects(
    execFileAsync(process.execPath, ['--input-type=module', '--eval', comparisonScript], {
      cwd: directory,
    }),
    ({ code }) => code === 1,
  );
});

function assertOrdered(value, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = value.indexOf(marker);
    assert.ok(current > previous, `${marker} must appear after the preceding workflow gate.`);
    previous = current;
  }
}

function featureCollection(geoids) {
  return {
    type: 'FeatureCollection',
    features: geoids.map((geoid) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 40], [-75.2, 39.9]]],
      },
      properties: { GEOID: geoid },
    })),
  };
}
