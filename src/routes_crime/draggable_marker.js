export const MARKER_DRAG_SETTLE_MS = 350;

function readMarkerPosition(marker) {
  const position = marker.getLngLat?.();
  const lng = Number(position?.lng);
  const lat = Number(position?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

export function wireSettledMarkerDrag(marker, {
  scheduler = globalThis,
  settleMs = MARKER_DRAG_SETTLE_MS,
  isActive = () => true,
  onDragStart = () => {},
  onMove = () => {},
  onSettled = () => {},
} = {}) {
  let disposed = false;
  let settleTimer = null;

  const cancelSettle = () => {
    if (settleTimer == null) return;
    scheduler.clearTimeout(settleTimer);
    settleTimer = null;
  };
  const handleDragStart = () => {
    cancelSettle();
    if (!disposed && isActive()) onDragStart();
  };
  const handleDrag = () => {
    cancelSettle();
    if (disposed || !isActive()) return;
    const position = readMarkerPosition(marker);
    if (position) onMove(position);
  };
  const handleDragEnd = () => {
    cancelSettle();
    if (disposed || !isActive()) return;
    settleTimer = scheduler.setTimeout(() => {
      settleTimer = null;
      if (disposed || !isActive()) return;
      const position = readMarkerPosition(marker);
      if (position) onSettled(position);
    }, settleMs);
  };

  marker.on('dragstart', handleDragStart);
  marker.on('drag', handleDrag);
  marker.on('dragend', handleDragEnd);

  return () => {
    if (disposed) return;
    disposed = true;
    cancelSettle();
    marker.off('dragstart', handleDragStart);
    marker.off('drag', handleDrag);
    marker.off('dragend', handleDragEnd);
  };
}
