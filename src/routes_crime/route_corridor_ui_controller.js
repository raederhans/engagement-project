import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import { registerMessagePairs } from '../i18n/messages.js';
import { createManualRouteInput, readRouteGeoJsonFile } from './route_input.js';

registerMessagePairs({
  'route.title': ['Known route history', '已知路线历史记录'],
  'route.description': ['Review records near a route you provide.', '查看所选路线附近的记录。'],
  'route.file': ['Choose GeoJSON LineString', '选择 GeoJSON LineString'],
  'route.draw': ['Draw on map', '在地图上绘制'],
  'route.finish': ['Finish route', '完成路线'],
  'route.clear': ['Clear route', '清除路线'],
  'route.buffer': ['Route buffer (metres)', '路线缓冲范围（米）'],
  'route.review': ['Review historical records', '查看历史记录'],
  'route.close': ['Close', '关闭'],
  'route.eyebrow': ['Historical reported records', '历史已记录事件'],
  'route.drawHint': ['Click map points', '点击地图添加路线点'],
  'route.waypoints': ['Enter route waypoints', '输入路线途经点'],
  'route.waypointsHint': ['At least two waypoints.', '至少两个途经点。'],
  'route.waypoint': ['Waypoint {count}', '途经点 {count}'],
  'route.longitude': ['Longitude', '经度'],
  'route.latitude': ['Latitude', '纬度'],
  'route.addWaypoint': ['Add waypoint', '添加途经点'],
  'route.removeWaypoint': ['Remove waypoint {count}', '移除途经点 {count}'],
  'route.undoWaypoint': ['Undo waypoint edit', '撤销途经点编辑'],
  'route.clearWaypoints': ['Clear waypoints', '清除途经点'],
  'route.queryContext': ['Historical window: {start} to {end}; offense filters: {filters}; buffer: {buffer} m; route: {route}.', '历史时间：{start} 至 {end}；事件筛选：{filters}；缓冲范围：{buffer} 米；路线：{route}。'],
  'route.value.all': ['all', '全部'],
  'route.value.provided': ['provided', '已提供'],
  'route.value.required': ['required', '尚未提供'],
  'route.value.unavailable': ['Unavailable', '不可用'],
  'route.evidence.time': ['Historical time', '历史时间'],
  'route.evidence.filters': ['Offense filters', '事件筛选'],
  'route.evidence.buffer': ['Route buffer', '路线缓冲范围'],
  'route.evidence.source': ['Data source', '数据源'],
  'route.evidence.coverage': ['Actual coverage', '实际覆盖时间'],
  'route.evidence.mapped': ['Mapped matches', '可绘制匹配数'],
  'route.evidence.unmapped': ['Unmapped/unlocated', '未定位记录'],
  'route.evidence.proof': ['Spatial proof', '空间准入证明'],
  'route.evidence.precision': ['Location precision', '位置精度'],
  'route.evidence.record': ['Record meaning', '记录含义'],
  'route.value.noneMapped': ['None in admitted mapped records', '已准入的可绘制记录中没有匹配项'],
  'route.value.unmappedScope': ['{count} citywide rows for the selected time and filters', '所选时间和筛选条件下，全市有 {count} 条未定位记录'],
  'route.value.spatialProof': ['{source} ({kind}, {method}); {margin} m conservative margin', '{source}（{kind}，{method}）；保守余量 {margin} 米'],
  'route.value.precision': ['Generalized to the hundred block by the source', '数据源已将位置泛化到百号街区'],
  'route.value.record': ['Source rows may not be unique incidents', '数据源记录行不一定对应唯一事件'],
  'route.value.reportedRecord': ['Reported record', '已记录事件'],
  'route.value.dateUnavailable': ['Date unavailable', '日期不可用'],
  'route.value.locationUnavailable': ['Location unavailable', '位置不可用'],
  'route.disclosure': ['The remote incident source receives a coarse 2 km-snapped area, historic dates, and current offense filters. The exact route stays in browser memory and is not saved.', '远程事件数据源会收到按 2 公里网格向外取整的粗略区域、历史日期和当前 offense filters。精确路线仅保留在浏览器内存中，不会保存。'],
  'route.truth': ['Historical reported records only; not live, predictive, a risk score, or a safer-route recommendation. A reported point near the route does not mean the event occurred on the route.', '仅为历史已记录事件；不是实时信息、预测、风险分数或更安全路线建议。记录点靠近路线不表示事件发生在路线上。'],
  'route.notes': ['Data & privacy', '数据与隐私'],
  'route.state.route-required': ['Provide a known route before requesting historical records.', '请先提供已知路线，再请求历史记录。'],
  'route.state.drawing': ['Drawing route: add at least two map points, then finish the route.', '正在绘制路线：请至少添加两个地图点，然后完成路线。'],
  'route.state.route-provided': ['Route provided. Review explicitly when you are ready; no request has been made.', '路线已提供。准备好后请明确点击查看；目前尚未发送请求。'],
  'route.state.route-invalid': ['The selected route or buffer is invalid. No request was made.', '所选路线或缓冲范围无效；未发送请求。'],
  'route.state.pending': ['Checking local coverage and historical reported records…', '正在检查本地覆盖范围和历史已记录事件…'],
  'route.state.coverage-unavailable': ['Coverage could not be proven for this route. This is unavailable, not a zero result.', '无法证明这条路线的覆盖范围；这是不可用状态，不是零结果。'],
  'route.state.source-failure': ['The historical reported-record source failed. No result count is available.', '历史已记录事件数据源失败；目前没有可用数量。'],
  'route.state.superseded': ['This request was replaced by a newer route or query.', '此请求已被更新的路线或查询取代。'],
  'route.state.no-mapped-incidents': ['No mapped reported records matched within the admitted corridor for this historical query.', '在已准入的路线范围与本次历史查询中，没有匹配的可绘制记录。'],
  'route.state.admitted-zero': ['No mapped reported records matched within the admitted corridor for this historical query.', '在已准入的路线范围与本次历史查询中，没有匹配的可绘制记录。'],
  'route.state.ready': ['{count} mapped historical reported records matched this admitted corridor.', '有 {count} 条可绘制的历史已记录事件匹配此准入路线范围。'],
});

