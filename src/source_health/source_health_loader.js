/** Owns the explicit lazy boundary for the text-first Data Status surface. */
import { t } from '../i18n/index.js';

export function createSourceHealthLoader({
  mount,
  loadUi,
  getRuntimeEvidence = () => ({}),
  warn = (...args) => console.warn(...args),
} = {}) {
  const host = mount?.querySelector?.('[data-source-health-host]');
  const status = mount?.querySelector?.('[data-source-health-loader-status]');
  const retry = mount?.querySelector?.('[data-source-health-retry]');
  const expand = mount?.querySelector?.('[data-source-workspace-open]');
  const dialog = mount?.querySelector?.('#source-workspace-dialog');
  const close = mount?.querySelector?.('[data-source-workspace-close]');
  const content = mount?.querySelector?.('[data-source-workspace-content]');
  let promise = null;
  let controller = null;

  const setState = (state, message = '') => {
    if (mount?.dataset) mount.dataset.sourceHealthLoader = state;
    if (status) {
      status.hidden = !message;
      status.textContent = message;
    }
    if (retry) retry.hidden = state !== 'unavailable';
    if (host) host.setAttribute?.('aria-busy', String(state === 'loading'));
  };

  const load = () => {
    if (controller) {
      controller.refresh?.(getRuntimeEvidence());
      return Promise.resolve(controller);
    }
    if (!promise) {
      setState('loading', t('sourceHealth.loading'));
      promise = loadUi()
        .then((module) => {
          controller = module.initSourceHealthSurface({
            host,
            getRuntimeEvidence,
          });
          setState('ready');
          return controller;
        })
        .catch((error) => {
          promise = null;
          setState('unavailable', t('sourceHealth.failed'));
          warn('Data Status surface is unavailable:', error);
          return null;
        });
    }
    return promise;
  };

  const onToggle = () => {
    if (mount?.open) void load();
  };
  const onRetry = () => { void load(); };
  const onExpand = async () => {
    if (!dialog || !content || !host) return;
    const ready = await load();
    if (!ready || dialog.open) return;
    content.append(host);
    dialog.showModal();
  };
  const onClose = () => {
    if (host && dialog) dialog.before(host);
    expand?.focus();
  };
  const closeWorkspace = () => dialog?.close();
  expand?.addEventListener?.('click', onExpand);
  close?.addEventListener?.('click', closeWorkspace);
  dialog?.addEventListener?.('close', onClose);
  mount?.addEventListener?.('toggle', onToggle);
  retry?.addEventListener?.('click', onRetry);
  setState('idle');

  return Object.freeze({
    open() {
      if (mount) mount.open = true;
      return load();
    },
    whenIdle: () => promise || Promise.resolve(controller),
    refresh: () => controller?.refresh?.(getRuntimeEvidence()),
    dispose() {
      controller?.dispose?.();
      mount?.removeEventListener?.('toggle', onToggle);
      retry?.removeEventListener?.('click', onRetry);
      expand?.removeEventListener?.('click', onExpand);
      close?.removeEventListener?.('click', closeWorkspace);
      dialog?.removeEventListener?.('close', onClose);
    },
  });
}
