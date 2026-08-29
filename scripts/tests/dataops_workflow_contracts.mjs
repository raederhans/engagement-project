#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/data-foundation-maintenance.yml', import.meta.url);
const contractUrl = new URL('../fixtures/dataops-workflow/contract.v1.json', import.meta.url);
const scenariosUrl = new URL('../fixtures/dataops-workflow/scenarios.v1.json', import.meta.url);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTITY_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

function jobBlock(workflow, name) {
  const start = new RegExp(`^  ${name}:\\r?$`, 'm').exec(workflow);
  if (!start) return '';
  const bodyStart = start.index + start[0].length;
  const next = /^  [A-Za-z0-9_-]+:\r?$/m.exec(workflow.slice(bodyStart));
  return workflow.slice(start.index, next ? bodyStart + next.index : workflow.length);
}

function assertOrdered(value, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = value.indexOf(marker);
    assert.ok(current > previous, `${marker} must appear after the preceding workflow gate.`);
    previous = current;
  }
}

function restoreCommandArgv(workflow) {
  const commands = [];
  const lines = workflow.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*&\s+node\s+scripts\/restore_data_artifacts\.mjs\b/.test(lines[index])) continue;
    const argv = [];
    let cursor = index;
    while (cursor < lines.length) {
      let segment = lines[cursor].trim();
      if (cursor === index) segment = segment.replace(/^&\s+/, '');
      const continued = /`\s*$/.test(segment);
      segment = segment.replace(/\s*`\s*$/, '');
      const pipe = segment.indexOf(' |');
      if (pipe !== -1) segment = segment.slice(0, pipe);
      argv.push(...segment.split(/\s+/).filter(Boolean));
      if (!continued) break;
      cursor += 1;
    }
    commands.push(argv);
  }
  return commands;
}

function materializeFileLocationArg(argv, scheme) {
  return argv.flatMap((token) => {
    if (token !== '@fileLocationArgs') return [token];
    return scheme === 'file'
      ? ['--file-location-root="$env:DATAOPS_FILE_LOCATION_ROOT"']
      : [];
  });
}

