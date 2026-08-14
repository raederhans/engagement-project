import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { contentIdentity } from '../lib/route_graph_candidate/safe_data.mjs';
import {
  CONTROLLER_NORMALIZATION_BINDING,
  DOWNLOAD_TRANSPORT_OBSERVATION_CLAIM_SCHEMA,
  INSTALLED_TOOL_OBSERVATION_CLAIM_SCHEMA,
  PERSISTENT_NONCE_STORE_CLAIM_SCHEMA,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  admitPersistentNonceStoreTransition,
  assertNonceAbsentFromPersistentStore,
  buildValidationOnlyAcquisitionControllerPlan,
  buildValidationOnlyAcquisitionPhaseBinding,
  buildValidationOnlyControllerEvidenceBinding,
  buildValidationOnlyControllerTraceClaim,
  buildValidationOnlyExtractionControllerPlan,
  buildValidationOnlyExtractionPhaseBinding,
  deriveControllerCurlPaths,
  deriveControllerStatePaths,
  deriveControllerToolPaths,
  inspectCallerControllerTraceClaim,
  inspectCallerDownloadTransportObservationClaim,
  inspectCallerInstalledToolObservationClaim,
  inspectCallerPersistentNonceStoreClaim,
  inspectControllerStateMachineMechanics,
  inspectInstalledToolAdmission,
  inspectRouteRealGraphControllerStatus,
  inspectWindowsRuntimeAdapterCapability,
  parseAcquisitionControllerPlanJsonText,
  parseControllerAcquisitionPhaseBindingJsonText,
  parseControllerEvidenceBindingJsonText,
  parseControllerExtractionPhaseBindingJsonText,
  parseControllerTraceClaim,
  parseDownloadTransportObservationClaim,
  parseInstalledToolObservationClaim,
  parsePersistentNonceStoreClaim,
  parseExtractionControllerPlanJsonText,
  persistentNonceStoreClaimIdentity,
} from '../lib/route_real_graph_controller/index.mjs';
import {
  makeSyntheticControllerEvidenceBundle,
} from '../fixtures/route-real-graph-controller/synthetic_evidence_bundle.mjs';

const WORKSPACE_ROOT = 'C:\\Users\\tester\\engagement_project';
const CONTROLLER_IDENTITY = digest('controller-v1');
const FIXTURE_ROOT = new URL('../fixtures/route-real-graph-controller/', import.meta.url);

test('RD-G production status keeps every authority and live capability unavailable', async () => {
  const controller = inspectRouteRealGraphControllerStatus();
  const tool = inspectInstalledToolAdmission();
  const runtime = inspectWindowsRuntimeAdapterCapability();
  const expected = JSON.parse(await readFile(new URL('expected-unavailable-summary.json', FIXTURE_ROOT), 'utf8'));
  assert.deepEqual({
    schema: 'route-real-graph-controller-unavailable-summary/v1',
    controllerStatus: controller.status,
    toolStatus: tool.status,
    runtimeCapabilityStatus: runtime.status,
    sourceCoreImplemented: controller.sourceCoreImplemented,
    trustedControllerInstalled: controller.trustedControllerInstalled,
    installedToolAdmitted: controller.installedToolAdmitted,
    commandsRunnable: controller.commandsRunnable,
    actualAcquisition: controller.actualAcquisition,
    actualExtraction: controller.actualExtraction,
    actualIntermediate: controller.actualIntermediate,
    actualGraph: controller.actualGraph,
    sourceHealthStatus: controller.sourceHealthProjection.status,
    sourceHealthObservationState: controller.sourceHealthProjection.observationState,
    sourceHealthRecordCount: controller.sourceHealthProjection.recordCount,
    runtimeAuthorized: controller.runtimeAuthorized,
    publicationAuthorized: controller.publicationAuthorized,
  }, expected);
  assert.equal(controller.controllerRegistryState, 'empty');
  assert.equal(controller.toolRegistryState, 'empty');
  assert.equal(controller.curlRegistryState, 'empty');
  assert.equal(controller.liveReleaseRegistryState, 'empty');
  assert.equal(controller.nonceStoreRegistryState, 'empty');
  assert.equal(runtime.liveMethodsExposed, false);
});

test('strict osmium and curl observations remain caller-only', () => {
  const osmiumText = JSON.stringify(makeOsmiumClaim());
  const curlText = JSON.stringify(makeCurlClaim());
  const osmium = parseInstalledToolObservationClaim(osmiumText);
  const curl = parseDownloadTransportObservationClaim(curlText);
  assert.equal(osmium.binaryBeforeVersion.fileIdentity, osmium.binaryAfterVersion.fileIdentity);
  assert.equal(curl.binaryBeforeVersion.fileIdentity, curl.binaryAfterVersion.fileIdentity);
  assert.equal(inspectCallerInstalledToolObservationClaim(osmiumText).installedToolAdmitted, false);
  assert.equal(inspectCallerDownloadTransportObservationClaim(curlText).actualAcquisition, false);
});

test('tool observations reject manifest, clock, binary, and capture drift', async (t) => {
  const cases = [
    ['non-JSON installation manifest', makeOsmiumClaim, (claim) => {
      replaceCaptureBytes(claim.installationManifest, Buffer.from('not-json', 'utf8'));
      refreshOsmiumBindings(claim);
    }, parseInstalledToolObservationClaim],
    ['osmium binary drift', makeOsmiumClaim, (claim) => {
      claim.binaryAfterVersion.sha256 = digest('different-osmium-binary');
      refreshOsmiumBindings(claim);
    }, parseInstalledToolObservationClaim],
    ['curl stdout version drift', makeCurlClaim, (claim) => {
      replaceInlineCapture(claim.versionObservation.stdout, Buffer.from('curl 8.14.2\n'));
      refreshCurlBindings(claim);
    }, parseDownloadTransportObservationClaim],
    ['curl post-observation drift', makeCurlClaim, (claim) => {
      claim.binaryAfterVersion.fileIdentity = 'curl-binary-file-v2';
      refreshCurlBindings(claim);
    }, parseDownloadTransportObservationClaim],
  ];
  for (const [label, make, mutate, parse] of cases) {
    await t.test(label, () => {
      const claim = make();
      mutate(claim);
      assert.throws(() => parse(JSON.stringify(claim)));
    });
  }
});

test('versioned persistent nonce snapshot remains a caller-only frozen-path claim', () => {
  const storeText = JSON.stringify(makeStoreClaim());
  const parsed = parsePersistentNonceStoreClaim(storeText);
  const inspection = inspectCallerPersistentNonceStoreClaim(storeText);
  assert.equal(parsed.ledgerAbsolutePath, deriveControllerStatePaths(WORKSPACE_ROOT).ledgerAbsolutePath);
  assert.equal(inspection.claimIdentity, persistentNonceStoreClaimIdentity(storeText));
  assert.equal(inspection.persistentStateDirectlyObserved, false);
  assert.equal(inspection.oneShotConsumptionTrusted, false);
  assert.equal(inspection.commandsRunnable, false);
  assert.equal(parsed.predecessorClaimIdentity, null);
});

