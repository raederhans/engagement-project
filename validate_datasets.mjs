import fs from 'fs';

const s = JSON.parse(fs.readFileSync('data/segments_phl.demo.geojson', 'utf8'));
const r = JSON.parse(fs.readFileSync('data/routes_phl.demo.geojson', 'utf8'));

const seg = new Set(s.features.map(f => f.properties.segment_id));
let errors = 0;

for (const f of r.features) {
  const p = f.properties || {};

  // Check segment_ids and alt_segment_ids references
  ['segment_ids', 'alt_segment_ids'].forEach(k => {
    if (p[k]) {
      const miss = p[k].filter(id => !seg.has(id));
      if (miss.length) {
        console.error('Missing', k, 'for', p.route_id, miss);
        errors++;
      }
    }
  });

  // Check numeric fields
  ['length_m', 'duration_min', 'alt_length_m', 'alt_duration_min'].forEach(k => {
    if (p[k] != null && typeof p[k] !== 'number') {
      console.error('Non-numeric', k, 'for', p.route_id, '(value:', p[k], ')');
      errors++;
    }
  });

  // Check alt_geometry exists
  if (!p.alt_geometry) {
    console.warn('Missing alt_geometry for', p.route_id);
  }
}

console.log('segments:', s.features.length, 'routes:', r.features.length);
console.log('validation errors:', errors);
process.exit(errors > 0 ? 1 : 0);
