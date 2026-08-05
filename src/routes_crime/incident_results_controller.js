import maplibregl from 'maplibre-gl';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import {
  pointOutsideCenterViewport,
  prefersReducedMotion as defaultPrefersReducedMotion,
} from '../map/camera_fit.js';

const PAGE_SIZE = 12;
const MAX_ROWS = 200;

function defaultResultKey(feature, { generation = 0, index = 0 } = {}) {
  if (feature?.id != null) return String(feature.id);
  const sourceRow = feature?.properties?.cartodb_id;
  if (sourceRow != null) return `carto:${sourceRow}`;
  return `result:${generation}:${index}`;
}

const defaultTranslate = (key) => key;
const defaultEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function createDefaultDetailModel(feature, {
  getResultKey,
  translate,
  formatDate,
}) {
  const properties = feature?.properties || feature || {};
  const unavailable = translate('summary.metricUnavailable');
  return {
    key: getResultKey(feature),
    offense: localizeOffenseCode(properties.text_general_code) || unavailable,
    occurred: formatDate(properties.dispatch_date_time) || unavailable,
    location: String(properties.location_block || unavailable),
    district: String(properties.dc_dist || unavailable),
    coordinates: feature?.geometry?.type === 'Point'
      ? feature.geometry.coordinates?.slice(0, 2)
      : null,
  };
}

function createDefaultDetailHtml(model, { translate, escape }) {
  const row = (labelKey, value) => `<div><dt>${escape(translate(labelKey))}</dt><dd>${escape(value)}</dd></div>`;
  return `<article><h3>${escape(translate('map.incidentDetails'))}</h3><dl>${row('map.incidentOffense', model.offense)}${row('map.incidentOccurred', model.occurred)}${row('map.incidentLocation', model.location)}${row('map.incidentDistrict', model.district)}</dl></article>`;
}

function sortNewestFirst(features) {
  return [...features].sort((left, right) => (
    Date.parse(right?.properties?.dispatch_date_time || 0)
      - Date.parse(left?.properties?.dispatch_date_time || 0)
  ));
}

export function visibleIncidentFeatures(features, {
  visibleCount = PAGE_SIZE,
  selectedKey = null,
  getResultKey = defaultResultKey,
} = {}) {
  const all = sortNewestFirst(Array.isArray(features) ? features : []);
  const limit = Math.min(visibleCount, MAX_ROWS, all.length);
  const visible = all.slice(0, limit);
  if (selectedKey && !visible.some((feature) => getResultKey(feature) === selectedKey)) {
    const selectedFeature = all.find((feature) => getResultKey(feature) === selectedKey);
    if (selectedFeature) {
      if (visible.length >= MAX_ROWS) visible[visible.length - 1] = selectedFeature;
      else visible.push(selectedFeature);
    }
  }
  return { all, visible };
}

function createNoopView() {
  return {
    setActivateHandler: () => () => {},
    setLoading() {},
    setFailed() {},
    replaceResults() {},
    setSelected() {},
    clearSelection() {},
    clear() {},
    destroy() {},
  };
}