test('progressive phase bindings separate acquisition pre-run inputs from extraction results', () => {
  const context = makeContext();
  const acquisition = parseControllerAcquisitionPhaseBindingJsonText(
    context.acquisitionPhaseBindingText,
    ...acquisitionDocumentTexts(context),
  );
  const extraction = parseControllerExtractionPhaseBindingJsonText(
    context.extractionPhaseBindingText,
    ...extractionDocumentTexts(context),
  );
  assert.deepEqual(Object.keys(acquisition.documentIdentities), [
    'sourceManifestIdentity', 'supervisorAdmissionIdentity', 'acquisitionReleaseIdentity',
  ]);
  assert.equal('observedPayloadReceiptIdentity' in acquisition.documentIdentities, false);
  assert.equal(acquisition.phase, 'acquisition');
  assert.equal(extraction.acquisitionPhaseBindingIdentity, acquisition.phaseBindingIdentity);
  assert.equal(extraction.documentIdentities.observedPayloadReceiptIdentity, contentIdentity(context.bundle.receipt));
  assert.equal(extraction.sourcePayload.absolutePath, context.bundle.receipt.sourcePayload.absolutePath);
  assert.equal(extraction.sourcePayload.sha256, context.bundle.receipt.sourcePayload.sha256);
  assert.equal(extraction.sourcePayload.byteCount, context.bundle.receipt.sourcePayload.byteCount);
  assert.equal(extraction.extractionInputRequirement.independentObservationRequiredAfterLeaseConsumption, true);
  assert.equal(acquisition.capability, null);
  assert.equal(extraction.commandsRunnable, false);
  assert.equal(extraction.actual, false);
  assert.equal(extraction.publication, false);
});

test('persistent store v3 represents one nonce as an append-only legal event sequence', () => {
  const predecessor = makeStoreClaim();
  const release = {
    ownerLease: { nonce: 'c'.repeat(32), leaseIdentity: digest('event-lease') },
    trustedController: { identity: CONTROLLER_IDENTITY },
  };
  const records = makeSuccessfulPhaseRecords(
    release,
    'acquisition',
    digest('event-plan'),
    digest('event-result'),
    [
      '2026-08-14T08:08:00.000Z',
      '2026-08-14T08:08:10.000Z',
      '2026-08-14T08:08:20.000Z',
      '2026-08-14T08:08:30.000Z',
      '2026-08-14T08:08:40.000Z',
    ],
    1,
  );
  const successor = makeStoreClaim(records, {
    predecessorClaimIdentity: contentIdentity(predecessor),
  });
  const parsed = parsePersistentNonceStoreClaim(JSON.stringify(successor));
  const transition = admitPersistentNonceStoreTransition(
    JSON.stringify(predecessor),
    JSON.stringify(successor),
  );
  assert.deepEqual(parsed.records.map((record) => record.phase), [
    'reserved', 'running', 'observing', 'promoted', 'terminal-succeeded',
  ]);
  assert.deepEqual(parsed.records.map((record) => record.phaseOrdinal), [1, 2, 3, 4, 5]);
  assert.equal(transition.schema, 'route-real-graph-persistent-nonce-store-transition/v2');
  assert.equal(transition.appendedRecordIdentities.length, 5);
});

test('persistent store transitions reject equal snapshots, backdated appends, clock rollback, and post-terminal events', async (t) => {
  const release = {
    ownerLease: { nonce: 'c'.repeat(32), leaseIdentity: digest('clock-lease') },
    trustedController: { identity: CONTROLLER_IDENTITY },
  };
  const predecessor = makeStoreClaim();
  const predecessorText = JSON.stringify(predecessor);
  const backdatedReserved = makeNonceRecord(release, 'reserved', '2026-08-14T08:06:00.000Z', {
    phaseSlot: 'acquisition',
    phasePlanIdentity: digest('clock-plan'),
  });
  await t.test('equal successor snapshot', () => {
    const successor = makeStoreClaim([backdatedReserved], {
      predecessorClaimIdentity: contentIdentity(predecessor),
    });
    successor.snapshotObservedAt = predecessor.snapshotObservedAt;
    assert.throws(
      () => admitPersistentNonceStoreTransition(predecessorText, JSON.stringify(successor)),
      hasCode('persistent-store-transition-clock'),
    );
  });
  await t.test('backdated appended record', () => {
    const successor = makeStoreClaim([backdatedReserved], {
      predecessorClaimIdentity: contentIdentity(predecessor),
    });
    successor.snapshotObservedAt = '2026-08-14T08:08:00.000Z';
    assert.throws(
      () => admitPersistentNonceStoreTransition(predecessorText, JSON.stringify(successor)),
      hasCode('persistent-store-transition-record-clock'),
    );
  });
  await t.test('ledger clock rollback', () => {
    const records = [
      backdatedReserved,
      makeNonceRecord(release, 'running', '2026-08-14T08:05:00.000Z', {
        ordinal: 2,
        phaseOrdinal: 2,
        phaseSlot: 'acquisition',
        phasePlanIdentity: digest('clock-plan'),
      }),
    ];
    assert.throws(
      () => parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim(records))),
      hasCode('persistent-record-clock-order'),
    );
  });
  await t.test('post-terminal event', () => {
    const records = makeSuccessfulPhaseRecords(
      release,
      'acquisition',
      digest('clock-plan'),
      digest('clock-result'),
      [
        '2026-08-14T08:08:00.000Z',
        '2026-08-14T08:08:10.000Z',
        '2026-08-14T08:08:20.000Z',
        '2026-08-14T08:08:30.000Z',
        '2026-08-14T08:08:40.000Z',
      ],
      1,
    );
    records.push(makeNonceRecord(release, 'running', '2026-08-14T08:08:50.000Z', {
      ordinal: 6,
      phaseOrdinal: 6,
      phaseSlot: 'acquisition',
      phasePlanIdentity: digest('clock-plan'),
    }));
    assert.throws(
      () => parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim(records))),
      hasCode('persistent-record-after-terminal'),
    );
  });
  await t.test('backdated extra record after a valid acquisition terminal', () => {
    const context = makeContext({ withTrace: false });
    const successor = structuredClone(context.extractionStore);
    const unrelatedRelease = {
      ownerLease: { nonce: 'd'.repeat(32), leaseIdentity: digest('backdated-extra-lease') },
      trustedController: { identity: CONTROLLER_IDENTITY },
    };
    successor.records.push(makeNonceRecord(
      unrelatedRelease,
      'reserved',
      '2026-08-14T08:15:20.000Z',
      {
        ordinal: successor.records.length + 1,
        phaseSlot: 'acquisition',
        phasePlanIdentity: digest('backdated-extra-plan'),
      },
    ));
    refreshStoreSnapshot(successor);
    assert.throws(
      () => admitPersistentNonceStoreTransition(
        context.acquisitionStoreText,
        JSON.stringify(successor),
      ),
      hasCode('persistent-record-clock-order'),
    );
  });
});

