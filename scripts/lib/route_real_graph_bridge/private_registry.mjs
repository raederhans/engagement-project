// Integration-owner-only observation slots. They deliberately remain empty in
// RD-F. There is no mutation seam and no latent process/controller capability.
const INSTALLED_REAL_BRIDGE_OBSERVATION_JSON_TEXT = null;
const INSTALLED_TRUSTED_BUILD_EVIDENCE_JSON_TEXT = null;

export function readInstalledRealBridgeObservationJsonText() {
  return INSTALLED_REAL_BRIDGE_OBSERVATION_JSON_TEXT;
}

export function readInstalledTrustedBuildEvidenceJsonText() {
  return INSTALLED_TRUSTED_BUILD_EVIDENCE_JSON_TEXT;
}
