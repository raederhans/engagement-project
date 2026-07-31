const DAY_MS = 24 * 60 * 60 * 1000;

export function isCadenceDue(date, { anchor, intervalDays = 14 } = {}) {
  const current = parseUtcDate(date, 'date');
  const origin = parseUtcDate(anchor, 'anchor');
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error('intervalDays must be a positive integer.');
  }
  const elapsedDays = (current - origin) / DAY_MS;
  return elapsedDays >= 0 && elapsedDays % intervalDays === 0;
}

export function buildTractSourceAudit({
  contract,
  localTracts,
  remoteTracts,
  serviceMetadata,
  layerMetadata,
  checkedAt = new Date().toISOString(),
}) {
  validateContract(contract);
  const latestAcsVintage = Math.max(
    ...serviceMetadata.layers
      .map(({ name }) => /^ACS\s+(\d{4})$/i.exec(String(name || ''))?.[1])
      .filter(Boolean)
      .map(Number),
    0,
  );
  const currentLayerVintage = Number(
    /\b(20\d{2})\s+vintage\b/i.exec(String(layerMetadata.description || ''))?.[1] || 0,
  );
  const availableFields = new Set((layerMetadata.fields || []).map(({ name }) => name));
  const missingFields = contract.required_fields.filter((name) => !availableFields.has(name));
  const localGeoids = collectGeoids(localTracts, 'local');
  const remoteGeoids = collectGeoids(remoteTracts, 'remote');
  const localSet = new Set(localGeoids);
  const remoteSet = new Set(remoteGeoids);
  const addedGeoids = remoteGeoids.filter((geoid) => !localSet.has(geoid));
  const removedGeoids = localGeoids.filter((geoid) => !remoteSet.has(geoid));
  const reasons = [];

  if (latestAcsVintage > contract.expected_current_vintage) {
    reasons.push(`TIGERweb publishes ACS ${latestAcsVintage}; contract expects ${contract.expected_current_vintage}.`);
  }
  if (currentLayerVintage !== contract.expected_current_vintage) {
    reasons.push(`Current tract layer vintage ${currentLayerVintage || 'unknown'} differs from ${contract.expected_current_vintage}.`);
  }
  if (missingFields.length) reasons.push(`Current tract layer is missing fields: ${missingFields.join(', ')}.`);
  if (remoteGeoids.length !== contract.expected_geoid_count) {
    reasons.push(`Remote Philadelphia tract count ${remoteGeoids.length} differs from ${contract.expected_geoid_count}.`);
  }
  if (localGeoids.length !== contract.expected_geoid_count) {
    reasons.push(`Local Philadelphia tract count ${localGeoids.length} differs from ${contract.expected_geoid_count}.`);
  }
  if (addedGeoids.length || removedGeoids.length) {
    reasons.push(`Tract GEOID set changed: ${addedGeoids.length} added, ${removedGeoids.length} removed.`);
  }

  return {
    status: reasons.length ? 'drift' : 'stable',
    checked_at: new Date(checkedAt).toISOString(),
    expected_current_vintage: contract.expected_current_vintage,
    latest_acs_vintage: latestAcsVintage,
    current_layer_vintage: currentLayerVintage,
    local_geoid_count: localGeoids.length,
    remote_geoid_count: remoteGeoids.length,
    added_geoids: addedGeoids,
    removed_geoids: removedGeoids,
    missing_fields: missingFields,
    reasons,
  };
}

export function formatTractSourceAudit(report) {
  const lines = [
    `## Tract source audit: ${report.status.toUpperCase()}`,
    '',
    `- Checked: ${report.checked_at}`,
    `- Expected vintage: ${report.expected_current_vintage}`,
    `- Latest ACS group: ${report.latest_acs_vintage || 'unknown'}`,
    `- Current layer vintage: ${report.current_layer_vintage || 'unknown'}`,
    `- Local / remote GEOIDs: ${report.local_geoid_count} / ${report.remote_geoid_count}`,
  ];
  if (report.reasons.length) {
    lines.push('', '### Review required', '', ...report.reasons.map((reason) => `- ${reason}`));
  }
  return `${lines.join('\n')}\n`;
}

function parseUtcDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return timestamp;
}

function collectGeoids(collection, label) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error(`${label} tracts must be a FeatureCollection.`);
  }
  const geoids = collection.features.map((feature) => String(feature?.properties?.GEOID || ''));
  if (geoids.some((geoid) => !/^\d{11}$/.test(geoid))) {
    throw new Error(`${label} tracts contain an invalid GEOID.`);
  }
  const unique = [...new Set(geoids)].sort();
  if (unique.length !== geoids.length) throw new Error(`${label} tracts contain duplicate GEOIDs.`);
  return unique;
}

function validateContract(contract) {
  if (contract?.schema_version !== 1) throw new Error('Unsupported tract source contract schema.');
  if (!Number.isInteger(contract.expected_current_vintage)) throw new Error('Contract vintage is invalid.');
  if (!Number.isInteger(contract.expected_geoid_count)) throw new Error('Contract GEOID count is invalid.');
  if (!Array.isArray(contract.required_fields)) throw new Error('Contract required fields are invalid.');
}
