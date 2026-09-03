export function createDiaryFormPort({
  loadModule = () => import('./form_submit.js'),
} = {}) {
  let loadedModule = null;
  let pendingModule = null;

  const load = () => {
    if (loadedModule) return Promise.resolve(loadedModule);
    if (!pendingModule) {
      const ownedRequest = Promise.resolve().then(() => loadModule());
      pendingModule = ownedRequest
        .then((module) => {
          loadedModule = module;
          return module;
        })
        .catch((error) => {
          if (pendingModule) pendingModule = null;
          throw error;
        });
    }
    return pendingModule;
  };

  return {
    load,
    async openRatingModal(options) {
      const module = await load();
      if (options?.signal?.aborted || (options?.isCurrent && !options.isCurrent())) return false;
      return module.openRatingModal(options);
    },
    closeRatingModal(options) {
      return loadedModule?.closeRatingModal(options);
    },
    async submitSegmentFeedback(payload, options) {
      const module = await load();
      if (options?.signal?.aborted || (options?.isCurrent && !options.isCurrent())) {
        return { applied: false, reason: 'stale' };
      }
      return module.submitSegmentFeedback(payload, options);
    },
    isLoaded() {
      return Boolean(loadedModule);
    },
  };
}

const diaryFormPort = createDiaryFormPort();

export const openRatingModal = (...args) => diaryFormPort.openRatingModal(...args);
export const closeRatingModal = (...args) => diaryFormPort.closeRatingModal(...args);
export const submitSegmentFeedback = (...args) => diaryFormPort.submitSegmentFeedback(...args);