test('one-shot store rejects consumption ordinal and release or lease identity aliasing', async (t) => {
  const releaseA = {
    ownerLease: { nonce: 'c'.repeat(32), leaseIdentity: digest('one-shot-lease-a') },
    trustedController: { identity: CONTROLLER_IDENTITY },
  };
  const releaseB = {
    ownerLease: { nonce: 'd'.repeat(32), leaseIdentity: digest('one-shot-lease-b') },
    trustedController: { identity: CONTROLLER_IDENTITY },
  };
  const baseRecord = makeNonceRecord(releaseA, 'reserved', '2026-08-14T08:05:00.000Z', {
    phaseSlot: 'acquisition',
    phasePlanIdentity: digest('one-shot-plan-a'),
  });
  for (const invalidOrdinal of [0, 2, Number.MAX_SAFE_INTEGER]) {
    await t.test(`consumption ordinal ${invalidOrdinal}`, () => {
      const record = structuredClone(baseRecord);
      record.consumptionOrdinal = invalidOrdinal;
      assert.throws(
        () => parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim([record]))),
        hasCode('persistent-record-consumption-ordinal'),
      );
    });
  }
  await t.test('same release identity across different nonces', () => {
    const second = makeNonceRecord(releaseB, 'reserved', '2026-08-14T08:05:10.000Z', {
      ordinal: 2,
      phaseSlot: 'acquisition',
      phasePlanIdentity: digest('one-shot-plan-b'),
    });
    second.releaseIdentity = baseRecord.releaseIdentity;
    assert.throws(
      () => parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim([baseRecord, second]))),
      hasCode('persistent-record-release-lease-alias'),
    );
  });
  await t.test('same lease identity across different nonces', () => {
    const second = makeNonceRecord(releaseB, 'reserved', '2026-08-14T08:05:10.000Z', {
      ordinal: 2,
      phaseSlot: 'acquisition',
      phasePlanIdentity: digest('one-shot-plan-b'),
    });
    second.leaseIdentity = baseRecord.leaseIdentity;
    assert.throws(
      () => parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim([baseRecord, second]))),
      hasCode('persistent-record-release-lease-alias'),
    );
  });
  await t.test('absence check rejects nonce alias with consumed release and lease', () => {
    const storeText = JSON.stringify(makeStoreClaim([baseRecord]));
    assert.throws(() => assertNonceAbsentFromPersistentStore(
      storeText,
      releaseB.ownerLease.nonce,
      baseRecord.releaseIdentity,
      baseRecord.leaseIdentity,
      CONTROLLER_IDENTITY,
    ), hasCode('nonce-replay'));
  });
  await t.test('different nonce release and lease triples remain valid', () => {
    const second = makeNonceRecord(releaseB, 'reserved', '2026-08-14T08:05:10.000Z', {
      ordinal: 2,
      phaseSlot: 'acquisition',
      phasePlanIdentity: digest('one-shot-plan-b'),
    });
    assert.equal(
      parsePersistentNonceStoreClaim(JSON.stringify(makeStoreClaim([baseRecord, second]))).records.length,
      2,
    );
  });
});

test('acquisition plan exists before receipt and extraction plan starts only after persisted acquisition terminal', () => {
  const context = makeContext();
  const acquisition = parseAcquisitionPlan(context);
  const extraction = parseExtractionPlan(context);
  assert.equal(acquisition.steps.length, 1);
  assert.equal(acquisition.steps[0].stepId, 'download-pbf');
  assert.equal(acquisition.steps[0].executableAbsolutePath, deriveControllerCurlPaths(WORKSPACE_ROOT).binaryAbsolutePath);
  assert.equal('observedPayloadReceiptIdentity' in acquisition.phaseDocuments, false);
  assert.equal('extractionReleaseIdentity' in acquisition.phaseDocuments, false);
  assert.equal('trustedBuildEvidenceIdentity' in acquisition.phaseDocuments, false);
  assert.equal(extraction.steps.length, 8);
  assert.equal(extraction.steps.slice(0, 6).every((step) => step.toolSlot === 'supervisor-admitted-osmium'), true);
  assert.equal(extraction.steps[6].stepId, 'normalize-opl-to-rd-b');
  assert.deepEqual(extraction.steps[6].identityOutputs, CONTROLLER_NORMALIZATION_BINDING.requiredResultIdentities);
  assert.equal(extraction.steps[7].stepId, 'finalize-trusted-build-evidence');
  assert.deepEqual(extraction.steps[7].fileOutputs.map((entry) => entry.slot), ['log', 'buildEvidence']);
  assert.equal(extraction.phaseBindingIdentity, context.extractionPhaseBinding.phaseBindingIdentity);
  assert.equal(extraction.acquisitionResultIdentity, context.extractionPhaseBinding.acquisitionResultIdentity);
  assert.equal(extraction.acquisitionTerminal.phasePlanIdentity, contentIdentity(acquisition));
  assert.equal(extraction.acquisitionTerminal.phaseResultIdentity, extraction.acquisitionResultIdentity);
  assert.equal(
    extraction.persistentStoreTransition.predecessorClaimIdentity,
    contentIdentity(context.acquisitionStore),
  );
  assert.equal(
    extraction.persistentStoreTransition.successorClaimIdentity,
    contentIdentity(context.extractionStore),
  );
  assert.equal(
    extraction.persistentStoreTransition.transitionIdentity,
    admitPersistentNonceStoreTransition(
      context.acquisitionStoreText,
      context.extractionStoreText,
    ).transitionIdentity,
  );
  assert.equal('finalEvidenceIdentity' in extraction, false);
  assert.equal(acquisition.commandAuthorization, false);
  assert.equal(extraction.commandsRunnable, false);
});

test('final evidence binding uniquely consumes RD-F inspection and binds steps, captures, promotions, bridge, and RD-B roots', () => {
  const context = makeContext();
  const binding = parseControllerEvidenceBindingJsonText(
    context.evidenceBindingText,
    ...evidenceDocumentTexts(context),
  );
  assert.equal(binding.acquisitionPhaseBindingIdentity, context.acquisitionPhaseBinding.phaseBindingIdentity);
  assert.equal(binding.extractionPhaseBindingIdentity, context.extractionPhaseBinding.phaseBindingIdentity);
  assert.equal(binding.evidence.steps.length, 7);
  assert.equal(binding.evidence.steps.every((step) => step.stdout.captureIdentity.startsWith('sha256:')), true);
  assert.deepEqual(binding.evidence.promotions.map((entry) => entry.slot), [
    'sourcePbf', 'sourceFileInfo', 'bufferExtractPbf', 'walkingFilteredPbf',
    'intermediateOpl', 'intermediateFileInfo', 'log', 'buildEvidence',
  ]);
  assert.equal(binding.evidence.outputs.bridgeMetadata.capture.captureIdentity.startsWith('sha256:'), true);
  assert.equal(binding.evidence.bridgeResult.rdBTopologyIdentity.startsWith('sha256:'), true);
  assert.equal(binding.extractionInput.absolutePath, binding.sourcePayload.absolutePath);
  assert.equal(binding.extractionInput.sha256, binding.sourcePayload.sha256);
  assert.equal(binding.extractionInput.byteCount, binding.sourcePayload.byteCount);
  assert.equal(binding.extractionInput.observationTrusted, false);
  assert.equal(binding.successEvidence, false);
  assert.equal(binding.runtime, false);
});

