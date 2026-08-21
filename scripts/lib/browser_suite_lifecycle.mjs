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
  let didPrimaryFail = false;
  let primaryError;
  const cleanupErrors = [];
  try {
    try {
      await prepare?.();
      server = await createPreview();
      browser = await launchBrowser();
      context = await createContext(browser);
      await configureContext?.(context, { server, browser });
      page = await context.newPage();
      await configurePage?.(page, context, { server, browser });
      result = await run({ server, browser, context, page });
    } catch (error) {
      didPrimaryFail = true;
      primaryError = error;
    }
  } finally {
    for (const operation of [
      () => closeIfPresent(page),
      () => closeIfPresent(context),
      () => closeIfPresent(browser),
      // Vite preview returns a PreviewServer wrapper. Its own close() owns
      // the HTTP listener and any Vite-managed resources; reaching into
      // httpServer closes only part of that transaction.
      () => closeIfPresent(server),
      () => cleanupArtifacts?.(),
    ]) {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (didPrimaryFail && cleanupErrors.length) {
    const error = new AggregateError(
      [primaryError, ...cleanupErrors],
      'Browser suite failed and cleanup failed.',
    );
    error.primaryError = primaryError;
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
  if (didPrimaryFail) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Browser suite cleanup failed.');
  return result;
}
