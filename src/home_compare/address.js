const PHILADELPHIA_BOUNDS = Object.freeze([-75.35, 39.8, -74.9, 40.2]);
const PROPERTY_ADDRESS_TYPES = new Set(['PointAddress', 'StreetAddress', 'Subaddress']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function normalizeStreetAddress(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s*,\s*\d{5}(?:-\d{4})?\s*$/, '')
    .replace(/\s*,\s*PHILADELPHIA(?:\s*,\s*PA)?(?:\s+\d{5})?\s*$/, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function admitPropertyAddressCandidates(payload, {
  minScore = 90,
  ambiguityDelta = 2,
  bounds = PHILADELPHIA_BOUNDS,
  maximumSameAddressSpreadMeters = 150,
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Array.isArray(payload.candidates)) {
    fail('ADDRESS_RESPONSE_INVALID', 'The City address response is malformed.');
  }
  if (!Number.isFinite(minScore) || minScore < 75 || minScore > 100) {
    fail('ADDRESS_POLICY_INVALID', 'The address score policy is invalid.');
  }

  const inspected = payload.candidates.map((candidate, index) => inspectCandidate(candidate, index, bounds));
  const eligible = inspected
    .filter((candidate) => candidate.score >= minScore
      && PROPERTY_ADDRESS_TYPES.has(candidate.matchType)
      && candidate.house)
    .sort((left, right) => right.score - left.score || left.normalizedAddress.localeCompare(right.normalizedAddress));
  if (!eligible.length) {
    fail('ADDRESS_LOW_CONFIDENCE', 'No unique, high-confidence Philadelphia property address was found.');
  }

  const topScore = eligible[0].score;
  const competitive = eligible.filter((candidate) => topScore - candidate.score <= ambiguityDelta);
  const groups = new Map();
  for (const candidate of competitive) {
    const group = groups.get(candidate.normalizedAddress) || [];
    group.push(candidate);
    groups.set(candidate.normalizedAddress, group);
  }
  if (groups.size !== 1) {
    fail('ADDRESS_AMBIGUOUS', 'Multiple high-confidence address candidates remain; refine the address.');
  }
  const duplicates = [...groups.values()][0];
  for (let left = 0; left < duplicates.length; left += 1) {
    for (let right = left + 1; right < duplicates.length; right += 1) {
      if (distanceMeters(duplicates[left].lngLat, duplicates[right].lngLat) > maximumSameAddressSpreadMeters) {
        fail('ADDRESS_GEOGRAPHY_CONFLICT', 'Equivalent address candidates disagree geographically.');
      }
    }
  }
  const selected = duplicates[0];
  return Object.freeze({
    normalizedAddress: selected.normalizedAddress,
    displayAddress: selected.displayAddress,
    score: selected.score,
    lngLat: Object.freeze([...selected.lngLat]),
    matchType: selected.matchType,
    referenceId: selected.referenceId,
    candidateCount: payload.candidates.length,
  });
}

export function admitPropertyParcelJoin(addressMatch, payload, {
  maximumDistanceMeters = 150,
} = {}) {
  if (!addressMatch?.normalizedAddress || !Array.isArray(addressMatch.lngLat)) {
    fail('PARCEL_JOIN_INPUT_INVALID', 'A validated address match is required before parcel resolution.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    fail('PARCEL_RESPONSE_INVALID', 'The OPA parcel response is malformed.');
  }
  if (!payload.rows.length) {
    fail('PARCEL_MISSING', 'The address has no exact OPA parcel match.');
  }
  if (payload.rows.length !== 1) {
    fail('PARCEL_AMBIGUOUS', 'The address maps to multiple OPA parcel rows.');
  }

  const rows = payload.rows.map((row, index) => inspectParcelRow(row, index));
  if (rows.some((row) => row.normalizedLocation !== addressMatch.normalizedAddress)) {
    fail('PARCEL_ADDRESS_MISMATCH', 'The geocoder and OPA normalized addresses disagree.');
  }
  const nearest = rows
    .map((row) => ({ row, distance: distanceMeters(addressMatch.lngLat, row.lngLat) }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!Number.isFinite(nearest.distance) || nearest.distance > maximumDistanceMeters) {
    fail('PARCEL_GEOGRAPHY_MISMATCH', 'The geocoder point and OPA parcel point disagree geographically.');
  }
  return Object.freeze({
    normalizedAddress: addressMatch.normalizedAddress,
    displayAddress: addressMatch.displayAddress,
    score: addressMatch.score,
    lngLat: Object.freeze([...addressMatch.lngLat]),
    matchType: addressMatch.matchType,
    candidateCount: addressMatch.candidateCount,
    parcelId: nearest.row.parcelId,
    property: Object.freeze(nearest.row.property),
    join: Object.freeze({
      method: 'exact-normalized-address-plus-opa-point-consistency',
      distanceMeters: Math.round(nearest.distance * 10) / 10,
      candidateRows: rows.length,
    }),
  });
}

function inspectCandidate(candidate, index, bounds) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('ADDRESS_CANDIDATE_INVALID', `Address candidate ${index} is malformed.`);
  }
  const score = Number(candidate.score ?? candidate.attributes?.Score);
  const longitude = Number(candidate.location?.x);
  const latitude = Number(candidate.location?.y);
  if (!Number.isFinite(score) || score < 0 || score > 100
    || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    fail('ADDRESS_CANDIDATE_INVALID', `Address candidate ${index} has invalid score or coordinates.`);
  }
  if (longitude < bounds[0] || longitude > bounds[2] || latitude < bounds[1] || latitude > bounds[3]) {
    fail('ADDRESS_OUTSIDE_PHILADELPHIA', `Address candidate ${index} is outside the admitted Philadelphia bounds.`);
  }
  const displayAddress = boundedText(candidate.address || candidate.attributes?.Match_addr, 160, `candidate ${index} address`);
  const normalizedAddress = normalizeStreetAddress(displayAddress);
  if (!normalizedAddress) fail('ADDRESS_CANDIDATE_INVALID', `Address candidate ${index} has no normalized address.`);
  return {
    displayAddress,
    normalizedAddress,
    score,
    lngLat: [longitude, latitude],
    matchType: boundedText(candidate.attributes?.Addr_type || '', 40, `candidate ${index} type`, true),
    referenceId: boundedText(String(candidate.attributes?.Ref_ID ?? ''), 80, `candidate ${index} reference`, true) || null,
    house: boundedText(candidate.attributes?.House || '', 20, `candidate ${index} house`, true),
  };
}

function inspectParcelRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail('PARCEL_ROW_INVALID', `OPA parcel row ${index} is malformed.`);
  }
  const parcelId = boundedText(String(row.parcel_number ?? ''), 32, `parcel row ${index} identifier`);
  if (!/^\d{6,16}$/.test(parcelId)) {
    fail('PARCEL_ROW_INVALID', `OPA parcel row ${index} has an invalid parcel identifier.`);
  }
  const longitude = Number(row.lon);
  const latitude = Number(row.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < PHILADELPHIA_BOUNDS[0] || longitude > PHILADELPHIA_BOUNDS[2]
    || latitude < PHILADELPHIA_BOUNDS[1] || latitude > PHILADELPHIA_BOUNDS[3]) {
    fail('PARCEL_ROW_INVALID', `OPA parcel row ${index} has no usable geometry.`);
  }
  return {
    parcelId,
    normalizedLocation: normalizeStreetAddress(row.location),
    lngLat: [longitude, latitude],
    property: {
      assessmentDate: dateOrNull(row.assessment_date),
      marketValue: numberOrNull(row.market_value),
      marketValueDate: dateOrNull(row.market_value_date),
      latestSaleDate: dateOrNull(row.sale_date),
      latestSalePrice: numberOrNull(row.sale_price),
      recordingDate: dateOrNull(row.recording_date),
      totalLivableArea: numberOrNull(row.total_livable_area),
      bedrooms: numberOrNull(row.number_of_bedrooms),
      bathrooms: numberOrNull(row.number_of_bathrooms),
      yearBuilt: integerOrNull(row.year_built),
      zoning: boundedText(row.zoning || '', 40, `parcel row ${index} zoning`, true) || null,
    },
  };
}

function boundedText(value, maximum, label, optional = false) {
  if (typeof value !== 'string') fail('TEXT_INVALID', `${label} must be text.`);
  const text = value.trim();
  if ((!text && !optional) || text.length > maximum || /[\u0000-\u001f]/.test(text)) {
    fail('TEXT_INVALID', `${label} is invalid.`);
  }
  return text;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return Number.isInteger(number) ? number : null;
}

function dateOrNull(value) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function distanceMeters(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const [leftLon, leftLat] = left;
  const [rightLon, rightLat] = right;
  const deltaLat = radians(rightLat - leftLat);
  const deltaLon = radians(rightLon - leftLon);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
