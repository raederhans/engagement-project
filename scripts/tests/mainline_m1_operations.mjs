import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitArtifactObjectCatalog,
  admitDataFoundationOperationReceipt,
  createArtifactObjectCatalog,
  createDataFoundationOperationReceipt,
} from '../lib/data_foundation_operational_receipt.mjs';

const fixture = new URL('../fixtures/artifact-registry-contracts/valid-file-registry.json', import.meta.url);

test('M1 object catalog derives provider-neutral content keys from exact object hashes', async () => {
  const registry = JSON.parse(await readFile(fixture, 'utf8'));
  const catalog = createArtifactObjectCatalog(registry);
  assert.equal(catalog.protocol, 'ArtifactObjectCatalog/v1');
  assert.equal(catalog.registry_identity, registry.registryIdentity);
  assert.equal(catalog.key_template, 'objects/sha256/{first-two-hex}/{full-hex}');
  assert.equal(catalog.registry_contains_secrets, false);
  assert.equal(catalog.provider_credentials_included, false);
  assert.deepEqual(catalog.authority, { serving: false, promotion: false, deletion: false });
  for (const object of catalog.objects) {
    const digest = object.sha256.slice('sha256:'.length);
    assert.equal(object.content_key, `objects/sha256/${digest.slice(0, 2)}/${digest}`);
  }
  assert.equal(admitArtifactObjectCatalog(catalog).catalog_identity, catalog.catalog_identity);
});

test('M1 unavailable operations preserve absent clocks, verification, metrics, and authority', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const receipt = createDataFoundationOperationReceipt({
    registry_identity: digest,
    object_catalog_identity: `sha256:${'b'.repeat(64)}`,
    operation: 'scheduled-rebuild',
    environment: {
      environment_id: 'scheduled-environment-unobserved',
      platform: 'unavailable',
      runner_class: 'unavailable',
      physical_environment_observed: false,
    },
    observation: {
      status: 'unavailable', started_at: null, completed_at: null,
      reason: 'No scheduled execution receipt is admitted.',
    },
    verification: {
      status: 'unavailable', object_count: null,
      registry_identity_matched: null, catalog_identity_matched: null,
    },
    metrics: {
      duration_ms: null, downloaded_bytes: null, verified_bytes: null,
      verification_duration_ms: null, peak_disk_bytes: null,
    },
    disaster_drill: null,
    limitations: ['No scheduled environment was observed.'],
  });
  assert.equal(receipt.observation.status, 'unavailable');
  assert.ok(Object.values(receipt.metrics).every((value) => value === null));
  assert.deepEqual(receipt.authority, { serving: false, promotion: false, deletion: false });
  assert.equal(admitDataFoundationOperationReceipt(receipt).receipt_identity, receipt.receipt_identity);

  const hostile = structuredClone(receipt);
  hostile.metrics.duration_ms = 0;
  assert.throws(() => admitDataFoundationOperationReceipt(hostile), /Unavailable observation/);
});

test('M1 disaster drill must detect and block both missing and corrupted objects', () => {
  const receipt = createDataFoundationOperationReceipt({
    registry_identity: `sha256:${'c'.repeat(64)}`,
    object_catalog_identity: `sha256:${'d'.repeat(64)}`,
    operation: 'disaster-drill',
    environment: {
      environment_id: 'fixture-clean-room', platform: 'test', runner_class: 'fixture',
      physical_environment_observed: true,
    },
    observation: {
      status: 'observed', started_at: '2026-08-31T00:00:00.000Z',
      completed_at: '2026-08-31T00:00:01.000Z', reason: 'Fixture observation.',
    },
    verification: {
      status: 'failed', object_count: 2,
      registry_identity_matched: true, catalog_identity_matched: true,
    },
    metrics: {
      duration_ms: 1000, downloaded_bytes: 2, verified_bytes: 2,
      verification_duration_ms: 1, peak_disk_bytes: 2,
    },
    disaster_drill: {
      missing_object: 'detected-and-blocked',
      corrupted_object: 'detected-and-blocked',
      downstream_build_started: false,
    },
    limitations: ['Fixture-only operational proof.'],
  });
  assert.equal(receipt.disaster_drill.downstream_build_started, false);
});