test('fixture contract freezes fail-closed DataOps and no-promotion semantics', async () => {
  const contract = JSON.parse(await readFile(contractUrl, 'utf8'));
  assert.equal(contract.schema, 'engagement-dataops-workflow-contract/v1');
  assert.equal(contract.synthetic_contract_fixture, true);
  assert.equal(contract.authority_source, false);
  assert.equal(contract.workflow.heavy_data_default, false);
  assert.equal(contract.workflow.pull_request_mode, 'contract-only');
  assert.deepEqual(contract.workflow.rebuild_triggers, ['workflow_dispatch', 'schedule']);
  assert.equal(contract.workflow.cancel_rebuild_in_progress, false);

  assert.equal(contract.input_gate.must_complete_before_data_root_creation, true);
  assert.equal(contract.input_gate.registry_schema, 'ArtifactRegistry/v1');
  assert.equal(contract.input_gate.receipt_schema, 'engagement-phl-crime-warehouse-receipt/v3');
  assert.equal(contract.input_gate.receipt_object_id_required, true);
  assert.deepEqual(contract.input_gate.allowed_location_schemes, ['file', 'https']);
  assert.equal(contract.input_gate.location_scheme_requires_explicit_authorization, true);
  assert.equal(contract.input_gate.file_location_root_required_for_file_scheme, true);
  assert.equal(contract.input_gate.file_location_root_must_be_explicit, true);
  assert.equal(contract.input_gate.registry_directory_fallback_allowed, false);
  assert.equal(contract.input_gate.file_location_root_must_differ_from_registry_directory, true);
  assert.equal(contract.input_gate.registry_snapshot_required_after_admission, true);
  assert.equal(contract.input_gate.registry_snapshot_job_local, true);
  assert.equal(contract.input_gate.registry_snapshot_raw_sha256_rechecked, true);
  assert.equal(contract.input_gate.registry_snapshot_identity_rechecked, true);
  assert.equal(contract.input_gate.downstream_registry_source_path_allowed, false);
  assert.equal(contract.input_gate.fallback_to_latest, false);
  assert.equal(contract.input_gate.fallback_to_sibling_root, false);
  assert.deepEqual(contract.input_gate.receipt_object_bindings, [
    'path', 'bytes', 'sha256', 'row_count', 'partition_inventory',
  ]);

  assert.deepEqual(contract.restore_interface, {
    entrypoint: 'scripts/restore_data_artifacts.mjs',
    mode_shape: 'first-positional',
    modes: ['plan', 'restore', 'verify'],
    named_options_after_mode: [
      '--registry', '--target', '--location', '--file-location-root', '--concurrency',
      '--registry-sha256', '--registry-identity', '--replace-existing',
    ],
    file_location_root_passed_for_file_scheme_in_all_modes: true,
    registry_pins_passed_in_all_modes: true,
    replace_existing_restore_only: true,
    replace_existing_default: false,
    mode_option_allowed: false,
  });

  assert.equal(contract.reconstruction.new_root_required, true);
  assert.equal(contract.reconstruction.checkpoint_required, true);
  assert.match(contract.reconstruction.root_template, /dataops-maintenance\/v1/);
  assert.equal(contract.reconstruction.incremental_refresh.overlap_days, 45);
  assert.equal(contract.reconstruction.incremental_refresh.requires_full_history_reconciliation_first, true);
  assert.equal(contract.reconstruction.incremental_refresh.publishes_receipt, false);
  assert.equal(contract.reconstruction.incremental_refresh.serving_eligible, false);

  assert.deepEqual(Object.keys(contract.reports.quality_dimensions), [
    'schema',
    'category',
    'cartodb_id',
    'late_arrival_and_revision',
    'coordinate',
    'spatial_coverage',
  ]);
  assert.equal(contract.reports.unknown_or_unavailable_is_zero, false);
  assert.equal(contract.reports.maximum_upload_bytes, 52_428_800);
  assert.equal(contract.reports.upload_directory, '${RUNNER_TEMP}/dataops-upload');

  assert.deepEqual(contract.model_boundary, {
    workflow_decision: 'review-required',
    review_artifact_only: true,
    automatic_promotion: false,
    serving_publish: false,
    write_main: false,
    deployment: false,
  });
  assert.deepEqual(contract.external_side_effects, {
    requires_cloud_credentials: false,
    creates_bucket_or_container: false,
    uploads_data_roots: false,
    opens_or_merges_pull_request: false,
    pushes_branch: false,
  });
});