const STATE_SUMMARIES = Object.freeze({
  'route-required': 'Provide a known route before requesting historical records.',
  'route-invalid': 'The selected route or buffer is invalid. No request was made.',
  pending: 'Checking local coverage and historical reported records…',
  'coverage-unavailable': 'Coverage could not be proven for this route. This is unavailable, not a zero result.',
  'source-failure': 'The historical reported-record source failed. No result count is available.',
  superseded: 'This request was replaced by a newer route or query.',
  'no-mapped-incidents': 'No mapped reported records matched within the admitted corridor for this historical query.',
  ready: 'Mapped historical reported records matched this admitted corridor.',
});

const PRESENTATION_PHASES = Object.freeze({
  'route-required': 'route-required',
  'route-invalid': 'route-required',
  superseded: 'route-provided',
  pending: 'pending',
  'coverage-unavailable': 'coverage-unavailable',
  'source-failure': 'source-failure',
  'no-mapped-incidents': 'admitted-zero',
  ready: 'ready',
});

export function createRouteCorridorPresentation(result = {}) {
  const status = Object.hasOwn(STATE_SUMMARIES, result.status) ? result.status : 'source-failure';
  const phase = ['route-required', 'drawing', 'route-provided', 'pending', 'coverage-unavailable', 'source-failure', 'admitted-zero', 'ready'].includes(result.phase)
    ? result.phase : PRESENTATION_PHASES[status];
  const mappedCount = status === 'ready' ? result.matches?.length || 0 : null;
  const unmappedCount = Number.isInteger(result.coverage?.unmappedIncidentCount)
    ? result.coverage.unmappedIncidentCount : null;
  return {
    status,
    phase,
    messageState: result.phase || (status === 'no-mapped-incidents' ? 'admitted-zero' : status),
    summary: status === 'ready'
      ? `${mappedCount} mapped historical reported records matched this admitted corridor.`
      : STATE_SUMMARIES[status],
    zeroClaim: status === 'no-mapped-incidents',
    mappedCount,
    unmappedCount,
    recordGrain: 'reported-record/non-unique',
    coverage: result.coverage || null,
  };
}

