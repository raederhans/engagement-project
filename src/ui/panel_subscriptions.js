export function createPanelSubscriptions() {
  const releases = new Set();

  return {
    add(subscribe, listener) {
      if (typeof subscribe !== 'function') return () => {};
      const release = subscribe(listener);
      if (typeof release === 'function') releases.add(release);
      return release;
    },
    release() {
      for (const dispose of releases) {
        try {
          dispose();
        } catch (error) {
          console.warn('[panel] subscription cleanup failed:', error);
        }
      }
      releases.clear();
    },
  };
}
