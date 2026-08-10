const VIEW_MODES = new Set(['map', 'list']);
const PRIVATE_DIARY_QUERY_KEYS = Object.freeze([
  'route',
  'routeId',
  'diaryRoute',
  'diaryRouteId',
  'selectedRouteId',
]);

function toUrl(value) {
  if (value instanceof URL) return new URL(value.href);
  const text = String(value || '');
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return new URL(text);
  return new URL(text.startsWith('?') ? `https://local.invalid/${text}` : `https://local.invalid/?${text}`);
}

export function normalizeCrimeViewMode(value) {
  return VIEW_MODES.has(value) ? value : 'map';
}

export function readCrimeViewMode(value = globalThis.location?.href || '') {
  const url = toUrl(value);
  if (url.searchParams.get('mode') === 'diary') return 'map';
  return normalizeCrimeViewMode(url.searchParams.get('view'));
}

export function writeCrimeViewMode(href, mode) {
  const url = toUrl(href);
  for (const key of PRIVATE_DIARY_QUERY_KEYS) url.searchParams.delete(key);
  url.searchParams.set('view', normalizeCrimeViewMode(mode));
  return url.href;
}

export function createCrimeViewModeController({
  getHref = () => globalThis.location?.href || '',
  replaceHref = (href) => globalThis.history?.replaceState?.({}, '', href),
  addEventListener = (...args) => globalThis.addEventListener?.(...args),
  removeEventListener = (...args) => globalThis.removeEventListener?.(...args),
  onChange = () => {},
} = {}) {
  let mode = readCrimeViewMode(getHref());

  const publish = (nextMode, origin) => {
    const normalized = normalizeCrimeViewMode(nextMode);
    const changed = normalized !== mode;
    mode = normalized;
    if (changed || origin === 'history') onChange(mode, { origin });
    return mode;
  };

  const onPopState = () => publish(readCrimeViewMode(getHref()), 'history');
  addEventListener?.('popstate', onPopState);

  return Object.freeze({
    getMode: () => mode,
    setMode(nextMode, { write = true, origin = 'user' } = {}) {
      const normalized = normalizeCrimeViewMode(nextMode);
      if (write) replaceHref(writeCrimeViewMode(getHref(), normalized));
      return publish(normalized, origin);
    },
    sync() {
      return publish(readCrimeViewMode(getHref()), 'history');
    },
    destroy() {
      removeEventListener?.('popstate', onPopState);
    },
  });
}
