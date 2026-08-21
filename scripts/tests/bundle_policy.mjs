#!/usr/bin/env node
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const entry = manifest['index.html'];
const mapRuntime = manifest['src/map/initMap.js'];
const crime = manifest['src/routes_crime/index.js'];
const crimeList = manifest['src/routes_crime/list_mode_controller.js'];
const routeCorridorApp = manifest['src/routes_crime/route_corridor_app_loader.js'];
const routeCorridorRuntime = manifest['src/routes_crime/route_corridor_app_runtime.js'];
const routeCorridor = manifest['src/routes_crime/route_corridor_crime_coordinator.js'];
const routeCorridorUi = manifest['src/routes_crime/route_corridor_ui_controller.js'];
const hin2025Ui = manifest['src/routes_crime/hin_2025_ui.js'];
const knownRouteEvidenceUi = manifest['src/routes_crime/known_route_evidence_ui.js'];
const acsMultitractLoader = manifest['src/acs_multitract/loader.js'];
const acsMultitractController = manifest['src/acs_multitract/controller.js'];
const acsMultitractStyles = { file: acsMultitractController?.css?.[0] };
const homeCompareLoader = manifest['src/home_compare/loader.js'];
const homeCompareController = manifest['src/home_compare/controller.js'];
const homeCompareSourceRegistry = manifest['src/home_compare/source_registry.js'];
const homeCompareStyles = { file: homeCompareController?.css?.[0] };
const incidentResults = manifest['src/routes_crime/incident_results_controller.js'];
const taskFocus = manifest['src/routes_crime/task_focus_controller.js'];
const queryPreset = manifest['src/routes_crime/query_preset_controller.js'];
const diary = manifest['src/routes_diary/index.js'];
const diaryStorage = manifest['src/routes_diary/diary_storage.js'];
const charts = manifest['src/charts/index.js'];
const insights = manifest['src/routes_diary/ui_insights_panel.js'];
const analysisHistory = manifest['src/analysis/analysis_history_controller.js'];
const evidenceBundleProduct = manifest['src/analysis/evidence_bundle_product.js'];
const evidenceBundleV2 = Object.values(manifest).find((record) => record.name === 'evidence_bundle_v2');
const evidenceBundleImport = manifest['src/analysis/evidence_bundle_import.js'];
const evidenceBundleSourceAdapter = manifest['src/analysis/evidence_bundle_source_adapter.js'];
const evidenceBundleImportPreview = manifest['src/ui/evidence_bundle_import_preview.js'];
const evidenceBundleImportStyles = manifest['src/styles/evidence-bundle-import.css'];
const evidenceBundleHash = manifest['src/analysis/evidence_bundle_hash.js'];
const sourceHealth = manifest['src/source_health/source_health_controller.js'];
const sourceHealthCatalog = Object.values(manifest).find((record) => record.name === 'source_health_catalog');
const analysisHistoryMessages = manifest['src/i18n/history.js'];
const helpContent = manifest['src/ui/help_content.js'];
const crimeOffenseCatalog = manifest['src/i18n/crime_offense_catalog.js'];
const p1Messages = Object.values(manifest).find((record) => record.name === 'p1');

