// Integration-owner-only trust roots. Source review keeps every record empty.
// There is intentionally no setter, installer, bootstrap, or mutation seam.
const INSTALLED_TRUSTED_CONTROLLER_OBSERVATION_JSON_TEXT = null;
const INSTALLED_OSMIUM_OBSERVATION_JSON_TEXT = null;
const INSTALLED_CURL_OBSERVATION_JSON_TEXT = null;
const INSTALLED_LIVE_RELEASE_JSON_TEXT = null;
const INSTALLED_PERSISTENT_NONCE_STORE_OBSERVATION_JSON_TEXT = null;

export function readInstalledTrustedControllerObservationJsonText() {
  return INSTALLED_TRUSTED_CONTROLLER_OBSERVATION_JSON_TEXT;
}

export function readInstalledToolObservationJsonText() {
  return INSTALLED_OSMIUM_OBSERVATION_JSON_TEXT;
}

export function readInstalledCurlObservationJsonText() {
  return INSTALLED_CURL_OBSERVATION_JSON_TEXT;
}

export function readInstalledLiveReleaseJsonText() {
  return INSTALLED_LIVE_RELEASE_JSON_TEXT;
}

export function readInstalledPersistentNonceStoreObservationJsonText() {
  return INSTALLED_PERSISTENT_NONCE_STORE_OBSERVATION_JSON_TEXT;
}
