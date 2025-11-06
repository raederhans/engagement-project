import {
  ACS_POP_TENURE_INCOME,
  ACS_POVERTY,
} from "../config.js";
import { fetchJson } from "../utils/http.js";

/**
 * Fetch ACS population, tenure, and poverty metrics for Philadelphia tracts.
 * @returns {Promise<Array<{geoid:string, pop:number|null, renter_total:number|null, renter_count:number|null, median_income:number|null, poverty_pct:number|null}>>}
 */
export async function fetchTractStats() {
  const [popTenureRows, povertyRows] = await Promise.all([
    fetchJson(ACS_POP_TENURE_INCOME),
    fetchJson(ACS_POVERTY),
  ]);

  if (!Array.isArray(popTenureRows) || popTenureRows.length === 0) {
    return [];
  }

  const [popHeader, ...popRecords] = popTenureRows;
  const popIdx = indexLookup(
    popHeader,
    [
      "B01003_001E",
      "B25003_001E",
      "B25003_003E",
      "B19013_001E",
      "state",
      "county",
      "tract",
    ],
    "ACS population/tenure"
  );

  const povertyMap = new Map();
  if (Array.isArray(povertyRows) && povertyRows.length > 0) {
    const [povertyHeader, ...povertyRecords] = povertyRows;
    const povertyIdx = indexLookup(
      povertyHeader,
      ["S1701_C03_001E", "state", "county", "tract"],
      "ACS poverty"
    );

    for (const row of povertyRecords) {
      const geoid = buildGeoid(
        row[povertyIdx.state],
        row[povertyIdx.county],
        row[povertyIdx.tract]
      );
      if (!geoid) {
        continue;
      }
      const povertyPct = toNumber(row[povertyIdx.S1701_C03_001E]);
      if (povertyPct !== null) {
        povertyMap.set(geoid, povertyPct);
      }
    }
  }

  const results = [];
  for (const row of popRecords) {
    const geoid = buildGeoid(
      row[popIdx.state],
      row[popIdx.county],
      row[popIdx.tract]
    );
    if (!geoid) {
      continue;
    }

    results.push({
      geoid,
      pop: toNumber(row[popIdx.B01003_001E]),
      renter_total: toNumber(row[popIdx.B25003_001E]),
      renter_count: toNumber(row[popIdx.B25003_003E]),
      median_income: toNumber(row[popIdx.B19013_001E]),
      poverty_pct: povertyMap.get(geoid) ?? null,
    });
  }

  return results;
}

/**
 * Cached-first loader for ACS tract stats. Attempts local JSON under /src/data first
 * then falls back to live endpoints.
 * @returns {Promise<Array<{geoid:string, pop:number|null, renter_total:number|null, renter_count:number|null, median_income:number|null, poverty_pct:number|null}>>}
 */
export async function fetchTractStatsCachedFirst() {
  const localPaths = [
    "/src/data/acs_tracts_2023_pa101.json",
    "/data/acs_tracts_2023_pa101.json",
  ];
  for (const p of localPaths) {
    try {
      const rows = await fetchJson(p, { timeoutMs: 8000, retries: 1 });
      if (Array.isArray(rows) && rows.length > 0 && rows[0]?.geoid) {
        return rows;
      }
    } catch (_) {
      // try next path
    }
  }
  // Fallback to live fetch
  return fetchTractStats();
}

function indexLookup(header, keys, label) {
  if (!Array.isArray(header)) {
    throw new Error(`Expected header array for ${label}.`);
  }

  const lookups = {};
  for (const key of keys) {
    const index = header.indexOf(key);
    if (index === -1) {
      throw new Error(`Missing ${key} column in ${label}.`);
    }
    lookups[key] = index;
  }
  return lookups;
}

function buildGeoid(state, county, tract) {
  if (!state || !county || !tract) {
    return "";
  }
  return `${state}${county}${tract}`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
