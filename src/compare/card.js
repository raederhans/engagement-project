import dayjs from "dayjs";
import { fetchCountBuffer, fetchTopTypesBuffer } from "../api/crime.js";
import { estimatePopInBuffer } from "../utils/pop_buffer.js";

function fmtPct(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

/**
 * Live compare card for buffer A.
 * @param {{types?:string[], center3857:[number,number], radiusM:number, timeWindowMonths:number, adminLevel:string}} params
 */
export async function updateCompare({ types = [], center3857, radiusM, timeWindowMonths = 6, adminLevel = "districts" }) {
  const el = document.getElementById("compare-card");
  if (!el) return null;

  try {
    el.innerHTML = '<div style="font:12px system-ui">Computing…</div>';

    const end = dayjs().endOf("day").format("YYYY-MM-DD");
    const start = dayjs(end).subtract(timeWindowMonths, "month").startOf("day").format("YYYY-MM-DD");

    // Totals and Top-3
    const [total, topn] = await Promise.all([
      fetchCountBuffer({ start, end, types, center3857, radiusM }),
      (async () => {
        const resp = await fetchTopTypesBuffer({ start, end, center3857, radiusM, limit: 3 });
        const rows = Array.isArray(resp?.rows) ? resp.rows : resp;
        return (rows || []).map((r) => ({ text_general_code: r.text_general_code, n: Number(r.n) || 0 }));
      })(),
    ]);

    // 30-day delta
    const end30 = dayjs(end);
    const start30 = dayjs(end30).subtract(30, "day").format("YYYY-MM-DD");
    const prior30_start = dayjs(start30).subtract(30, "day").format("YYYY-MM-DD");
    const prior30_end = start30;
    const [last30, prior30] = await Promise.all([
      fetchCountBuffer({ start: start30, end: end, types, center3857, radiusM }),
      fetchCountBuffer({ start: prior30_start, end: prior30_end, types, center3857, radiusM }),
    ]);
    const delta30 = prior30 === 0 ? null : (last30 - prior30) / prior30;

    // per-10k via centroid-in-buffer pop estimate only when on tracts
    let per10k = null;
    if (adminLevel === "tracts") {
      const { pop } = await estimatePopInBuffer({ center3857, radiusM });
      per10k = pop > 0 ? (total / pop) * 10000 : null;
    }

    el.innerHTML = `
      <div><strong>Total</strong>: ${total}${per10k != null ? ` &nbsp; <em>per10k</em>: ${per10k.toFixed(1)}` : ""}</div>
      <div><strong>Top 3</strong>: ${(topn || []).map((t) => `${t.text_general_code} (${t.n})`).join(", ") || "—"}</div>
      <div><strong>30d Δ</strong>: ${fmtPct(delta30)}</div>
    `;

    return { total, per10k, top3: topn, delta30 };
  } catch (e) {
    el.innerHTML = `<div style="color:#b91c1c; font:12px system-ui">Compare failed: ${e?.message || e}</div>`;
    return null;
  }
}

