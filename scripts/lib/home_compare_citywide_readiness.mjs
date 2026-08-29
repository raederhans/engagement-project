import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertTaskOwnedDfev1Path } from './dfev1_path.mjs';
import { validateHomeCompareCitywideSourceLifecycle } from './home_compare_citywide_source_lifecycle.mjs';
import { validateHomeCompareCitywideJoinDq } from './home_compare_citywide_join_dq.mjs';

export const HOME_COMPARE_CITYWIDE_READINESS_SCHEMA = 'engagement-home-compare-citywide-readiness/v1';
const SHA = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({ product_authority:false, publication_authority:false, redistribution_authority:false, safety_authority:false, routing_authority:false });
const PRIVACY = Object.freeze({ aggregate_only:true, address_included:false, coordinates_included:false, source_rows_included:false });
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
  const sources = l.receipts.map((receipt) => Object.freeze({ source_id:receipt.source_id, ordinal:receipt.ordinal, receipt_identity:receipt.receipt_identity, status:receipt.status, freshness:receipt.freshness, clocks:receipt.clocks, coverage:receipt.coverage, dq:receipt.dq, official_source_url:sourceUrl(receipt), limitations:sourceLimitations(receipt) }));
  const evidence = { schema:HOME_COMPARE_CITYWIDE_READINESS_SCHEMA, input:{ lifecycle:{ schema:l.schema, semantic_identity:l.identity, sha256:lifecycle.sha256, bytes:lifecycle.bytes }, ledger:{ schema:d.schema, semantic_identity:d.identity, sha256:ledger.sha256, bytes:ledger.bytes } }, status:sources.every((x)=>x.status==='unavailable')?'unavailable':'partial', sources, dimensions:d.dimensions, privacy:{...PRIVACY}, authority:{...AUTHORITY}, limitations:['Local non-authoritative candidate only; this is not address-level evidence.','No private address, coordinate, parcel, source row, or event identifier is included.','No result authorizes product publication, redistribution, safety, routing, travel-time, isochrone, scoring, ranking, or recommendation.'] };
  return validateHomeCompareCitywideReadiness({ ...evidence, identity:identityOf(evidence) });
}

export function validateHomeCompareCitywideReadiness(value) {
  if (!validateSchema(value)) throw new Error('Citywide readiness schema validation failed.');
  exact(value,['schema','input','status','sources','dimensions','privacy','authority','limitations','identity'],'citywide readiness');
  if (value.schema!==HOME_COMPARE_CITYWIDE_READINESS_SCHEMA || !['partial','unavailable'].includes(value.status) || !Array.isArray(value.sources) || value.sources.length!==9 || !Array.isArray(value.dimensions) || value.dimensions.length!==9 || stable(value.authority)!==stable(AUTHORITY) || stable(value.privacy)!==stable(PRIVACY) || !SHA.test(value.identity||'')) throw new Error('Citywide readiness schema or boundary is invalid.');
  for (const [i, source] of value.sources.entries()) { exact(source,['source_id','ordinal','receipt_identity','status','freshness','clocks','coverage','dq','official_source_url','limitations'],`source ${i}`); if (source.ordinal!==i || !SHA.test(source.receipt_identity||'') || !['available','available-zero','partial','unavailable'].includes(source.status) || !/^https:\/\//.test(source.official_source_url) || !Array.isArray(source.limitations) || !source.limitations.length) throw new Error('Citywide readiness source is invalid.'); }
  for (const [i, dimension] of value.dimensions.entries()) { if (dimension.ordinal!==i || dimension.total!==null || dimension.available_zero!==false || dimension.row_availability!=='unavailable' || dimension.value_availability!=='unavailable') throw new Error('Citywide readiness dimension must remain aggregate-only and fail closed.'); }
  const copy=structuredClone(value); delete copy.identity; if(value.identity!==identityOf(copy)) throw new Error('Citywide readiness identity drifted.');
  const text=JSON.stringify(value); if (/(?:"address"|"coordinates"|"parcel_id"|"source_rows"|"event_id"|"safety_score"|"winner"|"travel_time"|"isochrone")\s*:/i.test(text)) throw new Error('Citywide readiness contains private or decision fields.');
  return Object.freeze(structuredClone(value));
}

export async function writeHomeCompareCitywideReadiness(outputPath, readiness, { workspace=process.cwd() }={}) { const target=await outputTarget(outputPath,workspace); const content=Buffer.from(`${JSON.stringify(validateHomeCompareCitywideReadiness(readiness),null,2)}\n`); try { const current=await fs.readFile(target); if(current.equals(content)) return Object.freeze({status:'idempotent',outputPath:target,bytes:current.length}); throw new Error('Home Compare citywide readiness output already exists with different bytes; refusing overwrite.'); } catch(error){if(error?.code!=='ENOENT')throw error;} await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content,{flag:'wx'}); return Object.freeze({status:'published',outputPath:target,bytes:content.length}); }
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
function sourceLimitations(receipt){return [`${receipt.evidence_kind}; citywide aggregate metadata only.`,...receipt.dq.flags.slice(0,2)];}
function exact(v,k,l){if(!v||typeof v!=='object'||Array.isArray(v)||stable(Object.keys(v).sort())!==stable([...k].sort()))throw new Error(`${l} contains unknown or missing fields.`)} function positive(n){return Number.isSafeInteger(n)&&n>0} function hash(v){return `sha256:${createHash('sha256').update(v).digest('hex')}`} function identityOf(v){return hash(Buffer.from(stable(v)))} function stable(v){if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;return JSON.stringify(v)}
