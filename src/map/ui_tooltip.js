/**
 * Attach hover tooltip for a fill layer.
 * @param {import('maplibre-gl').Map} map
 * @param {string} [layer='districts-fill']
 */
export function attachHover(map, layer = 'districts-fill') {
  const tip = document.getElementById('tooltip');
  if (!tip) return;

  map.on('mousemove', layer, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const props = f.properties || {};
    const id = props.DIST_NUMC ?? props.dc_dist ?? '';
    const name = props.name ? ` ${props.name}` : '';
    const val = Number(props.value ?? 0);
    tip.style.left = `${e.point.x}px`;
    tip.style.top = `${e.point.y}px`;
    tip.style.display = 'block';
    tip.textContent = `District ${id}${name ? ' -'+name : ''}: ${val}`;
  });

  map.on('mouseleave', layer, () => {
    tip.style.display = 'none';
  });
}