export function createRouteQueryKey(snapshot = {}) {
  return JSON.stringify({
    start: snapshot.start || null,
    end: snapshot.end || null,
    filters: [...(snapshot.drilldownCodes?.length ? snapshot.drilldownCodes : snapshot.types || [])].sort(),
  });
}

export function createRouteBufferWidthExpression({ bufferM, latitude }) {
  const latitudeScale = Math.max(0.01, Math.abs(Math.cos(Number(latitude) * Math.PI / 180)));
  const metresPerPixelAtZoomZero = 156543.03392804097 * latitudeScale;
  const diameterAtZoomZero = Math.max(0, Number(bufferM) * 2) / metresPerPixelAtZoomZero;
  return ['interpolate', ['exponential', 2], ['zoom'], 0, diameterAtZoomZero, 22, diameterAtZoomZero * (2 ** 22)];
}

const EMPTY_WAYPOINTS = Object.freeze([
  Object.freeze({ lon: '', lat: '' }),
  Object.freeze({ lon: '', lat: '' }),
]);

export function createWaypointEditorState(waypoints = EMPTY_WAYPOINTS) {
  return {
    waypoints: normalizeWaypointRows(waypoints),
    history: [],
  };
}

export function reduceWaypointEditor(state, action = {}) {
  const current = state?.waypoints ? state : createWaypointEditorState();
  if (action.type === 'undo') {
    if (!current.history.length) return current;
    return {
      waypoints: normalizeWaypointRows(current.history.at(-1)),
      history: current.history.slice(0, -1),
    };
  }

  let next = normalizeWaypointRows(current.waypoints);
  if (action.type === 'set' && ['lon', 'lat'].includes(action.field) && next[action.index]) {
    next[action.index][action.field] = String(action.value ?? '');
  } else if (action.type === 'add') {
    next.push({ lon: '', lat: '' });
  } else if (action.type === 'remove' && next.length > 2 && next[action.index]) {
    next.splice(action.index, 1);
  } else if (action.type === 'clear') {
    next = normalizeWaypointRows(EMPTY_WAYPOINTS);
  } else {
    return current;
  }

  if (JSON.stringify(next) === JSON.stringify(current.waypoints)) return current;
  return {
    waypoints: next,
    history: [...current.history.slice(-49), normalizeWaypointRows(current.waypoints)],
  };
}

export function createRouteInputFromWaypoints(state) {
  const rows = normalizeWaypointRows(state?.waypoints || []);
  if (rows.length < 2 || rows.some(({ lon, lat }) => String(lon).trim() === '' || String(lat).trim() === '')) {
    throw new Error('At least two complete waypoints are required.');
  }
  const coordinates = rows.map(({ lon, lat }) => [Number(lon), Number(lat)]);
  if (coordinates.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat)
    || lon < -180 || lon > 180 || lat < -90 || lat > 90)) {
    throw new Error('Waypoint longitude or latitude is invalid.');
  }
  return createManualRouteInput(coordinates);
}

export function createRouteCloseResult(lastResult, routeInput) {
  if (lastResult?.status !== 'pending') return lastResult;
  return routeInput
    ? { status: 'superseded', phase: 'route-provided' }
    : { status: 'route-required' };
}

function normalizeWaypointRows(rows) {
  const normalized = Array.isArray(rows)
    ? rows.map((row) => ({ lon: String(row?.lon ?? ''), lat: String(row?.lat ?? '') }))
    : [];
  while (normalized.length < 2) normalized.push({ lon: '', lat: '' });
  return normalized;
}

const IDS = Object.freeze({
  corridor: 'route-corridor-context',
  route: 'route-corridor-line',
  points: 'route-corridor-matches',
});

