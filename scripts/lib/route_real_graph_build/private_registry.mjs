// Integration-owner-only trust roots. Records are primitive JSON text so no
// caller object can cross the contract boundary. All remain empty in RD-E.
// A separately reviewed source change and controller design are required to
// install or consume any record; this module exposes no mutation seam.
const INSTALLED_SUPERVISOR_ADMISSION_JSON_TEXT = null;
const INSTALLED_ACQUISITION_RELEASE_JSON_TEXT = null;
const INSTALLED_OBSERVED_PAYLOAD_RECEIPT_JSON_TEXT = null;
const INSTALLED_EXTRACTION_RELEASE_JSON_TEXT = null;

export function readInstalledSupervisorAdmissionJsonText() {
  return INSTALLED_SUPERVISOR_ADMISSION_JSON_TEXT;
}

export function readInstalledAcquisitionReleaseJsonText() {
  return INSTALLED_ACQUISITION_RELEASE_JSON_TEXT;
}

export function readInstalledObservedPayloadReceiptJsonText() {
  return INSTALLED_OBSERVED_PAYLOAD_RECEIPT_JSON_TEXT;
}

export function readInstalledExtractionReleaseJsonText() {
  return INSTALLED_EXTRACTION_RELEASE_JSON_TEXT;
}
