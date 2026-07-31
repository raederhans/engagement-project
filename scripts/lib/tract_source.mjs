export async function fetchFirstValidTractSource(endpoints, {
  attempts = 3,
  fetchJson,
  validate,
  onFailure = () => {},
  sleep = defaultSleep,
  retryDelay = (attempt) => 1000 * (2 ** attempt),
} = {}) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('At least one tract endpoint is required.');
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Tract endpoint attempts must be a positive integer.');
  }
  if (typeof fetchJson !== 'function' || typeof validate !== 'function') {
    throw new Error('Tract source fetching requires fetchJson and validate functions.');
  }

  for (const sourceUrl of endpoints) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const data = validate(await fetchJson(sourceUrl), sourceUrl);
        return { data, sourceUrl };
      } catch (error) {
        onFailure(`${sourceUrl} attempt ${attempt} failed: ${error?.message || error}`);
        if (attempt < attempts) await sleep(retryDelay(attempt - 1));
      }
    }
  }
  throw new Error(`All ${endpoints.length} tract endpoints failed validation.`);
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
