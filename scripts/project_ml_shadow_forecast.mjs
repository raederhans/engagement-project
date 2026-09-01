import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildShadowForecastArtifact,
  strictJsonParse,
} from './lib/ml_shadow_bridge/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS_ROOT = path.join(REPO_ROOT, 'ml', '.artifacts');
const OUTPUT_FILENAME = 'shadow-forecast-artifact.json';
const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const WINDOWS_RESERVED_RUN_IDS = new Set([
  'AUX', 'CON', 'NUL', 'PRN',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);
const execFileAsync = promisify(execFile);

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

async function assertTaskOwnedOutput(output) {
  const resolved = path.resolve(output);
  const relative = path.relative(ARTIFACTS_ROOT, resolved);
  const segments = relative.split(path.sep);
  const deviceStem = segments[0]?.split('.', 1)[0].toUpperCase();
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
    || segments.length !== 2 || !RUN_ID_PATTERN.test(segments[0])
    || segments[0].endsWith('.') || WINDOWS_RESERVED_RUN_IDS.has(deviceStem)
    || segments[1] !== OUTPUT_FILENAME) {
    throw new Error(`M7 shadow bridge output must be repo/ml/.artifacts/<run-id>/${OUTPUT_FILENAME}.`);
  }

  const artifactsRoot = await assertRealDirectory(ARTIFACTS_ROOT, 'artifact root');
  const parent = path.dirname(resolved);
  const realParent = await assertRealDirectory(parent, 'output parent');
  if (!sameResolvedPath(path.dirname(realParent), artifactsRoot)) {
    throw new Error('M7 shadow bridge output parent resolved outside the task artifact root.');
  }
  await assertMissing(resolved, 'M7 shadow bridge output must not already exist.');
  try {
    await execFileAsync('git', [
      'check-ignore', '--quiet', '--no-index', '--', path.relative(REPO_ROOT, resolved),
    ], { cwd: REPO_ROOT, windowsHide: true });
  } catch {
    throw new Error('M7 shadow bridge output must be ignored by Git.');
  }
  try {
    await execFileAsync('git', [
      'ls-files', '--error-unmatch', '--', path.relative(REPO_ROOT, resolved),
    ], { cwd: REPO_ROOT, windowsHide: true });
  } catch {
    return Object.freeze({ resolved, parent, realParent, artifactsRoot });
  }
  throw new Error('M7 shadow bridge output must not overlap tracked repository content.');
}

async function assertRealDirectory(directory, label) {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`M7 shadow bridge ${label} must be an existing real directory.`);
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`M7 shadow bridge ${label} must be an existing real directory.`);
  }
  const real = await fs.realpath(directory);
  if (!sameResolvedPath(real, directory)) {
    throw new Error(`M7 shadow bridge ${label} must not contain a link or reparse redirect.`);
  }
  return real;
}

async function assertMissing(target, message) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(message);
}

function sameResolvedPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function writeTaskOwnedArtifact(output, contents) {
  const admitted = await assertTaskOwnedOutput(output);
  const temporary = path.join(
    admitted.parent,
    `.${OUTPUT_FILENAME}.tmp-${process.pid}-${Date.now()}`,
  );
  let temporaryCreated = false;
  try {
    await fs.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    temporaryCreated = true;
    const [temporaryStat, temporaryReal, currentParent] = await Promise.all([
      fs.lstat(temporary),
      fs.realpath(temporary),
      assertRealDirectory(admitted.parent, 'output parent'),
    ]);
    if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()
      || !sameResolvedPath(temporaryReal, temporary)
      || !sameResolvedPath(currentParent, admitted.realParent)
      || !sameResolvedPath(path.dirname(currentParent), admitted.artifactsRoot)) {
      throw new Error('M7 shadow bridge output path changed before publication.');
    }
    await fs.link(temporary, admitted.resolved);
    const publishedStat = await fs.lstat(admitted.resolved);
    if (!publishedStat.isFile() || publishedStat.isSymbolicLink()) {
      throw new Error('M7 shadow bridge published output is not a regular file.');
    }
  } finally {
    if (temporaryCreated) await fs.rm(temporary, { force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildShadowForecastArtifact({
    receipt: await readStrict(args.admission),
    benchmark: args.benchmark ? await readStrict(args.benchmark) : null,
    calibration: args.calibration ? await readStrict(args.calibration) : null,
    modelCard: args['model-card'] ? await readStrict(args['model-card']) : null,
  });
  await writeTaskOwnedArtifact(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ decision: artifact.decision, artifact_identity: artifact.artifact_identity })}\n`);
}

main().catch((error) => {
  process.stderr.write(`project-ml-shadow-forecast: ${error.message}\n`);
  process.exitCode = 2;
});
