import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  main,
  parseArguments,
  publishJsonNoOverwrite,
  renderCliError,
} from '../audit_spatial_attribution.mjs';
import {
  buildSpatialAttributionReport,
  SPATIAL_ATTRIBUTION_AUDIT_SCHEMA,
  SPATIAL_ATTRIBUTION_METHOD_COMPARISON_SCHEMA,
  SPATIAL_ATTRIBUTION_REPORT_SCHEMA,
  spatialAttributionValueIdentity,
} from '../lib/spatial_attribution_report.mjs';
import { buildSpatialAttributionAudit } from '../lib/spatial_attribution_audit.mjs';
import { compareSpatialAttributionMethods } from '../lib/spatial_attribution_methods.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forbiddenJsonKeys = [
  'incidentRows',
  'incidents',
  'rows',
  'features',
  'source_record_id',
  'source_ids',
  'exactAddress',
  'location',
  'location_block',
  'geometry',
  'coordinates',
  'lat',
  'lng',
  'raw',
];

test('builder consumes the two actual aggregate schemas and projects a bounded report', () => {
  const fixture = createFixture();
  const observedInputBytes = {
    denominator_audit: digest('denominator-file'),
    method_comparison: digest('comparison-file'),
  };
  const report = buildSpatialAttributionReport({ ...fixture, observedInputBytes });

  assert.equal(report.schema, SPATIAL_ATTRIBUTION_REPORT_SCHEMA);
  assert.equal(report.status, 'local-attribution-audit-only');
  assert.equal(report.artifact_identity, spatialAttributionValueIdentity(stripIdentity(report)));
  assert.deepEqual(report.exact_inputs.common, fixture.denominatorAudit.exact_input);
  assert.equal(
    report.exact_inputs.denominator_audit.audit_identity,
    fixture.denominatorAudit.audit_identity,
  );
  assert.equal(
    report.exact_inputs.method_comparison.comparison_identity,
    fixture.methodComparison.comparison_identity,
  );
  assert.equal(
    report.exact_inputs.denominator_audit.bytes_sha256,
    observedInputBytes.denominator_audit,
  );
  assert.deepEqual(report.canonical_denominator, { name: 'canonical_rows', total: 8 });
  assert.equal(report.analysis_eligible_denominator.total, 8);
  assert.deepEqual(report.analysis_eligible_denominator.exclusions, {
    non_active: 0,
    invalid_event_time: 0,
    unknown_category: 0,
  });
  assert.equal(report.tract_grid_comparison.spatial_status_matrix.cells.length, 6);
  assert.deepEqual(report.tract_grid_comparison.mapped_set_relationship, {
    denominator: 'analysis_eligible_rows',
    total: 8,
    tract_mapped: 5,
    grid_mapped: 6,
    intersection_mapped: 4,
    tract_only_mapped: 1,
    grid_only_mapped: 2,
    neither_mapped: 1,
    union_mapped: 7,
    combination_policy: 'never-sum-parallel-denominators-as-unique-events',
  });
  assert.deepEqual(report.methods.map(({ method }) => method), [
    'tract-fail-closed',
    'fixed-grid-500m',
    'fractional',
    'area-kernel',
  ]);
  assert.equal(report.methods[0].availability, 'partial');
  assert.equal(report.methods[2].availability, 'unavailable');
  assert.equal(report.methods[2].weighted_mass, null);
  assert.equal(report.methods[2].assigned_rows, 0);
  assert.equal(report.methods[2].excluded_rows, 8);
  assert.equal(Object.hasOwn(report.methods[0], 'aggregates'), false);
  assert.deepEqual(report.methods[0].exclusions, [
    { reason: 'tract-ambiguous', excluded_rows: 2 },
    { reason: 'tract-unmapped', excluded_rows: 1 },
  ]);

  const districtMissing = report.strata.district.values.find(({ value }) => value === null);
  assert.deepEqual(districtMissing.quality, {
    status: 'unavailable',
    reason: 'district-missing-or-unavailable',
  });
  const ambiguousBoundary = report.strata.boundary_status.values.find(
    ({ value }) => value === 'ambiguous-tract-boundary',
  );
  assert.equal(ambiguousBoundary.quality.status, 'ambiguous');
  const unmappedBoundary = report.strata.boundary_status.values.find(
    ({ value }) => value === 'outside-admitted-tract-geometries',
  );
  assert.equal(unmappedBoundary.quality.status, 'unmapped');
  const stalePopulation = report.strata.acs_temporal_compatibility.values.find(
    ({ value }) => value === 'outside-acs-period',
  );
  assert.equal(stalePopulation.quality.status, 'stale');
  assert.deepEqual(report.strata.road, {
    status: 'unavailable',
    reason: 'versioned-road-geometry-binding-unavailable',
  });
  assert.deepEqual(report.claim_boundary, {
    local_attribution_audit: true,
    causal_evidence: false,
    safety_evidence: false,
    individual_risk_evidence: false,
    product_serving_evidence: false,
    scientific_promotion_evidence: false,
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.methods[0]), true);

  const serialized = JSON.stringify(report);
  for (const key of forbiddenJsonKeys) {
    assert.doesNotMatch(serialized, new RegExp(`"${escapeRegExp(key)}"\\s*:`));
  }
  assert.deepEqual(
    buildSpatialAttributionReport({ ...fixture, observedInputBytes }),
    report,
    'same aggregate inputs must produce the same report identity and bytes',
  );
});