assert.ok(entry?.isEntry, 'Vite manifest must contain index.html as the application entry');
assert.deepEqual(
  new Set(entry.dynamicImports || []),
  new Set([
    'src/routes_crime/index.js',
    'src/routes_diary/index.js',
    'src/routes_diary/ui_insights_panel.js',
    'src/i18n/history.js',
    'src/analysis/analysis_history_controller.js',
    'src/analysis/evidence_bundle_product.js',
    'src/ui/help_content.js',
    'src/map/initMap.js',
    'src/routes_crime/list_mode_controller.js',
    'src/routes_crime/route_corridor_app_loader.js',
    'src/acs_multitract/loader.js',
    'src/home_compare/loader.js',
    'src/source_health/source_health_controller.js',
  ]),
  'Entry must keep the map runtime, Crime, Diary, Help, Diary Insights, Analysis History, Evidence Bundle v2, ACS multi-tract, Source Health, and their translations behind direct lazy boundaries',
);
assert.ok(mapRuntime?.isDynamicEntry, 'Vite manifest must keep MapLibre and map initialization behind a lazy runtime boundary');
assert.ok(crimeList?.isDynamicEntry, 'Vite manifest must keep the Crime list controller behind its presentation boundary');
assert.ok(
  crimeList.dynamicImports?.includes('src/charts/index.js'),
  'Crime list queries must keep Charts lazy until a supported analysis runs',
);
assert.ok(
  ![...(crimeList.imports || []), ...(crimeList.dynamicImports || [])]
    .some((key) => key === 'src/map/initMap.js' || key === 'src/routes_crime/index.js'),
  'Crime list presentation must not import the MapLibre-backed Crime controller',
);
assert.deepEqual(
  new Set(crime?.dynamicImports || []),
  new Set([
    'src/routes_crime/incident_results_controller.js',
    'src/routes_crime/task_focus_controller.js',
    'src/charts/index.js',
    'src/i18n/crime_offense_catalog.js',
  ]),
  'Map Crime must keep incident results, task focus, and Charts behind focused lazy boundaries while shared Known Route stays app-owned',
);
assert.ok(incidentResults?.isDynamicEntry, 'Vite manifest must contain Incident Results as a lazy chunk');
assert.ok(taskFocus?.isDynamicEntry, 'Vite manifest must contain Task Focus as a lazy chunk');
assert.deepEqual(
  new Set(taskFocus.dynamicImports || []),
  new Set(['src/routes_crime/query_preset_controller.js']),
  'Task Focus must keep query preset transactions behind a nested lazy boundary',
);
assert.ok(queryPreset?.isDynamicEntry, 'Vite manifest must contain Query Preset as a nested lazy chunk');
assert.deepEqual(
  queryPreset.imports || [],
  [],
  'Query Preset must stay self-contained instead of pulling shared state back into the entry',
);
assert.ok(routeCorridorApp?.isDynamicEntry, 'Vite manifest must keep the shared map/list Known Route adapter lazy');
assert.deepEqual(
  new Set(routeCorridorApp.dynamicImports || []),
  new Set(['src/routes_crime/route_corridor_app_runtime.js']),
  'Known Route app adapter must keep all runtime ports behind the explicit open action',
);
assert.ok(routeCorridorRuntime?.isDynamicEntry, 'Vite manifest must contain the Known Route runtime ports as a nested lazy chunk');
assert.deepEqual(
  new Set(routeCorridorRuntime.dynamicImports || []),
  new Set([
    'src/routes_crime/route_corridor_crime_coordinator.js',
    'src/routes_crime/route_corridor_ui_controller.js',
    'src/routes_crime/hin_2025_ui.js',
    'src/routes_crime/known_route_evidence_ui.js',
  ]),
  'Known Route runtime must own the nested data, HIN, and UI boundaries',
);
assert.ok(routeCorridor?.isDynamicEntry, 'Vite manifest must contain route-corridor data as a lazy chunk');
assert.ok(routeCorridorUi?.isDynamicEntry, 'Vite manifest must contain route-corridor UI as a second-level lazy chunk');
assert.deepEqual(
  new Set(routeCorridorUi.dynamicImports || []),
  new Set(),
  'Route corridor UI must not own additional data or health adapters',
);
assert.ok(hin2025Ui?.isDynamicEntry, 'Vite manifest must contain HIN 2025 UI/context as a nested lazy chunk');
assert.ok(knownRouteEvidenceUi?.isDynamicEntry, 'Vite manifest must contain M4 Known Route evidence as its own nested lazy chunk');
assert.ok(acsMultitractLoader?.isDynamicEntry, 'Vite manifest must keep the ACS multi-tract loader lazy');
assert.deepEqual(
  new Set(acsMultitractLoader.dynamicImports || []),
  new Set(['src/acs_multitract/controller.js']),
  'ACS multi-tract must keep its VRE workflow behind a second-level lazy boundary',
);
assert.ok(acsMultitractController?.isDynamicEntry, 'Vite manifest must contain the ACS multi-tract controller as a nested lazy chunk');
assert.equal(
  (acsMultitractController.assets || []).filter((asset) => /acs_vre_b01003_2024_pa101-.*\.json$/.test(asset)).length,
  1,
  'ACS multi-tract controller must own exactly one admitted VRE source artifact',
);
assert.ok(homeCompareLoader?.isDynamicEntry, 'Vite manifest must keep Home Compare behind a direct user-intent lazy boundary');
assert.deepEqual(
  new Set(homeCompareLoader.dynamicImports || []),
  new Set(['src/home_compare/controller.js']),
  'Home Compare loader must keep its data, contracts, UI, and styles behind a nested lazy boundary',
);
assert.ok(homeCompareController?.isDynamicEntry, 'Vite manifest must contain the Home Compare controller as a nested lazy chunk');
assert.deepEqual(
  new Set(homeCompareController.dynamicImports || []),
  new Set(['src/home_compare/source_registry.js']),
  'Home Compare must keep full runtime registry admission behind its owned query-time boundary',
);
assert.ok(homeCompareSourceRegistry?.isDynamicEntry, 'Vite manifest must contain the Home Compare registry validator as a lazy chunk');
assert.ok(diary?.isDynamicEntry, 'Vite manifest must contain Diary as a lazy entry');
assert.deepEqual(
  new Set(diary.dynamicImports || []),
  new Set(['src/routes_diary/diary_storage.js']),
  'Diary must keep private local storage and backup code behind its own lazy boundary',
);
assert.ok(diaryStorage?.isDynamicEntry, 'Vite manifest must contain Diary local storage as a lazy chunk');
assert.equal(entry.css?.length, 1, 'Split product styles must compile into one initial stylesheet');
assert.equal(diary.css, undefined, 'Diary must not introduce delayed mode-only CSS or a flash of unstyled content');
assert.ok(charts, 'Vite manifest must contain the Charts lazy chunk');
assert.ok(insights, 'Vite manifest must contain the Diary Insights lazy chunk');
assert.ok(analysisHistory?.isDynamicEntry, 'Vite manifest must contain Analysis History as a lazy chunk');
assert.deepEqual(
  new Set(analysisHistory.dynamicImports || []),
  new Set([
    'src/analysis/evidence_bundle_import.js',
    'src/analysis/evidence_bundle_source_adapter.js',
    'src/ui/evidence_bundle_import_preview.js',
  ]),
  'Analysis History must keep Evidence Bundle validation and preview behind explicit import intent',
);
assert.ok(evidenceBundleProduct?.isDynamicEntry, 'Vite manifest must contain Evidence Bundle v2 product writer as a lazy chunk');
assert.ok(evidenceBundleV2, 'Vite manifest must contain the shared Evidence Bundle v2 validator');
assert.deepEqual(
  new Set(evidenceBundleV2.dynamicImports || []),
  new Set(['src/analysis/evidence_bundle_hash.js']),
  'Evidence Bundle v2 must keep browser cryptography behind a nested lazy boundary',
);
assert.ok(evidenceBundleHash?.isDynamicEntry, 'Vite manifest must contain Evidence Bundle hashing as a nested lazy chunk');
assert.ok(sourceHealth?.isDynamicEntry, 'Vite manifest must contain Source Health as a lazy chunk');
assert.ok(analysisHistoryMessages?.isDynamicEntry, 'Vite manifest must contain Analysis History translations as a lazy chunk');
assert.ok(helpContent?.isDynamicEntry, 'Vite manifest must contain Help Center content as a lazy chunk');
assert.ok(crimeOffenseCatalog?.isDynamicEntry, 'Vite manifest must keep the bilingual Crime offense catalog lazy');
assert.ok(p1Messages, 'Vite manifest must keep P1 translations in a shared lazy chunk');
assert.ok(
  !Object.keys(manifest).some((key) => key.includes('__vite-browser-external')),
  'Browser bundles must not contain the Node filesystem compatibility shim',
);