test('scenario fixtures cover authorized rebuilds and hostile fail-closed cases', async () => {
  const fixture = JSON.parse(await readFile(scenariosUrl, 'utf8'));
  assert.equal(fixture.schema, 'engagement-dataops-workflow-scenarios/v1');
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.authoritative_data, false);

  const scenarios = new Map(fixture.scenarios.map((scenario) => [scenario.id, scenario]));
  assert.deepEqual([...scenarios.keys()], [
    'authorized-dispatch-rebuild',
    'authorized-schedule-rebuild',
    'schedule-missing-authorized-location',
    'schedule-missing-file-location-root',
    'dispatch-missing-file-location-root',
    'registry-or-receipt-identity-mismatch',
    'hostile-model-requests-promotion',
  ]);

  for (const id of ['authorized-dispatch-rebuild', 'authorized-schedule-rebuild']) {
    const scenario = scenarios.get(id);
    assert.match(scenario.inputs.expected_git_sha, GIT_SHA_PATTERN);
    assert.match(scenario.inputs.registry_sha256, SHA256_PATTERN);
    assert.match(scenario.inputs.registry_identity, IDENTITY_PATTERN);
    assert.match(scenario.inputs.receipt_sha256, SHA256_PATTERN);
    assert.match(scenario.inputs.receipt_identity, IDENTITY_PATTERN);
    assert.match(scenario.inputs.artifact_set_id, /^artifact-set:/);
    assert.equal(scenario.inputs.authorized_location_scheme, 'file');
    assert.match(scenario.inputs.file_location_root, /^[A-Z]:\/dataops\/immutable\/artifacts-v1$/);
    assert.notEqual(
      scenario.inputs.file_location_root,
      scenario.inputs.registry_path.slice(0, scenario.inputs.registry_path.lastIndexOf('/')),
    );
    assert.equal(scenario.expected.input_gate, 'admitted');
    assert.equal(scenario.expected.new_versioned_root, true);
    assert.equal(scenario.expected.promotion_applied, false);
  }

  const missing = scenarios.get('schedule-missing-authorized-location');
  assert.equal(missing.inputs.authorized_location_scheme, '');
  assert.equal(missing.expected.input_gate, 'unauthorized');
  assert.equal(missing.expected.heavy_job_started, false);
  assert.equal(missing.expected.root_created, false);
  assert.equal(missing.expected.failure_report_preserved, true);

  const missingFileRoot = scenarios.get('schedule-missing-file-location-root');
  assert.equal(missingFileRoot.inputs.authorized_location_scheme, 'file');
  assert.equal(missingFileRoot.inputs.file_location_root, '');
  assert.equal(missingFileRoot.expected.input_gate, 'unauthorized');
  assert.equal(missingFileRoot.expected.heavy_job_started, false);
  assert.equal(missingFileRoot.expected.root_created, false);
  assert.equal(missingFileRoot.expected.registry_directory_fallback_used, false);
  assert.equal(missingFileRoot.expected.failure_report_preserved, true);

  const missingDispatchFileRoot = scenarios.get('dispatch-missing-file-location-root');
  assert.equal(missingDispatchFileRoot.input_source, 'dispatch-inputs-only');
  assert.equal(missingDispatchFileRoot.inputs.authorized_location_scheme, 'file');
  assert.equal(missingDispatchFileRoot.inputs.file_location_root, '');
  assert.ok(missingDispatchFileRoot.schedule_variables_present.DATAOPS_SCHEDULE_FILE_LOCATION_ROOT);
  assert.equal(missingDispatchFileRoot.expected.input_gate, 'unauthorized');
  assert.equal(missingDispatchFileRoot.expected.heavy_job_started, false);
  assert.equal(missingDispatchFileRoot.expected.root_created, false);
  assert.equal(missingDispatchFileRoot.expected.schedule_variable_fallback_used, false);
  assert.equal(missingDispatchFileRoot.expected.registry_directory_fallback_used, false);
  assert.equal(missingDispatchFileRoot.expected.failure_report_preserved, true);

  const mismatch = scenarios.get('registry-or-receipt-identity-mismatch');
  assert.notEqual(mismatch.inputs.registry_sha256, mismatch.inputs.observed_registry_sha256);
  assert.notEqual(mismatch.inputs.receipt_identity, mismatch.inputs.observed_receipt_identity);
  assert.equal(mismatch.expected.input_gate, 'rejected');
  assert.equal(mismatch.expected.root_created, false);
  assert.equal(mismatch.expected.failure_report_preserved, true);

  const hostile = scenarios.get('hostile-model-requests-promotion');
  assert.equal(hostile.model_result.promotion, 'promoted');
  assert.deepEqual(hostile.expected, {
    terminal_status: 'review-required',
    review_artifact_only: true,
    promotion_applied: false,
    serving_published: false,
    main_written: false,
    deployed: false,
  });
});

test('PR checks are lightweight while rebuild is limited to dispatch and schedule', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const triggers = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));
  const contracts = jobBlock(workflow, 'contracts');
  const rebuild = jobBlock(workflow, 'rebuild');

  assert.match(triggers, /^on:\r?$/m);
  assert.match(triggers, /^  pull_request:\r?$/m);
  assert.match(triggers, /^  schedule:\r?$/m);
  assert.match(triggers, /^  workflow_dispatch:\r?$/m);
  assert.doesNotMatch(triggers, /^  (?:push|pull_request_target|workflow_run|repository_dispatch):/m);

  assert.ok(contracts, 'workflow must define the lightweight contracts job');
  assert.match(contracts, /runs-on:\s*ubuntu-latest/);
  assert.match(contracts, /node --test scripts\/tests\/dataops_workflow_contracts\.mjs/);
  assert.doesNotMatch(
    contracts,
    /restore_data_artifacts|backfill_crime_event_warehouse|acquire_crime_events|ingest_crime_events|build_area_intelligence|evaluate_area_intelligence|\.dfev1/,
  );

  assert.ok(rebuild, 'workflow must define the controlled rebuild job');
  assert.match(rebuild, /needs:\s*contracts/);
  assert.match(rebuild, /github\.event_name == 'schedule'/);
  assert.match(rebuild, /github\.event_name == 'workflow_dispatch'/);
  assert.match(rebuild, /inputs\.maintenance_mode == 'rebuild'/);
  assert.doesNotMatch(rebuild, /github\.event_name == 'pull_request'/);
  assert.match(rebuild, /runs-on:\s*\[self-hosted, Windows, data-foundation\]/);
});

