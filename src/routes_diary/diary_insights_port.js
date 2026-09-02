export function createDiaryInsightsPort(insights = {}) {
  return Object.freeze({
    setViewContext(context) {
      insights?.setViewContext?.(context);
    },
    refresh() {
      insights?.refresh?.();
    },
    setEntries(entries) {
      insights?.setEntries?.(entries);
    },
  });
}

export function installOwnedDebugGlobal(target, debugApi, addCleanup) {
  if (!target || !debugApi) return debugApi;
  target.__diary_debug = debugApi;
  const cleanup = () => {
    if (target.__diary_debug === debugApi) delete target.__diary_debug;
  };
  addCleanup?.(cleanup);
  return debugApi;
}

export function createDiaryInsightsLoader({ loadModule, createRoot, createHost }) {
  let modulePromise = null;
  let host = null;

  const loadCachedModule = () => {
    if (!modulePromise) {
      let ownedPromise;
      ownedPromise = Promise.resolve()
        .then(loadModule)
        .catch((error) => {
          if (modulePromise === ownedPromise) modulePromise = null;
          throw error;
        });
      modulePromise = ownedPromise;
    }
    return modulePromise;
  };

  return Object.freeze({
    async getHost({ signal, isCurrent = () => true } = {}) {
      let module;
      try {
        module = await waitForOwnedPromise(loadCachedModule(), signal);
      } catch (error) {
        if (signal?.aborted) return null;
        throw error;
      }
      if (signal?.aborted || !isCurrent()) return null;
      if (!host) {
        const root = createRoot();
        host = createHost(module, root);
      }
      return host;
    },
  });
}
import { waitForOwnedPromise } from '../utils/latest_serial_queue.js';