const budgets = [
  ['Entry', entry, 875_585, 247_583],
  // Owns result-scoped cancellation, fail-closed data admission, immutable
  // provenance, and dispatch-only lazy edges without changing the Entry ceiling.
  ['Crime', crime, 42_000, 14_900],
  ['Crime list', crimeList, 6_500, 2_600],
  ['Route corridor app adapter', routeCorridorApp, 2_975, 1_275],
  // Loads only after the user opens Known Route; keeps mutable map/request/HIN
  // ports out of the app-level mode entry.
  ['Route corridor runtime ports', routeCorridorRuntime, 3_000, 1_400],
  // Loaded only after an explicit route-corridor request. Exact route geometry
  // stays local while this chunk owns coarse admission and local association.
  ['Route corridor data', routeCorridor, 23_500, 7_800],
  // Includes the shell-owned drawer and shared map/manual waypoint editor.
  ['Route corridor UI', routeCorridorUi, 24_000, 8_300],
  // Text-first HIN context plus dependency-free local segment association and
  // the admitted lifecycle receipt/source-health adapter.
  ['HIN 2025 context', hin2025Ui, 20_000, 7_200],
  // Loaded only after an admitted Known Route history request; owns strict
  // centerline consent/match, separated evidence dimensions and segment detail.
  ['Known Route evidence M4', knownRouteEvidenceUi, 36_500, 13_100],
  ['ACS multi-tract loader', acsMultitractLoader, 1_000, 600],
  ['ACS multi-tract controller', acsMultitractController, 22_000, 8_000],
  ['ACS multi-tract styles', acsMultitractStyles, 4_000, 1_200],
  // Opened only by explicit Home Compare intent. The nested controller owns
  // official aggregate queries, strict serving/share contracts, bilingual UI,
  // and fail-closed address/parcel admission without changing the Entry ceiling.
  ['Home Compare loader', homeCompareLoader, 1_100, 650],
  ['Home Compare controller', homeCompareController, 54_000, 18_000],
  ['Home Compare source registry', homeCompareSourceRegistry, 6_000, 2_000],
  ['Home Compare styles', homeCompareStyles, 4_500, 1_200],
  // Loaded only after an authorized point query; owns synchronized map/list selection.
  ['Incident Results', incidentResults, 7_000, 2_900],
  // Session-only presentation preferences load with active Crime; query mutation stays nested-lazy.
  ['Task Focus', taskFocus, 6_800, 3_100],
  // Owns preview, stale-state admission, one-refresh commit, full-snapshot undo,
  // and explicit failed-port settlement so interrupted transactions do not stay pending.
  ['Query Preset', queryPreset, 5_200, 2_050],
  ['Diary', diary, 210_100, 65_573],
  // Owns the versioned private schema, v1 migration, exact snapshot token,
  // serialized two-store transactions, and the extracted local-data controller.
  // It stays lazy and within a narrow regression budget after that controller
  // moved out of the larger Diary route chunk.
  ['Diary local storage', diaryStorage, 27_500, 8_000],
  ['Charts', charts, 233_791, 79_747],
  // Includes local-history trend/tag/heatmap rendering and the device-only data bridge.
  ['Diary Insights', insights, 11_200, 3_600],
  // Includes cached comparison rendering, truthful refresh cancellation/freshness
  // states, and v1/v2 analysis-artifact compatibility for structured ACS evidence.
  ['Analysis History', analysisHistory, 24_800, 8_100],
  // The feature-flagged v2 writer and import path stay absent from the initial entry.
  ['Evidence Bundle product', evidenceBundleProduct, 2_000, 1_000],
  ['Evidence Bundle v2', evidenceBundleV2, 24_000, 6_500],
  ['Evidence Bundle import', evidenceBundleImport, 7_500, 3_300],
  ['Evidence Bundle source adapter', evidenceBundleSourceAdapter, 5_500, 2_100],
  ['Evidence Bundle import preview', evidenceBundleImportPreview, 6_000, 2_200],
  ['Evidence Bundle import styles', evidenceBundleImportStyles, 1_600, 700],
  // Loads only after Data Status is expanded; owns the strict four-clock source
  // read model and text-first source catalog without importing map runtime code.
  ['Source Health', sourceHealth, 22_000, 7_500],
  ['Source Health catalog', sourceHealthCatalog, 15_000, 5_000],
  // Keeps bilingual history copy out of the entry and below a focused lazy-resource budget.
  ['Analysis History translations', analysisHistoryMessages, 4_000, 1_700],
  // Full bilingual source, ACS estimate/MOE, and methodology guidance loads
  // only when Help is opened.
  ['Help Center', helpContent, 23_300, 9_700],
  // Loaded with Crime initialization so the versioned taxonomy never inflates the app entry.
  ['Crime offense catalog', crimeOffenseCatalog, 9_000, 2_800],
  // Shared by lazy Crime/Diary surfaces without increasing the initial entry catalog.
  ['P1 translations', p1Messages, 8_644, 3_300],
];
const measurements = [];