test('builder accepts real audit and methods producers with nonzero eligibility exclusions', () => {
  const exactInput = createExactInput();
  exactInput.m1.canonical.row_count = 5;
  exactInput.m1.canonical.bytes = 500;
  exactInput.m1.canonical.sha256 = digest('canonical parts with exclusions');
  exactInput.m2.row_count = 2;
  exactInput.m2.bytes = 200;
  exactInput.m2.admission = {
    canonical_rows_seen: 5,
    tract: { admitted: 1, ambiguous_excluded: 1, unmapped_excluded: 0 },
    'fixed-grid': { admitted: 1, unavailable_excluded: 1 },
    unknown_category: 1,
    invalid_event_time: 1,
    non_active: 1,
  };
  const snapshotId = digest('producer integration snapshot');
  const canonicalEvents = [
    producerEvent({ id: 1, snapshotId, tract: 'mapped', grid: 'mapped' }),
    producerEvent({ id: 2, snapshotId, tract: 'ambiguous', grid: 'unavailable' }),
    producerEvent({ id: 3, snapshotId, lifecycle: 'removal-candidate' }),
    producerEvent({ id: 4, snapshotId, eventAt: 'invalid-time' }),
    producerEvent({ id: 5, snapshotId, categoryStatus: 'unmapped', themeId: null }),
  ];
  const denominatorAudit = buildSpatialAttributionAudit({
    exact_input: exactInput,
    rows: canonicalEvents.map((canonicalEvent, index) => ({
      canonical_event: canonicalEvent,
      raw_dimensions: {
        source_snapshot_id: snapshotId,
        dc_dist: '09',
        psa: index === 0 ? '0' : '1',
        location_block_available: true,
      },
    })),
  });
  const methodComparison = compareSpatialAttributionMethods({
    exactInput,
    rows: canonicalEvents.slice(0, 2),
  });

  const report = buildSpatialAttributionReport({ denominatorAudit, methodComparison });
  assert.deepEqual(report.analysis_eligible_denominator, {
    name: 'analysis_eligible_rows',
    parent: 'canonical_rows',
    total: 2,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
  });
  assert.equal(report.canonical_denominator.total, 5);
  assert.equal(report.methods.every(({ input_rows: inputRows }) => inputRows === 2), true);
  assert.equal(report.tract_grid_comparison.spatial_status_matrix.total, 2);
  assert.deepEqual(report.strata.psa.values, [
    { value: '0', count: 1, quality: { status: 'available' } },
    { value: '1', count: 1, quality: { status: 'available' } },
  ]);
});

test('exact_input, producer schema and identities fail closed', async (t) => {
  const cases = [
    ['denominator schema', ({ denominatorAudit }) => {
      denominatorAudit.schema = 'engagement-spatial-attribution-audit/v1';
      refreshAuditIdentity(denominatorAudit);
    }, /schema is not/],
    ['method schema', ({ methodComparison }) => {
      methodComparison.schema = 'engagement-spatial-attribution-method-comparison/v1';
      refreshComparisonIdentity(methodComparison);
    }, /schema is not/],
    ['audit identity drift', ({ denominatorAudit }) => {
      denominatorAudit.canonical_denominator.total = 11;
    }, /does not match exact_input|audit_identity drifted/],
    ['comparison identity drift', ({ methodComparison }) => {
      methodComparison.source_spatial_rows.tract.mapped = 4;
    }, /invalid or do not conserve|comparison_identity drifted/],
    ['producer exact_input mismatch', ({ methodComparison }) => {
      methodComparison.exact_input.protocol.sha256 = digest('other protocol');
      refreshComparisonIdentity(methodComparison);
    }, /exact_input values do not match/],
    ['protocol schema mismatch', ({ denominatorAudit }) => {
      denominatorAudit.exact_input.protocol.schema =
        'engagement-area-intelligence-evaluation-protocol/v2';
      refreshAuditIdentity(denominatorAudit);
    }, /protocol schema is invalid/],
    ['missing M1 part identity', ({ denominatorAudit }) => {
      delete denominatorAudit.exact_input.m1.canonical.sha256;
      refreshAuditIdentity(denominatorAudit);
    }, /missing or unknown schema fields/],
    ['unknown exact_input field', ({ denominatorAudit }) => {
      denominatorAudit.exact_input.boundary = { identity: digest('unbound') };
      refreshAuditIdentity(denominatorAudit);
    }, /missing or unknown schema fields/],
    ['canonical identity mismatch', ({ denominatorAudit }) => {
      denominatorAudit.exact_input.m1.canonical.row_count = 11;
      refreshAuditIdentity(denominatorAudit);
    }, /canonical row identities do not reconcile/],
    ['M2 event-level policy contradiction', ({ denominatorAudit }) => {
      denominatorAudit.exact_input.m2.artifact_policy.event_level_data_included = true;
      refreshAuditIdentity(denominatorAudit);
    }, /must exclude event-level data/],
    ['M2 zero part count', ({ denominatorAudit }) => {
      denominatorAudit.exact_input.m2.part_count = 0;
      refreshAuditIdentity(denominatorAudit);
    }, /part_count must be positive/],
    ['unknown producer top field', ({ denominatorAudit }) => {
      denominatorAudit.generated_at = '2026-08-29T00:00:00.000Z';
      refreshAuditIdentity(denominatorAudit);
    }, /missing or unknown schema fields/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const fixture = createFixture();
      mutate(fixture);
      assert.throws(() => buildSpatialAttributionReport(fixture), pattern);
    });
  }
});

