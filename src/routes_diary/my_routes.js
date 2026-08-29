const MY_ROUTES_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 'unavailable',
  mode: 'local-only',
  capability: 'unavailable',
  network: 'disabled',
  persisted: false,
  shared: false,
  message: 'This legacy My Routes surface is unavailable. Use the browser-local Diary history.',
});

/**
 * Legacy API-shaped route actions remain inert. Browser-local route CRUD is
 * provided by the Diary repository and local history controller, not here.
 */
export function openMyRoutesPanel() {
  return MY_ROUTES_UNAVAILABLE;
}

export function closeMyRoutesPanel() {
  return MY_ROUTES_UNAVAILABLE;
}

export function loadRoute() {
  return MY_ROUTES_UNAVAILABLE;
}

export function deleteRoute() {
  return MY_ROUTES_UNAVAILABLE;
}
