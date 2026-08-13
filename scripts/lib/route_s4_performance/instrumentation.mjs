import { types as utilTypes } from 'node:util';

import { ROUTE_S4_PERFORMANCE_PROTOCOL } from './contracts.mjs';

export const ROUTE_S4_STAGE_INSTRUMENTATION_VERSION = 'route-s4-stage-instrumentation/v1';
const COLLECTORS = new WeakSet();

export function createRouteS4StageInstrumentation(input = Object.create(null)) {
  const configuration = admitConfiguration(input);
  const clock = configuration.clock ?? (() => process.hrtime.bigint());
  const readMemory = configuration.readMemory ?? (() => process.memoryUsage());
  const errorCodeFor = configuration.errorCodeFor ?? (() => 'stage-operation-failed');
  if (typeof clock !== 'function' || typeof readMemory !== 'function' || typeof errorCodeFor !== 'function') {
    throw new TypeError('clock, readMemory, and errorCodeFor must be functions');
  }
  const collector = Object.freeze({
    async run(stageOperations, runInput = Object.create(null)) {
      const signal = admitRunOptions(runInput);
      const operations = admitOperations(stageOperations);
      const baseline = memory(readMemory(), 'sample baseline');
      let peakRss = baseline.rss;
      let peakHeap = baseline.heapUsed;
      const stages = [];
      const businessResults = Object.create(null);

      for (const stageId of ROUTE_S4_PERFORMANCE_PROTOCOL.stages) {
        if (readAbort(signal)) return finish('stopped', stopCode(), completedStageId());
        observeMemory();
        const started = time(clock(), `${stageId} start`);
        try {
          businessResults[stageId] = await operations[stageId]();
        } catch (error) {
          const ended = time(clock(), `${stageId} end`);
          observeMemory();
          stages.push(stage(stageId, started, ended));
          return readAbort(signal)
            ? finish('stopped', stopCode(), stageId)
            : finish('failure', boundedErrorCode(errorCodeFor(error, stageId)), stageId);
        }
        const ended = time(clock(), `${stageId} end`);
        observeMemory();
        stages.push(stage(stageId, started, ended));
        if (readAbort(signal)) return finish('stopped', stopCode(), stageId);
      }
      if (readAbort(signal)) return finish('stopped', stopCode(), completedStageId());
      return finish('success', null, completedStageId());

      function observeMemory() {
        const observed = memory(readMemory(), 'stage boundary');
        peakRss = Math.max(peakRss, observed.rss);
        peakHeap = Math.max(peakHeap, observed.heapUsed);
      }

      function completedStageId() { return stages.length ? stages.at(-1).stageId : null; }

      function finish(outcome, errorCode, completedStage) {
        const evidence = deepFreeze({
          collectorVersion: ROUTE_S4_STAGE_INSTRUMENTATION_VERSION,
          outcome,
          errorCode,
          completedStageId: completedStage,
          stages: stages.map((value) => ({ ...value })),
          totalDurationNanoseconds: stages.reduce((sum, value) => sum + value.durationNanoseconds, 0),
          memory: {
            baselineRssBytes: baseline.rss, baselineHeapUsedBytes: baseline.heapUsed,
            peakRssBytes: peakRss, peakHeapUsedBytes: peakHeap,
            rssDeltaBytes: Math.max(0, peakRss - baseline.rss),
            heapUsedDeltaBytes: Math.max(0, peakHeap - baseline.heapUsed),
          },
        });
        return Object.freeze({ evidence, businessResults: Object.freeze({ ...businessResults }) });
      }
    },
  });
  COLLECTORS.add(collector);
  return collector;
}

export function assertRouteS4StageInstrumentation(value) {
  if (!COLLECTORS.has(value)) throw new TypeError('collector is not minted by route-s4 stage instrumentation');
}

function admitOperations(value) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value)) throw new TypeError('stageOperations must be a non-Proxy object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('stageOperations must have a plain prototype');
  const keys = Reflect.ownKeys(value);
  const expected = ROUTE_S4_PERFORMANCE_PROTOCOL.stages;
  if (keys.some((key) => typeof key === 'symbol') || keys.sort().join('\0') !== [...expected].sort().join('\0')) {
    throw new TypeError(`stageOperations must have exact stages: ${expected.join(', ')}`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = Object.create(null);
  for (const stageId of expected) {
    const descriptor = descriptors[stageId];
    if (!descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new TypeError(`${stageId} must be an enumerable function data property`);
    }
    output[stageId] = descriptor.value;
  }
  return output;
}

function admitConfiguration(value) {
  return descriptorOptions(value, ['clock', 'readMemory', 'errorCodeFor'], false, 'instrumentation options');
}

function admitRunOptions(value) {
  return descriptorOptions(value, ['signal'], false, 'run options').signal ?? null;
}

function descriptorOptions(value, allowed, requireAll, label) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value)) throw new TypeError(`${label} must be a non-Proxy object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must have a plain prototype`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.some((key) => !allowed.includes(key))) throw new TypeError(`${label} has invalid keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = Object.create(null);
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor) {
      if (requireAll) throw new TypeError(`${label}.${key} is required`);
      continue;
    }
    if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${label}.${key} must be an enumerable data property`);
    output[key] = descriptor.value;
  }
  return output;
}

function readAbort(signal) {
  if (signal === null) return false;
  if (!signal || typeof signal !== 'object' || utilTypes.isProxy(signal)) {
    throw new TypeError('signal must be non-Proxy plain abort data');
  }
  const prototype = Object.getPrototypeOf(signal);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('signal must have a plain prototype');
  }
  const keys = Reflect.ownKeys(signal);
  if (keys.length !== 1 || keys[0] !== 'aborted') {
    throw new TypeError('signal must have exact aborted key');
  }
  const aborted = Object.getOwnPropertyDescriptor(signal, 'aborted');
  if (!aborted?.enumerable || !('value' in aborted) || typeof aborted.value !== 'boolean') {
    throw new TypeError('signal.aborted must be an enumerable own boolean data property');
  }
  return aborted.value;
}

function stopCode() { return 'collection-aborted'; }
function boundedErrorCode(value) { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('errorCodeFor returned an invalid code'); return value; }
function stage(stageId, start, end) { if (end < start) throw new TypeError(`clock moved backwards during ${stageId}`); const duration = end - start; if (duration > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('duration exceeds safe integer'); return { stageId, durationNanoseconds: Number(duration) }; }
function time(value, label) { if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${label} must be a non-negative bigint`); return value; }
function memory(value, label) { if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} memory must be non-Proxy plain data`); const keys = Reflect.ownKeys(value); if (keys.some((key) => typeof key === 'symbol') || keys.sort().join('\0') !== ['heapUsed', 'rss'].join('\0')) throw new TypeError(`${label} memory must have exact rss and heapUsed keys`); const descriptors = Object.getOwnPropertyDescriptors(value); const output = {}; for (const key of ['rss', 'heapUsed']) { const descriptor = descriptors[key]; if (!descriptor.enumerable || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw new TypeError(`${label}.${key} is invalid`); output[key] = descriptor.value; } return output; }
function deepFreeze(value) { Object.freeze(value); for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ('value' in descriptor && descriptor.value && typeof descriptor.value === 'object') deepFreeze(descriptor.value); return value; }