test('canonical, eligible, 3x2 and M2 conservation fail closed', async (t) => {
  const cases = [
    ['eligible exclusions', ({ denominatorAudit }) => {
      denominatorAudit.analysis_eligible_denominator.exclusions.non_active = 1;
      refreshAuditIdentity(denominatorAudit);
    }, /exclusions do not match/],
    ['tract denominator', ({ denominatorAudit }) => {
      denominatorAudit.tract_denominator.statuses.unmapped = 2;
      refreshAuditIdentity(denominatorAudit);
    }, /does not conserve/],
    ['grid denominator', ({ denominatorAudit }) => {
      denominatorAudit.grid_denominator.statuses.unavailable = 3;
      refreshAuditIdentity(denominatorAudit);
    }, /does not conserve/],
    ['duplicate matrix cell', ({ denominatorAudit }) => {
      denominatorAudit.spatial_status_matrix.cells[5] = structuredClone(
        denominatorAudit.spatial_status_matrix.cells[4],
      );
      refreshAuditIdentity(denominatorAudit);
    }, /duplicate\/conflicting cells|frozen 3x2 order/],
    ['reordered matrix cells', ({ denominatorAudit }) => {
      [denominatorAudit.spatial_status_matrix.cells[0],
        denominatorAudit.spatial_status_matrix.cells[1]] = [
        denominatorAudit.spatial_status_matrix.cells[1],
        denominatorAudit.spatial_status_matrix.cells[0],
      ];
      refreshAuditIdentity(denominatorAudit);
    }, /frozen 3x2 order/],
    ['matrix margin', ({ denominatorAudit }) => {
      denominatorAudit.spatial_status_matrix.cells[0].count = 5;
      refreshAuditIdentity(denominatorAudit);
    }, /does not conserve/],
    ['mapped set relationship', ({ denominatorAudit }) => {
      denominatorAudit.mapped_set_relationship.union_mapped = 8;
      refreshAuditIdentity(denominatorAudit);
    }, /does not conserve|conflicts with/],
    ['M2 reconciliation', ({ denominatorAudit }) => {
      denominatorAudit.m2_aggregate_reconciliation.tract.admitted = 4;
      refreshAuditIdentity(denominatorAudit);
    }, /does not match exact_input/],
    ['method source denominator mismatch', ({ methodComparison }) => {
      methodComparison.source_spatial_rows.tract.mapped = 4;
      methodComparison.source_spatial_rows.tract.unmapped = 2;
      refreshComparisonIdentity(methodComparison);
    }, /do not match the denominator audit/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const fixture = createFixture();
      mutate(fixture);
      assert.throws(() => buildSpatialAttributionReport(fixture), pattern);
    });
  }
});