test('successful evidence-closure trace is canonical but never trusted or runnable', () => {
  const context = makeContext();
  const trace = parseTrace(context);
  const inspection = inspectTrace(context);
  assert.equal(trace.terminalState, 'terminal-succeeded-evidence-bound');
  assert.equal(trace.events.at(-1).type, 'terminal-succeeded-evidence-bound');
  assert.equal(trace.events.filter((event) => event.type === 'process-step-exited').length, 7);
  assert.equal(trace.events.filter((event) => event.type === 'output-promoted').length, 8);
  assert.equal(trace.events.filter((event) => event.type === 'persistent-state-record-bound').length, 10);
  assert.equal(trace.events.some((event) => event.type === 'acquisition-terminal-persisted'), true);
  assert.equal(trace.events.some((event) => event.type === 'extraction-terminal-persisted'), true);
  assert.equal(trace.events.filter((event) => event.type === 'nonce-absence-precondition-bound').length, 2);
  assert.equal(trace.events.some((event) => event.type === 'nonce-reserved-and-consumed'), false);
  const acquisitionTerminal = trace.events.find((event) => event.type === 'acquisition-terminal-persisted');
  assert.equal(acquisitionTerminal.phasePlanIdentity, trace.acquisitionPlanIdentity);
  assert.equal(acquisitionTerminal.phaseResultIdentity, trace.sourceTransfer.acquisitionResultIdentity);
  assert.equal(
    trace.persistentStoreTransitionIdentities.acquisitionToExtraction,
    context.extractionPlan.persistentStoreTransition.transitionIdentity,
  );
  assert.equal(
    trace.persistentStoreTransitionIdentities.extractionToCompletion,
    admitPersistentNonceStoreTransition(
      context.extractionStoreText,
      context.completionStoreText,
    ).transitionIdentity,
  );
  assert.equal(trace.persistentStoreClaimIdentities.completionAfter, contentIdentity(context.completionStore));
  assert.equal(trace.events.some((event) => event.type === 'source-input-revalidation-bound'), true);
  assert.equal(trace.events.some((event) => event.type === 'normalization-completed'), true);
  assert.equal(inspection.canonicalPhaseBindingRecomputed, true);
  assert.equal(inspection.canonicalEvidenceBindingRecomputed, true);
  assert.equal(inspection.oneShotConsumptionTrusted, false);
  assert.equal(inspection.processObservationTrusted, false);
  assert.equal(inspection.filesystemObservationTrusted, false);
  assert.equal(inspection.actualAcquisition, false);
  assert.equal(inspection.actualGraph, false);
  assert.equal(trace.capability, null);
  assert.equal(trace.successEvidence, false);
  assert.equal(trace.publication, false);
});

test('progressive plans reject future-document, terminal-store, and tool-observation drift', async (t) => {
  for (let index = 0; index < 3; index += 1) {
    await t.test(`acquisition document ${index}`, () => {
      const context = makeContext();
      const support = acquisitionPlanSupportTexts(context);
      support[index + 2] = mutateJsonText(support[index + 2]);
      assert.throws(() => parseAcquisitionControllerPlanJsonText(context.acquisitionPlanText, ...support));
    });
  }
  await t.test('acquisition plan refuses future receipt argument', () => {
    const context = makeContext();
    assert.throws(() => buildValidationOnlyAcquisitionControllerPlan(
      WORKSPACE_ROOT,
      context.curlText,
      context.acquisitionStoreText,
      ...acquisitionDocumentTexts(context),
      context.bundle.receiptText,
    ), hasCode('controller-acquisition-plan-arguments'));
  });
  await t.test('curl bytes differ from supervisor observation', () => {
    const context = makeContext();
    const curl = structuredClone(context.curlClaim);
    curl.binaryBeforeVersion.sha256 = digest('other-curl-binary');
    curl.binaryAfterVersion.sha256 = curl.binaryBeforeVersion.sha256;
    refreshCurlBindings(curl);
    assert.throws(() => buildValidationOnlyAcquisitionControllerPlan(
      WORKSPACE_ROOT,
      JSON.stringify(curl),
      context.acquisitionStoreText,
      ...acquisitionDocumentTexts(context),
    ), hasCode('controller-curl-evidence-drift'));
  });
  await t.test('extraction plan requires persisted acquisition terminal', () => {
    const context = makeContext();
    const emptyExtractionStore = makeStoreClaim([], {
      predecessorClaimIdentity: contentIdentity(context.acquisitionStore),
    });
    emptyExtractionStore.snapshotObservedAt = '2026-08-14T08:08:00.000Z';
    const emptyExtractionStoreText = JSON.stringify(emptyExtractionStore);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      emptyExtractionStoreText,
      ...extractionDocumentTexts(context),
    ), hasCode('persistent-store-transition-records'));
  });
  await t.test('acquisition terminal binds exact phase plan', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    for (const record of phaseRecords(store, 'acquisition')) {
      record.phasePlanIdentity = digest('other-acquisition-plan');
    }
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('controller-acquisition-terminal-binding'));
  });
  await t.test('acquisition terminal binds exact phase result', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    terminalRecord(store, 'acquisition').phaseResultIdentity = digest('other-acquisition-result');
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('controller-acquisition-terminal-binding'));
  });
  await t.test('acquisition terminal uses the acquisition phase slot', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    for (const record of phaseRecords(store, 'acquisition')) record.phaseSlot = 'extraction';
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('controller-acquisition-terminal-binding'));
  });
  await t.test('acquisition terminal precedes extraction release issuance', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    terminalRecord(store, 'acquisition').recordedAt = '2099-01-01T00:00:00.000Z';
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('controller-acquisition-terminal-store-clock'));
  });
  await t.test('acquisition terminal cannot equal extraction release issuance', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    terminalRecord(store, 'acquisition').recordedAt = context.extractionPhaseBinding.releases.extraction.issuedAt;
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('controller-acquisition-terminal-store-clock'));
  });
  await t.test('extraction store identifies its exact predecessor', () => {
    const context = makeContext();
    const store = structuredClone(context.extractionStore);
    store.predecessorClaimIdentity = digest('forked-predecessor');
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('persistent-store-transition-lineage'));
  });
  await t.test('extraction store preserves the predecessor record prefix', () => {
    const historicalRelease = {
      ownerLease: {
        nonce: 'f'.repeat(32),
        leaseIdentity: digest('historical-lease'),
      },
      trustedController: { identity: CONTROLLER_IDENTITY },
    };
    const historicalPlanIdentity = digest('historical-acquisition-plan');
    const context = makeContext({
      acquisitionRecordsFactory: () => [
        makeNonceRecord(historicalRelease, 'reserved', '2026-08-14T08:05:00.000Z', {
          ordinal: 1,
          phaseOrdinal: 1,
          phaseSlot: 'acquisition',
          phasePlanIdentity: historicalPlanIdentity,
        }),
        makeNonceRecord(historicalRelease, 'terminal-failed', '2026-08-14T08:06:00.000Z', {
          ordinal: 2,
          phaseOrdinal: 2,
          phaseSlot: 'acquisition',
          phasePlanIdentity: historicalPlanIdentity,
        }),
      ],
    });
    const store = structuredClone(context.extractionStore);
    store.records[0].phasePlanIdentity = digest('rewritten-historical-plan');
    store.records[1].phasePlanIdentity = digest('rewritten-historical-plan');
    refreshStoreSnapshot(store);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      context.osmiumText,
      JSON.stringify(store),
      ...extractionDocumentTexts(context),
    ), hasCode('persistent-store-transition-prefix'));
  });
  for (let index = 3; index < 5; index += 1) {
    await t.test(`extraction result document ${index}`, () => {
      const context = makeContext();
      const support = extractionPlanSupportTexts(context);
      support[index + 5] = mutateJsonText(support[index + 5]);
      assert.throws(() => parseExtractionControllerPlanJsonText(context.extractionPlanText, ...support));
    });
  }
  await t.test('osmium package differs from supervisor observation', () => {
    const context = makeContext();
    const osmium = structuredClone(context.osmiumClaim);
    osmium.package.sha256 = digest('other-osmium-package');
    refreshOsmiumManifest(osmium);
    refreshOsmiumBindings(osmium);
    assert.throws(() => buildValidationOnlyExtractionControllerPlan(
      WORKSPACE_ROOT,
      context.acquisitionPlanText,
      context.curlText,
      context.acquisitionStoreText,
      JSON.stringify(osmium),
      context.extractionStoreText,
      ...extractionDocumentTexts(context),
    ), hasCode('controller-osmium-evidence-drift'));
  });
});