export function initRouteCorridorUi({
  mount,
  host: shellHost,
  returnFocus = null,
  map,
  requestRouteCorridor,
  clearRouteCorridor = () => {},
  prepareKnownRouteEvidence = () => {},
  readCanonicalSnapshot = () => ({}),
  readFile = readRouteGeoJsonFile,
} = {}) {
  if (!mount?.querySelector || !map || typeof requestRouteCorridor !== 'function') {
    throw new Error('Route corridor UI requires its mount, map port, and request port.');
  }
  const host = shellHost || mount.ownerDocument?.querySelector?.('[data-route-corridor-host]')
    || mount.querySelector('[data-route-corridor-host]');
  if (!host) throw new Error('Route corridor UI host is unavailable.');
  host.innerHTML = surfaceHtml();
  applyTranslations(host);
  const surface = host.querySelector('[data-route-corridor-surface]');
  const file = host.querySelector('[data-route-file]');
  const draw = host.querySelector('[data-route-draw]');
  const finish = host.querySelector('[data-route-finish]');
  const clear = host.querySelector('[data-route-clear]');
  const submit = host.querySelector('[data-route-submit]');
  const close = host.querySelector('[data-route-close]');
  const buffer = host.querySelector('[data-route-buffer]');
  const status = host.querySelector('[data-route-status]');
  const context = host.querySelector('[data-route-query-context]');
  const evidence = host.querySelector('[data-route-evidence]');
  const list = host.querySelector('[data-route-results]');
  const instruction = host.querySelector('[data-route-instruction]');
  const waypointList = host.querySelector('[data-route-waypoint-list]');
  const waypointAdd = host.querySelector('[data-route-waypoint-add]');
  const waypointUndo = host.querySelector('[data-route-waypoint-undo]');
  const waypointClear = host.querySelector('[data-route-waypoint-clear]');
  const documentRef = mount.ownerDocument || document;
  let routeInput = null;
  let drawing = false;
  let drawingCoordinates = [];
  let waypointState = createWaypointEditorState();
  let generation = 0;
  let controller = null;
  let active = false;
  let canonicalKey = createRouteQueryKey(readCanonicalSnapshot());
  let lastResult = { status: 'route-required' };

  const setStatus = (result) => {
    lastResult = result;
    const presentation = createRouteCorridorPresentation(result);
    surface.dataset.routeStatus = presentation.status;
    surface.dataset.routePhase = presentation.phase;
    surface.setAttribute('aria-busy', String(presentation.status === 'pending'));
    status.textContent = t(`route.state.${presentation.messageState}`, { count: presentation.mappedCount ?? 0 });
    renderEvidence(documentRef, evidence, presentation, result, readCanonicalSnapshot(), Number(buffer.value));
    renderResults(documentRef, list, result?.matches || []);
    renderMap(map, routeInput, Number(buffer.value), result?.matches || []);
  };

  const replaceRoute = (next) => {
    generation += 1;
    controller?.abort();
    controller = null;
    clearRouteCorridor();
    routeInput = next;
    drawing = false;
    drawingCoordinates = [];
    draw.textContent = t('route.draw');
    finish.hidden = true;
    instruction.hidden = true;
    syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
    setStatus(next ? { status: 'superseded', phase: 'route-provided' } : { status: 'route-required' });
  };

  const syncWaypointRoute = () => {
    file.value = '';
    try {
      replaceRoute(createRouteInputFromWaypoints(waypointState));
    } catch {
      replaceRoute(null);
    }
  };

  const renderWaypointEditor = () => {
    waypointList.replaceChildren();
    waypointState.waypoints.forEach((waypoint, index) => {
      const item = documentRef.createElement('li');
      item.className = 'route-corridor__waypoint';
      const title = documentRef.createElement('strong');
      title.textContent = t('route.waypoint', { count: index + 1 });
      const lonLabel = documentRef.createElement('label');
      const lonText = documentRef.createElement('span');
      lonText.textContent = t('route.longitude');
      const lon = documentRef.createElement('input');
      lon.className = 'field';
      lon.type = 'number';
      lon.min = '-180';
      lon.max = '180';
      lon.step = 'any';
      lon.inputMode = 'decimal';
      lon.value = waypoint.lon;
      lon.dataset.routeWaypointField = 'lon';
      lon.dataset.routeWaypointIndex = String(index);
      lonLabel.append(lonText, lon);
      const latLabel = documentRef.createElement('label');
      const latText = documentRef.createElement('span');
      latText.textContent = t('route.latitude');
      const lat = documentRef.createElement('input');
      lat.className = 'field';
      lat.type = 'number';
      lat.min = '-90';
      lat.max = '90';
      lat.step = 'any';
      lat.inputMode = 'decimal';
      lat.value = waypoint.lat;
      lat.dataset.routeWaypointField = 'lat';
      lat.dataset.routeWaypointIndex = String(index);
      latLabel.append(latText, lat);
      const remove = documentRef.createElement('button');
      remove.className = 'button button--secondary';
      remove.type = 'button';
      remove.dataset.routeWaypointRemove = String(index);
      remove.textContent = t('route.removeWaypoint', { count: index + 1 });
      remove.disabled = waypointState.waypoints.length <= 2;
      item.append(title, lonLabel, latLabel, remove);
      waypointList.append(item);
    });
    waypointUndo.disabled = waypointState.history.length === 0;
  };

  const onFile = async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      waypointState = createWaypointEditorState();
      renderWaypointEditor();
      replaceRoute(await readFile(selected));
    } catch (error) {
      replaceRoute(null);
      setStatus({ status: 'route-invalid', reason: String(error?.message || error) });
    }
  };
  const onDraw = () => {
    file.value = '';
    waypointState = createWaypointEditorState();
    renderWaypointEditor();
    generation += 1;
    controller?.abort();
    clearRouteCorridor();
    routeInput = null;
    drawing = true;
    drawingCoordinates = [];
    finish.hidden = false;
    instruction.hidden = false;
    draw.textContent = t('route.drawHint');
    setStatus({ status: 'route-required', phase: 'drawing' });
  };
  const onMapClick = (event) => {
    if (!active || !drawing) return;
    drawingCoordinates.push([event.lngLat.lng, event.lngLat.lat]);
    if (drawingCoordinates.length >= 2) {
      routeInput = createManualRouteInput(drawingCoordinates);
      syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
      renderMap(map, routeInput, Number(buffer.value), []);
    }
  };
  const onFinish = () => {
    if (drawingCoordinates.length < 2) return setStatus({ status: 'route-invalid' });
    replaceRoute(createManualRouteInput(drawingCoordinates));
  };
  const onSubmit = async () => {
    if (!routeInput) return setStatus({ status: 'route-required' });
    const bufferM = Number(buffer.value);
    if (!Number.isInteger(bufferM) || bufferM < 10 || bufferM > 10_000) {
      return setStatus({ status: 'route-invalid' });
    }
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    syncQueryContext(context, readCanonicalSnapshot(), bufferM, routeInput);
    setStatus({ status: 'pending' });
    let result;
    try {
      result = await requestRouteCorridor({ routeInput, bufferM, signal: controller.signal });
    } catch {
      result = { status: 'source-failure' };
    }
    if (requestGeneration !== generation) return;
    controller = null;
    setStatus(result);
    prepareKnownRouteEvidence({ routeInput, incidentResult: result });
  };
  const onBuffer = () => {
    generation += 1;
    controller?.abort();
    clearRouteCorridor();
    syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
    renderMap(map, routeInput, Number(buffer.value), []);
    setStatus(routeInput ? { status: 'superseded', phase: 'route-provided' } : { status: 'route-required' });
  };
  const onWaypointChange = (event) => {
    const field = event.target?.dataset?.routeWaypointField;
    const index = Number(event.target?.dataset?.routeWaypointIndex);
    if (!field || !Number.isInteger(index)) return;
    waypointState = reduceWaypointEditor(waypointState, {
      type: 'set', index, field, value: event.target.value,
    });
    syncWaypointRoute();
    waypointUndo.disabled = waypointState.history.length === 0;
  };
  const onWaypointRemove = (event) => {
    const target = event.target?.closest?.('[data-route-waypoint-remove]');
    if (!target) return;
    waypointState = reduceWaypointEditor(waypointState, {
      type: 'remove', index: Number(target.dataset.routeWaypointRemove),
    });
    renderWaypointEditor();
    syncWaypointRoute();
  };
  const onWaypointAdd = () => {
    waypointState = reduceWaypointEditor(waypointState, { type: 'add' });
    renderWaypointEditor();
    syncWaypointRoute();
    waypointList.querySelector?.('li:last-child input')?.focus?.();
  };
  const onWaypointUndo = () => {
    waypointState = reduceWaypointEditor(waypointState, { type: 'undo' });
    renderWaypointEditor();
    syncWaypointRoute();
  };
  const onWaypointClear = () => {
    waypointState = reduceWaypointEditor(waypointState, { type: 'clear' });
    renderWaypointEditor();
    syncWaypointRoute();
  };
  const clearRouteInputs = () => {
    file.value = '';
    waypointState = createWaypointEditorState();
    renderWaypointEditor();
    replaceRoute(null);
  };
  const hideSurface = ({ restoreFocus = false } = {}) => {
    active = false;
    const closeResult = createRouteCloseResult(lastResult, routeInput);
    if (controller) generation += 1;
    controller?.abort();
    controller = null;
    if (closeResult !== lastResult) setStatus(closeResult);
    removeMap(map);
    surface.hidden = true;
    surface.inert = true;
    host.hidden = true;
    host.inert = true;
    returnFocus?.setAttribute?.('aria-expanded', 'false');
    clearRouteCorridor();
    if (restoreFocus) returnFocus?.focus?.({ preventScroll: true });
  };
  const onClose = () => hideSurface({ restoreFocus: true });
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || surface.hidden) return;
    event.preventDefault?.();
    onClose();
  };

  file.addEventListener('change', onFile);
  draw.addEventListener('click', onDraw);
  finish.addEventListener('click', onFinish);
  clear.addEventListener('click', clearRouteInputs);
  submit.addEventListener('click', onSubmit);
  buffer.addEventListener('change', onBuffer);
  waypointList.addEventListener('change', onWaypointChange);
  waypointList.addEventListener('click', onWaypointRemove);
  waypointAdd.addEventListener('click', onWaypointAdd);
  waypointUndo.addEventListener('click', onWaypointUndo);
  waypointClear.addEventListener('click', onWaypointClear);
  close.addEventListener('click', onClose);
  documentRef.addEventListener?.('keydown', onKeyDown);
  map.on('click', onMapClick);
  draw.hidden = map.isAvailable?.() === false;
  const releaseLanguage = onLanguageChange(() => {
    applyTranslations(host);
    renderWaypointEditor();
    if (drawing) draw.textContent = t('route.drawHint');
    syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
    setStatus(lastResult);
  });
  renderWaypointEditor();
  setStatus({ status: 'route-required' });

  return {
    open() {
      active = true;
      draw.hidden = map.isAvailable?.() === false;
      host.hidden = false;
      host.inert = false;
      surface.hidden = false;
      surface.inert = false;
      returnFocus?.setAttribute?.('aria-expanded', 'true');
      syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
      setStatus(lastResult);
      surface.focus?.({ preventScroll: true });
    },
    clear: clearRouteInputs,
    syncCanonical() {
      const nextKey = createRouteQueryKey(readCanonicalSnapshot());
      if (nextKey === canonicalKey) return false;
      canonicalKey = nextKey;
      if (!routeInput) return false;
      generation += 1;
      controller?.abort();
      controller = null;
      clearRouteCorridor();
      syncQueryContext(context, readCanonicalSnapshot(), Number(buffer.value), routeInput);
      setStatus({ status: 'superseded', phase: 'route-provided' });
      return true;
    },
    setActive(next) {
      active = Boolean(next);
      if (active) draw.hidden = map.isAvailable?.() === false;
      if (!active) {
        clearRouteInputs();
        hideSurface();
      }
    },
    dispose() {
      releaseLanguage();
      documentRef.removeEventListener?.('keydown', onKeyDown);
      controller?.abort();
      clearRouteCorridor();
      map.off?.('click', onMapClick);
      removeMap(map);
      host.replaceChildren();
    },
  };
}

