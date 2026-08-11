#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HIN_CANDIDATE_RECEIPT_SCHEMA,
  SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS,
  auditSourceCandidates,
  compareAcsEstimateCandidates,
  compareAcsVreCandidates,
  createHinCandidateReceipt,
  writeSourceCandidateAudit,
} from '../lib/source_candidate_audit.mjs';
import { fetchOfficialRows } from '../fetch_acs_tracts.mjs';
import { acquireRows as acquireOfficialVreRows } from '../fetch_acs_vre_b01003.mjs';
import { compareHin2025SemanticSnapshots } from '../lib/hin_2025_receipt.mjs';
import { acquireOfficialHin2025 } from '../lib/hin_2025_snapshot.mjs';

const OBSERVED_AT = '2026-08-11T03:00:00.000Z';
const repositoryRoot = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'));
const committedAcs = await fixture('src/data/acs_tracts_2024_pa101.json');
const committedVre = await fixture('src/data/acs_vre_b01003_2024_pa101.json');
const committedHin = await fixture('public/data/hin_2025.snapshot.json');

test('ACS comparisons ignore retrieval clocks but require review for contract or row changes', () => {
  const estimateClockOnly = structuredClone(committedAcs);
  estimateClockOnly.manifest.retrievedAt = OBSERVED_AT;
  assert.deepEqual(compareAcsEstimateCandidates(committedAcs, estimateClockOnly), {
    changed: false,
    reasons: [],
  });

  const estimateDrift = structuredClone(estimateClockOnly);
  estimateDrift.manifest.vintage = '2025';
  estimateDrift.rows[0].population.estimate += 1;
  estimateDrift.manifest.rowsSha256 = rowsIdentity(estimateDrift.rows);
  const estimateComparison = compareAcsEstimateCandidates(committedAcs, estimateDrift);
  assert.equal(estimateComparison.changed, true);
  assert.ok(estimateComparison.reasons.includes('manifest-vintage'));
  assert.ok(estimateComparison.reasons.includes('row-content'));

  const vreClockOnly = structuredClone(committedVre);
  vreClockOnly.manifest.retrievedAt = OBSERVED_AT;
  assert.equal(compareAcsVreCandidates(committedVre, vreClockOnly).changed, false);
  const vreDrift = structuredClone(vreClockOnly);
  vreDrift.manifest.tableId = 'B25003';
  vreDrift.manifest.geographyVintage = 'future geography';
  const vreComparison = compareAcsVreCandidates(committedVre, vreDrift);
  assert.ok(vreComparison.reasons.includes('manifest-tableId'));
  assert.ok(vreComparison.reasons.includes('manifest-geographyVintage'));
});

test('HIN candidate receipt is explicitly unadmitted and contains no invented reviewer or build clock', () => {
  const clockOnly = hinCandidate();
  const unchanged = compareHin2025SemanticSnapshots(committedHin, clockOnly);
  assert.equal(unchanged.changed, false);

  const changed = hinCandidate();
  changed.rows[0][1] = `${changed.rows[0][1]} reviewed candidate`;
  const comparison = compareHin2025SemanticSnapshots(committedHin, changed);
  assert.deepEqual(comparison.reasons, ['feature-content']);
  const receipt = createHinCandidateReceipt({ candidate: changed, comparison, observedAt: OBSERVED_AT });
  assert.equal(receipt.schema, HIN_CANDIDATE_RECEIPT_SCHEMA);
  assert.equal(receipt.artifact.builtAt, null);
  assert.equal(receipt.admission.status, 'not-admitted');
  assert.equal(receipt.admission.requiresHumanReview, true);
  assert.equal(receipt.admission.reviewedAt, null);
  assert.equal(receipt.admission.reviewedBy, null);
  assert.equal(receipt.audit.observedAt, OBSERVED_AT);
  assert.match(receipt.source.sourceAsOfMeaning, /not the crash-data period, retrieval, build, review, or audit time/i);
});

