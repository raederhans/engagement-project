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

function createDefaultCompareView() {
  const element = document.getElementById('compare-card');
  if (!element) return null;
  return {
    pending() {
      element.innerHTML = '<div style="font:12px system-ui">Computing…</div>';
    },
    success({ total, per10k, top3, delta30 }) {
      element.innerHTML = `
        <div><strong>Total</strong>: ${total}${per10k != null ? ` &nbsp; <em>per10k</em>: ${per10k.toFixed(1)}` : ''}</div>
        <div><strong>Top 3</strong>: ${(top3 || []).map((item) => `${escapeHtml(item.text_general_code)} (${item.n})`).join(', ') || '—'}</div>
        <div><strong>30d Δ</strong>: ${fmtPct(delta30)}</div>
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
 * Live compare card for buffer A.
 * @param {{types?:string[], center3857:[number,number], radiusM:number, timeWindowMonths:number, adminLevel:string}} params
 */
export async function updateCompare(
  { types = [], center3857, radiusM, timeWindowMonths = 6, adminLevel = 'districts' },
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
    compareView.pending();

    const end = dayjs().endOf("day").format("YYYY-MM-DD");
    const start = dayjs(end).subtract(timeWindowMonths, "month").startOf("day").format("YYYY-MM-DD");
    const end30 = dayjs(end);
    const start30 = dayjs(end30).subtract(30, "day").format("YYYY-MM-DD");
    const prior30_start = dayjs(start30).subtract(30, "day").format("YYYY-MM-DD");
    const prior30_end = start30;
    const [total, topResponse, last30, prior30, population] = await Promise.all([
      compareFetchers.fetchCountBuffer({ start, end, types, center3857, radiusM, signal }),
      compareFetchers.fetchTopTypesBuffer({ start, end, center3857, radiusM, limit: 3, signal }),
      compareFetchers.fetchCountBuffer({ start: start30, end, types, center3857, radiusM, signal }),
      compareFetchers.fetchCountBuffer({ start: prior30_start, end: prior30_end, types, center3857, radiusM, signal }),
      adminLevel === 'tracts'
        ? compareFetchers.estimatePopInBuffer({ center3857, radiusM, signal })
        : Promise.resolve({ pop: 0 }),
    ]);
    if (!isFresh()) return { applied: false };

    const topRows = Array.isArray(topResponse?.rows) ? topResponse.rows : topResponse;
    const topn = (topRows || []).map((row) => ({
      text_general_code: row.text_general_code,
      n: Number(row.n) || 0,
    }));
    const delta30 = prior30 === 0 ? null : (last30 - prior30) / prior30;

    let per10k = null;
    if (adminLevel === "tracts") {
      per10k = population.pop > 0 ? (total / population.pop) * 10000 : null;
    }

    const result = { total, per10k, top3: topn, delta30 };
    compareView.success(result);
    return { applied: true, ...result };
  } catch (e) {
    if (!isFresh() || isAbortError(e)) return { applied: false };
    compareView.error(e);
    return null;
  }
}

