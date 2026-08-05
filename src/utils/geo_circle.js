const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees) => degrees * Math.PI / 180;
const toDegrees = (radians) => radians * 180 / Math.PI;

export function distanceMeters([lonA, latA], [lonB, latB]) {
  const lat1 = toRadians(latA);
  const lat2 = toRadians(latB);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(lonB - lonA);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function geometryVertexCentroid(geometry) {
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  let x = 0;
  let y = 0;
  let count = 0;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const closed = ring.length > 1
        && ring[0][0] === ring.at(-1)[0]
        && ring[0][1] === ring.at(-1)[1];
      for (const coordinate of closed ? ring.slice(0, -1) : ring) {
        x += coordinate[0];
        y += coordinate[1];
        count += 1;
      }
    }
  }
  return count ? [x / count, y / count] : null;
}

export function circleFeature([longitude, latitude], radiusM, steps = 64) {
  const angularDistance = radiusM / EARTH_RADIUS_M;
  const latitudeRadians = toRadians(latitude);
  const longitudeRadians = toRadians(longitude);
  const coordinates = [];
  for (let index = 0; index < steps; index += 1) {
    const bearing = -2 * Math.PI * index / steps;
    const nextLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance)
      + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const nextLongitude = longitudeRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitude),
    );
    coordinates.push([toDegrees(nextLongitude), toDegrees(nextLatitude)]);
  }
  coordinates.push(coordinates[0]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}
