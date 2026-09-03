import './styles.css';

export function createHomeCompareLoader({ dialog, opener } = {}) {
  if (!dialog || !opener) throw new TypeError('Missing Home Compare setup.');
  let controllerPromise;

  dialog.addEventListener('close', () => {
    controllerPromise?.then((owner) => owner.destroy());
    controllerPromise = null;
  });

  function ensureController() {
    return controllerPromise ||= import('./controller.js')
        .then((module) => module.createHomeCompareController({ dialog }))
        .catch((error) => {
          controllerPromise = null;
          throw error;
        });
  }

  return Object.freeze({
    async open() {
      const owner = await ensureController();
      owner.open({ opener });
      return owner;
    },
  });
}
