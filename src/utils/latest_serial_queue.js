export function waitForOwnedPromise(promise, signal) {
  const observed = Promise.resolve(promise);
  if (!signal) return observed;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      settle(value);
    };
    const handleAbort = () => finish(
      reject,
      signal.reason || new DOMException('The owner was aborted.', 'AbortError'),
    );

    observed.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) handleAbort();
    else signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export function createLatestSerialQueue(run) {
  let latestToken = 0;
  let tail = Promise.resolve();
  let currentController = null;

  const schedule = (value) => {
    currentController?.abort(new DOMException('Superseded by a newer queued value.', 'AbortError'));
    const controller = new AbortController();
    currentController = controller;
    const token = ++latestToken;
    const task = tail.then(async () => {
      try {
        return await run(value, {
          isLatest: () => token === latestToken,
          signal: controller.signal,
        });
      } finally {
        if (currentController === controller) currentController = null;
      }
    });
    tail = task.catch(() => {});
    return task;
  };

  schedule.cancel = (reason = new DOMException('Cancelled current queued value.', 'AbortError')) => {
    latestToken += 1;
    if (!currentController || currentController.signal.aborted) return false;
    currentController.abort(reason);
    return true;
  };

  return schedule;
}
