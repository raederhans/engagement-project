#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateAreaIntelligence } from './lib/area_intelligence_evaluation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await main();

async function main() {
  let memorySampler;
  try {
    const args = parseArgs(process.argv.slice(2));
    const martRoot = path.resolve(root, args.mart || '.dfev1/area-intelligence/m2-baseline');
    const outputRoot = path.resolve(root, args.output);
    const startedAt = Date.now();
    let peakRss = process.memoryUsage().rss;
    memorySampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 1000);
    memorySampler.unref();
    const result = await evaluateAreaIntelligence({
      martRoot,
      outputRoot,
      protocolPath: path.resolve(root, 'scripts/data/area_intelligence_evaluation_protocol.v2.json'),
      onProgress(event) {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        process.stdout.write(`${JSON.stringify({ event: 'area-intelligence-evaluation-progress', ...event })}\n`);
      },
    });
    process.stdout.write(`${JSON.stringify({
      event: 'area-intelligence-evaluation-result',
      status: result.idempotent ? 'idempotent' : 'evaluated',
      promotion: result.manifest.promotion.status,
      decision: result.manifest.promotion.decision,
      local_candidate_model: result.manifest.promotion.local_candidate_model,
      selected_model: null,
      elapsed_ms: Date.now() - startedAt,
      peak_rss_bytes: peakRss,
    }, null, 2)}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${JSON.stringify({
      event: 'area-intelligence-evaluation-error',
      error: {
        code: safeErrorCode(error),
        message: 'Area Intelligence evaluation failed closed; inspect local diagnostics without publishing raw paths or rows.',
      },
    })}\n`);
  } finally {
    if (memorySampler) clearInterval(memorySampler);
  }
}

export function parseArgs(values) {
  const allowed = new Set(['mart', 'output']);
  const parsed = {};
  for (const entry of values) {
    if (typeof entry !== 'string' || !entry.startsWith('--') || !entry.includes('=')) {
      throw cliError('argument-syntax-invalid');
    }
    const separator = entry.indexOf('=');
    const key = entry.slice(2, separator);
    const value = entry.slice(separator + 1);
    if (!allowed.has(key)) throw cliError('argument-unknown');
    if (Object.hasOwn(parsed, key)) throw cliError('argument-duplicate');
    if (value.trim() === '') throw cliError('argument-empty');
    parsed[key] = value;
  }
  if (!parsed.output) throw cliError('output-required');
  return parsed;
}

function cliError(code) {
  const error = new Error('Area Intelligence evaluation CLI argument rejected.');
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  if (/^[a-z0-9-]{3,80}$/.test(error?.code || '')) return error.code;
  if (/task-owned \.dfev1/.test(error?.message || '')) return 'output-not-task-owned';
  return 'evaluation-preflight-failed';
}