for (const [label, record, rawLimit, gzipLimit] of budgets) {
  const builtFile = path.join(distDir, record.file);
  const contents = await readFile(builtFile);
  const rawBytes = contents.byteLength;
  const gzipBytes = gzipSync(contents).byteLength;
  assert.ok(rawBytes <= rawLimit, `${label} raw size must stay <= ${rawLimit}; received ${rawBytes}`);
  assert.ok(gzipBytes <= gzipLimit, `${label} gzip size must stay <= ${gzipLimit}; received ${gzipBytes}`);
  measurements.push(`${label} ${rawBytes}/${gzipBytes}`);
}

const distFiles = await listFiles(distDir);
const publicFiles = await listFiles(publicDir);
const artifactFiles = [...distFiles, ...publicFiles];
const distBytes = await sumFileSizes(distFiles);
const vreArtifacts = distFiles.filter((file) => /acs_vre_b01003_2024_pa101-.*\.json$/.test(path.basename(file)));
assert.equal(vreArtifacts.length, 1, 'dist must contain exactly one admitted ACS VRE source artifact');
const vreArtifactBytes = await sumFileSizes(vreArtifacts);
const nonVreDistBytes = distBytes - vreArtifactBytes;
assert.ok(vreArtifactBytes <= 200_000, `ACS VRE source artifact must stay <= 200000; received ${vreArtifactBytes}`);
assert.ok(nonVreDistBytes <= 4_000_000, `Dist excluding the separately admitted ACS VRE source artifact must stay <= 4000000; received ${nonVreDistBytes}`);
assert.ok(distBytes <= 4_200_000, `Transparent total dist size must stay <= 4200000; received ${distBytes}`);
for (const rootDir of [distDir, publicDir]) {
  const hinArtifact = path.join(rootDir, 'data', 'hin_2025.snapshot.json');
  const size = (await stat(hinArtifact)).size;
  assert.ok(size <= 280_000, `${relative(hinArtifact)} must stay <= 280000 bytes; received ${size}`);
}

