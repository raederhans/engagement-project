const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;

/**
 * Wrap an already-instantiated local Node/libOSRM binding without using the
 * OSRM HTTP API. Coordinates remain in this process and are never encoded in
 * a URL, command argument, environment variable, or log entry.
 *
 * projectRouteContext must convert the local OSRM result into the existing
 * admitted GraphArtifact/CandidateSearchRequest input expected by the M7 core.
 */
export function createInProcessOsrmEngineAdapter({
  identity,
  osrm,
  projectRouteContext,
  candidateLimit = 3,
} = {}) {
  if (typeof identity !== 'string' || !ID_PATTERN.test(identity)) {
    throw new TypeError('in-process OSRM identity must be a bounded canonical id');
  }
  if (!osrm || typeof osrm.route !== 'function') {
    throw new TypeError('in-process OSRM binding must provide route(options, callback)');
  }
  if (typeof projectRouteContext !== 'function') {
    throw new TypeError('in-process OSRM adapter requires a route-context projector');
  }
  if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 5) {
    throw new TypeError('in-process OSRM candidateLimit must be between 1 and 5');
  }

  let nativeRouteInFlight = false;
  const invokeExclusiveRoute = (options, signal) => {
    if (signal?.aborted) {
      return Promise.reject(new Error('local in-process OSRM route generation aborted'));
    }
    if (nativeRouteInFlight) {
      return Promise.reject(new Error('local in-process OSRM route generation is still draining'));
    }
    nativeRouteInFlight = true;
    return invokeRoute(osrm, options, signal, () => {
      nativeRouteInFlight = false;
    });
  };

  return Object.freeze({
    identity,
    transport: Object.freeze({ kind: 'in-process' }),
    async generate(privateRequest, { signal = null } = {}) {
      const routeResult = await invokeExclusiveRoute(Object.freeze({
        coordinates: Object.freeze([
          Object.freeze([
            privateRequest.origin.longitude,
            privateRequest.origin.latitude,
          ]),
          Object.freeze([
            privateRequest.destination.longitude,
            privateRequest.destination.latitude,
          ]),
        ]),
        alternatives: candidateLimit,
        annotations: true,
        steps: false,
        overview: false,
      }), signal);
      return projectRouteContext(routeResult, Object.freeze({
        requestId: privateRequest.requestId,
        mode: privateRequest.mode,
        candidateLimit,
      }));
    },
  });
}

function invokeRoute(osrm, options, signal, onNativeSettled) {
  return new Promise((resolve, reject) => {
    let clientSettled = false;
    let nativeSettled = false;
    let removeAbortListener = null;
    const finishClient = (error, value) => {
      if (clientSettled) return;
      clientSettled = true;
      removeAbortListener?.();
      if (error) reject(new Error('local in-process OSRM route generation failed'));
      else resolve(value);
    };
    const finishNative = (error, value) => {
      if (nativeSettled) return;
      nativeSettled = true;
      onNativeSettled();
      finishClient(error, value);
    };
    if (signal) {
      if (signal.aborted) {
        onNativeSettled();
        finishClient(new Error('local in-process OSRM route generation aborted'));
        return;
      }
      const onAbort = () => finishClient(new Error('local in-process OSRM route generation aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
    try {
      osrm.route(options, finishNative);
    } catch {
      finishNative(new Error('local in-process OSRM route generation failed'));
    }
  });
}
