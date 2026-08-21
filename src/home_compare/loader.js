export function createHomeCompareLoader({ dialog, opener } = {}) {
  if (!dialog || !opener) throw new TypeError('Home Compare loader requires a dialog and opener.');
  let controller = null;
  let controllerPromise = null;

  async function ensureController() {
    if (controller) return controller;
    if (!controllerPromise) {
      controllerPromise = import('./controller.js')
        .then((module) => module.createHomeCompareController({ dialog }))
        .then((owner) => {
          controller = owner;
          return owner;
        })
        .catch((error) => {
          controllerPromise = null;
          throw error;
        });
    }
    return controllerPromise;
  }

  return Object.freeze({
    async open() {
      const owner = await ensureController();
      owner.open({ opener });
      return owner;
    },
  });
}