test('unchanged audit is report-only and leaves no candidate files', async () => {
  await withTempDirectory(async (outputDirectory) => {
    const report = await auditSourceCandidates({
      outputDirectory,
      repositoryRoot,
      observedAt: OBSERVED_AT,
      acquisitions: unchangedAcquisitions(),
    });
    assert.equal(report.status, 'unchanged');
    assert.equal(report.releaseGate, false);
    assert.equal(report.admission.automatic, false);
    assert.deepEqual(report.sources.map(({ status }) => status), [
      'unchanged', 'unchanged', 'unchanged',
    ]);
    assert.deepEqual(await readdir(outputDirectory), []);

    await writeSourceCandidateAudit(outputDirectory, report);
    assert.deepEqual((await readdir(outputDirectory)).sort(), [
      'source-candidate-audit.json',
      'source-candidate-audit.md',
    ]);
  });
});

test('semantic changes retain review candidates but never admit or rewrite committed artifacts', async () => {
  await withTempDirectory(async (outputDirectory) => {
    const estimate = structuredClone(committedAcs);
    estimate.manifest.retrievedAt = OBSERVED_AT;
    estimate.rows[0].population.estimate += 1;
    estimate.manifest.rowsSha256 = rowsIdentity(estimate.rows);
    const hin = hinCandidate();
    hin.rows[0][1] = `${hin.rows[0][1]} reviewed candidate`;

    const report = await auditSourceCandidates({
      outputDirectory,
      repositoryRoot,
      observedAt: OBSERVED_AT,
      acquisitions: {
        ...unchangedAcquisitions(),
        acsEstimates: async () => estimate,
        hin2025: async () => hin,
      },
    });
    assert.equal(report.status, 'review-required');
    assert.deepEqual(report.sources.map(({ status }) => status), [
      'review-required', 'unchanged', 'review-required',
    ]);
    const files = (await readdir(outputDirectory)).sort();
    assert.deepEqual(files, [
      'acs_tracts_2024_pa101.candidate.json',
      'hin_2025.candidate.receipt.json',
      'hin_2025.candidate.snapshot.json',
    ]);
    const receipt = JSON.parse(await readFile(
      path.join(outputDirectory, 'hin_2025.candidate.receipt.json'),
      'utf8',
    ));
    assert.deepEqual(receipt.admission, {
      status: 'not-admitted',
      requiresHumanReview: true,
      reviewedAt: null,
      reviewedBy: null,
    });
    assert.equal(receipt.artifact.builtAt, null);
  });
});

test('reused output directory removes prior candidates before an unchanged audit', async () => {
  await withTempDirectory(async (outputDirectory) => {
    const estimate = structuredClone(committedAcs);
    estimate.manifest.retrievedAt = OBSERVED_AT;
    estimate.rows[0].population.estimate += 1;
    estimate.manifest.rowsSha256 = rowsIdentity(estimate.rows);
    const changed = await auditSourceCandidates({
      outputDirectory,
      repositoryRoot,
      observedAt: OBSERVED_AT,
      acquisitions: {
        ...unchangedAcquisitions(),
        acsEstimates: async () => estimate,
      },
    });
    await writeSourceCandidateAudit(outputDirectory, changed);
    assert.equal(changed.status, 'review-required');
    assert.ok((await readdir(outputDirectory)).some((name) => name.endsWith('.candidate.json')));

    const unchanged = await auditSourceCandidates({
      outputDirectory,
      repositoryRoot,
      observedAt: OBSERVED_AT,
      acquisitions: unchangedAcquisitions(),
    });
    await writeSourceCandidateAudit(outputDirectory, unchanged);
    assert.equal(unchanged.status, 'unchanged');
    assert.deepEqual((await readdir(outputDirectory)).sort(), [
      'source-candidate-audit.json',
      'source-candidate-audit.md',
    ]);
  });
});

