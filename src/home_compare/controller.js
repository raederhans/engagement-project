import { getLanguage, onLanguageChange } from '../i18n/index.js';
import {
  combineHomeCompareSources,
  fetchHomeProfileEvidence,
  loadHomeCompareRegistry,
  loadM2AreaIntelligenceBoundary,
  resolveHomePropertyAddress,
} from './api.js';
import {
  buildWeightSensitivity,
  createHomeCompareProjection,
  decodeHomeCompareShareState,
  encodeHomeCompareShareState,
  HOME_COMPARE_DIMENSIONS,
} from './contract.js';
import {
  getHomeCompareCopy,
  homeCompareProductHtml,
} from './view.js';

const DEFAULT_WEIGHTS = Object.freeze({
  property: 20,
  costHistory: 20,
  civicRecords: 20,
  transportContext: 20,
  dataQuality: 20,
});

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function createHomeCompareController({
  dialog,
  resolveAddress = resolveHomePropertyAddress,
  fetchEvidence = fetchHomeProfileEvidence,
  loadRegistry = loadHomeCompareRegistry,
  loadAreaIntelligence = loadM2AreaIntelligenceBoundary,
  loadResultsView = () => import('./results_view.js'),
  clipboard = globalThis.navigator?.clipboard,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
} = {}) {
  if (!dialog?.querySelector) throw new TypeError('Home Compare dialog is required.');
  const host = dialog.querySelector('[data-home-compare-host]');
  if (!host) throw new TypeError('Home Compare host is required.');

  const state = {
    addresses: ['', ''],
    destinations: '',
    weights: { ...DEFAULT_WEIGHTS },
    busy: false,
    status: 'idle',
    result: null,
    labels: [],
  };
  let returnFocus = null;
  let generation = 0;
  let requestController = null;
  let renderResults = null;

  applyShareStateFromUrl();

  function render() {
    const locale = getLanguage();
    const copy = getHomeCompareCopy(locale);
    host.innerHTML = homeCompareProductHtml({
      locale,
      addressCount: state.addresses.length,
      weights: state.weights,
      busy: state.busy,
    });
    state.addresses.forEach((value, index) => {
      const input = host.querySelector(`[data-home-address="${index}"]`);
      if (!input) return;
      input.value = value;
      input.addEventListener('input', () => {
        state.addresses[index] = input.value;
        invalidateResult();
      });
    });
    const destinationInput = host.querySelector('[data-home-destinations]');
    destinationInput.value = state.destinations;
    destinationInput.addEventListener('input', () => {
      state.destinations = destinationInput.value;
      invalidateResult();
    });
    for (const input of host.querySelectorAll('[data-home-weight]')) {
      input.addEventListener('input', () => {
        state.weights[input.dataset.homeWeight] = Number(input.value);
        const output = host.querySelector(`[data-home-weight-output="${input.dataset.homeWeight}"]`);
        if (output) output.textContent = input.value;
        invalidateResult();
      });
    }
    host.querySelector('[data-home-add]')?.addEventListener('click', addAddress);
    for (const button of host.querySelectorAll('[data-home-remove]')) {
      button.addEventListener('click', () => removeAddress(Number(button.dataset.homeRemove)));
    }
    host.querySelector('[data-home-run]')?.addEventListener('click', () => { void compare(); });
    host.querySelector('[data-home-retry-results]')?.addEventListener('click', () => { void compare(); });
    host.querySelector('[data-home-share]')?.addEventListener('click', () => { void shareSettings(); });
    host.querySelector('[data-home-close]')?.addEventListener('click', () => closeDialog(dialog));
    const status = host.querySelector('[data-home-status]');
    if (status) status.textContent = statusText(copy);
    const retryResults = host.querySelector('[data-home-retry-results]');
    if (retryResults) {
      retryResults.hidden = state.status !== 'results-unavailable';
      retryResults.disabled = state.busy;
    }
    const resultHost = host.querySelector('[data-home-results]');
    if (state.result && renderResults) {
      resultHost.innerHTML = renderResults(state.result, { labels: state.labels, locale });
    }
    dialog.setAttribute('aria-busy', String(state.busy));
  }

  function invalidateResult() {
    if (state.busy) return;
    state.result = null;
    state.labels = [];
    state.status = 'idle';
    host.querySelector('[data-home-results]')?.replaceChildren();
    const status = host.querySelector('[data-home-status]');
    if (status) status.textContent = getHomeCompareCopy(getLanguage()).idle;
  }

  function addAddress() {
    if (state.busy || state.addresses.length >= 4) return;
    state.addresses.push('');
    invalidateResult();
    render();
    host.querySelector(`[data-home-address="${state.addresses.length - 1}"]`)?.focus();
  }

  function removeAddress(index) {
    if (state.busy || state.addresses.length <= 2 || !Number.isInteger(index)) return;
    state.addresses.splice(index, 1);
    invalidateResult();
    render();
    host.querySelector(`[data-home-address="${Math.max(0, index - 1)}"]`)?.focus();
  }

  async function compare() {
    if (state.busy) return { status: 'busy' };
    const addresses = state.addresses.map((value) => value.trim());
    const destinations = state.destinations.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (addresses.some((value) => value.length < 3 || value.length > 160)) {
      state.status = 'invalid-addresses';
      render();
      return { status: 'invalid' };
    }
    if (destinations.length > 3 || destinations.some((value) => value.length > 160)) {
      state.status = 'invalid-destinations';
      render();
      return { status: 'invalid' };
    }
    const requestGeneration = ++generation;
    requestController?.abort();
    const activeRequestController = new AbortController();
    requestController = activeRequestController;
    // Results contain profile cards and localized formatting that are not needed
    // to open/configure Home Compare. Observe a failure immediately so a lazy
    // chunk failure never escapes as an unhandled rejection while source work runs.
    const resultsView = Promise.resolve().then(loadResultsView);
    const observedResultsView = resultsView.then(
      (view) => ({ view }),
      (error) => ({ error }),
    );
    state.busy = true;
    state.status = 'loading';
    state.result = null;
    state.labels = [];
    render();
    try {
      const [registry, areaIntelligence, identities] = await Promise.all([
        loadRegistry({ signal: activeRequestController.signal }),
        loadAreaIntelligence({ signal: activeRequestController.signal }),
        Promise.all(addresses.map((address) => resolveAddress(address, { signal: activeRequestController.signal }))),
      ]);
      const results = await Promise.all(identities.map((identity) => fetchEvidence(identity, {
        signal: activeRequestController.signal,
      })));
      if (requestGeneration !== generation || activeRequestController.signal.aborted) return { status: 'superseded' };
      const profiles = results.map((result, index) => ({
        ...result.profile,
        profileId: `home-${index + 1}`,
      }));
      const projection = createHomeCompareProjection({
        profiles,
        sources: await combineHomeCompareSources(registry, results),
        areaIntelligence,
        sensitivity: buildWeightSensitivity(state.weights),
      });
      const labels = results.map(({ privateLabel }) => privateLabel);
      const { view, error: resultsViewError } = await observedResultsView;
      if (requestGeneration !== generation || activeRequestController.signal.aborted) return { status: 'superseded' };
      if (resultsViewError || typeof view?.homeCompareResultsHtml !== 'function') {
        throw createResultsViewUnavailableError(resultsViewError);
      }
      // Commit only after all local work belongs to the active generation. This
      // prevents a closed/destroyed dialog from retaining an old projection.
      renderResults = view.homeCompareResultsHtml;
      state.result = projection;
      state.labels = labels;
      state.status = projection.status === 'available' ? 'available' : 'partial';
      state.busy = false;
      render();
      const resultHost = host.querySelector('[data-home-results]');
      resultHost?.focus?.({ preventScroll: true });
      resultHost?.scrollIntoView?.({ block: 'nearest' });
      return { status: projection.status, projection };
    } catch (error) {
      if (requestGeneration !== generation || activeRequestController.signal.aborted || error?.name === 'AbortError') return { status: 'superseded' };
      state.busy = false;
      state.status = errorStatus(error);
      render();
      return { status: 'unavailable', reason: state.status };
    }
  }

  async function shareSettings() {
    try {
      const encoded = encodeHomeCompareShareState({
        weights: state.weights,
        dimensions: [...HOME_COMPARE_DIMENSIONS],
      });
      const url = new URL(locationRef.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('hc', encoded);
      historyRef?.replaceState?.({}, '', url);
      if (typeof clipboard?.writeText !== 'function') throw new TypeError('Clipboard is unavailable.');
      await clipboard.writeText(url.href);
      state.status = 'shared';
    } catch {
      state.status = 'share-failed';
    }
    render();
  }

  function applyShareStateFromUrl() {
    try {
      const text = new URL(locationRef.href).searchParams.get('hc');
      if (!text) return;
      const shared = decodeHomeCompareShareState(text);
      state.weights = { ...shared.weights };
      state.status = 'share-loaded';
    } catch {
      state.status = 'invalid-share';
    }
  }

  function statusText(copy) {
    const messages = getStatusMessages(getLanguage());
    if (state.status === 'loading') return copy.loading;
    if (state.status === 'available') return copy.statusAvailable;
    if (state.status === 'partial') return copy.statusPartial;
    return messages[state.status] || copy.idle;
  }

  const onClose = () => {
    const wasBusy = state.busy;
    generation += 1;
    requestController?.abort();
    requestController = null;
    state.busy = false;
    if (wasBusy) {
      state.result = null;
      state.labels = [];
    }
    if (state.status === 'loading') state.status = 'idle';
    render();
    returnFocus?.focus?.();
  };
  dialog.addEventListener('close', onClose);
  const unsubscribeLanguage = onLanguageChange(render);
  render();

  return Object.freeze({
    open({ opener = null } = {}) {
      returnFocus = opener;
      render();
      openDialog(dialog);
      host.querySelector('[data-home-address="0"]')?.focus();
    },
    compare,
    getState: () => ({
      addressCount: state.addresses.length,
      busy: state.busy,
      status: state.status,
      hasResult: Boolean(state.result),
      weights: { ...state.weights },
    }),
    destroy() {
      generation += 1;
      requestController?.abort();
      requestController = null;
      state.busy = false;
      state.result = null;
      state.labels = [];
      unsubscribeLanguage();
      dialog.removeEventListener('close', onClose);
      closeDialog(dialog);
      host.replaceChildren();
    },
  });
}

function errorStatus(error) {
  if (error?.code === 'RESULTS_VIEW_UNAVAILABLE') return 'results-unavailable';
  const code = String(error?.code || '');
  if (code.startsWith('ADDRESS_')) return code.toLowerCase().replaceAll('_', '-');
  if (code.startsWith('PARCEL_')) return code.toLowerCase().replaceAll('_', '-');
  return 'source-unavailable';
}

function getStatusMessages(locale) {
  if (locale === 'zh-CN') {
    return {
      idle: '输入 2–4 个地址后开始。',
      'invalid-addresses': '每个住宅都需要完整且长度合规的街道地址。',
      'invalid-destinations': '通勤目的地最多 3 个，每个不超过 160 个字符。',
      'address-low-confidence': '地址匹配分数不足；请补充完整街道地址。',
      'address-ambiguous': '存在多个高分地址候选；请细化地址。',
      'address-geography-conflict': '等价地址候选的地理位置不一致，已 fail closed。',
      'parcel-missing': '没有找到精确 OPA parcel 关联，已 fail closed。',
      'parcel-ambiguous': '地址关联到多个 parcel，已 fail closed。',
      'parcel-address-mismatch': 'geocoder 与 OPA 地址不一致，已 fail closed。',
      'parcel-geography-mismatch': 'geocoder 与 OPA 地理位置不一致，已 fail closed。',
      'source-unavailable': '至少一个必需来源或合同不可用；没有用零值或 mock 替代。',
      'results-unavailable': '结果视图暂时无法加载；来源状态没有被改写。请重试。',
      shared: '已复制隐私安全的设置链接；链接不含地址或目的地。',
      'share-loaded': '已加载共享权重；地址和目的地保持为空。',
      'invalid-share': '共享设置无效，已拒绝加载。',
      'share-failed': '无法复制设置链接；地址和目的地仍未写入 URL。',
    };
  }
  return {
    idle: 'Enter 2–4 addresses to begin.',
    'invalid-addresses': 'Each home needs a complete, bounded street address.',
    'invalid-destinations': 'Use no more than 3 commute destinations, each under 160 characters.',
    'address-low-confidence': 'The address score is too low; provide a complete street address.',
    'address-ambiguous': 'Multiple high-confidence addresses remain; refine the address.',
    'address-geography-conflict': 'Equivalent address candidates disagree geographically; the request failed closed.',
    'parcel-missing': 'No exact OPA parcel join was found; the request failed closed.',
    'parcel-ambiguous': 'The address joins to multiple parcels; the request failed closed.',
    'parcel-address-mismatch': 'City geocoder and OPA addresses disagree; the request failed closed.',
    'parcel-geography-mismatch': 'City geocoder and OPA geography disagree; the request failed closed.',
    'source-unavailable': 'A required source or contract is unavailable; no zero or mock was substituted.',
    'results-unavailable': 'The results view could not load; source status was not changed. Retry the comparison.',
    shared: 'Privacy-safe settings link copied; it contains no address or destination.',
    'share-loaded': 'Shared weights loaded; addresses and destinations remain empty.',
    'invalid-share': 'Invalid shared settings were rejected.',
    'share-failed': 'The settings link could not be copied; addresses and destinations were not written to the URL.',
  };
}

function createResultsViewUnavailableError(cause) {
  const error = new Error('Home Compare results view is unavailable.');
  error.code = 'RESULTS_VIEW_UNAVAILABLE';
  error.cause = cause;
  return error;
}