test('workflow permissions, pinned actions, and rebuild concurrency stay minimal', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /^permissions:\r?\n  contents: read\r?$/m);
  assert.doesNotMatch(workflow, /^\s+(?:contents|pull-requests|issues|actions|packages|pages|id-token|deployments):\s*write\r?$/m);
  assert.doesNotMatch(workflow, /secrets\.|persist-credentials:\s*true/);
  assert.equal((workflow.match(/persist-credentials:\s*false/g) || []).length, 2);

  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 5);
  for (const action of uses) {
    assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${action} must be pinned to an exact commit`);
  }
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/);

  const concurrency = workflow.slice(workflow.indexOf('concurrency:'), workflow.indexOf('jobs:'));
  assert.match(concurrency, /data-foundation-maintenance-/);
  assert.match(concurrency, /'rebuild'/);
  assert.match(concurrency, /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.doesNotMatch(concurrency, /github\.(?:sha|run_id|run_attempt)/);
});

test('exact Git registry and receipt admission happens before any data root exists', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const rebuild = jobBlock(workflow, 'rebuild');

  for (const input of [
    'expected_git_sha',
    'registry_path',
    'registry_sha256',
    'registry_identity',
    'artifact_set_id',
    'receipt_object_id',
    'receipt_sha256',
    'receipt_identity',
    'authorized_location_scheme',
    'file_location_root',
    'through_date',
  ]) {
    assert.match(workflow, new RegExp(`^      ${input}:\\r?$`, 'm'), `${input} dispatch input is required by contract`);
  }

  assert.match(rebuild, /git rev-parse HEAD/);
  assert.match(rebuild, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(rebuild, /createHash\('sha256'\)[\s\S]*DATAOPS_REGISTRY_SHA256/);
  assert.match(rebuild, /parseArtifactRegistry/);
  assert.match(rebuild, /ArtifactRegistry\/v1/);
  assert.match(rebuild, /registryIdentity/);
  assert.match(rebuild, /receiptObject[\s\S]*DATAOPS_RECEIPT_SHA256/);
  assert.match(rebuild, /DATAOPS_RECEIPT_IDENTITY/);
  assert.match(rebuild, /DATAOPS_AUTHORIZED_LOCATION_SCHEME/);
  for (const [environmentName, scheduleVariable, dispatchInput] of [
    ['DATAOPS_EXPECTED_GIT_SHA', 'DATAOPS_SCHEDULE_EXPECTED_GIT_SHA', 'expected_git_sha'],
    ['DATAOPS_REGISTRY_PATH', 'DATAOPS_SCHEDULE_REGISTRY_PATH', 'registry_path'],
    ['DATAOPS_REGISTRY_SHA256', 'DATAOPS_SCHEDULE_REGISTRY_SHA256', 'registry_sha256'],
    ['DATAOPS_REGISTRY_IDENTITY', 'DATAOPS_SCHEDULE_REGISTRY_IDENTITY', 'registry_identity'],
    ['DATAOPS_ARTIFACT_SET_ID', 'DATAOPS_SCHEDULE_ARTIFACT_SET_ID', 'artifact_set_id'],
    ['DATAOPS_RECEIPT_OBJECT_ID', 'DATAOPS_SCHEDULE_RECEIPT_OBJECT_ID', 'receipt_object_id'],
    ['DATAOPS_RECEIPT_SHA256', 'DATAOPS_SCHEDULE_RECEIPT_SHA256', 'receipt_sha256'],
    ['DATAOPS_RECEIPT_IDENTITY', 'DATAOPS_SCHEDULE_RECEIPT_IDENTITY', 'receipt_identity'],
    ['DATAOPS_AUTHORIZED_LOCATION_SCHEME', 'DATAOPS_SCHEDULE_LOCATION_SCHEME', 'authorized_location_scheme'],
    ['DATAOPS_FILE_LOCATION_ROOT', 'DATAOPS_SCHEDULE_FILE_LOCATION_ROOT', 'file_location_root'],
    ['DATAOPS_THROUGH_DATE', 'DATAOPS_SCHEDULE_THROUGH_DATE', 'through_date'],
  ]) {
    const expectedSource = `${environmentName}: \${{ github.event_name == 'schedule' && vars.${scheduleVariable} || inputs.${dispatchInput} }}`;
    assert.match(rebuild, new RegExp(`^      ${expectedSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'm'));
  }
  assert.doesNotMatch(rebuild, /DATAOPS_FILE_LOCATION_ROOT=.*(?:Split-Path|DATAOPS_REGISTRY_PATH)/);
  assert.match(rebuild, /IsNullOrWhiteSpace\(\$env:DATAOPS_FILE_LOCATION_ROOT\)/);
  assert.match(rebuild, /file artifact location root must be separate from the metadata registry directory/i);
  assert.match(rebuild, /registry directory is never a fallback/i);
  assert.match(rebuild, /\['file', 'https'\]/);
  assert.match(rebuild, /input-admission\.json/);
  assert.match(rebuild, /DATAOPS_REGISTRY_SNAPSHOT_PATH[\s\S]*RUNNER_TEMP/);
  assert.match(rebuild, /writeFile\(process\.env\.DATAOPS_REGISTRY_SNAPSHOT_PATH[\s\S]*flag:\s*'wx'/);
  assert.match(rebuild, /pinnedSha[\s\S]*DATAOPS_REGISTRY_SHA256/);
  assert.match(rebuild, /pinnedRegistry\.registryIdentity[\s\S]*DATAOPS_REGISTRY_IDENTITY/);
  assert.match(rebuild, /Set-ItemProperty[\s\S]*IsReadOnly[\s\S]*\$true/);

  assertOrdered(rebuild, [
    'Admit exact Git, registry, receipt, and location inputs',
    'Plan receipt-bound clean-room restore',
    'Create a new versioned maintenance root',
    'Restore exact registry artifact set',
  ]);
  const beforeRootCreation = rebuild.slice(0, rebuild.indexOf('Create a new versioned maintenance root'));
  const preGateNewItemLines = beforeRootCreation.match(/^.*New-Item.*$/gm) || [];
  for (const line of preGateNewItemLines) {
    assert.doesNotMatch(line, /DATAOPS_TARGET_ROOT|\.dfev1/);
  }
});

