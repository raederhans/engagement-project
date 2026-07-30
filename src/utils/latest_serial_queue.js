export function createLatestSerialQueue(run) {
  let latestToken = 0;
  let tail = Promise.resolve();

  return (value) => {
    const token = ++latestToken;
    const task = tail.then(() => run(value, {
      isLatest: () => token === latestToken,
    }));
    tail = task.catch(() => {});
    return task;
  };
}
