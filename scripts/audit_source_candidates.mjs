#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditSourceCandidates,
  formatSourceCandidateAudit,
  writeSourceCandidateAudit,
} from './lib/source_candidate_audit.mjs';

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outputDirectory = path.resolve(options.outputDirectory || path.join('.source-audit', 'candidates'));
  const report = await auditSourceCandidates({
    outputDirectory,
    observedAt: options.observedAt || new Date().toISOString(),
  });
  await writeSourceCandidateAudit(outputDirectory, report);
  console.log(formatSourceCandidateAudit(report));
  if (report.status === 'review-required') process.exitCode = 2;
  else if (report.status === 'failed') process.exitCode = 1;
  return report;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith('--output-dir=')) {
      options.outputDirectory = argument.slice('--output-dir='.length);
    } else if (argument === '--output-dir') {
      options.outputDirectory = args[++index];
    } else if (argument.startsWith('--observed-at=')) {
      options.observedAt = argument.slice('--observed-at='.length);
    } else if (argument === '--observed-at') {
      options.observedAt = args[++index];
    } else {
      throw new Error(`Unknown source candidate audit option: ${argument}`);
    }
  }
  if (options.outputDirectory === undefined && args.includes('--output-dir')) {
    throw new Error('--output-dir requires a value');
  }
  if (options.observedAt === undefined && args.includes('--observed-at')) {
    throw new Error('--observed-at requires a value');
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[source-candidate-audit] ${error?.stack || error}`);
    process.exitCode = 1;
  });
}
