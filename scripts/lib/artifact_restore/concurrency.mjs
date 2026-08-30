import { restoreError } from './errors.mjs';

export async function mapBounded(items, concurrency, worker) {
  if (!Array.isArray(items)) {
    throw restoreError('INVALID_WORK_ITEMS', 'Bounded work items must be an array.');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw restoreError(
      'INVALID_CONCURRENCY',
      'Concurrency must be an integer between 1 and 32.',
    );
  }
  if (typeof worker !== 'function') {
    throw restoreError('INVALID_WORKER', 'Bounded worker must be a function.');
  }
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let cursor = 0;
  let firstError;

  async function runWorker() {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (firstError) throw firstError;
  return results;
}