test('final binding fails closed for every exact support document and evidence-root drift', async (t) => {
  const names = ['evidenceText', 'manifestText', 'admissionText', 'acquisitionText', 'receiptText', 'extractionText'];
  for (const name of names) {
    await t.test(name, () => {
      const context = makeContext();
      const support = evidenceDocumentTexts(context);
      const index = names.indexOf(name);
      support[index] = mutateJsonText(support[index]);
      assert.throws(() => parseControllerEvidenceBindingJsonText(context.evidenceBindingText, ...support));
    });
  }
});

test('trace rejects source, step exit, promotion, bridge, and final evidence drift', async (t) => {
  const cases = [
    ['source transfer', (trace) => { trace.sourceTransfer.sourcePayload.sha256 = digest('forged-source'); }],
    ['step stdout capture', (trace) => {
      trace.events.find((event) => event.type === 'process-step-exited').stdout.captureIdentity = digest('forged-stdout');
    }],
    ['promotion root', (trace) => {
      trace.events.find((event) => event.type === 'output-promoted').promotionIdentity = digest('forged-promotion');
    }],
    ['bridge result', (trace) => {
      trace.events.find((event) => event.type === 'normalization-completed').bridgeResultIdentity = digest('forged-bridge');
    }],
    ['final evidence', (trace) => { trace.finalEvidenceIdentity = digest('forged-final-evidence'); }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const context = makeContext();
      const trace = structuredClone(context.trace);
      mutate(trace);
      assert.throws(() => parseControllerTraceClaim(JSON.stringify(trace), ...traceSupportTexts(context)));
    });
  }
});

test('successful trace requires exact post-extraction store lineage and evidence-bound terminal', async (t) => {
  await t.test('completion terminal plan drift', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    for (const record of phaseRecords(store, 'extraction')) {
      record.phasePlanIdentity = digest('forged-extraction-plan');
    }
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-successful-phase-store-sequence'),
    );
  });
  await t.test('completion terminal result drift', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    terminalRecord(store, 'extraction').phaseResultIdentity = digest('forged-final-evidence');
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-successful-phase-store-sequence'),
    );
  });
  await t.test('completion consumption ordinal drift', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    for (const record of phaseRecords(store, 'extraction')) record.consumptionOrdinal = 2;
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('persistent-record-consumption-ordinal'),
    );
  });
  await t.test('completion promoted clock drifts from final promotion evidence', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    phaseRecords(store, 'extraction')[3].recordedAt = '2026-08-14T08:31:31.000Z';
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-successful-phase-evidence-clock'),
    );
  });
  await t.test('completion store predecessor fork', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    store.predecessorClaimIdentity = digest('forked-completion-predecessor');
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('persistent-store-transition-lineage'),
    );
  });
  await t.test('completion store must append extraction lifecycle', () => {
    const context = makeContext();
    const store = makeStoreClaim(context.extractionStore.records, {
      predecessorClaimIdentity: contentIdentity(context.extractionStore),
    });
    store.snapshotObservedAt = new Date(Date.parse(context.extractionStore.snapshotObservedAt) + 1_000).toISOString();
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('persistent-store-transition-records'),
    );
  });
  await t.test('completion terminal cannot exceed extraction deadline', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    terminalRecord(store, 'extraction').recordedAt = '2099-01-01T00:00:00.000Z';
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-extraction-terminal-store-clock'),
    );
  });
  await t.test('completion terminal cannot equal final evidence clock', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    terminalRecord(store, 'extraction').recordedAt = context.evidenceBinding.evidence.evidenceObservedAt;
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-extraction-terminal-store-clock'),
    );
  });
  await t.test('completion terminal cannot equal extraction deadline', () => {
    const context = makeContext();
    const store = structuredClone(context.completionStore);
    terminalRecord(store, 'extraction').recordedAt = context.extractionPhaseBinding.releases.extraction.deadlineAt;
    refreshStoreSnapshot(store);
    const support = traceSupportTexts(context);
    support[support.length - 1] = JSON.stringify(store);
    assert.throws(
      () => parseControllerTraceClaim(context.traceText, ...support),
      hasCode('controller-extraction-terminal-store-clock'),
    );
  });
});

test('both phase nonces fail closed when present in the independently supplied persistent store', async (t) => {
  await t.test('acquisition', () => {
    assert.throws(() => makeContext({
      acquisitionRecordsFactory: (bundle) => [makeNonceRecord(
        bundle.acquisition,
        'reserved',
        '2026-08-14T08:11:50.000Z',
        {
          phaseSlot: 'acquisition',
          phasePlanIdentity: digest('historic-acquisition-plan'),
        },
      )],
    }), hasCode('nonce-replay'));
  });
  await t.test('extraction', () => {
    assert.throws(() => makeContext({
      extractionExtraRecordsFactory: (bundle, nextOrdinal) => [makeNonceRecord(
        bundle.extraction,
        'reserved',
        '2026-08-14T08:17:50.000Z',
        {
          ordinal: nextOrdinal,
          phaseOrdinal: 1,
          phaseSlot: 'extraction',
          phasePlanIdentity: digest('historic-extraction-plan'),
        },
      )],
    }), hasCode('nonce-replay'));
  });
  await t.test('acquisition release and lease alias under a different nonce', () => {
    assert.throws(() => makeContext({
      acquisitionRecordsFactory: (bundle) => {
        const record = makeNonceRecord(
          bundle.acquisition,
          'reserved',
          '2026-08-14T08:11:50.000Z',
          {
            phaseSlot: 'acquisition',
            phasePlanIdentity: digest('historic-acquisition-alias-plan'),
          },
        );
        record.nonce = 'e'.repeat(32);
        return [record];
      },
    }), hasCode('nonce-replay'));
  });
  await t.test('extraction release and lease alias under a different nonce', () => {
    assert.throws(() => makeContext({
      extractionExtraRecordsFactory: (bundle, nextOrdinal) => {
        const record = makeNonceRecord(
          bundle.extraction,
          'reserved',
          '2026-08-14T08:17:50.000Z',
          {
            ordinal: nextOrdinal,
            phaseSlot: 'extraction',
            phasePlanIdentity: digest('historic-extraction-alias-plan'),
          },
        );
        record.nonce = 'e'.repeat(32);
        return [record];
      },
    }), hasCode('nonce-replay'));
  });
});

test('canonical limitations describe progressive plans and never claim a unified source plan', () => {
  const limitations = controllerLimitations();
  assert.equal(limitations.some((entry) => /unified source plan/iu.test(entry)), false);
  assert.equal(limitations.some((entry) => /acquisition pre-run plan/iu.test(entry)), true);
  assert.equal(limitations.some((entry) => /extraction pre-run plan/iu.test(entry)), true);
  assert.equal(limitations.some((entry) => /monotonic append-only transition/iu.test(entry)), true);
  assert.equal(limitations.some((entry) => /equality fails closed/iu.test(entry)), true);
  assert.equal(limitations.some((entry) => /one-to-one nonce, release, and lease identities/iu.test(entry)), true);
});

