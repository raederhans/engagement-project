import { onLanguageChange, t } from '../i18n/index.js';

let districtAccessibleSnapshot = null;

onLanguageChange(() => {
  if (!districtAccessibleSnapshot) return;
  syncCrimeDistrictData(
    districtAccessibleSnapshot.geojson,
    districtAccessibleSnapshot.options,
  );
});

function flattenLabel(value) {
  return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

export function projectCrimeChartData(kind, model, copy = {}) {
  if (!model?.data) return { headers: [], rows: [] };
  if (kind === 'monthly') {
    const datasets = model.data.datasets || [];
    return {
      headers: [t('chart.data.period'), ...datasets.map(({ label }) => flattenLabel(label))],
      rows: (model.data.labels || []).map((label, index) => [
        flattenLabel(label),
        ...datasets.map(({ rawValues, data }) => rawValues?.[index] ?? data?.[index] ?? 0),
      ]),
    };
  }
  if (kind === 'top') {
    const datasets = model.data.datasets || [];
    return {
      headers: [t('chart.data.category'), ...datasets.map(({ label }) => flattenLabel(label))],
      rows: (model.data.labels || []).map((label, index) => [
        flattenLabel(label),
        ...datasets.map(({ rawValues, data }) => rawValues?.[index] ?? data?.[index] ?? 0),
      ]),
    };
  }
  const dataset = model.data.datasets?.[0];
  const values = dataset?.data || [];
  if (model.type === 'scatter') {
    const weekdays = copy.weekdays || [];
    return {
      headers: [t('chart.data.day'), t('chart.data.hour'), t('chart.data.count')],
      rows: values.map(({ x, y, v }) => [
        weekdays[y] || String(y),
        copy.hourLabel?.(x) || String(x),
        v,
      ]),
    };
  }
  return {
    headers: [t('chart.data.period'), flattenLabel(dataset?.label || t('chart.data.value'))],
    rows: (model.data.labels || []).map((label, index) => [flattenLabel(label), values[index] ?? 0]),
  };
}

export function projectCrimeDistrictData(geojson) {
  const rows = (geojson?.features || [])
    .map((feature) => {
      const rawCode = String(feature?.properties?.DIST_NUMC || '').trim();
      return {
        code: /^\d{1,2}$/.test(rawCode) && Number(rawCode) > 0
          ? rawCode.padStart(2, '0')
          : '',
        value: feature?.properties?.value,
      };
    })
    .filter(({ code, value }) => code && Number.isSafeInteger(Number(value)))
    .sort((left, right) => left.code.localeCompare(right.code))
    .map(({ code, value }) => [code, Number(value)]);
  return {
    headers: [t('map.districtDataCode'), t('map.districtDataCount')],
    rows,
  };
}

export function replaceAccessibleTables(mount, tables, documentRef = globalThis.document) {
  if (!mount || !documentRef?.createElement) return;
  mount.replaceChildren();
  for (const descriptor of tables) {
    const section = documentRef.createElement('section');
    section.dataset.accessibleChart = descriptor.key;
    const table = documentRef.createElement('table');
    const caption = documentRef.createElement('caption');
    caption.textContent = descriptor.caption;
    table.appendChild(caption);
    const head = documentRef.createElement('thead');
    const headRow = documentRef.createElement('tr');
    for (const header of descriptor.headers || []) {
      const cell = documentRef.createElement('th');
      cell.scope = 'col';
      cell.textContent = String(header);
      headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = documentRef.createElement('tbody');
    for (const row of descriptor.rows || []) {
      const rowElement = documentRef.createElement('tr');
      row.forEach((value, index) => {
        const cell = documentRef.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.textContent = String(value ?? '');
        rowElement.appendChild(cell);
      });
      body.appendChild(rowElement);
    }
    table.appendChild(body);
    section.appendChild(table);
    mount.appendChild(section);
  }
}

export function syncCrimeChartData(kind, model, copy = {}, documentRef = globalThis.document) {
  const mount = documentRef?.querySelector?.('[data-crime-canvas-data-mount]');
  if (!mount) return;
  const sections = new Map([...mount.querySelectorAll?.('[data-accessible-chart]') || []]
    .map((section) => [section.dataset.accessibleChart, section]));
  const projected = projectCrimeChartData(kind, model, copy);
  const captions = {
    monthly: t('crime.chartMonthly'),
    top: t('crime.topOffenses'),
    heat: t('crime.dayHour'),
  };
  const scratch = documentRef.createElement('div');
  replaceAccessibleTables(scratch, [{ key: kind, caption: captions[kind] || kind, ...projected }], documentRef);
  sections.set(kind, scratch.children[0]);
  mount.replaceChildren(...['districts', 'monthly', 'top', 'heat'].map((key) => sections.get(key)).filter(Boolean));
}

export function syncCrimeDistrictData(geojson, {
  start = '',
  end = '',
} = {}, documentRef = globalThis.document) {
  districtAccessibleSnapshot = { geojson, options: { start, end } };
  const mount = documentRef?.querySelector?.('[data-crime-canvas-data-mount]');
  if (!mount) return;
  const sections = new Map([...mount.querySelectorAll?.('[data-accessible-chart]') || []]
    .map((section) => [section.dataset.accessibleChart, section]));
  const projected = projectCrimeDistrictData(geojson);
  const scratch = documentRef.createElement('div');
  replaceAccessibleTables(scratch, [{
    key: 'districts',
    caption: t('map.districtDataCaption', { start, end }),
    ...projected,
  }], documentRef);
  sections.set('districts', scratch.children[0]);
  mount.replaceChildren(...['districts', 'monthly', 'top', 'heat']
    .map((key) => sections.get(key)).filter(Boolean));
}

export function clearCrimeDistrictData(documentRef = globalThis.document) {
  districtAccessibleSnapshot = null;
  const mount = documentRef?.querySelector?.('[data-crime-canvas-data-mount]');
  mount?.querySelector?.('[data-accessible-chart="districts"]')?.remove?.();
}

export function clearCrimeChartData(documentRef = globalThis.document) {
  documentRef?.querySelector?.('[data-crime-canvas-data-mount]')?.replaceChildren?.();
}
