import { createHook } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const ESCAPE_RESOURCE_TYPES = new Set([
  'TCPCONNECTWRAP',
  'TCPWRAP',
  'TLSWRAP',
  'UDPWRAP',
  'UDPSENDWRAP',
  'GETADDRINFOREQWRAP',
  'GETNAMEINFOREQWRAP',
  'HTTPCLIENTREQUEST',
  'PROCESSWRAP',
  'WORKER',
]);

export const RUNTIME_ESCAPE_MEASUREMENT = 'runner-owned-node-async-hooks-fetch-attempt-detector';
export const RUNTIME_ESCAPE_OBSERVER_IDENTITY = `sha256:${createHash('sha256')
  .update('mainline-m7-node-runtime-escape-attempt-observer/v1', 'utf8')
  .digest('hex')}`;

/** Count escape attempts independently of the benchmarked companion. */
export async function observeRuntimeEscapes(operation) {
  if (typeof operation !== 'function') throw new TypeError('runtime observer operation must be a function');
  const events = [];
  const hook = createHook({
    init(asyncId, type) {
      if (ESCAPE_RESOURCE_TYPES.has(type)) events.push(Object.freeze({ asyncId, type }));
    },
  });
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let fetchPatched = false;
  try {
    if (typeof globalThis.fetch === 'function'
      && (!originalFetchDescriptor || originalFetchDescriptor.writable || originalFetchDescriptor.set)) {
      globalThis.fetch = async function blockedBenchmarkFetch() {
        events.push(Object.freeze({ asyncId: null, type: 'FETCH' }));
        throw new Error('formal local benchmark blocks fetch');
      };
      fetchPatched = true;
    }
    hook.enable();
    const value = await operation();
    return Object.freeze({
      value,
      measurementStatus: 'observed',
      enforcement: 'attempt-detection-only',
      observerIdentity: RUNTIME_ESCAPE_OBSERVER_IDENTITY,
      egressCount: events.length,
      eventTypes: Object.freeze(events.map(({ type }) => type)),
      measurement: RUNTIME_ESCAPE_MEASUREMENT,
    });
  } finally {
    hook.disable();
    if (fetchPatched) {
      if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
      else delete globalThis.fetch;
    }
  }
}