const publishedFallbackFields = new Map([
  ['data/tracts_phl.geojson', ['GEOID']],
  ['data/police_districts.geojson', ['DIST_NUMC']],
]);
for (const [relativePath, allowedFields] of publishedFallbackFields) {
  const artifact = JSON.parse(await readFile(path.join(distDir, relativePath), 'utf8'));
  assert.ok(Array.isArray(artifact.features) && artifact.features.length > 0, `${relativePath} must retain published features`);
  for (const feature of artifact.features) {
    assert.deepEqual(
      Object.keys(feature.properties || {}).sort(),
      [...allowedFields].sort(),
      `${relativePath} must publish only runtime-consumed fallback properties`,
    );
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type), `${relativePath} must retain boundary geometry`);
  }
}

const forbiddenRoadFiles = new Set([
  'streets_phl.raw.geojson',
  'segments_phl.network.geojson',
]);
for (const file of artifactFiles) {
  const size = (await stat(file)).size;
  assert.ok(size <= 10_000_000, `${relative(file)} must stay <= 10000000 bytes; received ${size}`);
  assert.ok(!forbiddenRoadFiles.has(path.basename(file)), `${relative(file)} must not publish the full road network`);
  if (isTextArtifact(file)) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /(?:[A-Za-z]:(?:\\+|\/+)Users(?:\\+|\/+)|file:\/\/\/|essay help master|6920Java|engagement_project-stage1)/i, `${relative(file)} must not expose a local workstation path`);
  }
}

