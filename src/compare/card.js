import dayjs from "dayjs";
import { fetchCountBuffer, fetchTopTypesBuffer } from "../api/crime.js";
import { estimatePopInBuffer } from "../utils/pop_buffer.js";
import { escapeHtml } from "../utils/html.js";

function fmtPct(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

const DEFAULT_FETCHERS = {
  fetchCountBuffer,
  fetchTopTypesBuffer,
  estimatePopInBuffer,
};

let lastComparison = null;

export function buildComparisonFilterKey(filters = {}) {
  return JSON.stringify({
    start: filters.start || null,
    end: filters.end || null,
    types: [...(filters.types || [])].map(String).sort(),
    center3857: filters.center3857 || null,
    centerB3857: filters.centerB3857 || null,
    radiusM: Number(filters.radiusM ?? filters.radius) || null,
    adminLevel: filters.adminLevel || null,
    per10k: Boolean(filters.per10k),
    addressA: filters.addressA || null,
    addressB: filters.addressB || null,
  });
}

export function getLastComparison(filters) {
  if (!lastComparison) return null;
  if (filters && lastComparison.filterKey !== buildComparisonFilterKey(filters)) return null;
  return structuredClone(lastComparison.comparison);
}

function createDefaultCompareView() {
  const element = document.getElementById('compare-card');
  if (!element) return null;
  return {
    pending() {
      element.innerHTML = '<div style="font:12px system-ui">Computing…</div>';
    },
    success({ a, b }) {
      const renderPoint = (label, point) => point ? `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
          <div style="font-weight:700">${escapeHtml(point.label || label)}</div>
          <div><strong>Total</strong>: ${point.total}${point.per10k != null ? ` &nbsp; <em>per10k</em>: ${point.per10k.toFixed(1)}` : ''}</div>
          <div><strong>Top 3</strong>: ${(point.top3 || []).map((item) => `${escapeHtml(item.text_general_code)} (${item.n})`).join(', ') || '—'}</div>
          <div><strong>30d Δ</strong>: ${fmtPct(point.delta30)}</div>
        </div>` : `<div style="margin-top:8px;color:#64748b">Set point ${label} to compare.</div>`;
      element.innerHTML = `
        <div style="font:600 13px/1.2 system-ui">Compare A vs B</div>
        ${renderPoint('A', a)}
        ${renderPoint('B', b)}
      `;
    },
    error(error) {
      element.innerHTML = `<div style="color:#b91c1c; font:12px system-ui">Compare failed: ${escapeHtml(error?.message || error)}</div>`;
    },
  };
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Live compare card for buffers A and B.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number],radiusM:number,adminLevel:string}} params
 */
export async function updateCompare(
  {
    start,
    end,
    types = [],
    center3857,
    centerB3857 = null,
    addressA = 'Point A',
    addressB = 'Point B',
    radiusM,
    adminLevel = 'districts',
    per10k = false,
  },
  {
    signal,
    shouldApply = () => true,
    fetchers,
    view,
  } = {},
) {
  const compareFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const compareView = view ?? createDefaultCompareView();
  if (!compareView) return null;
  const isFresh = () => !signal?.aborted && shouldApply();
  if (!isFresh()) return { applied: false };

  try {
    lastComparison = null;
    compareView.pending();

    const readPoint = async (pointCenter, label) => {
      if (!pointCenter) return null;
      const end30 = dayjs(end);
      const start30 = dayjs(end30).subtract(30, 'day').format('YYYY-MM-DD');
      const prior30Start = dayjs(start30).subtract(30, 'day').format('YYYY-MM-DD');
      const [total, topResponse, last30, prior30, population] = await Promise.all([
        compareFetchers.fetchCountBuffer({ start, end, types, center3857: pointCenter, radiusM, signal }),
        compareFetchers.fetchTopTypesBuffer({ start, end, types, center3857: pointCenter, radiusM, limit: 3, signal }),
        compareFetchers.fetchCountBuffer({ start: start30, end, types, center3857: pointCenter, radiusM, signal }),
        compareFetchers.fetchCountBuffer({ start: prior30Start, end: start30, types, center3857: pointCenter, radiusM, signal }),
        adminLevel === 'tracts'
          ? compareFetchers.estimatePopInBuffer({ center3857: pointCenter, radiusM, signal })
          : Promise.resolve({ pop: 0 }),
      ]);
      const topRows = Array.isArray(topResponse?.rows) ? topResponse.rows : topResponse;
      const top3 = (topRows || []).map((row) => ({
        text_general_code: row.text_general_code,
        n: Number(row.n) || 0,
      }));
      return {
        label,
        total,
        per10k: adminLevel === 'tracts' && population.pop > 0 ? (total / population.pop) * 10000 : null,
        top3,
        delta30: prior30 === 0 ? null : (last30 - prior30) / prior30,
      };
    };
    const [a, b] = await Promise.all([
      readPoint(center3857, addressA),
      readPoint(centerB3857, addressB),
    ]);
    if (!isFresh()) return { applied: false };
    const result = { a, b, ...(a || {}) };
    lastComparison = {
      filterKey: buildComparisonFilterKey({
        start, end, types, center3857, centerB3857, radiusM, adminLevel,
        per10k, addressA, addressB,
      }),
      comparison: { a, b },
    };
    compareView.success(result);
    return { applied: true, ...result };
  } catch (e) {
    if (!isFresh() || isAbortError(e)) return { applied: false };
    lastComparison = null;
    compareView.error(e);
    return null;
  }
}

