#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  admitBenchmarkReceipt,
  admitCorpus,
  admitManifest,
  admitPolicy,
  admitQaPolicy,
  admitQaReceipt,
  admitQaSampleManifest,
  admitQaTemplate,
  admitThresholds,
  EXACT_KEYS,
} from './validation/contracts.mjs';

const fixtureRoot = new URL('../fixtures/mainline-m7-validation/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));

export async function validateM7Pack() {
  const corpus = admitCorpus(await load('public-od-corpus.v1.json'));
  const policy = admitPolicy(await load('validation-policy.v1.json'));
  const manifest = admitManifest(await load('manifest.v1.json'), corpus, policy);
  const baseline = admitBenchmarkReceipt(await load('baseline-receipt.v1.json'), { corpus, manifest, policy });
  const thresholds = admitThresholds(await load('performance-thresholds.v1.json'), baseline);
  const qaPolicy = admitQaPolicy(await load('qa-sampling-policy.v1.json'));
  admitQaTemplate(await load('qa-adjudication-template.v1.json'));
  const qaSampleManifest = admitQaSampleManifest(
    await load('qa-sample-manifest.v1.json'),
    { policy: qaPolicy, benchmarkReceipt: baseline, eligibleSegments: [] },
  );
  const qaReceipt = admitQaReceipt(await load('qa-receipt.v1.json'), {
    policy: qaPolicy,
    benchmarkReceipt: baseline,
    sampleManifest: qaSampleManifest,
    eligibleSegments: [],
    adjudicationRecords: [],
  });
  assertSchemaExactKeys(await load('exact-key-schemas.v1.json'));
  return {
    status: 'valid',
    pairCount: corpus.pairs.length,
    manifestIdentity: manifest.identity,
    baseline: { status: baseline.status, identity: baseline.identity },
    thresholds: { status: thresholds.status, frozen: thresholds.frozen, identity: thresholds.identity },
    privacyEgressCount: baseline.privacy.egressCount,
    qa: { status: qaReceipt.status, sampledSegmentCount: qaReceipt.sampledSegmentCount, twoReviewerCompleted: qaReceipt.twoReviewerCompleted },
  };
}

export function assertSchemaExactKeys(schemas) {
  const definitions = schemas?.$defs;
  const mappings = [
    ['corpus', definitions?.corpus, EXACT_KEYS.corpus],
    ['pair', definitions?.pair, EXACT_KEYS.pair],
    ['point', definitions?.point, EXACT_KEYS.point],
    ['manifest', definitions?.manifest, EXACT_KEYS.manifest],
    ['manifest.corpus', definitions?.manifestCorpus, EXACT_KEYS.manifestCorpus],
    ['manifest.policy', definitions?.manifestPolicy, EXACT_KEYS.manifestPolicy],
    ['receipt', definitions?.receipt, EXACT_KEYS.receipt],
    ['receipt.identities', definitions?.identities, EXACT_KEYS.identities],
    ['receipt.descriptor', definitions?.descriptor, EXACT_KEYS.descriptor],
    ['receipt.denominator', definitions?.denominator, EXACT_KEYS.denominator],
    ['receipt.metrics', definitions?.metrics, EXACT_KEYS.metrics],
    ['receipt.privacy', definitions?.receipt?.properties?.privacy, EXACT_KEYS.privacy],
    ['receipt.successObservation', definitions?.successObservation, EXACT_KEYS.successObservation],
    ['receipt.invalidObservation', definitions?.invalidObservation, EXACT_KEYS.invalidObservation],
    ['receipt.unavailableObservation', definitions?.unavailableObservation, EXACT_KEYS.unavailableObservation],
    ['receipt.candidateObservation', definitions?.candidateObservation, EXACT_KEYS.candidateObservation],
    ['receipt.candidateEvidence', definitions?.candidateEvidence, EXACT_KEYS.candidateEvidence],
    ['thresholds', definitions?.thresholds, EXACT_KEYS.thresholds],
    ['thresholds.values', definitions?.thresholdValues, EXACT_KEYS.thresholdValues],
    ['qaSampleManifest', definitions?.qaSampleManifest, EXACT_KEYS.qaSampleManifest],
    ['qaSampleManifest.samples[]', definitions?.qaSample, EXACT_KEYS.qaSample],
    ['qaReceipt', definitions?.qaReceipt, EXACT_KEYS.qaReceipt],
    ['qaAdjudication', definitions?.qaAdjudication, EXACT_KEYS.qaTemplate],
    ['qaAdjudication.reviewer', definitions?.reviewer, EXACT_KEYS.reviewer],
    ['qaAdjudication.adjudication', definitions?.adjudication, EXACT_KEYS.adjudication],
  ];
  for (const [name, schema, keys] of mappings) {
    if (schema?.additionalProperties !== false) {
      throw new Error(`schema ${name} must reject additional properties`);
    }
    const required = [...(schema.required ?? [])].sort();
    const expected = [...keys].sort();
    if (required.length !== expected.length
      || required.some((key, index) => key !== expected[index])) {
      throw new Error(`schema ${name} required keys do not match executable contract`);
    }
  }
  if (definitions?.qaSampleManifest?.properties?.samples?.items?.$ref !== '#/$defs/qaSample') {
    throw new Error('schema qaSampleManifest samples must use the exact QA sample definition');
  }
  return schemas;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(JSON.stringify(await validateM7Pack(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
