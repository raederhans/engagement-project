export function createMapOriginSelectionHandler({ syncPanel, clearCurrentArtifact }) {
  return (_key, { origin } = {}) => {
    if (origin !== 'map') return false;
    syncPanel();
    clearCurrentArtifact();
    return true;
  };
}
