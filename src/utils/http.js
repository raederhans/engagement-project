const BACKOFF_DELAYS_MS = [1000, 2000, 4000];
const LRU_MAX = 200;
const DEFAULT_TTL = 5 * 60_000; // 5 minutes

const inflight = new Map(); // key -> Promise
const lru = new Map(); // key -> {expires, data}

function hashKey(s) {
  // djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function lruGet(key) {
  const v = lru.get(key);
  if (!v) return null;
  if (Date.now() >= v.expires) { lru.delete(key); return null; }
  // refresh recency
  lru.delete(key); lru.set(key, v);
  return v.data;
}

function lruSet(key, data, ttl) {
  lru.set(key, { data, expires: Date.now() + (ttl ?? DEFAULT_TTL) });
  while (lru.size > LRU_MAX) {
    const firstKey = lru.keys().next().value;
    lru.delete(firstKey);
  }
}

function ssGet(key) {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { expires, data } = JSON.parse(raw);
    if (Date.now() >= expires) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function ssSet(key, data, ttl) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + (ttl ?? DEFAULT_TTL) }));
  } catch {}
}

async function appendRetryLog(line) {
  // Node-only file append
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const fs = await importNodeFs();
      await fs.mkdir('logs', { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const p = `logs/http_retries_${ts}.log`;
      await fs.appendFile(p, line + '\n');
    }
  } catch {}
}

/**
 * Fetch JSON with cache, dedupe, and backoff.
 * @template T
 * @param {string} url
 * @param {RequestInit & {timeoutMs?:number, retries?:number, cacheTTL?:number}} [options]
 * @returns {Promise<T>}
 */
export async function fetchJson(url, { timeoutMs = 15000, retries, cacheTTL, method = 'GET', body, headers, signal, ...rest } = {}) {
  if (!url) throw new Error('fetchJson requires url');
  throwIfAborted(signal);
  const normalizedMethod = method.toUpperCase();
  const safeMethod = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
  const effectiveCacheTTL = cacheTTL ?? (safeMethod ? DEFAULT_TTL : 0);
  const effectiveRetries = retries ?? (safeMethod || effectiveCacheTTL > 0 ? 2 : 0);
  const keyBase = `${normalizedMethod} ${url} ${typeof body === 'string' ? hashKey(body) : hashKey(JSON.stringify(body ?? ''))}`;
  const cacheKey = `cache:${hashKey(keyBase)}`;
  const cacheEnabled = Number(effectiveCacheTTL) > 0;
  const shareInflight = cacheEnabled && !signal;

  // memory/session cache
  const dev = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) || (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development');
  const mem = cacheEnabled ? lruGet(cacheKey) : null;
  if (mem != null) { if (dev) console.log(`cache HIT: ${cacheKey}`); return mem; }
  const ss = cacheEnabled ? ssGet(cacheKey) : null;
  if (ss != null) { if (dev) console.log(`cache HIT(session): ${cacheKey}`); lruSet(cacheKey, ss, effectiveCacheTTL); return ss; }

  if (shareInflight && inflight.has(cacheKey)) return inflight.get(cacheKey);

  const p = (async () => {
    let attempt = 0;
    const total = Math.max(0, effectiveRetries) + 1;
    while (attempt < total) {
      const attemptSignal = createAttemptSignal(signal, timeoutMs);
      try {
        try {
          const res = await fetch(url, { method, body, headers, ...rest, signal: attemptSignal.signal });
          if (!res.ok) {
            const shouldRetry = res.status === 429 || (res.status >= 500 && res.status <= 599);
            if (!shouldRetry) throw new Error(`HTTP ${res.status}`);
            throw new RetryableError(`HTTP ${res.status}`);
          }
          const data = await res.json();
          throwIfAborted(signal);
          if (cacheEnabled) {
            lruSet(cacheKey, data, effectiveCacheTTL);
            ssSet(cacheKey, data, effectiveCacheTTL);
          }
          if (dev) console.log(`cache MISS: ${cacheKey}`);
          return data;
        } finally {
          attemptSignal.cleanup();
        }
      } catch (e) {
        throwIfAborted(signal);
        const error = attemptSignal.signal.aborted
          && attemptSignal.signal.reason?.name === 'TimeoutError'
          ? attemptSignal.signal.reason
          : e;
        const last = attempt === total - 1;
        const retryable = error.name === 'TimeoutError' || error instanceof RetryableError || /ETIMEDOUT|ENOTFOUND|ECONNRESET/.test(String(error?.message || error));
        if (!retryable || last) { throw error; }
        const delay = BACKOFF_DELAYS_MS[Math.min(attempt, BACKOFF_DELAYS_MS.length - 1)];
        await appendRetryLog(`[${new Date().toISOString()}] retry ${attempt + 1} for ${url}: ${error?.message || error}`);
        await waitForRetry(delay, signal);
      } finally {
        attempt++;
      }
    }
    throw new Error('exhausted retries');
  })();

  if (!shareInflight) return p;

  inflight.set(cacheKey, p);
  try {
    const data = await p;
    return data;
  } finally {
    inflight.delete(cacheKey);
  }
}

class RetryableError extends Error {}

/**
 * Convenience wrapper to retrieve GeoJSON payloads.
 */
export async function fetchGeoJson(url, options) {
  return fetchJson(url, options);
}

/**
 * Append a SQL or URL to queries log in Node; no-op in browser.
 */
export async function logQuery(label, content) {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const fs = await importNodeFs();
      await fs.mkdir('logs', { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const p = `logs/queries_${ts}.log`;
      await fs.appendFile(p, `[${new Date().toISOString()}] ${label}: ${content}\n`);
    }
  } catch {}
}

async function importNodeFs() {
  const specifier = 'node:fs/promises';
  return import(/* @vite-ignore */ specifier);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException('The operation was aborted.', 'AbortError');
}

function createAttemptSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  const timer = timeoutMs > 0 && !controller.signal.aborted
    ? setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), timeoutMs)
    : null;

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function waitForRetry(delay, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
