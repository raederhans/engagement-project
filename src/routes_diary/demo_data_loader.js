export async function loadJsonFromCandidates(label, urls, {
  fetchImpl = fetch,
  signal,
} = {}) {
  signal?.throwIfAborted();
  let lastError;

  for (const url of urls) {
    try {
      const response = await fetchImpl(url, { cache: 'no-cache', signal });
      if (!response.ok) {
        throw new Error(`${label} request failed (${response.status})`);
      }
      const payload = await response.json();
      signal?.throwIfAborted();
      return payload;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }

  throw lastError || new Error(`${label} data unavailable`);
}

export async function loadOwnedDiaryData({
  loadSegments,
  loadRoutes,
  signal,
  isCurrent = () => true,
}) {
  signal?.throwIfAborted();
  const [segments, routes] = await Promise.all([
    loadSegments({ signal }),
    loadRoutes({ signal }),
  ]);
  signal?.throwIfAborted();
  if (!isCurrent()) return { applied: false, reason: 'stale' };
  return { applied: true, segments, routes };
}