await verifyWorkflowPolicy();
await verifyDependabotPolicy();
verifyReadOnlyJobPermissionGuard();

console.log(`[Bundle Policy] PASS - ${measurements.join(', ')}; dist ${distBytes} bytes (${nonVreDistBytes} excluding ${vreArtifactBytes}-byte ACS VRE source artifact).`);

async function verifyWorkflowPolicy() {
  const approvedUses = new Map([
    ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
    ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
    ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
    ['actions/configure-pages', '45bfe0192ca1faeb007ade9deae92b16b8254a0d'],
    ['actions/upload-pages-artifact', 'fc324d3547104276b827a68afc52ff2a11cc49c9'],
    ['actions/deploy-pages', 'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128'],
  ]);
  const expectedUseCounts = new Map([
    ['actions/checkout', 6],
    ['actions/setup-node', 5],
    ['actions/upload-artifact', 3],
    ['actions/configure-pages', 1],
    ['actions/upload-pages-artifact', 1],
    ['actions/deploy-pages', 1],
  ]);
  const observedUseCounts = new Map();
  const workflowDir = path.join(root, '.github', 'workflows');
  const workflowFiles = (await listFiles(workflowDir)).filter((file) => /\.ya?ml$/i.test(file));

  for (const file of workflowFiles) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
      const reference = match[1];
      const separator = reference.lastIndexOf('@');
      assert.ok(separator > 0, `${relative(file)} uses entry must include an immutable ref: ${reference}`);
      const action = reference.slice(0, separator);
      const ref = reference.slice(separator + 1);
      assert.match(ref, /^[0-9a-f]{40}$/i, `${relative(file)} must pin ${action} to a 40-hex SHA`);
      assert.equal(ref, approvedUses.get(action), `${relative(file)} has an unapproved SHA for ${action}`);
      observedUseCounts.set(action, (observedUseCounts.get(action) || 0) + 1);
    }
    assert.doesNotMatch(text, /^\s*uses:\s*[^\s#]+@v\d+/gmi, `${relative(file)} must not use mutable action version tags`);
  }
  assert.deepEqual(
    [...observedUseCounts].sort(([left], [right]) => left.localeCompare(right)),
    [...expectedUseCounts].sort(([left], [right]) => left.localeCompare(right)),
    'Workflows must use exactly the approved action set',
  );

  const ci = await readFile(path.join(workflowDir, 'ci.yml'), 'utf8');
  assert.match(ci, /^permissions:\r?\n  contents: read\r?$/m, 'CI must keep workflow-level contents: read permissions');
  assertJobInheritsWorkflowPermissions(ci, 'core', 'CI core job');
  assertJobInheritsWorkflowPermissions(ci, 'release', 'CI release job');
  assertJobInheritsWorkflowPermissions(ci, 'coverage', 'CI coverage job');
  const deployBlock = extractJobBlock(ci, 'deploy');
  assert.match(
    deployBlock,
    /^    permissions:\r?\n      contents: read\r?\n      pages: write\r?\n      id-token: write\r?$/m,
    'Pages deploy job must explicitly grant contents: read, pages: write, and id-token: write',
  );
  assert.match(deployBlock, /^    needs: \[core, release, coverage\]\r?$/m, 'Pages deploy job must depend on every same-run gate');
  assert.match(deployBlock, /^    environment:\r?\n      name: github-pages\r?\n      url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}\r?$/m, 'Pages deploy environment and URL contract must remain intact');

  const sourceAudit = await readFile(path.join(workflowDir, 'audit-source-candidates.yml'), 'utf8');
  assert.match(
    sourceAudit,
    /^permissions:\r?\n  contents: read\r?$/m,
    'Source candidate audit must keep workflow-level contents: read permissions',
  );
  assertJobInheritsWorkflowPermissions(sourceAudit, 'audit', 'Source candidate audit job');
  assert.doesNotMatch(
    sourceAudit,
    /(?:contents|issues|pull-requests|pages|id-token): write|git (?:add|commit|push)|gh (?:issue|pr)|deploy-pages/i,
    'Source candidate audit must not gain repository, review, or deployment write behavior',
  );
}

