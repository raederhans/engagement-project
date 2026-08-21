#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateModelEvaluationReport } from './lib/area_intelligence_evaluation.mjs';
import { validateAreaIntelligenceServingArtifact } from '../src/area_intelligence/serving_contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const evaluationRoot = path.resolve(root, args.evaluation || '.dfev1/area-intelligence/m2-baseline/evaluation');
const manifest = JSON.parse(await fs.readFile(path.join(evaluationRoot, 'manifest.json'), 'utf8'));
if (manifest?.schema !== 'engagement-area-intelligence-evaluation-run/v1' || !Array.isArray(manifest.artifacts)) {
  throw new Error('Area Intelligence evaluation manifest is invalid or incomplete.');
}
for (const artifact of manifest.artifacts) {
  const source = path.join(evaluationRoot, artifact.name);
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size !== artifact.bytes || await hashFile(source) !== artifact.sha256) {
    throw new Error(`Area Intelligence evaluation artifact identity mismatch: ${artifact.name}`);
  }
}

const publication = [
  ['model-evaluation-report.json', 'reports/area-intelligence/model-evaluation-report.v1.json'],
  ['residual-map.json', 'reports/area-intelligence/residual-map.v1.json'],
  ['bias-error-audit.json', 'reports/area-intelligence/bias-error-audit.v1.json'],
  ['data-lineage-summary.json', 'reports/area-intelligence/data-lineage-summary.v1.json'],
  ['model-card.md', 'reports/area-intelligence/model-card.md'],
  ['serving-artifact.json', 'public/data/area_intelligence_baseline.v1.json'],
];
const staged = [];
for (const [sourceName, destinationName] of publication) {
  const source = path.join(evaluationRoot, sourceName);
  let contents = await fs.readFile(source, 'utf8');
  assertPrivacySafe(contents, sourceName);
  if (sourceName === 'model-evaluation-report.json') validateModelEvaluationReport(JSON.parse(contents));
  if (sourceName === 'serving-artifact.json') {
    const serving = validateAreaIntelligenceServingArtifact(JSON.parse(contents));
    contents = `${JSON.stringify({
      schema: serving.schema,
      generated_at: serving.generated_at,
      status: serving.status,
      historical_evidence: serving.historical_evidence,
      forecast: serving.forecast,
      evaluation: {
        promotion_status: serving.evaluation.promotion_status,
        selected_model: serving.evaluation.selected_model,
      },
      forbidden_claims: serving.forbidden_claims,
    })}\n`;
    validateAreaIntelligenceServingArtifact(JSON.parse(contents));
  }
  const destination = path.join(root, ...destinationName.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, 'utf8');
  staged.push({ destination, temporary, bytes: Buffer.byteLength(contents) });
}
for (const item of staged) await fs.rename(item.temporary, item.destination);
process.stdout.write(`${JSON.stringify({
  status: 'published-local-serving-candidate',
  promotion: manifest.promotion.status,
  files: staged.map((item) => ({ path: path.relative(root, item.destination).replaceAll('\\', '/'), bytes: item.bytes })),
  boundary: 'Local tracked artifacts only; not main, remote CI, runtime deployment, or scientific validity.',
}, null, 2)}\n`);

function assertPrivacySafe(contents, name) {
  if (/(?:[A-Za-z]:[\\/]+Users[\\/]+|file:\/\/\/|"(?:generalized_location|location_block|source_record_id|point_x|point_y)"\s*:)/i.test(contents)) {
    throw new Error(`Area Intelligence publication contains a forbidden local path or event-level field: ${name}`);
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function parseArgs(values) {
  return Object.fromEntries(values.map((entry) => {
    if (!entry.startsWith('--') || !entry.includes('=')) throw new Error(`Invalid argument: ${entry}`);
    const separator = entry.indexOf('=');
    return [entry.slice(2, separator), entry.slice(separator + 1)];
  }));
}