export function createIncidentResultsView({
  root = globalThis.document?.getElementById?.('incident-results'),
  documentRef = globalThis.document,
  focusFilters = () => documentRef?.getElementById?.('queryModeSel')?.focus?.(),
  translate = defaultTranslate,
  getResultKey = defaultResultKey,
  createDetailModel = (feature) => createDefaultDetailModel(feature, {
    getResultKey,
    translate,
    formatDate: (value) => String(value || ''),
  }),
} = {}) {
  if (!root || !documentRef?.createElement) return createNoopView();
  const status = root.querySelector('[data-incident-results-status]');
  const selected = root.querySelector('[data-selected-incident]');
  const state = root.querySelector('[data-incident-results-state]');
  const list = root.querySelector('[data-incident-results-list]');
  const more = root.querySelector('[data-incident-results-more]');
  const edit = root.querySelector('[data-incident-results-edit]');
  let activate = () => {};
  let visibleCount = PAGE_SIZE;
  let currentGeneration = null;
  let lastPayload = null;

  function renderedFeatures(payload) {
    return visibleIncidentFeatures(payload?.geo?.features, {
      visibleCount,
      selectedKey: payload?.selectedKey,
      getResultKey,
    });
  }

  function statusText(payload, shown) {
    const total = Number(payload?.count) || 0;
    if (payload?.status === 'idle') return translate('incidents.idle');
    if (payload?.status === 'empty' || total === 0) return translate('incidents.empty');
    if (total > MAX_ROWS || payload?.tooMany) {
      return translate('incidents.dense', { shown, total });
    }
    return translate('incidents.count', { shown, total });
  }

  function render(payload) {
    lastPayload = payload;
    if (payload?.generation !== currentGeneration) {
      currentGeneration = payload?.generation;
      visibleCount = PAGE_SIZE;
    }
    const { all, visible } = renderedFeatures(payload);
    list?.replaceChildren?.();
    for (const feature of visible) {
      const model = createDetailModel(feature);
      const item = documentRef.createElement('li');
      item.className = 'incident-results__item';
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.dataset.incidentKey = model.key;
      if (model.key === payload?.selectedKey) button.setAttribute('aria-current', 'true');
      const offense = documentRef.createElement('strong');
      offense.textContent = model.offense;
      const meta = documentRef.createElement('span');
      meta.textContent = `${model.occurred} · ${model.location}`;
      button.append(offense, meta);
      item.appendChild(button);
      list?.appendChild?.(item);
    }
    const shown = visible.length;
    if (status) status.textContent = statusText(payload, shown);
    if (state) {
      state.textContent = all.length ? '' : statusText(payload, 0);
      state.hidden = all.length > 0;
    }
    if (edit) edit.hidden = all.length > 0;
    if (more) {
      const expandable = visibleCount < Math.min(all.length, MAX_ROWS);
      more.hidden = !expandable;
      more.textContent = translate('incidents.showMore');
    }
    root.setAttribute('aria-busy', 'false');
  }

  const onClick = (event) => {
    const button = event.target?.closest?.('[data-incident-key]');
    if (button && list?.contains?.(button)) {
      activate(button.dataset.incidentKey);
      return;
    }
    if (event.target === more && lastPayload) {
      visibleCount = Math.min(visibleCount + PAGE_SIZE, MAX_ROWS);
      render(lastPayload);
      return;
    }
    if (event.target === edit) focusFilters();
  };
  root.addEventListener('click', onClick);

  return {
    setActivateHandler(handler) {
      activate = typeof handler === 'function' ? handler : () => {};
      return () => { activate = () => {}; };
    },
    setLoading() {
      root.setAttribute('aria-busy', 'true');
      if (status) status.textContent = translate('incidents.loading');
    },
    setFailed() {
      root.setAttribute('aria-busy', 'false');
      if (status) status.textContent = translate('incidents.failed');
    },
    replaceResults: render,
    setSelected(payload) {
      let activeButton = null;
      for (const button of list?.querySelectorAll?.('[data-incident-key]') || []) {
        if (button.dataset.incidentKey === payload.key) activeButton = button;
      }
      if (!activeButton) return false;
      if (selected) {
        selected.hidden = false;
        selected.innerHTML = payload.html;
      }
      for (const button of list?.querySelectorAll?.('[data-incident-key]') || []) {
        if (button.dataset.incidentKey === payload.key) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      }
      if (payload.ensureVisible) activeButton?.scrollIntoView?.({ block: 'nearest' });
      if (lastPayload) lastPayload = { ...lastPayload, selectedKey: payload.key };
      return true;
    },
    clearSelection() {
      if (selected) {
        selected.hidden = true;
        selected.replaceChildren();
      }
      for (const button of list?.querySelectorAll?.('[aria-current]') || []) {
        button.removeAttribute('aria-current');
      }
      if (lastPayload) lastPayload = { ...lastPayload, selectedKey: null };
    },
    clear() {
      currentGeneration = null;
      visibleCount = PAGE_SIZE;
      lastPayload = null;
      list?.replaceChildren?.();
      this.clearSelection();
      if (status) status.textContent = translate('incidents.idle');
      if (state) {
        state.hidden = false;
        state.textContent = translate('incidents.idle');
      }
      if (edit) edit.hidden = false;
      if (more) more.hidden = true;
      root.setAttribute('aria-busy', 'false');
    },
    destroy() {
      root.removeEventListener('click', onClick);
      activate = () => {};
    },
  };
}