test('controller roots reject Windows namespace, alias, ADS, traversal, separator, and reserved-name forms', async (t) => {
  const hostileRoots = [
    '\\\\server\\share\\engagement_project',
    '\\\\?\\C:\\Users\\tester\\engagement_project',
    'c:\\Users\\tester\\engagement_project',
    'C:/Users/tester/engagement_project',
    'C:\\Users\\tester\\..\\engagement_project',
    'C:\\Users\\tester:ads\\engagement_project',
    'C:\\PROGRA~1\\engagement_project',
    'C:\\Users\\NUL\\engagement_project',
  ];
  for (const root of hostileRoots) {
    await t.test(root, () => {
      assert.throws(() => deriveControllerToolPaths(root));
      assert.throws(() => deriveControllerCurlPaths(root));
      assert.throws(() => deriveControllerStatePaths(root));
    });
  }
});

test('all phase, evidence, plan, trace, and tool ingress rejects hostile objects with zero traps', () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps += 1; throw new Error('get trap'); },
    ownKeys() { traps += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error('descriptor trap'); },
  });
  const context = makeContext();
  const calls = [
    () => parseInstalledToolObservationClaim(hostile),
    () => parseDownloadTransportObservationClaim(hostile),
    () => parsePersistentNonceStoreClaim(hostile),
    () => admitPersistentNonceStoreTransition(hostile, hostile),
    () => buildValidationOnlyAcquisitionPhaseBinding(hostile, hostile, hostile),
    () => parseControllerAcquisitionPhaseBindingJsonText(hostile, ...acquisitionDocumentTexts(context)),
    () => buildValidationOnlyExtractionPhaseBinding(hostile, hostile, hostile, hostile, hostile),
    () => parseControllerExtractionPhaseBindingJsonText(hostile, ...extractionDocumentTexts(context)),
    () => buildValidationOnlyControllerEvidenceBinding(hostile, hostile, hostile, hostile, hostile, hostile),
    () => parseControllerEvidenceBindingJsonText(hostile, ...evidenceDocumentTexts(context)),
    () => buildValidationOnlyAcquisitionControllerPlan(hostile, hostile, hostile, hostile, hostile, hostile),
    () => parseAcquisitionControllerPlanJsonText(hostile, ...acquisitionPlanSupportTexts(context)),
    () => buildValidationOnlyExtractionControllerPlan(
      hostile, hostile, hostile, hostile, hostile, hostile,
      hostile, hostile, hostile, hostile, hostile,
    ),
    () => parseExtractionControllerPlanJsonText(hostile, ...extractionPlanSupportTexts(context)),
    () => parseControllerTraceClaim(hostile, ...traceSupportTexts(context)),
    () => inspectCallerControllerTraceClaim(hostile, ...traceSupportTexts(context)),
    () => assertNonceAbsentFromPersistentStore(hostile, hostile, hostile, hostile, hostile),
  ];
  for (const call of calls) assert.throws(call);
  assert.equal(traps, 0);
});

