function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeIfPresent(resource) {
  if (resource?.close) await resource.close();
}

/**
 * Own a preview/browser/context/page as one recoverable test transaction.
 * Every resource is optional until it has been created, so setup failures
 * still release earlier resources in reverse acquisition order.
 */
export async function runBrowserSuite({
  prepare,
  createPreview,
  launchBrowser,
  createContext = (browser) => browser.newContext(),
  configureContext,
  configurePage,
  cleanupArtifacts,
  run,
}) {
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  let result;
  const cleanupErrors = [];
  try {
    await prepare?.();
    server = await createPreview();
    browser = await launchBrowser();
    context = await createContext(browser);
    await configureContext?.(context, { server, browser });
    page = await context.newPage();
    await configurePage?.(page, context, { server, browser });
    result = await run({ server, browser, context, page });
  } finally {
    for (const operation of [
      () => closeIfPresent(page),
      () => closeIfPresent(context),
      () => closeIfPresent(browser),
      () => (server ? closeServer(server) : undefined),
      () => cleanupArtifacts?.(),
    ]) {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Browser suite cleanup failed.');
  return result;
}