export function createIncidentResultsController(map, {
  view = null,
  layerId = 'unclustered',
  createPopup = () => new maplibregl.Popup({ closeButton: true, focusAfterOpen: false }),
  prefersReducedMotion = defaultPrefersReducedMotion,
  languageChange = () => () => {},
  translate = defaultTranslate,
  getResultKey = defaultResultKey,
  formatDate = (value) => String(value || ''),
  escape = defaultEscape,
  createDetailModel = (feature) => createDefaultDetailModel(feature, {
    getResultKey,
    translate,
    formatDate,
  }),
  renderDetailHtml = (feature) => createDefaultDetailHtml(createDetailModel(feature), {
    translate,
    escape,
  }),
} = {}) {
  const resultsView = view || createIncidentResultsView({
    translate,
    getResultKey,
    createDetailModel,
  });
  let currentPayload = null;
  let featuresByKey = new Map();
  let selectedKey = null;
  let popup = null;
  let destroyed = false;

  const closePopup = () => {
    popup?.remove?.();
    popup = null;
  };

  const clearSelection = () => {
    selectedKey = null;
    closePopup();
    resultsView.clearSelection?.();
  };

  const syncSelectedView = (payload) => {
    if (resultsView.setSelected?.(payload) !== false) return true;
    if (!currentPayload) return false;
    resultsView.replaceResults?.({ ...currentPayload, selectedKey: payload.key });
    return resultsView.setSelected?.(payload) !== false;
  };

  const present = (feature, eventLngLat = null, { ensureVisible = false } = {}) => {
    if (destroyed || !feature) return false;
    const key = getResultKey(feature);
    if (!featuresByKey.has(key)) return false;
    selectedKey = key;
    const html = renderDetailHtml(feature);
    const model = createDetailModel(feature);
    syncSelectedView({ key, feature, model, html, ensureVisible });
    const coordinates = model.coordinates?.slice();
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const eventLongitude = Number(eventLngLat?.lng);
      if (Number.isFinite(eventLongitude)) {
        while (Math.abs(eventLongitude - coordinates[0]) > 180) {
          coordinates[0] += eventLongitude > coordinates[0] ? 360 : -360;
        }
      }
      closePopup();
      const nextPopup = createPopup?.();
      if (nextPopup?.setLngLat && nextPopup?.setHTML && nextPopup?.addTo) {
        popup = nextPopup
          .setLngLat(coordinates)
          .setHTML(html)
          .addTo(map);
      }
      if (ensureVisible && pointOutsideCenterViewport(map, coordinates)) {
        map.easeTo?.({
          center: coordinates,
          duration: prefersReducedMotion() ? 0 : 300,
        });
      }
    }
    return true;
  };

  const onMapClick = (event) => {
    const eventFeature = event?.features?.[0];
    const key = getResultKey(eventFeature);
    present(featuresByKey.get(key) || eventFeature, event?.lngLat);
  };
  const onEnter = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
  };
  map.on('click', layerId, onMapClick);
  map.on('mouseenter', layerId, onEnter);
  map.on('mouseleave', layerId, onLeave);
  const releaseActivation = resultsView.setActivateHandler?.((key) => present(
    featuresByKey.get(key),
    null,
    { ensureVisible: true },
  )) || (() => {});
  const releaseLanguage = languageChange(() => {
    if (destroyed || !currentPayload) return;
    resultsView.replaceResults?.({ ...currentPayload, selectedKey });
    if (selectedKey) present(featuresByKey.get(selectedKey));
  });

  return {
    setLoading() {
      if (!destroyed) resultsView.setLoading?.();
    },
    setFailed() {
      if (!destroyed) resultsView.setFailed?.();
    },
    replaceResults(payload = {}) {
      if (destroyed || !payload.geo) return false;
      currentPayload = payload;
      featuresByKey = new Map((payload.geo.features || []).map((feature, index) => [
        getResultKey(feature, { generation: payload.generation, index }),
        feature,
      ]));
      if (selectedKey && !featuresByKey.has(selectedKey)) clearSelection();
      resultsView.replaceResults?.({ ...payload, selectedKey });
      if (selectedKey) {
        const selected = featuresByKey.get(selectedKey);
        present(selected);
      }
      return true;
    },
    clear() {
      currentPayload = null;
      featuresByKey.clear();
      clearSelection();
      resultsView.clear?.();
    },
    getSelectedKey: () => selectedKey,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.off('click', layerId, onMapClick);
      map.off('mouseenter', layerId, onEnter);
      map.off('mouseleave', layerId, onLeave);
      onLeave();
      clearSelection();
      releaseActivation();
      releaseLanguage?.();
      resultsView.destroy?.();
      currentPayload = null;
      featuresByKey.clear();
    },
  };
}
