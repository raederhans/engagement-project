import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertTaskOwnedDfev1Path } from './dfev1_path.mjs';
import { validateHomeCompareCitywideSourceLifecycle } from './home_compare_citywide_source_lifecycle.mjs';
import { validateHomeCompareCitywideJoinDq } from './home_compare_citywide_join_dq.mjs';

export const HOME_COMPARE_CITYWIDE_READINESS_SCHEMA = 'engagement-home-compare-citywide-readiness/v1';
const SHA = /^sha256:[a-f0-9]{64}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORITY = Object.freeze({ product_authority:false, publication_authority:false, redistribution_authority:false, safety_authority:false, routing_authority:false });
const PRIVACY = Object.freeze({ aggregate_only:true, address_included:false, coordinates_included:false, source_rows_included:false });
const SOURCE_IDS = Object.freeze(['citygeo-address-locator','opa-current-property','opa-assessment-history','real-estate-transfers','philly311-requests','li-property-history','vacant-property-indicators','philadelphia-reported-crime','vision-zero-hin-2025']);
const DIMENSIONS = Object.freeze(['geocoder_address_resolution','property_current_assessment','assessment_history','transfers','requests_311','li_property_history','vacancy','reported_incidents','hin_road_context']);
const READINESS_LIMITATIONS = Object.freeze([
  'Local non-authoritative candidate only; this is not address-level evidence.',
  'No private address, coordinate, parcel, source row, or event identifier is included.',
  'No result authorizes product publication, redistribution, safety, routing, travel-time, isochrone, scoring, ranking, or recommendation.',
]);
const SOURCE_LIMITATIONS = Object.freeze([
  Object.freeze(['City geocoder readiness does not admit a citywide address payload or address-level join.']),
  Object.freeze(['OPA current-property readiness does not admit a complete immutable parcel payload or private address-level join.']),
  Object.freeze(['Assessment-history readiness is bounded metadata only; no complete immutable parcel history or private join is admitted.']),
  Object.freeze(['Transfer readiness does not admit a complete immutable transaction payload or private address-level join.']),
  Object.freeze(['311 readiness is bounded metadata only; no complete request payload or private address-level join is admitted.']),
  Object.freeze(['L&I readiness is bounded composite metadata only; no complete property-history payload or private join is admitted.']),
  Object.freeze(['Vacancy readiness is modeled likely-vacant context only; it is not field-confirmed occupancy or address-level evidence.']),
  Object.freeze(['Reported-incident readiness reuses exact M1 aggregate identity only; no event payload, address join, or current safety claim is admitted.']),
  Object.freeze(['HIN readiness is legacy historical planning context only; it is not raw crash data, current safety evidence, or routing authority.']),
]);
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const schema = JSON.parse(await fs.readFile(new URL('../data/home_compare_citywide_readiness.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv2020({ strict:true, allErrors:true }).compile(schema);

export async function loadHomeCompareCitywideReadinessInputs({ lifecyclePath, ledgerPath, expectedLifecycleIdentity, expectedLifecycleSha256, expectedLedgerIdentity, expectedLedgerSha256 } = {}) {
  const lifecycle = await loadExact(lifecyclePath, expectedLifecycleIdentity, expectedLifecycleSha256, validateHomeCompareCitywideSourceLifecycle, 'lifecycle');
  const ledger = await loadExact(ledgerPath, expectedLedgerIdentity, expectedLedgerSha256, validateHomeCompareCitywideJoinDq, 'join DQ ledger');
  if (ledger.value.input.lifecycle_identity !== lifecycle.value.identity || ledger.value.input.sha256 !== lifecycle.sha256 || ledger.value.input.bytes !== lifecycle.bytes) throw new Error('Join DQ ledger input does not cross-bind the exact lifecycle identity, SHA-256, and bytes.');
  return Object.freeze({ lifecycle, ledger });
}

export function buildHomeCompareCitywideReadiness({ lifecycle, ledger } = {}) {
  const l = validateHomeCompareCitywideSourceLifecycle(lifecycle?.value);
  const d = validateHomeCompareCitywideJoinDq(ledger?.value);
  if (!SHA.test(lifecycle?.sha256 || '') || !positive(lifecycle?.bytes) || !SHA.test(ledger?.sha256 || '') || !positive(ledger?.bytes)) throw new Error('Readiness inputs require exact SHA-256 and byte identity.');
  if (d.input.lifecycle_identity !== l.identity || d.input.sha256 !== lifecycle.sha256 || d.input.bytes !== lifecycle.bytes) throw new Error('Readiness ledger cross-input binding drifted.');
  const sources = l.receipts.map((receipt) => Object.freeze({ source_id:receipt.source_id, ordinal:receipt.ordinal, receipt_identity:receipt.receipt_identity, status:receipt.status, freshness:receipt.freshness, clocks:receipt.clocks, coverage:receipt.coverage, dq:projectDq(receipt), official_source_url:sourceUrl(receipt), limitations:sourceLimitations(receipt) }));
  const evidence = { schema:HOME_COMPARE_CITYWIDE_READINESS_SCHEMA, input:{ lifecycle:{ schema:l.schema, semantic_identity:l.identity, sha256:lifecycle.sha256, bytes:lifecycle.bytes }, ledger:{ schema:d.schema, semantic_identity:d.identity, sha256:ledger.sha256, bytes:ledger.bytes } }, status:sources.every((x)=>x.status==='unavailable')?'unavailable':'partial', sources, dimensions:d.dimensions, privacy:{...PRIVACY}, authority:{...AUTHORITY}, limitations:[...READINESS_LIMITATIONS] };
  return validateHomeCompareCitywideReadiness({ ...evidence, identity:identityOf(evidence) });
}

export function validateHomeCompareCitywideReadiness(value) {
  if (!validateSchema(value)) throw new Error('Citywide readiness schema validation failed.');
  exact(value,['schema','input','status','sources','dimensions','privacy','authority','limitations','identity'],'citywide readiness');
  if (value.schema!==HOME_COMPARE_CITYWIDE_READINESS_SCHEMA || value.input?.lifecycle?.schema!=='engagement-home-compare-citywide-source-lifecycle/v1' || value.input?.ledger?.schema!=='engagement-home-compare-citywide-join-dq/v1' || !['partial','unavailable'].includes(value.status) || !Array.isArray(value.sources) || value.sources.length!==9 || !Array.isArray(value.dimensions) || value.dimensions.length!==9 || stable(value.authority)!==stable(AUTHORITY) || stable(value.privacy)!==stable(PRIVACY) || stable(value.limitations)!==stable(READINESS_LIMITATIONS) || !SHA.test(value.identity||'')) throw new Error('Citywide readiness schema or boundary is invalid.');
  for (const [i, source] of value.sources.entries()) validateSourceProjection(source, i);
  for (const [i, dimension] of value.dimensions.entries()) {
    exact(dimension,['dimension','ordinal','required_source_receipt_identities','source_readiness','join_status','admission_status','reason','row_availability','value_availability','total','available_zero','identity'],`dimension ${i}`);
    const source=value.sources[i];
    const sourceReadiness=source.status==='unavailable'?'unavailable':source.status==='partial'?'partial':'exact-receipt-ready';
    const joinStatus=sourceReadiness==='unavailable'?'unavailable':'not-admitted';
    const evidence=structuredClone(dimension); delete evidence.identity;
    if (dimension.dimension!==DIMENSIONS[i] || dimension.ordinal!==i || dimension.required_source_receipt_identities?.length!==1 || dimension.required_source_receipt_identities[0]!==source.receipt_identity || dimension.source_readiness!==sourceReadiness || dimension.join_status!==joinStatus || dimension.admission_status!==joinStatus || dimension.reason!==dimensionReason(dimension.dimension,sourceReadiness) || !SHA.test(dimension.identity||'') || dimension.identity!==identityOf(evidence) || dimension.total!==null || dimension.available_zero!==false || dimension.row_availability!=='unavailable' || dimension.value_availability!=='unavailable') throw new Error('Citywide readiness dimension must remain aggregate-only and fail closed.');
  }
  if (value.status!==(value.sources.every(({status})=>status==='unavailable')?'unavailable':'partial')) throw new Error('Citywide readiness top status drifted.');
  const copy=structuredClone(value); delete copy.identity; if(value.identity!==identityOf(copy)) throw new Error('Citywide readiness identity drifted.');
  const text=JSON.stringify(value); if (/(?:"address"|"coordinates"|"parcel_id"|"source_rows"|"event_id"|"safety_score"|"winner"|"travel_time"|"isochrone")\s*:/i.test(text)) throw new Error('Citywide readiness contains private or decision fields.');
  return Object.freeze(structuredClone(value));
}

export async function writeHomeCompareCitywideReadiness(
  outputPath,
  readiness,
  { workspace = process.cwd(), fileSystem = fs } = {},
) {
  const target = await outputTarget(outputPath, workspace);
  const content = Buffer.from(`${JSON.stringify(
    validateHomeCompareCitywideReadiness(readiness),
    null,
    2,
  )}\n`);
  try {
    const current = await fileSystem.readFile(target);
    if (current.equals(content)) {
      return Object.freeze({ status: 'idempotent', outputPath: target, bytes: current.length });
    }
    throw new Error('Home Compare citywide readiness output already exists with different bytes; refusing overwrite.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await fileSystem.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  let result;
  try {
    await fileSystem.writeFile(temporary, content, { flag: 'wx' });
    try {
      await fileSystem.link(temporary, target);
      result = Object.freeze({ status: 'published', outputPath: target, bytes: content.length });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await fileSystem.readFile(target);
      if (!current.equals(content)) {
        throw new Error('Home Compare citywide readiness output already exists with different bytes; refusing overwrite.');
      }
      result = Object.freeze({ status: 'idempotent', outputPath: target, bytes: current.length });
    }
  } finally {
    // A failed cleanup is itself a failed publication attempt. Do not report a
    // clean published/idempotent result while a staging file may remain.
    await fileSystem.rm(temporary, { force: true });
  }
  return result;
}
async function outputTarget(outputPath, workspace) { const root=path.resolve(workspace); const target=path.resolve(root, outputPath); const tracked=path.resolve(root,'public/data/home_compare_citywide_readiness.v1.json'); if(target===tracked)return target; return assertTaskOwnedDfev1Path(outputPath,{workspace,label:'Home Compare citywide readiness output'}); }
async function loadExact(file, expectedIdentity, expectedSha, validate, label) { if(!SHA.test(expectedIdentity||'')||!SHA.test(expectedSha||''))throw new Error(`Expected ${label} semantic identity and exact file SHA-256 are required.`); const bytes=await fs.readFile(path.resolve(file)); const sha=hash(bytes); if(sha!==expectedSha)throw new Error(`${label} does not match the explicitly expected exact file SHA-256.`); let value;try{value=JSON.parse(bytes)}catch{throw new Error(`${label} is not strict JSON.`)} value=validate(value);if(value.identity!==expectedIdentity)throw new Error(`${label} does not match the explicitly expected semantic identity.`);return Object.freeze({value,sha256:sha,bytes:bytes.length}); }
const OFFICIAL_URLS = Object.freeze({
  'citygeo-address-locator':'https://citygeo-geocoder-pub.databridge.phila.gov/arcgis/rest/services/Geocoders/Address_Locator/GeocodeServer',
  'opa-current-property':'https://data.phila.gov/visualizations/property-assessments/',
  'opa-assessment-history':'https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/',
  'real-estate-transfers':'https://data.phila.gov/visualizations/real-estate-transfers/',
  'philly311-requests':'https://data.phila.gov/visualizations/311-requests/',
  'li-property-history':'https://opendataphilly.org/datasets/licenses-and-inspections-property-history/',
  'vacant-property-indicators':'https://opendataphilly.org/datasets/vacant-property-indicators/',
  'philadelphia-reported-crime':'https://data.phila.gov/visualizations/crime-incidents/',
  'vision-zero-hin-2025':'https://opendataphilly.org/datasets/vision-zero-high-injury-network/',
});
function sourceUrl(receipt){ const url=OFFICIAL_URLS[receipt.source_id]; if(!url) throw new Error('Citywide readiness source URL is not in the fixed nine-source registry.'); return url; }
function sourceLimitations(receipt){const index=SOURCE_IDS.indexOf(receipt.source_id);if(index<0)throw new Error('Readiness source is not in the fixed registry.');return [...SOURCE_LIMITATIONS[index]];}
function projectDq(receipt){return {status:receipt.dq.status,observed_field_count:receipt.dq.observed_field_count,missing_fields:[],flags:dqFlags(receipt.status,receipt.coverage.status)};}
function dqFlags(status,coverageStatus){if(status==='unavailable')return ['source-unavailable'];if(coverageStatus==='exact-receipt-review-incomplete')return ['exact-receipt-review-incomplete'];if(coverageStatus==='bounded-metadata-only')return ['bounded-metadata-only'];return ['exact-receipt-admitted'];}
function validateSourceProjection(source,index){
  exact(source,['source_id','ordinal','receipt_identity','status','freshness','clocks','coverage','dq','official_source_url','limitations'],`source ${index}`);
  exact(source.freshness,['status','max_age_days','age_days'],`source ${index} freshness`);
  exact(source.clocks,['source_as_of','retrieved_at','built_at','observed_at'],`source ${index} clocks`);
  exact(source.coverage,['scope','status','row_count','available_zero','exact_payload','completeness_admitted'],`source ${index} coverage`);
  exact(source.dq,['status','observed_field_count','missing_fields','flags'],`source ${index} DQ`);
  const {freshness,clocks,coverage,dq}=source;
  if(source.source_id!==SOURCE_IDS[index] || source.ordinal!==index || !SHA.test(source.receipt_identity||'') || !['available','available-zero','partial','unavailable'].includes(source.status) || source.official_source_url!==OFFICIAL_URLS[source.source_id] || stable(source.limitations)!==stable(SOURCE_LIMITATIONS[index]) || !['current','stale','unavailable'].includes(freshness.status) || !Number.isSafeInteger(freshness.max_age_days) || freshness.max_age_days<1 || freshness.max_age_days>366 || !(freshness.age_days===null || Number.isFinite(freshness.age_days)&&freshness.age_days>=0) || (freshness.status==='unavailable')!==(freshness.age_days===null) || !strictClock(clocks.observed_at) || !['source_as_of','retrieved_at','built_at'].every((key)=>clocks[key]===null||strictClock(clocks[key])) || coverage.scope!=='citywide' || !['complete-exact-receipt','exact-receipt-review-incomplete','bounded-metadata-only','unavailable'].includes(coverage.status) || !(coverage.row_count===null || Number.isSafeInteger(coverage.row_count)&&coverage.row_count>=0) || ![coverage.available_zero,coverage.exact_payload,coverage.completeness_admitted].every((item)=>typeof item==='boolean') || !['pass','partial','unavailable'].includes(dq.status) || !Number.isSafeInteger(dq.observed_field_count) || dq.observed_field_count<0 || dq.observed_field_count>250 || stable(dq.missing_fields)!==stable([]) || stable(dq.flags)!==stable(dqFlags(source.status,coverage.status))) throw new Error('Citywide readiness source is invalid.');
  if(source.status==='unavailable' && (coverage.status!=='unavailable' || coverage.row_count!==null || coverage.available_zero!==false || coverage.exact_payload!==false || coverage.completeness_admitted!==false || dq.status!=='unavailable')) throw new Error('Unavailable readiness source changed coverage semantics.');
  if(source.status==='partial') { const bounded=coverage.status==='bounded-metadata-only'&&coverage.exact_payload===false; const review=coverage.status==='exact-receipt-review-incomplete'&&coverage.exact_payload===true; if((!bounded&&!review)||coverage.available_zero!==false||coverage.completeness_admitted!==false||dq.status!=='partial') throw new Error('Partial readiness source changed coverage semantics.'); }
  if(['available','available-zero'].includes(source.status)) { if(coverage.status!=='complete-exact-receipt'||coverage.exact_payload!==true||coverage.completeness_admitted!==true||!Number.isSafeInteger(coverage.row_count)||coverage.row_count<0||dq.status!=='pass') throw new Error('Available readiness source lacks exact admitted coverage.'); if(source.status==='available-zero'?(coverage.row_count!==0||coverage.available_zero!==true):(coverage.row_count===0||coverage.available_zero!==false)) throw new Error('Available readiness source changed zero semantics.'); }
}
function strictClock(value){if(typeof value!=='string'||!CLOCK.test(value))return false;const timestamp=Date.parse(value);return Number.isFinite(timestamp)&&new Date(timestamp).toISOString()===value}
function dimensionReason(dimension,readiness){if(readiness==='unavailable')return 'Required source receipt is unavailable; no join, rows, values, or zero claim is admitted.';if(dimension==='hin_road_context')return 'Legacy partial HIN receipt is road context only; no raw crash, current safety, private join, or routing authority is admitted.';if(dimension==='reported_incidents')return 'Exact M1 receipt readiness is reused, but no event payload, private address join key, coverage, or parcel authority is admitted.';return 'No exact payload, private address or parcel join authority, exact join key, coverage, or completeness is admitted.'}
function exact(v,k,l){if(!v||typeof v!=='object'||Array.isArray(v)||stable(Object.keys(v).sort())!==stable([...k].sort()))throw new Error(`${l} contains unknown or missing fields.`)} function positive(n){return Number.isSafeInteger(n)&&n>0} function hash(v){return `sha256:${createHash('sha256').update(v).digest('hex')}`} function identityOf(v){return hash(Buffer.from(stable(v)))} function stable(v){if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;return JSON.stringify(v)}
