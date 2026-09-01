import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildShadowForecastArtifact,
  strictJsonParse,
} from './lib/ml_shadow_bridge/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('M7 shadow bridge requires --flag value pairs.');
    values[flag.slice(2)] = value;
  }
  for (const required of ['admission', 'output']) {
    if (!values[required]) throw new Error(`M7 shadow bridge requires --${required}.`);
  }
  return values;
}

async function readStrict(filePath) {
  return strictJsonParse(await fs.readFile(path.resolve(filePath), 'utf8'));
}

function assertTaskOwnedOutput(output) {
  const resolved = path.resolve(output);
  const publicRoot = path.join(REPO_ROOT, 'public');
  if (resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`)
    || path.basename(resolved) === 'area_intelligence_baseline.v2.json') {
    throw new Error('M7 shadow bridge refuses production/public serving targets.');
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildShadowForecastArtifact({
    receipt: await readStrict(args.admission),
    benchmark: args.benchmark ? await readStrict(args.benchmark) : null,
    calibration: args.calibration ? await readStrict(args.calibration) : null,
    modelCard: args['model-card'] ? await readStrict(args['model-card']) : null,
  });
  const output = assertTaskOwnedOutput(args.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await fs.rename(temporary, output);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ decision: artifact.decision, artifact_identity: artifact.artifact_identity })}\n`);
}

main().catch((error) => {
  process.stderr.write(`project-ml-shadow-forecast: ${error.message}\n`);
  process.exitCode = 2;
});