function surfaceHtml() {
  return `<section class="route-corridor" data-route-corridor-surface tabindex="-1" aria-labelledby="route-corridor-title" aria-busy="false" hidden inert>
    <header><p class="route-corridor__eyebrow" data-i18n="route.eyebrow">${t('route.eyebrow')}</p><h2 id="route-corridor-title" data-i18n="route.title">${t('route.title')}</h2></header>
    <div class="route-corridor-shell__scroll">
    <div class="route-corridor__controls">
      <label class="button button--secondary"><span data-i18n="route.file">${t('route.file')}</span><input data-route-file type="file" accept=".geojson,.json,application/geo+json,application/json"></label>
      <button class="button button--secondary" data-route-draw data-i18n="route.draw" type="button">${t('route.draw')}</button>
      <button class="button button--secondary" data-route-finish data-i18n="route.finish" type="button" hidden>${t('route.finish')}</button>
      <button class="button button--secondary" data-route-clear data-i18n="route.clear" type="button">${t('route.clear')}</button>
      <label><span data-i18n="route.buffer">${t('route.buffer')}</span><input class="field" data-route-buffer type="number" min="10" max="10000" step="1" value="100"></label>
    </div>
    <fieldset class="route-corridor__waypoint-editor" aria-describedby="route-waypoints-hint">
      <legend data-i18n="route.waypoints">${t('route.waypoints')}</legend>
      <p id="route-waypoints-hint" class="route-corridor__compact-hint" data-i18n="route.waypointsHint">${t('route.waypointsHint')}</p>
      <ol data-route-waypoint-list></ol>
      <div class="route-corridor__waypoint-actions">
        <button class="button button--secondary" data-route-waypoint-add data-i18n="route.addWaypoint" type="button">${t('route.addWaypoint')}</button>
        <button class="button button--secondary" data-route-waypoint-undo data-i18n="route.undoWaypoint" type="button" disabled>${t('route.undoWaypoint')}</button>
        <button class="button button--secondary" data-route-waypoint-clear data-i18n="route.clearWaypoints" type="button">${t('route.clearWaypoints')}</button>
      </div>
    </fieldset>
    <p class="route-corridor__instruction" data-route-instruction data-i18n="route.drawHint" hidden>${t('route.drawHint')}</p>
    <p data-route-query-context></p>
    <details class="route-corridor__notes">
      <summary data-i18n="route.notes">${t('route.notes')}</summary>
      <p class="route-corridor__disclosure" data-i18n="route.disclosure">${t('route.disclosure')}</p>
      <p class="route-corridor__truth" data-i18n="route.truth">${t('route.truth')}</p>
    </details>
    <p data-route-status role="status" aria-live="polite" aria-atomic="true"></p>
    <dl data-route-evidence></dl><ol class="incident-results__list" data-route-results></ol>
    <section class="route-corridor__hin" data-route-hin-context aria-live="polite"></section>
    <section data-known-route-evidence></section>
    </div>
    <footer class="route-corridor__actions"><button class="button button--primary" data-route-submit data-i18n="route.review" type="button">${t('route.review')}</button><button class="button button--secondary" data-route-close data-i18n="route.close" type="button">${t('route.close')}</button></footer>
  </section>`;
}

