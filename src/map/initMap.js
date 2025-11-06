import maplibregl from 'maplibre-gl';

/**
 * Initialize a MapLibre map instance with a simple OSM raster basemap.
 * @returns {import('maplibre-gl').Map}
 */
export function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [
        { id: 'osm-tiles', type: 'raster', source: 'osm' }
      ]
    },
    center: [-75.1652, 39.9526],
    zoom: 11,
  });

  return map;
}

