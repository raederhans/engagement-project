import { createHash } from 'node:crypto';

import {
  ROUTE_S4_PERFORMANCE_PROTOCOL,
  ROUTE_S4_PERFORMANCE_VERSIONS,
  createRouteS4StageInstrumentation,
  expectedRouteS4PerformanceSchedule,
} from '../../lib/route_s4_performance/index.mjs';

export function syntheticArtifacts() {
  return {
    algorithm: { kind: 'synthetic-algorithm' },
    graph: { kind: 'synthetic-graph' },
    policy: { kind: 'synthetic-policy' },
    requestSet: { kind: 'synthetic-request-set' },
    adapter: { kind: 'synthetic-adapter' },
  };
}

export function syntheticReferenceEnvironment(kind = 'synthetic-contract-probe') {
  return {
    schemaVersion: ROUTE_S4_PERFORMANCE_VERSIONS.referenceEnvironment,
    environmentId: 'synthetic-contract-probe', environmentKind: kind,
    capturedAt: '2026-08-13T00:00:00.000Z',
    operatingSystem: { platform: 'synthetic', release: 'contract-probe', architecture: 'synthetic-64' },
    runtime: { implementation: 'node', nodeVersion: 'synthetic-node', v8Version: 'synthetic-v8' },
    hardware: { cpuModel: 'synthetic-cpu', logicalCpuCount: 1, memoryBytes: 1024 },
    process: { execArgv: [], nodeOptions: null, timezone: 'Etc/UTC' },
    isolation: { network: 'disabled', backgroundLoad: 'controlled-and-recorded', powerMode: 'fixed-and-recorded' },
  };
}

export function syntheticAttempt(mode = 'diagnostic-dry-run', artifacts = syntheticArtifacts()) {
  const kind = mode === 'gate-eligible' ? 'measured-reference' : 'synthetic-contract-probe';
  return {
    schemaVersion: ROUTE_S4_PERFORMANCE_VERSIONS.attempt,
    attemptId: `synthetic-${mode}`, mode,
    preregisteredAt: '2026-08-13T00:00:00.000Z',
    protocol: structuredClone(ROUTE_S4_PERFORMANCE_PROTOCOL),
    referenceEnvironment: syntheticReferenceEnvironment(kind),
    bindings: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [
      `${key}Identity`, `sha256:${createHash('sha256').update(canonical(artifact)).digest('hex')}`,
    ])),
    schedule: structuredClone(expectedRouteS4PerformanceSchedule()),
  };
}

export function deterministicCollector({ onStage = null } = {}) {
  let time = 0n;
  let memory = 100;
  return createRouteS4StageInstrumentation({
    clock: () => { time += 1n; return time; },
    readMemory: () => { memory += 1; return { rss: memory, heapUsed: memory }; },
    errorCodeFor: () => 'synthetic-stage-failure',
  });
}

export function syntheticOperations(callback = null) {
  return Object.fromEntries(ROUTE_S4_PERFORMANCE_PROTOCOL.stages.map((stageId) => [stageId, async () => {
    callback?.(stageId);
    return { mutableBusinessResult: stageId };
  }]));
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
