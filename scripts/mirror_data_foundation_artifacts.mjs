#!/usr/bin/env node
import { mirrorDataFoundationArtifacts } from './lib/data_foundation_artifact_mirror/index.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await mirrorDataFoundationArtifacts({
    bundleDir: options['bundle-dir'],
    m1SourceRoot: options['m1-source-root'],
    m2SourceRoot: options['m2-source-root'],
    protocolSource: options['protocol-source'],
    mirrorRoot: options['mirror-root'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', code: error?.code || 'invalid-arguments' })}\n`);
  process.exitCode = 1;
}

function parseArguments(entries) {
  const required = ['bundle-dir', 'm1-source-root', 'm2-source-root', 'protocol-source', 'mirror-root'];
  const options = {};
  for (const entry of entries) {
    const match = /^--([^=]+)=(.+)$/.exec(entry);
    if (!match || !required.includes(match[1]) || Object.hasOwn(options, match[1])) {
      const error = new Error('Arguments must be unique supported non-empty --name=value entries.');
      error.code = 'invalid-arguments';
      throw error;
    }
    options[match[1]] = match[2];
  }
  if (required.some((name) => !Object.hasOwn(options, name))) {
    const error = new Error('All mirror arguments are required.');
    error.code = 'missing-option';
    throw error;
  }
  return options;
}