test('restore CLI uses positional modes and exact conditional argv shapes', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const rebuild = jobBlock(workflow, 'rebuild');
  const commands = restoreCommandArgv(rebuild);
  assert.equal(commands.length, 3);
  assert.equal((rebuild.match(/\$fileLocationArgs = if \(\$env:DATAOPS_AUTHORIZED_LOCATION_SCHEME -eq 'file'\)/g) || []).length, 3);
  assert.equal((rebuild.match(/@\("--file-location-root=\$env:DATAOPS_FILE_LOCATION_ROOT"\)/g) || []).length, 3);
  assert.equal((rebuild.match(/^\s*@\(\)\r?$/gm) || []).length, 3);
  assert.doesNotMatch(rebuild, /--mode(?:=|\s)/);

  for (const [index, mode] of ['plan', 'restore', 'verify'].entries()) {
    const expectedWithFileRoot = [
      'node',
      'scripts/restore_data_artifacts.mjs',
      mode,
      '--registry="$env:DATAOPS_REGISTRY_SNAPSHOT_PATH"',
      '--registry-sha256="$env:DATAOPS_REGISTRY_SHA256"',
      '--registry-identity="$env:DATAOPS_REGISTRY_IDENTITY"',
      '--target="$env:DATAOPS_TARGET_ROOT"',
      '--location="$env:DATAOPS_AUTHORIZED_LOCATION_SCHEME"',
      '--file-location-root="$env:DATAOPS_FILE_LOCATION_ROOT"',
      '--concurrency=2',
    ];
    assert.deepEqual(materializeFileLocationArg(commands[index], 'file'), expectedWithFileRoot);
    assert.deepEqual(
      materializeFileLocationArg(commands[index], 'https'),
      expectedWithFileRoot.filter((token) => !token.startsWith('--file-location-root=')),
    );
  }
  const downstreamRestoreBlock = rebuild.slice(rebuild.indexOf('Plan receipt-bound clean-room restore'));
  assert.doesNotMatch(downstreamRestoreBlock, /--registry="\$env:DATAOPS_REGISTRY_PATH"/);
  assert.doesNotMatch(downstreamRestoreBlock, /--replace-existing/);
});

