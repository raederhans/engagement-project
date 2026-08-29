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
  validateHomeCompareAreaIntelligenceBoundary,
} from './contract.js';
import {
  getHomeCompareCopy,
  homeCompareProductHtml,
} from './view.js';
import {
  homeCompareCitywideReadinessHtml,
  loadHomeCompareCitywideReadiness,
} from './citywide_readiness.js';
import { rejectPrivateLocationEgress } from '../utils/http.js';

const DEFAULT_WEIGHTS = Object.freeze({
  property: 20,
  costHistory: 20,
  civicRecords: 20,
  transportContext: 20,
  dataQuality: 20,
});

function loadInitialResultsView() {
  return import('./results_view.js');
}

function loadRetryResultsView() {
  // This must remain a statically analyzable Vite import. A `new URL()` plus
  // `@vite-ignore` looks like a retry URL in source but emits an unbundled
  // module with broken relative imports in production dist.
  return import('./results_view.js?homeCompareRetry=1');
}

function createDefaultResultsViewLoader() {
  let attempts = 0;
  return () => {
    attempts += 1;
    // Chromium retains a failed static module-map entry for the document.
    // The explicit retry uses a second, Vite-built lazy entry; normal first
    // compare intent remains the original static lazy split.
    return attempts === 1 ? loadInitialResultsView() : loadRetryResultsView();
  };
}

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
  loadResultsView: suppliedResultsViewLoader = null,
  clipboard = globalThis.navigator?.clipboard,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  loadCitywideReadiness = loadHomeCompareCitywideReadiness,
  privateAnalysisGate = rejectPrivateLocationEgress,
} = {}) {
  if (!dialog?.querySelector) throw new TypeError('Home Compare dialog is required.');
  const host = dialog.querySelector('[data-home-compare-host]');
  if (!host) throw new TypeError('Home Compare host is required.');
  const loadResultsView = suppliedResultsViewLoader || createDefaultResultsViewLoader();

  const state = {
    addresses: ['', ''],
    destinations: '',
    weights: { ...DEFAULT_WEIGHTS },
    busy: false,
    status: 'idle',
    result: null,
    labels: [],
    resultHtml: null,
    resultLocale: null,
    citywideReadiness: null,
  };
  let returnFocus = null;
  let generation = 0;
  let requestController = null;
  let renderResults = null;
  let destroyed = false;
  let readinessGeneration = 0;

  applyShareStateFromUrl();
  void refreshCitywideReadiness();

  function render() {
    const locale = getLanguage();
    const copy = getHomeCompareCopy(locale);
    host.innerHTML = homeCompareProductHtml({
      locale,
      addressCount: state.addresses.length,
      weights: state.weights,
      busy: state.busy,
      citywideReadinessHtml: homeCompareCitywideReadinessHtml(state.citywideReadiness, { locale }),
    });
    state.addresses.forEach((value, index) => {
      const input = host.querySelector(`[data-home-address="${index}"]`);
      if (!input) return;
      input.value = value;
      input.disabled = state.busy;
      input.addEventListener('input', () => {
        if (state.busy) return;
        state.addresses[index] = input.value;
        invalidateResult();
      });
    });
    const destinationInput = host.querySelector('[data-home-destinations]');
    destinationInput.value = state.destinations;
    destinationInput.disabled = state.busy;
    destinationInput.addEventListener('input', () => {
      if (state.busy) return;
      state.destinations = destinationInput.value;
      invalidateResult();
    });
    for (const input of host.querySelectorAll('[data-home-weight]')) {
      input.disabled = state.busy;
      input.addEventListener('input', () => {
        if (state.busy) return;
        state.weights[input.dataset.homeWeight] = Number(input.value);
        const output = host.querySelector(`[data-home-weight-output="${input.dataset.homeWeight}"]`);
        if (output) output.textContent = input.value;
        invalidateResult();
      });
    }
    const addButton = host.querySelector('[data-home-add]');
    if (addButton) {
      addButton.disabled = state.busy || state.addresses.length >= 4;
      addButton.addEventListener('click', addAddress);
    }
    for (const button of host.querySelectorAll('[data-home-remove]')) {
      button.disabled = state.busy;
      button.addEventListener('click', () => removeAddress(Number(button.dataset.homeRemove)));
    }
    host.querySelector('[data-home-run]')?.addEventListener('click', () => { void compare(); });
    host.querySelector('[data-home-retry-results]')?.addEventListener('click', () => { void compare(); });
    host.querySelector('[data-home-share]')?.addEventListener('click', () => { void shareSettings(); });
    host.querySelector('[data-home-close]')?.addEventListener('click', () => {
      cancelInFlight();
      closeDialog(dialog);
    });
    const status = host.querySelector('[data-home-status]');
    if (status) status.textContent = statusText(copy);
    const retryResults = host.querySelector('[data-home-retry-results]');
    if (retryResults) {
      retryResults.hidden = state.status !== 'results-unavailable';
      retryResults.disabled = state.busy;
    }
    const resultHost = host.querySelector('[data-home-results]');
    if (state.result && renderResults) {
      try {
        const resultHtml = state.resultLocale === locale
          ? state.resultHtml
          : renderResults(state.result, { labels: state.labels, locale });
        state.resultHtml = resultHtml;
        state.resultLocale = locale;
        resultHost.innerHTML = resultHtml;
      } catch (error) {
        setResultsUnavailable(error);
        resultHost?.replaceChildren();
        if (status) status.textContent = statusText(copy);
        if (retryResults) retryResults.hidden = false;
      }
    }
    dialog.setAttribute('aria-busy', String(state.busy));
  }

  async function refreshCitywideReadiness() {
    const currentGeneration = ++readinessGeneration;
    try {
      state.citywideReadiness = await loadCitywideReadiness();
    } catch {
      if (destroyed || currentGeneration !== readinessGeneration) return;
      state.citywideReadiness = null;
    }
    if (destroyed || currentGeneration !== readinessGeneration) return;
    render();
  }

  function invalidateResult() {
    if (state.busy) return;
    clearResult();
    state.status = 'idle';
    host.querySelector('[data-home-results]')?.replaceChildren();
    const status = host.querySelector('[data-home-status]');
    if (status) status.textContent = getHomeCompareCopy(getLanguage()).idle;
  }

  function clearResult() {
    state.result = null;
    state.labels = [];
    state.resultHtml = null;
    state.resultLocale = null;
  }

  function setResultsUnavailable(error) {
    renderResults = null;
    clearResult();
    state.busy = false;
    state.status = errorStatus(createResultsViewUnavailableError(error));
  }

  function cancelInFlight({ renderAfter = true } = {}) {
    if (!state.busy && !requestController) return false;
    generation += 1;
    requestController?.abort();
    requestController = null;
    state.busy = false;
    clearResult();
    if (state.status === 'loading') state.status = 'idle';
    if (renderAfter) render();
    return true;
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
    // Production's default gate is synchronous and runs before any lazy chunk,
    // registry, M2, geocoder, evidence, or ancillary request. Tests alone may
    // inject a no-op to preserve the pure local compare-domain harness.
    try { privateAnalysisGate(); } catch (error) {
      clearResult(); state.status = 'address-unavailable'; render();
      return Object.freeze({ status: 'unavailable', reason: 'private-address-unavailable-before-egress', travelTimes: [], isochrones: [] });
    }
    const request = Object.freeze({
      addresses: Object.freeze(state.addresses.map((value) => value.trim())),
      destinations: Object.freeze(state.destinations.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)),
      weights: Object.freeze({ ...state.weights }),
    });
    if (request.addresses.some((value) => value.length < 3 || value.length > 160)) { state.status = 'invalid-addresses'; render(); return { status: 'invalid' }; }
    if (request.destinations.length > 3 || request.destinations.some((value) => value.length > 160)) { state.status = 'invalid-destinations'; render(); return { status: 'invalid' }; }
    const requestGeneration = ++generation;
    requestController?.abort();
    const activeRequestController = new AbortController(); requestController = activeRequestController;
    const resultsView = Promise.resolve().then(loadResultsView);
    const observedResultsView = resultsView.then((view) => ({ view }), (error) => ({ error }));
    state.busy = true; state.status = 'loading'; clearResult(); render();
    try {
      const [registry, areaIntelligence, identities] = await Promise.all([
        loadRegistry({ signal: activeRequestController.signal }), loadAreaIntelligence({ signal: activeRequestController.signal }),
        Promise.all(request.addresses.map((address) => resolveAddress(address, { signal: activeRequestController.signal }))),
      ]);
      if (requestGeneration !== generation || activeRequestController.signal.aborted) return { status: 'superseded' };
      const admittedAreaIntelligence = validateHomeCompareAreaIntelligenceBoundary(areaIntelligence);
      const results = await Promise.all(admitComparisonIdentities(identities).map((identity) => fetchEvidence(identity, { signal: activeRequestController.signal })));
      if (requestGeneration !== generation || activeRequestController.signal.aborted) return { status: 'superseded' };
      const projection = createHomeCompareProjection({ profiles:results.map((result,index)=>({ ...result.profile, profileId:`home-${index + 1}` })), sources:await combineHomeCompareSources(registry,results), areaIntelligence:admittedAreaIntelligence, sensitivity:buildWeightSensitivity(request.weights) });
      const { view, error:resultsViewError } = await observedResultsView;
      if (requestGeneration !== generation || activeRequestController.signal.aborted) return { status: 'superseded' };
      if (resultsViewError || typeof view?.homeCompareResultsHtml !== 'function') throw createResultsViewUnavailableError(resultsViewError);
      renderResults = view.homeCompareResultsHtml; state.result=projection; state.labels=results.map(({privateLabel})=>privateLabel); state.resultHtml=renderResults(projection,{labels:state.labels,locale:getLanguage()}); state.resultLocale=getLanguage(); state.status=projection.status==='available'?'available':'partial'; state.busy=false;
      if(requestController===activeRequestController)requestController=null; render(); host.querySelector('[data-home-results]')?.focus?.({preventScroll:true}); return {status:projection.status,projection};
    } catch (error) {
      if(requestGeneration!==generation||activeRequestController.signal.aborted||error?.name==='AbortError')return {status:'superseded'};
      activeRequestController.abort(); if(requestController===activeRequestController)requestController=null;
      if(error?.code==='RESULTS_VIEW_UNAVAILABLE')setResultsUnavailable(error); else {state.busy=false;state.status=errorStatus(error);} render(); return {status:'unavailable',reason:state.status};
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

  const onCancel = () => {
    cancelInFlight();
  };
  const onClose = () => {
    cancelInFlight({ renderAfter: false });
    render();
    returnFocus?.focus?.();
  };
  dialog.addEventListener('cancel', onCancel);
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
      destroyed = true;
      readinessGeneration += 1;
      cancelInFlight({ renderAfter: false });
      unsubscribeLanguage();
      dialog.removeEventListener('cancel', onCancel);
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
      'address-duplicate': '多个住宅解析为同一个规范化地址，已 fail closed。',
      'address-geography-conflict': '等价地址候选的地理位置不一致，已 fail closed。',
      'address-unavailable': '私人地址比较不可用；在任何 geocoder、parcel、地图或附属请求前已 fail closed。',
      'parcel-missing': '没有找到精确 OPA parcel 关联，已 fail closed。',
      'parcel-ambiguous': '地址关联到多个 parcel，已 fail closed。',
      'parcel-duplicate': '多个住宅解析为同一个 parcel，已 fail closed。',
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
    'address-duplicate': 'Multiple homes resolve to the same normalized address; the request failed closed.',
    'address-geography-conflict': 'Equivalent address candidates disagree geographically; the request failed closed.',
    'address-unavailable': 'Private address comparison is unavailable and failed closed before any geocoder, parcel, map, or ancillary request.',
    'parcel-missing': 'No exact OPA parcel join was found; the request failed closed.',
    'parcel-ambiguous': 'The address joins to multiple parcels; the request failed closed.',
    'parcel-duplicate': 'Multiple homes resolve to the same parcel; the request failed closed.',
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

function admitComparisonIdentities(identities) {
  if (!Array.isArray(identities) || identities.length < 2 || identities.length > 4) {
    const error = new TypeError('Home Compare requires two to four admitted property identities.');
    error.code = 'PARCEL_JOIN_INPUT_INVALID';
    throw error;
  }
  const parcelIds = new Set();
  const normalizedAddresses = new Set();
  for (const identity of identities) {
    if (!identity || typeof identity !== 'object'
      || !/^\d{6,16}$/.test(identity.parcelId || '')
      || typeof identity.normalizedAddress !== 'string' || !identity.normalizedAddress.trim()) {
      const error = new TypeError('Home Compare requires admitted address and parcel identities.');
      error.code = 'PARCEL_JOIN_INPUT_INVALID';
      throw error;
    }
    if (normalizedAddresses.has(identity.normalizedAddress)) {
      const error = new TypeError('Home Compare property identities must resolve to unique normalized addresses.');
      error.code = 'ADDRESS_DUPLICATE';
      throw error;
    }
    if (parcelIds.has(identity.parcelId)) {
      const error = new TypeError('Home Compare property identities must resolve to unique parcels.');
      error.code = 'PARCEL_DUPLICATE';
      throw error;
    }
    normalizedAddresses.add(identity.normalizedAddress);
    parcelIds.add(identity.parcelId);
  }
  return identities;
}

function createResultsViewUnavailableError(cause) {
  const error = new Error('Home Compare results view is unavailable.');
  error.code = 'RESULTS_VIEW_UNAVAILABLE';
  error.cause = cause;
  return error;
}
