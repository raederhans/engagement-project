const defaultCleanupErrorReporter = (error) => {
  console.error('[Diary] Cleanup failed.', error);
};

export function runCleanupSteps(steps, reportError = defaultCleanupErrorReporter) {
  for (const step of steps) {
    if (typeof step !== 'function') continue;
    try {
      step();
    } catch (error) {
      try { reportError(error); } catch {}
    }
  }
}

export function createDiarySession({
  scheduler = globalThis,
  reportError = defaultCleanupErrorReporter,
  ownerSignal,
} = {}) {
  const cleanups = new Set();
  const timeoutOwners = new Map();
  const intervalOwners = new Map();
  const controller = new AbortController();
  let active = true;

  function ownCleanup(cleanup) {
    let called = false;
    const ownedCleanup = () => {
      if (called) return;
      called = true;
      cleanups.delete(ownedCleanup);
      cleanup();
    };
    const release = () => {
      if (called) return;
      called = true;
      cleanups.delete(ownedCleanup);
    };
    if (!active) {
      ownedCleanup();
      return { run: ownedCleanup, release };
    }
    cleanups.add(ownedCleanup);
    return { run: ownedCleanup, release };
  }

  function addCleanup(cleanup) {
    if (typeof cleanup !== 'function') return cleanup;
    return ownCleanup(cleanup).run;
  }

  function dispose(reason) {
    if (!active) return;
    active = false;
    controller.abort(reason);
    runCleanupSteps([...cleanups], reportError);
    cleanups.clear();
  }

  if (ownerSignal?.aborted) {
    dispose(ownerSignal.reason);
  } else if (ownerSignal) {
    const handleOwnerAbort = () => dispose(ownerSignal.reason);
    ownerSignal.addEventListener('abort', handleOwnerAbort, { once: true });
    addCleanup(() => ownerSignal.removeEventListener('abort', handleOwnerAbort));
  }

  return {
    signal: controller.signal,
    isActive() {
      return active;
    },
    setTimeout(callback, delay, ...args) {
      const wrapped = (...callbackArgs) => {
        const owner = timeoutOwners.get(id);
        owner?.release();
        timeoutOwners.delete(id);
        if (active) callback(...callbackArgs);
      };
      const id = scheduler.setTimeout(wrapped, delay, ...args);
      const owner = ownCleanup(() => {
        timeoutOwners.delete(id);
        scheduler.clearTimeout(id);
      });
      timeoutOwners.set(id, owner);
      return id;
    },
    clearTimeout(id) {
      timeoutOwners.get(id)?.run();
    },
    setInterval(callback, delay, ...args) {
      const wrapped = (...callbackArgs) => {
        if (active) callback(...callbackArgs);
      };
      const id = scheduler.setInterval(wrapped, delay, ...args);
      const owner = ownCleanup(() => {
        intervalOwners.delete(id);
        scheduler.clearInterval(id);
      });
      intervalOwners.set(id, owner);
      return id;
    },
    clearInterval(id) {
      intervalOwners.get(id)?.run();
    },
    listen(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      return addCleanup(() => target.removeEventListener(type, listener, options));
    },
    addCleanup,
    dispose,
  };
}

export function releaseOwnedReference(currentReference, cleanedReference) {
  return currentReference === cleanedReference ? null : currentReference;
}