async function verifyDependabotPolicy() {
  const text = await readFile(path.join(root, '.github', 'dependabot.yml'), 'utf8');
  const githubActionsEntry = text.match(/(?:^|\n)  - package-ecosystem: github-actions\r?\n([\s\S]*?)(?=\n  - package-ecosystem:|$)/)?.[0] || '';
  assert.ok(githubActionsEntry, 'Dependabot must maintain pinned GitHub Actions');
  assert.match(githubActionsEntry, /^    directory: \/\r?$/m, 'GitHub Actions Dependabot entry must target the repository root');
  assert.match(githubActionsEntry, /^    schedule:\r?\n      interval: weekly\r?$/m, 'GitHub Actions Dependabot entry must run weekly');
}

function extractJobBlock(text, jobName) {
  const heading = new RegExp(`^  ${jobName}:\\r?$`, 'm').exec(text);
  if (!heading) return '';
  const afterHeading = heading.index + heading[0].length;
  const nextJob = /^  [A-Za-z0-9_-]+:\r?$/m.exec(text.slice(afterHeading));
  const end = nextJob ? afterHeading + nextJob.index : text.length;
  return text.slice(heading.index, end);
}

function verifyReadOnlyJobPermissionGuard() {
  const unsafeBuildJob = [
    'jobs:',
    '  build:',
    '    permissions:',
    '      pages: write',
    '      id-token: write',
  ].join('\n');
  assert.throws(
    () => assertJobInheritsWorkflowPermissions(unsafeBuildJob, 'build', 'Pages build job'),
    /must inherit workflow-level read-only permissions/,
    'Permission policy must reject a build job that grants Pages write permissions',
  );

  const unsafeCoreJob = [
    'jobs:',
    '  core:',
    '    permissions:',
    '      contents: write',
  ].join('\n');
  assert.throws(
    () => assertJobInheritsWorkflowPermissions(unsafeCoreJob, 'core', 'CI core job'),
    /must inherit workflow-level read-only permissions/,
    'Permission policy must reject any broader core job permissions',
  );
}

function assertJobInheritsWorkflowPermissions(text, jobName, label) {
  const jobBlock = extractJobBlock(text, jobName);
  assert.ok(jobBlock, `${label} must exist`);
  const contentLines = jobBlock.split(/\r?\n/).slice(1).filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  const jobLevelIndent = Math.min(...contentLines.map((line) => line.length - line.trimStart().length));
  const declaresPermissions = contentLines.some((line) => (
    line.length - line.trimStart().length === jobLevelIndent
    && /^permissions\s*:/.test(line.trimStart())
  ));
  assert.equal(declaresPermissions, false, `${label} must inherit workflow-level read-only permissions`);
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in bundle-policy inputs: ${relative(target)}`);
    }
    if (entry.isDirectory()) files.push(...await listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function sumFileSizes(files) {
  let total = 0;
  for (const file of files) total += (await stat(file)).size;
  return total;
}

function isTextArtifact(file) {
  return /\.(?:css|csv|geojson|html|js|json|map|md|svg|txt|xml|ya?ml)$/i.test(file);
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}