test('method IDs, row admission and weighted mass fail closed', async (t) => {
  const cases = [
    ['wrong method ID/order', ({ methodComparison }) => {
      methodComparison.methods[3].method = 'fixed-grid';
      refreshMethodResultIdentity(methodComparison.methods[3]);
      refreshComparisonIdentity(methodComparison);
    }, /method IDs\/order/],
    ['missing method', ({ methodComparison }) => {
      methodComparison.methods.pop();
      refreshComparisonIdentity(methodComparison);
    }, /exactly four methods/],
    ['assigned plus excluded mismatch', ({ methodComparison }) => {
      methodComparison.methods[0].excluded_rows = 4;
      refreshMethodResultIdentity(methodComparison.methods[0]);
      refreshComparisonIdentity(methodComparison);
    }, /row mass does not conserve/],
    ['unavailable claims admission', ({ methodComparison }) => {
      const method = methodComparison.methods[2];
      method.assigned_rows = 1;
      method.excluded_rows = 7;
      method.weighted_mass = 1;
      method.availability = 'partial';
      method.unavailable_reason = null;
      method.exclusions[0].rows = 7;
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /aggregates cannot be empty|availability contradicts/],
    ['weighted mass differs from admitted rows', ({ methodComparison }) => {
      const method = methodComparison.methods[3];
      method.weighted_mass = 5.9;
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /availability contradicts/],
    ['widened tolerance cannot hide drift', ({ methodComparison }) => {
      const method = methodComparison.methods[0];
      method.tolerance = 1e-6;
      method.config_identity = methodConfigIdentity(method);
      method.aggregates[0].weighted_mass = 5.000006;
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /weighted mass does not conserve/],
    ['duplicate aggregate unit', ({ methodComparison }) => {
      const method = methodComparison.methods[3];
      method.aggregates.push(structuredClone(method.aggregates[0]));
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /duplicate\/conflicting or invalid units/],
    ['duplicate exclusion reason', ({ methodComparison }) => {
      const method = methodComparison.methods[0];
      method.exclusions[1].reason = method.exclusions[0].reason;
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /duplicate\/conflicting or invalid strata/],
    ['method result identity drift', ({ methodComparison }) => {
      methodComparison.methods[0].assigned_rows = 4;
      refreshComparisonIdentity(methodComparison);
    }, /row mass does not conserve|result_identity drifted/],
    ['forged method identity', ({ methodComparison }) => {
      const method = methodComparison.methods[0];
      method.method_identity = digest('forged');
      method.config_identity = methodConfigIdentity(method);
      refreshMethodResultIdentity(method);
      refreshComparisonIdentity(methodComparison);
    }, /method_identity drifted/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const fixture = createFixture();
      mutate(fixture);
      assert.throws(() => buildSpatialAttributionReport(fixture), pattern);
    });
  }
});

test('report accepts producer-valid non-reciprocal tolerance quantization', () => {
  const fixture = createFixture();
  const method = fixture.methodComparison.methods[3];
  const tolerance = 3e-7;
  const scale = Math.round(1 / tolerance);
  method.tolerance = tolerance;
  method.assigned_rows = 1;
  method.excluded_rows = 7;
  method.weighted_mass = 1;
  method.exclusions = [{ reason: 'uncertainty-footprint-row-unavailable', rows: 7 }];
  method.aggregates = [
    { unit_id: '42101000100', contributing_rows: 1, weighted_mass: 1 / scale },
    { unit_id: '42101000200', contributing_rows: 1, weighted_mass: (scale - 1) / scale },
  ];
  method.config_identity = methodConfigIdentity(method);
  refreshMethodResultIdentity(method);
  refreshComparisonIdentity(fixture.methodComparison);
  const report = buildSpatialAttributionReport(fixture);
  assert.equal(report.methods[3].tolerance, tolerance);
  assert.equal(report.methods[3].weighted_mass, 1);
});

test('strata remain unique and preserve unavailable versus available zero', async (t) => {
  const cases = [
    ['duplicate stratum', ({ denominatorAudit }) => {
      denominatorAudit.strata.year.values.push({ value: 2024, count: 1 });
      denominatorAudit.strata.year.values[0].count = 7;
      refreshAuditIdentity(denominatorAudit);
    }, /duplicate\/conflicting values/],
    ['conflicting stratum', ({ denominatorAudit }) => {
      denominatorAudit.strata.normalized_category.values.push({ value: 'ASSAULT', count: 1 });
      denominatorAudit.strata.normalized_category.values[0].count = 2;
      refreshAuditIdentity(denominatorAudit);
    }, /duplicate\/conflicting values/],
    ['unavailable carries total', ({ denominatorAudit }) => {
      denominatorAudit.strata.road.total = 0;
      refreshAuditIdentity(denominatorAudit);
    }, /missing or unknown schema fields|must not carry total/],
    ['road attribution invented', ({ denominatorAudit }) => {
      denominatorAudit.strata.road = {
        status: 'available',
        denominator: 'analysis_eligible_rows',
        total: 8,
        values: [{ value: 'road-1', count: 8 }],
      };
      refreshAuditIdentity(denominatorAudit);
    }, /Road stratum|missing or unknown schema fields/],
    ['null district converted to code', ({ denominatorAudit }) => {
      denominatorAudit.strata.district.values[0].value = 'UNKNOWN';
      refreshAuditIdentity(denominatorAudit);
    }, /value is invalid|available attribution is inconsistent/],
    ['district status conflicts with join status', ({ denominatorAudit }) => {
      denominatorAudit.strata.district = {
        status: 'unavailable',
        reason: 'raw-binding-unavailable',
      };
      refreshAuditIdentity(denominatorAudit);
    }, /available attribution is inconsistent/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const fixture = createFixture();
      mutate(fixture);
      assert.throws(() => buildSpatialAttributionReport(fixture), pattern);
    });
  }

  const zero = createZeroFixture();
  const report = buildSpatialAttributionReport(zero);
  assert.deepEqual(report.canonical_denominator, { name: 'canonical_rows', total: 0 });
  assert.equal(report.strata.year.status, 'available');
  assert.equal(report.strata.year.total, 0);
  assert.deepEqual(report.strata.year.values, []);
  assert.equal(report.strata.road.status, 'unavailable');
  assert.equal(Object.hasOwn(report.strata.road, 'total'), false);
});

test('privacy declarations and non-aggregate fields fail closed under strict whitelists', async (t) => {
  const declarationCases = [
    ['denominator policy', ({ denominatorAudit }) => {
      denominatorAudit.artifact_policy.coordinates_included = true;
      refreshAuditIdentity(denominatorAudit);
    }],
    ['method privacy', ({ methodComparison }) => {
      methodComparison.privacy.raw_events_included = true;
      refreshComparisonIdentity(methodComparison);
    }],
    ['method governance', ({ methodComparison }) => {
      methodComparison.governance.serving_authority = true;
      refreshComparisonIdentity(methodComparison);
    }],
  ];
  for (const [name, mutate] of declarationCases) {
    await t.test(name, () => {
      const fixture = createFixture();
      mutate(fixture);
      assert.throws(() => buildSpatialAttributionReport(fixture), /boundary is invalid|aggregate-only/);
    });
  }

  for (const key of forbiddenJsonKeys) {
    await t.test(`forbidden injected key ${key}`, () => {
      const fixture = createFixture();
      fixture.denominatorAudit[key] = hostileValue(key);
      refreshAuditIdentity(fixture.denominatorAudit);
      assert.throws(
        () => buildSpatialAttributionReport(fixture),
        /missing or unknown schema fields|forbidden event-level field/,
      );
    });
  }
});

test('CLI requires three distinct explicit paths and never publishes after builder refusal', async () => {
  assert.deepEqual(parseArguments([
    '--denominator-audit=.dfev1/a/audit.json',
    '--method-comparison', '.dfev1/b/methods.json',
    '--output', '.dfev1/c/report.json',
  ]), {
    denominatorAudit: '.dfev1/a/audit.json',
    methodComparison: '.dfev1/b/methods.json',
    output: '.dfev1/c/report.json',
  });
  assert.throws(() => parseArguments([]), /Required option/);
  assert.throws(() => parseArguments([
    '--denominator-audit=a', '--method-comparison=b', '--output=c', '--overwrite',
  ]), /Unknown or duplicate option/);

  const fixture = createFixture();
  const base = path.join(repoRoot, '.dfev1', 'injected-spatial-report');
  let published = false;
  await assert.rejects(() => main([
    '--denominator-audit=a.json',
    '--method-comparison=b.json',
    '--output=c.json',
  ], {
    workspace: repoRoot,
    pathGuard: async (value) => path.resolve(base, value),
    readInput: async (filePath) => ({
      value: filePath.endsWith('a.json')
        ? fixture.denominatorAudit : fixture.methodComparison,
      bytesIdentity: digest(filePath),
    }),
    buildReport() { throw new Error('synthetic builder refusal'); },
    publishReport: async () => { published = true; },
    stdout: { write() { throw new Error('stdout must not be written'); } },
  }), /synthetic builder refusal/);
  assert.equal(published, false);

  await assert.rejects(() => main([
    '--denominator-audit=a.json',
    '--method-comparison=b.json',
    '--output=a.json',
  ], {
    workspace: repoRoot,
    pathGuard: async (value) => path.resolve(base, value),
  }), (error) => error.code === 'PATH_COLLISION');
  assert.match(
    renderCliError(Object.assign(new Error('fixture'), { code: 'FIXTURE' })),
    /"code":"FIXTURE"/,
  );
});

test('output path drift fails without path-based cleanup after the drift is observed', async () => {
  const parent = path.join(repoRoot, '.dfev1', 'simulated-safe-parent');
  const destination = path.join(parent, 'report.json');
  const staging = path.join(parent, '.report.json.staging-fixed-id');
  const calls = { write: 0, link: 0, remove: 0 };
  const directoryStat = { isDirectory: () => true, isSymbolicLink: () => false };
  const fileStat = {
    size: 10,
    mtimeMs: 1,
    dev: 1,
    ino: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fileSystem = {
    async lstat(target) {
      if (target === parent) return directoryStat;
      if (target === staging) return fileStat;
      if (target === destination) throw missing();
      throw missing();
    },
    async realpath(target) {
      if (target === parent) return parent;
      if (target === staging) return path.resolve(repoRoot, '..', 'escaped-staging');
      return target;
    },
    async writeFile() { calls.write += 1; },
    async link() { calls.link += 1; },
    async rm() { calls.remove += 1; },
  };
  await assert.rejects(() => publishJsonNoOverwrite(destination, '{}\n', {
    fileSystem,
    createId: () => 'fixed-id',
    allowedRoot: repoRoot,
  }), (error) => error.code === 'OUTPUT_PATH_CHANGED');
  assert.deepEqual(calls, { write: 1, link: 0, remove: 0 });
});

test('real CLI writes inside caller paths, refuses overwrite and never creates parents', async (t) => {
  await fs.mkdir(path.join(repoRoot, '.dfev1'), { recursive: true });
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1', 'spatial-report-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const denominatorPath = path.join(root, 'denominator.json');
  const methodsPath = path.join(root, 'methods.json');
  const outputParent = path.join(root, 'result');
  const outputPath = path.join(outputParent, 'report.json');
  const fixture = createFixture();
  await fs.writeFile(denominatorPath, `${JSON.stringify(fixture.denominatorAudit, null, 2)}\n`);
  await fs.writeFile(methodsPath, `${JSON.stringify(fixture.methodComparison, null, 2)}\n`);

  await assert.rejects(() => main([
    `--denominator-audit=${denominatorPath}`,
    `--method-comparison=${methodsPath}`,
    `--output=${outputPath}`,
  ], { workspace: repoRoot, stdout: { write() {} } }), /existing real directory/);
  assert.equal(await exists(outputParent), false);

  await fs.mkdir(outputParent);
  let stdout = '';
  const result = await main([
    `--denominator-audit=${denominatorPath}`,
    `--method-comparison=${methodsPath}`,
    `--output=${outputPath}`,
  ], { workspace: repoRoot, stdout: { write(value) { stdout += value; } } });
  assert.equal(result.status, 'local-attribution-audit-written');
  assert.equal(JSON.parse(stdout).report_identity, result.report_identity);
  const firstBytes = await fs.readFile(outputPath);
  const report = JSON.parse(firstBytes.toString('utf8'));
  assert.equal(report.artifact_identity, result.report_identity);
  assert.equal(
    report.exact_inputs.denominator_audit.bytes_sha256,
    digestBytes(await fs.readFile(denominatorPath)),
  );
  assert.deepEqual(
    (await fs.readdir(outputParent)).filter((name) => name.includes('.staging-')),
    [],
  );

  await assert.rejects(() => main([
    `--denominator-audit=${denominatorPath}`,
    `--method-comparison=${methodsPath}`,
    `--output=${outputPath}`,
  ], { workspace: repoRoot, stdout: { write() {} } }), (error) => error.code === 'OUTPUT_EXISTS');
  assert.deepEqual(await fs.readFile(outputPath), firstBytes);

  await assert.rejects(() => main([
    `--denominator-audit=${path.resolve(repoRoot, '..', 'outside.json')}`,
    `--method-comparison=${methodsPath}`,
    `--output=${path.join(root, 'outside-refusal.json')}`,
  ], { workspace: repoRoot, stdout: { write() {} } }), /task-owned \.dfev1 path/);
});

function createFixture() {
  const exactInput = createExactInput();
  const denominatorAudit = createDenominatorAudit(exactInput);
  const methodComparison = createMethodComparison(exactInput);
  return { denominatorAudit, methodComparison };
}

function producerEvent({
  id,
  snapshotId,
  lifecycle = 'active',
  eventAt = '2024-01-01T12:00:00.000Z',
  categoryStatus = 'mapped',
  themeId = 'person',
  tract = 'mapped',
  grid = 'mapped',
}) {
  return {
    source_record_id: `cartodb:${id}`,
    source_ids: { cartodb_id: String(id) },
    event_at: eventAt,
    lifecycle: { state: lifecycle },
    normalized_category: { status: categoryStatus, theme_id: themeId },
    spatial: {
      tract: tract === 'mapped'
        ? { status: 'mapped', geoid: '42101000100', candidates: ['42101000100'], reason: null }
        : { status: 'ambiguous', geoid: null, candidates: ['42101000100', '42101000200'], reason: 'point-on-or-across-tract-boundary' },
      grid: grid === 'mapped'
        ? { status: 'mapped', gridId: 'epsg3857-500m:-1:2', scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500 }
        : { status: 'unavailable', gridId: null, scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500 },
    },
    acs: {
      status: 'available',
      valueStatus: 'available',
      estimate: { value: 2499 },
      temporalAlignment: 'within-acs-period',
      modelInputEligible: true,
    },
    lineage: { source_snapshot_id: snapshotId },
  };
}

function createExactInput() {
  return {
    protocol: {
      schema: 'engagement-spatial-attribution-protocol/v2',
      sha256: digest('spatial attribution protocol v2'),
    },
    m1: {
      receipt_schema: 'engagement-phl-crime-warehouse-receipt/v3',
      receipt_identity: digest('m1 receipt identity'),
      receipt_sha256: digest('m1 receipt bytes'),
      warehouse_schema: 'engagement-phl-crime-event-warehouse/v1',
      warehouse_current_snapshot_id: digest('warehouse current snapshot'),
      canonical: {
        partition_count: 2,
        row_count: 8,
        bytes: 1000,
        sha256: digest('canonical parts'),
      },
    },
    m2: {
      mart_schema: 'engagement-area-intelligence-feature-mart/v2',
      manifest_sha256: digest('m2 manifest bytes'),
      artifact_identity: digest('m2 artifact identity'),
      part_bindings_identity: digest('m2 part bindings'),
      part_count: 2,
      row_count: 8,
      bytes: 800,
      admission: {
        canonical_rows_seen: 8,
        tract: { admitted: 5, ambiguous_excluded: 2, unmapped_excluded: 1 },
        'fixed-grid': { admitted: 6, unavailable_excluded: 2 },
        unknown_category: 0,
        invalid_event_time: 0,
        non_active: 0,
      },
      artifact_policy: { event_level_data_included: false },
    },
  };
}

function createDenominatorAudit(exactInput) {
  const admission = exactInput.m2.admission;
  const core = {
    schema: SPATIAL_ATTRIBUTION_AUDIT_SCHEMA,
    exact_input: structuredClone(exactInput),
    method: {
      version: 'spatial-attribution-denominator-audit/v2',
      canonical_event_denominator: 'canonical_rows',
      analysis_eligibility: 'active-and-valid-event-time-and-mapped-normalized-category',
      tract_grid_relationship: 'parallel-overlapping-event-sets',
      source_join: {
        cardinality: 'exactly-one-source-record-per-canonical-event-and-lineage-snapshot',
        missing_value_policy: 'null-is-unavailable',
      },
      acs_population_bands: {
        low_upper_exclusive: 2500,
        medium_upper_exclusive: 4500,
      },
    },
    canonical_denominator: { name: 'canonical_rows', total: 8 },
    analysis_eligible_denominator: {
      name: 'analysis_eligible_rows',
      parent: 'canonical_rows',
      total: 8,
      exclusions: { non_active: 0, invalid_event_time: 0, unknown_category: 0 },
    },
    tract_denominator: {
      name: 'tract_status_rows',
      parent: 'analysis_eligible_rows',
      total: 8,
      statuses: { mapped: 5, ambiguous: 2, unmapped: 1 },
    },
    grid_denominator: {
      name: 'grid_status_rows',
      parent: 'analysis_eligible_rows',
      total: 8,
      statuses: { mapped: 6, unavailable: 2 },
    },
    spatial_status_matrix: {
      denominator: 'analysis_eligible_rows',
      total: 8,
      cells: [
        { tract_status: 'mapped', grid_status: 'mapped', count: 4 },
        { tract_status: 'mapped', grid_status: 'unavailable', count: 1 },
        { tract_status: 'ambiguous', grid_status: 'mapped', count: 1 },
        { tract_status: 'ambiguous', grid_status: 'unavailable', count: 1 },
        { tract_status: 'unmapped', grid_status: 'mapped', count: 1 },
        { tract_status: 'unmapped', grid_status: 'unavailable', count: 0 },
      ],
    },
    mapped_set_relationship: {
      denominator: 'analysis_eligible_rows',
      total: 8,
      tract_mapped: 5,
      grid_mapped: 6,
      intersection_mapped: 4,
      tract_only_mapped: 1,
      grid_only_mapped: 2,
      neither_mapped: 1,
      union_mapped: 7,
      combination_policy: 'never-sum-parallel-denominators-as-unique-events',
    },
    m2_aggregate_reconciliation: {
      status: 'matched',
      analysis_eligible_rows: 8,
      ...structuredClone(admission),
    },
    strata: {
      year: availableStratum([{ value: 2024, count: 8 }]),
      normalized_category: availableStratum([
        { value: 'ASSAULT', count: 3 },
        { value: 'THEFT', count: 5 },
      ]),
      tract_status: availableStratum([
        { value: 'ambiguous', count: 2 },
        { value: 'mapped', count: 5 },
        { value: 'unmapped', count: 1 },
      ]),
      grid_status: availableStratum([
        { value: 'mapped', count: 6 },
        { value: 'unavailable', count: 2 },
      ]),
      boundary_status: availableStratum([
        { value: 'ambiguous-tract-boundary', count: 2 },
        { value: 'inside-single-tract', count: 5 },
        { value: 'outside-admitted-tract-geometries', count: 1 },
      ]),
      acs_population_band: availableStratum([
        { value: 'high', count: 1 },
        { value: 'low', count: 3 },
        { value: 'medium', count: 2 },
        { value: 'unavailable', count: 2 },
      ]),
      acs_temporal_compatibility: availableStratum([
        { value: 'outside-acs-period', count: 2 },
        { value: 'unavailable', count: 1 },
        { value: 'within-acs-period', count: 5 },
      ]),
      district: availableStratum([
        { value: null, count: 2 },
        { value: 'D1', count: 6 },
      ]),
      psa: availableStratum([
        { value: null, count: 1 },
        { value: 'P1', count: 7 },
      ]),
      road: {
        status: 'unavailable',
        reason: 'versioned-road-geometry-binding-unavailable',
      },
    },
    district_psa_attribution: {
      status: 'available',
      total: 8,
      joined_events: 8,
      district_missing: 2,
      psa_missing: 1,
    },
    artifact_policy: {
      aggregate_only: true,
      event_level_data_included: false,
      source_records_included: false,
      source_identifiers_included: false,
      coordinates_included: false,
      generalized_locations_included: false,
    },
    authority: { serving: false, promotion: false, forecast: false, receipt: false },
  };
  return { ...core, audit_identity: spatialAttributionValueIdentity(core) };
}

function createMethodComparison(exactInput) {
  const methods = [
    methodResult('tract-fail-closed', {
      assigned: 5,
      exclusions: [
        { reason: 'tract-ambiguous', rows: 2 },
        { reason: 'tract-unmapped', rows: 1 },
      ],
      aggregates: [
        { unit_id: '42101000100', contributing_rows: 5, weighted_mass: 5 },
      ],
    }),
    methodResult('fixed-grid-500m', {
      assigned: 6,
      exclusions: [{ reason: 'grid-unavailable', rows: 2 }],
      aggregates: [
        { unit_id: 'epsg3857-500m:-1:2', contributing_rows: 6, weighted_mass: 6 },
      ],
    }),
    methodResult('fractional', {
      assigned: 0,
      exclusions: [{ reason: 'uncertainty-footprint-artifact-unavailable', rows: 8 }],
      aggregates: [],
      inputArtifactIdentity: null,
    }),
    methodResult('area-kernel', {
      assigned: 6,
      exclusions: [{ reason: 'uncertainty-footprint-row-unavailable', rows: 2 }],
      aggregates: [
        { unit_id: '42101000100', contributing_rows: 4, weighted_mass: 3 },
        { unit_id: '42101000200', contributing_rows: 4, weighted_mass: 3 },
      ],
      inputArtifactIdentity: digest('area kernel footprint artifact'),
    }),
  ];
  const core = {
    schema: SPATIAL_ATTRIBUTION_METHOD_COMPARISON_SCHEMA,
    exact_input: structuredClone(exactInput),
    input_rows: 8,
    source_spatial_rows: {
      tract: { mapped: 5, ambiguous: 2, unmapped: 1, invalid: 0 },
      fixed_grid: { mapped: 6, unavailable: 2, invalid: 0 },
    },
    methods,
    privacy: {
      aggregate_only: true,
      coordinates_included: false,
      generalized_locations_included: false,
      raw_events_included: false,
      source_record_ids_included: false,
      uncertainty_footprints_included: false,
    },
    governance: {
      integer_m2_mart_contract: 'independent-unchanged',
      evaluation_contract: 'unchanged',
      serving_contract: 'unchanged',
      forecast_contract: 'unchanged',
      acs_weighting: 'forbidden',
      demographic_ranking_authority: false,
      serving_authority: false,
      forecast_authority: false,
      promotion_authority: false,
      known_route_segment_kernel: 'not-area-attribution',
    },
  };
  return { ...core, comparison_identity: spatialAttributionValueIdentity(core) };
}

function methodResult(method, {
  assigned,
  exclusions,
  aggregates,
  inputArtifactIdentity = null,
  tolerance = 1e-9,
}) {
  const blueprint = methodBlueprint(method);
  const methodIdentity = spatialAttributionValueIdentity({
    schema: 'engagement-spatial-attribution-method-result/v2',
    method,
    method_version: blueprint.method_version,
    unit_type: blueprint.unit_type,
    assignment: blueprint.assignment,
    spatial_semantics: blueprint.spatial_semantics,
    weight_basis: blueprint.weight_basis,
  });
  const excluded = 8 - assigned;
  const availability = assigned === 8 ? 'available' : assigned > 0 ? 'partial' : 'unavailable';
  const value = {
    schema: 'engagement-spatial-attribution-method-result/v2',
    method,
    method_version: blueprint.method_version,
    unit_type: blueprint.unit_type,
    assignment: blueprint.assignment,
    availability,
    weight_basis: blueprint.weight_basis,
    candidate_weight_contract_identity: blueprint.candidate_weight_contract_identity,
    input_artifact_identity: inputArtifactIdentity,
    unavailable_reason: assigned > 0
      ? null
      : inputArtifactIdentity === null && blueprint.assignment === 'weighted'
        ? 'uncertainty-footprint-artifact-unavailable'
        : 'no-admitted-assignments',
    acs_weighting: 'forbidden',
    known_route_segment_kernel: 'not-area-attribution',
    integer_m2_mart_contract: 'independent-unchanged',
    method_identity: methodIdentity,
    config_identity: null,
    input_rows: 8,
    assigned_rows: assigned,
    excluded_rows: excluded,
    weighted_mass: assigned > 0 ? assigned : null,
    tolerance,
    exclusions,
    aggregates,
  };
  value.config_identity = methodConfigIdentity(value);
  value.result_identity = spatialAttributionValueIdentity(value);
  return value;
}

function methodConfigIdentity(method) {
  const blueprint = methodBlueprint(method.method);
  return spatialAttributionValueIdentity({
    schema: 'engagement-spatial-attribution-method-config/v2',
    method: method.method,
    ...blueprint,
    input_artifact_identity: method.input_artifact_identity,
    configured_unavailable_reason:
      blueprint.assignment === 'weighted' && method.input_artifact_identity === null
        ? 'uncertainty-footprint-artifact-unavailable'
        : null,
    tolerance: method.tolerance,
    acs_weighting: 'forbidden',
    known_route_segment_kernel: 'not-area-attribution',
    integer_m2_mart_contract: 'independent-unchanged',
    method_identity: method.method_identity,
  });
}

function methodBlueprint(method) {
  const blueprints = {
    'tract-fail-closed': {
      method_version: 'crime-event-tract-fail-closed/v1',
      unit_type: 'tract',
      assignment: 'integer',
      spatial_semantics:
        'canonical-spatial-tract-mapped-only-ambiguous-and-unmapped-excluded',
      weight_basis: 'canonical-unit-mass',
      candidate_weights: 'forbidden',
      candidate_weight_contract_identity: null,
    },
    'fixed-grid-500m': {
      method_version: 'epsg3857-square-grid-v1',
      unit_type: 'fixed-grid',
      assignment: 'integer',
      spatial_semantics:
        'canonical-spatial-grid-mapped-only-epsg3857-square-grid-v1-500m',
      weight_basis: 'canonical-unit-mass',
      candidate_weights: 'forbidden',
      candidate_weight_contract_identity: null,
    },
    fractional: {
      method_version: 'fractional-area-attribution/v2',
      unit_type: 'tract',
      assignment: 'weighted',
      spatial_semantics:
        'caller-supplied-admitted-uncertainty-footprint-and-normalized-tract-candidates',
      weight_basis: 'caller-supplied-fractional-area-overlap',
      candidate_weights: 'required',
      candidate_weight_contract_identity: spatialAttributionValueIdentity({
        schema: 'engagement-spatial-attribution-candidate-weights/v1',
        method: 'fractional',
        normalization: 'finite-nonnegative-sum-to-one',
        unit_type: 'tract',
        geometry_derivation: 'outside-comparator',
      }),
    },
    'area-kernel': {
      method_version: 'area-kernel-attribution/v2',
      unit_type: 'tract',
      assignment: 'weighted',
      spatial_semantics:
        'caller-supplied-admitted-area-uncertainty-footprint-and-normalized-tract-kernel-mass',
      weight_basis: 'caller-supplied-area-kernel-mass',
      candidate_weights: 'required',
      candidate_weight_contract_identity: spatialAttributionValueIdentity({
        schema: 'engagement-spatial-attribution-candidate-weights/v1',
        method: 'area-kernel',
        normalization: 'finite-nonnegative-sum-to-one',
        unit_type: 'tract',
        geometry_derivation: 'outside-comparator',
        known_route_segment_kernel: 'forbidden',
      }),
    },
  };
  return blueprints[method];
}

function createZeroFixture() {
  const fixture = createFixture();
  const { denominatorAudit: audit, methodComparison: comparison } = fixture;
  audit.exact_input.m1.canonical.row_count = 0;
  audit.exact_input.m2.admission = zeroAdmission();
  audit.canonical_denominator.total = 0;
  audit.analysis_eligible_denominator.total = 0;
  audit.analysis_eligible_denominator.exclusions = {
    non_active: 0, invalid_event_time: 0, unknown_category: 0,
  };
  audit.tract_denominator.total = 0;
  audit.tract_denominator.statuses = { mapped: 0, ambiguous: 0, unmapped: 0 };
  audit.grid_denominator.total = 0;
  audit.grid_denominator.statuses = { mapped: 0, unavailable: 0 };
  audit.spatial_status_matrix.total = 0;
  audit.spatial_status_matrix.cells.forEach((cell) => { cell.count = 0; });
  for (const key of [
    'total', 'tract_mapped', 'grid_mapped', 'intersection_mapped',
    'tract_only_mapped', 'grid_only_mapped', 'neither_mapped', 'union_mapped',
  ]) audit.mapped_set_relationship[key] = 0;
  audit.m2_aggregate_reconciliation = {
    status: 'matched', analysis_eligible_rows: 0, ...zeroAdmission(),
  };
  for (const [dimension, stratum] of Object.entries(audit.strata)) {
    if (dimension !== 'road') {
      stratum.total = 0;
      stratum.values = [];
    }
  }
  audit.district_psa_attribution = {
    status: 'available', total: 0, joined_events: 0, district_missing: 0, psa_missing: 0,
  };
  refreshAuditIdentity(audit);

  comparison.exact_input = structuredClone(audit.exact_input);
  comparison.input_rows = 0;
  comparison.source_spatial_rows = {
    tract: { mapped: 0, ambiguous: 0, unmapped: 0, invalid: 0 },
    fixed_grid: { mapped: 0, unavailable: 0, invalid: 0 },
  };
  comparison.methods = comparison.methods.map((original) => {
    const value = {
      ...original,
      availability: 'unavailable',
      unavailable_reason:
        original.method === 'fractional'
          ? 'uncertainty-footprint-artifact-unavailable' : 'no-input-rows',
      input_rows: 0,
      assigned_rows: 0,
      excluded_rows: 0,
      weighted_mass: null,
      exclusions: [],
      aggregates: [],
    };
    refreshMethodResultIdentity(value);
    return value;
  });
  refreshComparisonIdentity(comparison);
  return fixture;
}

function zeroAdmission() {
  return {
    canonical_rows_seen: 0,
    tract: { admitted: 0, ambiguous_excluded: 0, unmapped_excluded: 0 },
    'fixed-grid': { admitted: 0, unavailable_excluded: 0 },
    unknown_category: 0,
    invalid_event_time: 0,
    non_active: 0,
  };
}

function availableStratum(values) {
  return { status: 'available', denominator: 'analysis_eligible_rows', total: 8, values };
}

function refreshAuditIdentity(value) {
  delete value.audit_identity;
  value.audit_identity = spatialAttributionValueIdentity(value);
}

function refreshComparisonIdentity(value) {
  delete value.comparison_identity;
  value.comparison_identity = spatialAttributionValueIdentity(value);
}

function refreshMethodResultIdentity(value) {
  delete value.result_identity;
  value.result_identity = spatialAttributionValueIdentity(value);
}

function stripIdentity(value) {
  const clone = structuredClone(value);
  delete clone.artifact_identity;
  return clone;
}

function hostileValue(key) {
  if (['incidentRows', 'incidents', 'rows', 'features'].includes(key)) return [];
  if (['geometry', 'coordinates'].includes(key)) return {};
  if (['lat', 'lng'].includes(key)) return 1;
  return 'sensitive-fixture';
}

function digest(value) {
  return digestBytes(Buffer.from(value));
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