test('default source acquisitions attach bounded request timeouts', async () => {
  assert.ok(SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS > 0);
  assert.ok(SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS < 10 * 60 * 1000);
  const timeoutMs = 20;
  const abortingRequest = (_url, { signal } = {}) => new Promise((_, reject) => {
    assert.ok(signal, 'source request must receive an AbortSignal');
    const guard = setTimeout(() => reject(new Error('request signal did not abort')), timeoutMs * 10);
    const rejectForAbort = () => {
      clearTimeout(guard);
      reject(signal.reason);
    };
    if (signal.aborted) rejectForAbort();
    else signal.addEventListener('abort', rejectForAbort, { once: true });
  });
  const isTimeout = (error) => error?.name === 'TimeoutError';

  await assert.rejects(
    fetchOfficialRows({ request: abortingRequest, timeoutMs }),
    isTimeout,
  );
  await assert.rejects(
    acquireOfficialVreRows(null, { request: abortingRequest, timeoutMs }),
    isTimeout,
  );
  await assert.rejects(
    acquireOfficialHin2025({ request: abortingRequest, timeoutMs }),
    isTimeout,
  );
});

test('transport or contract failure remains distinct from change and fails closed', async () => {
  await withTempDirectory(async (outputDirectory) => {
    const report = await auditSourceCandidates({
      outputDirectory,
      repositoryRoot,
      observedAt: OBSERVED_AT,
      acquisitions: {
        ...unchangedAcquisitions(),
        acsVre: async () => { throw new Error('fixture endpoint unavailable'); },
      },
    });
    assert.equal(report.status, 'failed');
    const failed = report.sources.find(({ sourceId }) => sourceId === 'acs-tract-population-vre');
    assert.equal(failed.status, 'audit-failed');
    assert.equal(failed.admission.requiresHumanReview, true);
    assert.equal(failed.identity.candidate, null);
    assert.equal(failed.clocks.sourceAsOf, null);
    assert.match(failed.error, /endpoint unavailable/);
    await writeSourceCandidateAudit(outputDirectory, report);
    assert.deepEqual((await readdir(outputDirectory)).sort(), [
      'source-candidate-audit.json',
      'source-candidate-audit.md',
    ]);
  });
});

test('scheduled workflow is candidate-only, least-privilege, fail-closed, and outside release truth', async () => {
  const [workflow, runner, packageText] = await Promise.all([
    readFile(new URL('../../.github/workflows/audit-source-candidates.yml', import.meta.url), 'utf8'),
    readFile(new URL('../audit_source_candidates.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.match(workflow, /cron:\s*['"]17 9 15 \* \*['"]/);
  assert.match(workflow, /^permissions:\r?\n  contents: read\r?$/m);
  assert.match(workflow, /timeout-minutes:\s*10/);
  assert.match(workflow, /data:audit:source-candidates/);
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /steps\.audit\.outputs\.status != '0'[\s\S]*run: exit 1/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write|issues:\s*write/);
  assert.doesNotMatch(workflow, /git (?:add|commit|push|switch)|gh (?:pr|issue)|deploy|push origin|accept-reviewed-change|reviewed-by/i);
  assert.doesNotMatch(runner, /accept-reviewed-change|reviewed-by/);
  assert.equal(
    packageJson.scripts['data:audit:source-candidates'],
    'node scripts/audit_source_candidates.mjs',
  );
  assert.match(packageJson.scripts['test:data-automation'], /source_candidate_audit\.mjs/);
  assert.ok(SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS < 10 * 60 * 1000);
});

function unchangedAcquisitions() {
  const estimate = structuredClone(committedAcs);
  estimate.manifest.retrievedAt = OBSERVED_AT;
  const vre = structuredClone(committedVre);
  vre.manifest.retrievedAt = OBSERVED_AT;
  return {
    acsEstimates: async () => structuredClone(estimate),
    acsVre: async () => structuredClone(vre),
    hin2025: async () => hinCandidate(),
  };
}

function hinCandidate() {
  const candidate = structuredClone(committedHin);
  candidate.meta.retrievedAt = OBSERVED_AT;
  candidate.meta.itemMetadataModifiedAt = OBSERVED_AT;
  return candidate;
}

function rowsIdentity(rows) {
  return `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
}

async function fixture(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

async function withTempDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'engagement-source-audit-'));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(access(directory), /ENOENT/);
  }
}