test('source-only modules expose no execution, network, write, or registry mutation primitive', async () => {
  const mechanics = inspectControllerStateMachineMechanics();
  const audit = JSON.parse(await readFile(new URL('runtime-capability-audit.json', FIXTURE_ROOT), 'utf8'));
  assert.equal(mechanics.progressiveAcquisitionAndExtractionPlansRequired, true);
  assert.equal(mechanics.acquisitionPlanMustPrecedeReceipt, true);
  assert.equal(mechanics.extractionPlanRequiresAcquisitionTerminalStoreRecord, true);
  assert.equal(mechanics.acquisitionTerminalBindsExactPlanAndResult, true);
  assert.equal(mechanics.persistentStoreSnapshotsRequireMonotonicPrefixTransition, true);
  assert.equal(mechanics.persistentStoreNonceHistoryIsAppendOnlyEventSequence, true);
  assert.equal(mechanics.finalTraceMustBindBothPlansThreeStoreSnapshotsAndTwoTransitions, true);
  assert.equal(mechanics.successfulEvidenceTerminalMustBeFinalEvent, true);
  assert.equal(mechanics.failedCrashedExpiredTraceGrammar, 'unavailable');
  assert.equal(mechanics.runtimeCapability, audit.status);
  assert.equal(mechanics.commandsRunnable, false);
  const files = [
    'contracts.mjs', 'controller_evidence_binding.mjs', 'controller_plan.mjs',
    'controller_core.mjs', 'controller_status.mjs', 'installed_tool_admission.mjs',
    'persistent_store_contract.mjs', 'private_registry.mjs',
    'runtime_adapter_contract.mjs', 'tool_contracts.mjs', 'trace_contract.mjs',
  ];
  const sourceRoot = new URL('../lib/route_real_graph_controller/', import.meta.url);
  for (const file of files) {
    const source = await readFile(new URL(file, sourceRoot), 'utf8');
    assert.doesNotMatch(source, /from ['"]node:(?:child_process|net|http|https|tls)['"]/u);
    assert.doesNotMatch(source, /\b(?:fetch|spawn|execFile|writeFile|appendFile|createWriteStream)\s*\(/u);
  }
  const registry = await readFile(new URL('private_registry.mjs', sourceRoot), 'utf8');
  assert.doesNotMatch(registry, /export\s+function\s+(?:set|install|register|mutate)/u);
});

function makeContext({
  acquisitionRecordsFactory = () => [],
  extractionExtraRecordsFactory = () => [],
  withTrace = true,
} = {}) {
  const curlClaim = makeCurlClaim();
  const osmiumClaim = makeOsmiumClaim();
  const bundle = makeSyntheticControllerEvidenceBundle({
    workspaceRootAbsolute: WORKSPACE_ROOT,
    controllerIdentity: CONTROLLER_IDENTITY,
    curlClaim,
    osmiumClaim,
  });
  const curlText = JSON.stringify(curlClaim);
  const osmiumText = JSON.stringify(osmiumClaim);
  const acquisitionStore = makeStoreClaim(acquisitionRecordsFactory(bundle));
  const acquisitionStoreText = JSON.stringify(acquisitionStore);
  const acquisitionPhaseBinding = buildValidationOnlyAcquisitionPhaseBinding(
    ...acquisitionDocumentTexts({ bundle }),
  );
  const acquisitionPhaseBindingText = JSON.stringify(acquisitionPhaseBinding);
  const acquisitionPlan = buildValidationOnlyAcquisitionControllerPlan(
    WORKSPACE_ROOT,
    curlText,
    acquisitionStoreText,
    ...acquisitionDocumentTexts({ bundle }),
  );
  const acquisitionPlanText = JSON.stringify(acquisitionPlan);
  const extractionPhaseBinding = buildValidationOnlyExtractionPhaseBinding(
    ...extractionDocumentTexts({ bundle }),
  );
  const extractionPhaseBindingText = JSON.stringify(extractionPhaseBinding);
  const acquisitionLifecycle = makeSuccessfulPhaseRecords(
    bundle.acquisition,
    'acquisition',
    contentIdentity(acquisitionPlan),
    extractionPhaseBinding.acquisitionResultIdentity,
    [
      '2026-08-14T08:12:00.000Z',
      '2026-08-14T08:12:10.000Z',
      '2026-08-14T08:13:00.000Z',
      '2026-08-14T08:15:00.000Z',
      '2026-08-14T08:15:30.000Z',
    ],
    acquisitionStore.records.length + 1,
  );
  const acquisitionRecords = [...acquisitionStore.records, ...acquisitionLifecycle];
  const extractionStore = makeStoreClaim([
    ...acquisitionRecords,
    ...extractionExtraRecordsFactory(bundle, acquisitionRecords.length + 1),
  ], {
    predecessorClaimIdentity: contentIdentity(acquisitionStore),
  });
  const extractionStoreText = JSON.stringify(extractionStore);
  const extractionPlan = buildValidationOnlyExtractionControllerPlan(
    WORKSPACE_ROOT,
    acquisitionPlanText,
    curlText,
    acquisitionStoreText,
    osmiumText,
    extractionStoreText,
    ...extractionDocumentTexts({ bundle }),
  );
  const extractionPlanText = JSON.stringify(extractionPlan);
  const evidenceBinding = buildValidationOnlyControllerEvidenceBinding(...evidenceDocumentTexts({ bundle }));
  const evidenceBindingText = JSON.stringify(evidenceBinding);
  const extractionLifecycle = makeSuccessfulPhaseRecords(
    bundle.extraction,
    'extraction',
    contentIdentity(extractionPlan),
    evidenceBinding.finalEvidenceIdentity,
    [
      '2026-08-14T08:18:00.000Z',
      '2026-08-14T08:19:00.000Z',
      '2026-08-14T08:20:00.000Z',
      '2026-08-14T08:31:30.000Z',
      '2026-08-14T08:33:00.000Z',
    ],
    extractionStore.records.length + 1,
  );
  const completionStore = makeStoreClaim([
    ...extractionStore.records,
    ...extractionLifecycle,
  ], {
    predecessorClaimIdentity: contentIdentity(extractionStore),
  });
  const completionStoreText = JSON.stringify(completionStore);
  const context = {
    curlClaim, osmiumClaim, bundle, curlText, osmiumText,
    acquisitionStore, acquisitionStoreText, extractionStore, extractionStoreText,
    completionStore, completionStoreText,
    acquisitionPhaseBinding, acquisitionPhaseBindingText,
    extractionPhaseBinding, extractionPhaseBindingText,
    acquisitionPlan, acquisitionPlanText, extractionPlan, extractionPlanText,
    evidenceBinding, evidenceBindingText,
  };
  if (withTrace) {
    context.trace = buildTrace(context);
    context.traceText = JSON.stringify(context.trace);
  }
  return context;
}

function buildTrace(context) {
  return buildValidationOnlyControllerTraceClaim(
    'rd-g-successful-evidence-closure-v6',
    context.acquisitionPlanText,
    context.extractionPlanText,
    context.evidenceBindingText,
    ...evidenceDocumentTexts(context),
    context.curlText,
    context.osmiumText,
    context.acquisitionStoreText,
    context.extractionStoreText,
    context.completionStoreText,
  );
}

function parseAcquisitionPlan(context) {
  return parseAcquisitionControllerPlanJsonText(
    context.acquisitionPlanText,
    ...acquisitionPlanSupportTexts(context),
  );
}

function parseExtractionPlan(context) {
  return parseExtractionControllerPlanJsonText(
    context.extractionPlanText,
    ...extractionPlanSupportTexts(context),
  );
}

function parseTrace(context) {
  return parseControllerTraceClaim(context.traceText, ...traceSupportTexts(context));
}

function inspectTrace(context) {
  return inspectCallerControllerTraceClaim(context.traceText, ...traceSupportTexts(context));
}

function acquisitionDocumentTexts(context) {
  return [
    context.bundle.manifestText,
    context.bundle.admissionText,
    context.bundle.acquisitionText,
  ];
}

function extractionDocumentTexts(context) {
  return [
    ...acquisitionDocumentTexts(context),
    context.bundle.receiptText,
    context.bundle.extractionText,
  ];
}

function evidenceDocumentTexts(context) {
  return [context.bundle.evidenceText, ...extractionDocumentTexts(context)];
}

function acquisitionPlanSupportTexts(context) {
  return [
    context.curlText,
    context.acquisitionStoreText,
    ...acquisitionDocumentTexts(context),
  ];
}

function extractionPlanSupportTexts(context) {
  return [
    context.acquisitionPlanText,
    context.curlText,
    context.acquisitionStoreText,
    context.osmiumText,
    context.extractionStoreText,
    ...extractionDocumentTexts(context),
  ];
}

function traceSupportTexts(context) {
  return [
    context.acquisitionPlanText,
    context.extractionPlanText,
    context.evidenceBindingText,
    ...evidenceDocumentTexts(context),
    context.curlText,
    context.osmiumText,
    context.acquisitionStoreText,
    context.extractionStoreText,
    context.completionStoreText,
  ];
}

function makeOsmiumClaim() {
  const paths = deriveControllerToolPaths(WORKSPACE_ROOT);
  const packageObservation = closedFile(paths.packageAbsolutePath, '2026-08-14T08:03:00.000Z', 'osmium-package');
  const manifest = {
    schema: 'route-real-graph-controller-osmium-installation-manifest/v1',
    name: 'osmium-tool',
    version: '1.19.1',
    build: 'h60971b7_0',
    subdir: 'win-64',
    channel: 'conda-forge',
    packageFilename: 'osmium-tool-1.19.1-h60971b7_0.conda',
    packageObservationIdentity: contentIdentity(packageObservation),
    installedPrefixAbsolute: paths.installedPrefixAbsolute,
    binaryRelativePath: 'Library\\bin\\osmium.exe',
  };
  const binary = closedFile(paths.binaryAbsolutePath, '2026-08-14T08:03:20.000Z', 'osmium-binary');
  const claim = {
    schema: INSTALLED_TOOL_OBSERVATION_CLAIM_SCHEMA,
    claimId: 'rd-g-osmium-observation-v3',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: WORKSPACE_ROOT,
    toolId: 'osmium-tool/1.19.1/win-64/conda-forge-h60971b7_0',
    package: packageObservation,
    installationManifest: exactCapture(paths.manifestAbsolutePath, Buffer.from(JSON.stringify(manifest), 'utf8'), '2026-08-14T08:03:10.000Z'),
    binaryBeforeVersion: binary,
    version: versionObservation(paths.binaryAbsolutePath, '1.19.1', Buffer.from('osmium version 1.19.1\n'), '2026-08-14T08:03:30.000Z', '2026-08-14T08:03:40.000Z'),
    binaryAfterVersion: { ...binary, observedAt: '2026-08-14T08:04:00.000Z' },
    bindings: {},
    claims: controllerClaims(),
    limitations: controllerLimitations(),
  };
  refreshOsmiumBindings(claim);
  return claim;
}

function makeCurlClaim() {
  const paths = deriveControllerCurlPaths(WORKSPACE_ROOT);
  const binary = closedFile(paths.binaryAbsolutePath, '2026-08-14T08:04:10.000Z', 'curl-binary');
  const claim = {
    schema: DOWNLOAD_TRANSPORT_OBSERVATION_CLAIM_SCHEMA,
    claimId: 'rd-g-curl-observation-v2',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: WORKSPACE_ROOT,
    toolId: 'curl/8.14.1/supervisor-observed',
    version: '8.14.1',
    binaryBeforeVersion: binary,
    versionObservation: versionObservation(paths.binaryAbsolutePath, '8.14.1', Buffer.from('curl 8.14.1 (Windows)\n'), '2026-08-14T08:04:20.000Z', '2026-08-14T08:04:30.000Z'),
    binaryAfterVersion: { ...binary, observedAt: '2026-08-14T08:05:00.000Z' },
    bindings: {},
    claims: controllerClaims(),
    limitations: controllerLimitations(),
  };
  refreshCurlBindings(claim);
  return claim;
}

function makeStoreClaim(records = [], { predecessorClaimIdentity = null } = {}) {
  const snapshotObservedAt = records.length === 0
    ? '2026-08-14T08:07:00.000Z'
    : new Date(Math.max(...records.map((record) => Date.parse(record.recordedAt))) + 1_000).toISOString();
  const snapshotBytes = Buffer.from(JSON.stringify(records), 'utf8');
  return {
    schema: PERSISTENT_NONCE_STORE_CLAIM_SCHEMA,
    storeId: 'rd-g-persistent-nonce-store-v3',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: WORKSPACE_ROOT,
    ledgerAbsolutePath: deriveControllerStatePaths(WORKSPACE_ROOT).ledgerAbsolutePath,
    controllerIdentity: CONTROLLER_IDENTITY,
    snapshotObservedAt,
    snapshotFileIdentity: 'persistent-ledger-file-v3',
    snapshotSha256: digest(snapshotBytes),
    snapshotByteCount: snapshotBytes.length,
    predecessorClaimIdentity,
    closedBeforeObservation: true,
    completeByteTraversal: true,
    reparsePoint: false,
    exclusiveNoReplaceReservationRequired: true,
    reservationFileFlushRequired: true,
    parentDirectoryDurabilityRequired: true,
    records,
    claims: controllerClaims(),
    limitations: controllerLimitations(),
  };
}

function makeNonceRecord(release, phase, recordedAt, {
  ordinal = 1,
  phaseOrdinal = 1,
  consumptionOrdinal = 1,
  phaseSlot,
  phasePlanIdentity,
  phaseResultIdentity = null,
}) {
  return {
    ordinal,
    phaseOrdinal,
    consumptionOrdinal,
    nonce: release.ownerLease.nonce,
    releaseIdentity: contentIdentity(release),
    leaseIdentity: release.ownerLease.leaseIdentity,
    controllerIdentity: release.trustedController.identity,
    phaseSlot,
    phasePlanIdentity,
    phaseResultIdentity,
    phase,
    recordedAt,
    durableState: true,
    stateFileFlushed: true,
    parentDirectoryDurable: true,
    retryUsed: false,
    fallbackUsed: false,
  };
}

function makeSuccessfulPhaseRecords(
  release,
  phaseSlot,
  phasePlanIdentity,
  phaseResultIdentity,
  recordedAtValues,
  startingOrdinal,
) {
  const phases = ['reserved', 'running', 'observing', 'promoted', 'terminal-succeeded'];
  return phases.map((phase, index) => makeNonceRecord(release, phase, recordedAtValues[index], {
    ordinal: startingOrdinal + index,
    phaseOrdinal: index + 1,
    phaseSlot,
    phasePlanIdentity,
    phaseResultIdentity: phase === 'terminal-succeeded' ? phaseResultIdentity : null,
  }));
}

function phaseRecords(store, phaseSlot) {
  return store.records.filter((record) => record.phaseSlot === phaseSlot);
}

function terminalRecord(store, phaseSlot) {
  return phaseRecords(store, phaseSlot).find((record) => record.phase === 'terminal-succeeded');
}

function refreshStoreSnapshot(store) {
  const snapshotBytes = Buffer.from(JSON.stringify(store.records), 'utf8');
  store.snapshotSha256 = digest(snapshotBytes);
  store.snapshotByteCount = snapshotBytes.length;
  store.snapshotObservedAt = store.records.length === 0
    ? '2026-08-14T08:07:00.000Z'
    : new Date(Math.max(...store.records.map((record) => Date.parse(record.recordedAt))) + 1_000).toISOString();
}

function closedFile(absolutePath, observedAt, seed) {
  return {
    absolutePath,
    sha256: digest(`${seed}-bytes`),
    byteCount: 128,
    fileIdentity: `${seed}-file-v1`,
    observedAt,
    closedBeforeObservation: true,
    flushedBeforeObservation: true,
    completeByteTraversal: true,
    reparsePoint: false,
  };
}

function exactCapture(absolutePath, bytes, observedAt) {
  return {
    absolutePath,
    encoding: 'base64',
    base64: bytes.toString('base64'),
    sha256: digest(bytes),
    byteCount: bytes.length,
    observedAt,
    closedBeforeObservation: true,
    flushedBeforeObservation: true,
    completeByteTraversal: true,
    reparsePoint: false,
    truncated: false,
  };
}

function versionObservation(executableAbsolutePath, parsedVersion, stdoutBytes, startedAt, endedAt) {
  return {
    executableAbsolutePath,
    argv: ['--version'],
    stdout: inlineCapture(stdoutBytes),
    stderr: inlineCapture(Buffer.alloc(0)),
    exitCode: 0,
    signal: null,
    startedAt,
    endedAt,
    parsedVersion,
    shell: false,
    windowsHide: true,
    stdin: 'ignore',
    retryUsed: false,
    fallbackUsed: false,
  };
}

function inlineCapture(bytes) {
  return {
    encoding: 'base64',
    base64: bytes.toString('base64'),
    sha256: digest(bytes),
    byteCount: bytes.length,
    truncated: false,
  };
}

function refreshOsmiumManifest(claim) {
  const manifest = JSON.parse(Buffer.from(claim.installationManifest.base64, 'base64').toString('utf8'));
  manifest.packageObservationIdentity = contentIdentity(claim.package);
  replaceCaptureBytes(claim.installationManifest, Buffer.from(JSON.stringify(manifest), 'utf8'));
}

function refreshOsmiumBindings(claim) {
  claim.bindings = {
    packageObservationIdentity: contentIdentity(claim.package),
    installationManifestIdentity: contentIdentity(claim.installationManifest),
    binaryBeforeVersionIdentity: contentIdentity(claim.binaryBeforeVersion),
    versionObservationIdentity: contentIdentity(claim.version),
    binaryAfterVersionIdentity: contentIdentity(claim.binaryAfterVersion),
  };
}

function refreshCurlBindings(claim) {
  claim.bindings = {
    binaryBeforeVersionIdentity: contentIdentity(claim.binaryBeforeVersion),
    versionObservationIdentity: contentIdentity(claim.versionObservation),
    binaryAfterVersionIdentity: contentIdentity(claim.binaryAfterVersion),
  };
}

function replaceCaptureBytes(capture, bytes) {
  capture.base64 = bytes.toString('base64');
  capture.sha256 = digest(bytes);
  capture.byteCount = bytes.length;
}

function replaceInlineCapture(capture, bytes) {
  capture.base64 = bytes.toString('base64');
  capture.sha256 = digest(bytes);
  capture.byteCount = bytes.length;
}

function mutateJsonText(text) {
  const value = JSON.parse(text);
  value.__unsupported = true;
  return JSON.stringify(value);
}

function hasCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function controllerClaims() {
  return inspectRouteRealGraphControllerStatus().claims;
}

function controllerLimitations() {
  return inspectRouteRealGraphControllerStatus().limitations;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