test('rebuild reconciles full history before model review and overlap refresh', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const rebuild = jobBlock(workflow, 'rebuild');

  assert.match(rebuild, /dataops-maintenance[\\/]v1/);
  assert.match(rebuild, /GITHUB_RUN_ID/);
  assert.match(rebuild, /GITHUB_RUN_ATTEMPT/);
  assert.doesNotMatch(rebuild, /--root=(?:"|')?\.dfev1[\\/]crime(?:"|')?/);
  assert.deepEqual(
    restoreCommandArgv(rebuild).map((argv) => argv[2]),
    ['plan', 'restore', 'verify'],
  );
  assert.match(rebuild, /backfill_crime_event_warehouse\.mjs --validate-only/);
  assert.match(rebuild, /backfill-checkpoint\.json/);
  assert.match(rebuild, /acquired_rows[\s\S]*expected_date_scoped_rows[\s\S]*canonical_rows/);
  assert.match(rebuild, /partition_bindings/);
  assert.match(rebuild, /--overlap-days=45/);

  assertOrdered(rebuild, [
    'Reconcile full-history receipt and partition counts',
    'Build receipt-bound Area Intelligence review candidate',
    'Freeze model output as review-only',
    'Acquire 45-day overlap candidate',
    'Ingest overlap as an unreceipted review candidate',
    'Collect overlap DQ and drift reports',
  ]);
});

test('machine reports survive failures and upload only through a bounded report directory', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const rebuild = jobBlock(workflow, 'rebuild');
  const uploadStart = rebuild.indexOf('Upload bounded machine-readable reports');
  const upload = rebuild.slice(uploadStart);

  for (const dimension of [
    'schema', 'category', 'cartodb_id', 'late-arriving', 'revision', 'coordinate', 'spatial',
  ]) {
    assert.match(rebuild, new RegExp(dimension, 'i'));
  }
  for (const report of [
    'run-status.json',
    'input-admission.json',
    'data-quality-full-history.json',
    'drift-full-history.json',
    'data-quality-overlap.json',
    'drift-overlap.json',
    'model-review.json',
  ]) {
    assert.match(rebuild, new RegExp(report.replace('.', '\\.')));
  }

  assert.match(rebuild, /Write terminal machine-readable status[\s\S]*if:\s*always\(\)/);
  assert.match(rebuild, /Stage bounded reports only[\s\S]*if:\s*always\(\)/);
  assert.match(upload, /if:\s*always\(\)/);
  assert.match(upload, /path:\s*\$\{\{ runner\.temp \}\}\/dataops-upload/);
  assert.match(upload, /if-no-files-found:\s*error/);
  assert.match(rebuild, /52428800/);
  assert.match(rebuild, /artifact-size-gate\.json/);
  assert.doesNotMatch(upload, /\.dfev1|warehouse|canonical|acquisitions|\*\*/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\|\s*true/);
  assert.match(rebuild, /Fail closed after preserving reports[\s\S]*exit 1/);
});

test('workflow cannot push main, publish serving, promote, deploy, or create cloud storage', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  const forbidden = [
    /git\s+push/i,
    /gh\s+pr\s+(?:merge|create)/i,
    /refs\/heads\/main/,
    /data:publish:area-intelligence/,
    /publish_area_intelligence_evaluation/,
    /actions\/deploy-pages/,
    /upload-pages-artifact/,
    /configure-pages/,
    /pages:\s*write/,
    /id-token:\s*write/,
    /aws-actions|google-github-actions|azure\/login/i,
    /aws\s+s3\s+mb|gsutil\s+mb|gcloud\s+storage\s+buckets\s+create|az\s+storage\s+container\s+create/i,
    /terraform|pulumi/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(workflow, pattern);

  assert.match(workflow, /workflowDecision\s*=\s*'review-required'/);
  assert.match(workflow, /reviewArtifactOnly\s*=\s*\$true/);
  assert.match(workflow, /promotionApplied\s*=\s*\$false/);
  assert.match(workflow, /servingPublished\s*=\s*\$false/);
  assert.match(workflow, /mainWritten\s*=\s*\$false/);
  assert.match(workflow, /deployed\s*=\s*\$false/);
  assert.doesNotMatch(workflow, /serving-artifact\.json[\s\S]*Copy-Item/);
});