function syncQueryContext(node, snapshot, bufferM, routeInput) {
  const start = String(snapshot?.start || '').slice(0, 10) || t('route.value.unavailable');
  const end = String(snapshot?.end || '').slice(0, 10) || t('route.value.unavailable');
  const filters = [...(snapshot?.drilldownCodes?.length ? snapshot.drilldownCodes : snapshot?.types || [])];
  node.textContent = t('route.queryContext', {
    start,
    end,
    filters: filters.join(', ') || t('route.value.all'),
    buffer: bufferM,
    route: t(routeInput ? 'route.value.provided' : 'route.value.required'),
  });
}

function renderEvidence(documentRef, node, presentation, result, snapshot, bufferM) {
  node.replaceChildren();
  if (!['ready', 'no-mapped-incidents'].includes(presentation.status)) return;
  const coverage = presentation.coverage || {};
  const rows = [
    [t('route.evidence.time'), `${String(snapshot?.start || '').slice(0, 10)} — ${String(snapshot?.end || '').slice(0, 10)}`],
    [t('route.evidence.filters'), [...(snapshot?.drilldownCodes?.length ? snapshot.drilldownCodes : snapshot?.types || [])].join(', ') || t('route.value.all')],
    [t('route.evidence.buffer'), `${bufferM} m`],
    [t('route.evidence.source'), coverage.source || 'Philadelphia Crime Incidents'],
    [t('route.evidence.coverage'), `${coverage.availableStart || t('route.value.unavailable')} — ${coverage.availableEndExclusive || t('route.value.unavailable')}`],
    [t('route.evidence.mapped'), presentation.zeroClaim ? t('route.value.noneMapped') : String(presentation.mappedCount)],
    [t('route.evidence.unmapped'), presentation.unmappedCount == null ? t('route.value.unavailable') : t('route.value.unmappedScope', { count: presentation.unmappedCount })],
    [t('route.evidence.proof'), t('route.value.spatialProof', { source: coverage.spatialCoverageSource || 'Philadelphia boundary', kind: coverage.spatialCoverageKind || 'unknown', method: coverage.spatialCoverageMethod || 'unknown', margin: coverage.conservativeBoundaryMarginM ?? 500 })],
    [t('route.evidence.precision'), coverage.locationPrecision || t('route.value.precision')],
    [t('route.evidence.record'), t('route.value.record')],
  ];
  for (const [label, value] of rows) {
    const group = documentRef.createElement('div');
    const term = documentRef.createElement('dt');
    const detail = documentRef.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    group.append(term, detail);
    node.append(group);
  }
}

