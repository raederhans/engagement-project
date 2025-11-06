/**
 * Helper to retrieve a tract polygon and bbox by GEOID, truncating coordinates.
 * @param {{type:'FeatureCollection',features:any[]}} tractFC
 * @param {string} geoid
 * @param {{decimals?:number}} [opts]
 * @returns {{ geojsonPolygon4326: object, bbox4326: [number,number,number,number] } | null}
 */
export function getTractPolygonAndBboxByGEOID(tractFC, geoid, { decimals = 6 } = {}) {
  if (!tractFC || !Array.isArray(tractFC.features)) return null;
  const target = String(geoid);
  const feat = tractFC.features.find(f => {
    const p = f?.properties || {};
    const g = p.GEOID || p.GEOID20 || p.TRACT || p.TRACT_FIPS;
    return g && String(g) === target;
  });
  if (!feat || !feat.geometry) return null;
  const geom = truncateGeom(feat.geometry, decimals);
  const bbox = computeBbox4326(geom);
  return { geojsonPolygon4326: geom, bbox4326: bbox };
}

function truncateGeom(geom, decimals) {
  const r = (n) => Number(n.toFixed(decimals));
  const rc = (coords) => Array.isArray(coords[0]) ? coords.map(rc) : [r(coords[0]), r(coords[1])];
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: rc(geom.coordinates) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map(rc) };
  return geom;
}

function computeBbox4326(geom) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const visit = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      const x = c[0], y = c[1];
      if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    } else {
      for (const n of c) visit(n);
    }
  };
  if (geom.type === 'Polygon') visit(geom.coordinates);
  else if (geom.type === 'MultiPolygon') visit(geom.coordinates);
  if (!Number.isFinite(minx)) return null;
  return [minx, miny, maxx, maxy];
}

