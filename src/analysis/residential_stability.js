function monthKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function roundOne(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function monthOrdinal(value) {
  const key = monthKey(value);
  if (!key) return null;
  const [year, month] = key.split('-').map(Number);
  return (year * 12) + month - 1;
}

function monthFromOrdinal(value) {
  const year = Math.floor(value / 12);
  const month = (value % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeRows(rows, { start = null, end = null, coverageDate = null } = {}) {
  const totals = new Map();
  for (const row of rows || []) {
    const month = monthKey(row?.m);
    const count = Number(row?.n);
    if (!month || !Number.isFinite(count) || count < 0) continue;
    totals.set(month, (totals.get(month) || 0) + count);
  }
  const observed = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([m, n]) => ({ m, n }));
  let first = monthOrdinal(start) ?? monthOrdinal(observed[0]?.m);
  let last = end ? monthOrdinal(end) - 1 : monthOrdinal(observed.at(-1)?.m);
  const coverage = monthOrdinal(coverageDate);
  if (coverage != null && (last == null || coverage < last)) last = coverage;
  if (first == null || last == null || first > last) return observed;
  const complete = [];
  for (let ordinal = first; ordinal <= last; ordinal += 1) {
    const m = monthFromOrdinal(ordinal);
    complete.push({ m, n: totals.get(m) || 0 });
  }
  return complete;
}

function isPartialCoverageMonth(coverageDate) {
  const match = String(coverageDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day < lastDay;
}

function standardDeviation(values, mean) {
  if (!values.length || !Number.isFinite(mean)) return null;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function buildRollingAverageSeries(rows, windowSize = 3) {
  const size = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : 3;
  const normalized = normalizeRows(rows);
  return normalized.map((row, index) => {
    if (index + 1 < size) return { m: row.m, n: null };
    const window = normalized.slice(index + 1 - size, index + 1).map(({ n }) => n);
    return { m: row.m, n: roundOne(average(window)) };
  });
}

export function buildResidentialStability({
  rows = [],
  start = null,
  end = null,
  coverageDate = null,
} = {}) {
  const normalized = normalizeRows(rows, { start, end, coverageDate });
  const coverageMonth = monthKey(coverageDate);
  const partialMonthExcluded = Boolean(
    coverageMonth
    && isPartialCoverageMonth(coverageDate)
    && normalized.some(({ m }) => m === coverageMonth),
  );
  const completeRows = partialMonthExcluded
    ? normalized.filter(({ m }) => m !== coverageMonth)
    : normalized;
  const counts = completeRows.map(({ n }) => n);
  const totalRecords = counts.reduce((sum, count) => sum + count, 0);
  const monthlyAverage = average(counts);

  let recentAverage = null;
  let priorAverage = null;
  let recentChangePct = null;
  let trend = 'insufficient';
  if (counts.length >= 6) {
    recentAverage = average(counts.slice(-3));
    priorAverage = average(counts.slice(-6, -3));
    if (priorAverage > 0) {
      recentChangePct = roundOne(((recentAverage - priorAverage) / priorAverage) * 100);
      trend = recentChangePct > 5
        ? 'rising'
        : recentChangePct < -5 ? 'falling' : 'steady';
    }
  }

  let volatility = 'insufficient';
  const deviation = standardDeviation(counts, monthlyAverage);
  const coefficientOfVariation = monthlyAverage > 0 && deviation != null
    ? deviation / monthlyAverage
    : null;
  if (coefficientOfVariation != null && counts.length >= 6) {
    volatility = coefficientOfVariation <= 0.15
      ? 'low'
      : coefficientOfVariation <= 0.35 ? 'moderate' : 'high';
  }

  const confidence = counts.length >= 12 && totalRecords >= 50
    ? 'high'
    : counts.length >= 6 && totalRecords >= 20 ? 'medium' : 'low';

  return Object.freeze({
    monthsObserved: counts.length,
    totalRecords,
    monthlyAverage: roundOne(monthlyAverage),
    recentAverage: roundOne(recentAverage),
    priorAverage: roundOne(priorAverage),
    recentChangePct,
    trend,
    volatility,
    confidence,
    partialMonthExcluded,
  });
}
