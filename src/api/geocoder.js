import { fetchJson } from '../utils/http.js';

const PHILADELPHIA_GEOCODER = 'https://citygeo-geocoder-pub.databridge.phila.gov/arcgis/rest/services/Geocoders/Philly_Composite_Locator/GeocodeServer/findAddressCandidates';
const PHILADELPHIA_PROPERTY_GEOCODER = 'https://citygeo-geocoder-pub.databridge.phila.gov/arcgis/rest/services/Geocoders/Address_Locator/GeocodeServer/findAddressCandidates';

/**
 * Resolve raw City address candidates for Home Compare without browser/session
 * caching. The caller must still apply score, ambiguity, geography, and OPA
 * parcel admission; a geocoder candidate is not property identity.
 */
export async function findPhiladelphiaPropertyAddressCandidates(address, {
  request = fetchJson,
  signal,
} = {}) {
  const query = String(address || '').trim();
  if (query.length < 3 || query.length > 160) {
    throw new Error('Enter a bounded Philadelphia street address.');
  }
  const params = new URLSearchParams({
    Street: query,
    f: 'json',
    outSR: '4326',
    maxLocations: '5',
    outFields: '*',
  });
  const response = await request(`${PHILADELPHIA_PROPERTY_GEOCODER}?${params}`, {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 8000,
    signal,
  });
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || !Array.isArray(response.candidates)) {
    throw new Error('The City address response is unavailable.');
  }
  return response;
}

export async function geocodePhiladelphiaAddress(address, {
  request = fetchJson,
  minScore = 85,
  signal,
} = {}) {
  const query = String(address || '').trim();
  if (query.length < 3) throw new Error('Enter a Philadelphia address or intersection.');
  const params = new URLSearchParams({
    SingleLine: query,
    f: 'json',
    outSR: '4326',
    maxLocations: '5',
  });
  const response = await request(`${PHILADELPHIA_GEOCODER}?${params}`, {
    cacheTTL: 10 * 60_000,
    retries: 1,
    timeoutMs: 8000,
    signal,
  });
  const candidate = (response?.candidates || [])
    .filter((item) => Number.isFinite(Number(item?.location?.x)) && Number.isFinite(Number(item?.location?.y)))
    .sort((a, b) => Number(b.score) - Number(a.score))[0];
  if (!candidate || Number(candidate.score) < minScore) {
    throw new Error('No confident Philadelphia match was found. Try a full street address or intersection.');
  }
  return {
    address: normalizeAddressLabel(candidate.address || query),
    score: Number(candidate.score),
    lngLat: [Number(candidate.location.x), Number(candidate.location.y)],
  };
}

export function createLatestGeocodeOwner({ geocode = geocodePhiladelphiaAddress } = {}) {
  const targets = new Map();

  function cancel(target) {
    const current = targets.get(target);
    if (!current) return;
    current.controller.abort(new DOMException('Superseded geocode request.', 'AbortError'));
    targets.delete(target);
  }

  return Object.freeze({
    cancel,
    cancelAll() {
      for (const target of [...targets.keys()]) cancel(target);
    },
    isPending(target) {
      return targets.has(target);
    },
    async resolve(target, address, { shouldCommit = () => true } = {}) {
      cancel(target);
      const controller = new AbortController();
      const owner = { controller };
      targets.set(target, owner);
      try {
        const result = await geocode(address, { signal: controller.signal });
        if (targets.get(target) !== owner || controller.signal.aborted || !shouldCommit()) {
          return { applied: false, result: null };
        }
        return { applied: true, result };
      } catch (error) {
        if (controller.signal.aborted || targets.get(target) !== owner || error?.name === 'AbortError') {
          return { applied: false, result: null };
        }
        throw error;
      } finally {
        if (targets.get(target) === owner) targets.delete(target);
      }
    },
  });
}

function normalizeAddressLabel(value) {
  return String(value || '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}