function renderResults(documentRef, node, matches) {
  node.replaceChildren();
  for (const match of matches) {
    const properties = match.incident?.properties || {};
    const item = documentRef.createElement('li');
    item.className = 'incident-results__item';
    const title = documentRef.createElement('strong');
    title.textContent = properties.text_general_code || t('route.value.reportedRecord');
    const meta = documentRef.createElement('span');
    meta.textContent = `${properties.dispatch_date_time || t('route.value.dateUnavailable')} · ${properties.location_block || t('route.value.locationUnavailable')}`;
    item.append(title, meta);
    node.append(item);
  }
}

function renderMap(map, routeInput, bufferM, matches) {
  removeMap(map);
  if (!map || !routeInput || !map.getStyle?.()) return;
  const route = { type: 'Feature', properties: {}, geometry: routeInput.geometry };
  const latitude = routeInput.geometry.coordinates.reduce((sum, coordinate) => sum + Number(coordinate[1]), 0)
    / routeInput.geometry.coordinates.length;
  map.addSource(IDS.corridor, { type: 'geojson', data: route });
  map.addLayer({ id: IDS.corridor, type: 'line', source: IDS.corridor, paint: { 'line-color': '#3b6ea8', 'line-opacity': 0.18, 'line-width': createRouteBufferWidthExpression({ bufferM, latitude }) }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addLayer({ id: IDS.route, type: 'line', source: IDS.corridor, paint: { 'line-color': '#245b91', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  const features = matches.map((match) => match.incident).filter((feature) => feature?.geometry?.type === 'Point');
  map.addSource(IDS.points, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({ id: IDS.points, type: 'circle', source: IDS.points, paint: { 'circle-color': '#3b6ea8', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
}

function removeMap(map) {
  if (!map) return;
  for (const id of [IDS.points, IDS.route, IDS.corridor]) if (map.getLayer?.(id)) map.removeLayer(id);
  for (const id of [IDS.points, IDS.corridor]) if (map.getSource?.(id)) map.removeSource(id);
}
