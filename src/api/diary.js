const PUBLIC_WRITE_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 'unavailable',
  mode: 'local-only',
  capability: 'unavailable',
  network: 'disabled',
  persisted: false,
  shared: false,
  message: 'Public Diary and Community submissions are unavailable. No data left this browser.',
});

const READ_CAPABILITY_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 'unavailable',
  mode: 'local-only',
  capability: 'unavailable',
  network: 'disabled',
  persisted: false,
  shared: false,
  message: 'Remote Diary data is not a product capability.',
});

/**
 * Create the static Pages Diary capability.
 *
 * Public writes are mechanically unavailable. The factory and every method
 * intentionally accept no configuration: environment values, endpoints,
 * transports, adapters, and caller options cannot create a submission path.
 * Private Diary persistence is owned by the browser-local repository instead.
 */
export function createDiaryClient() {
  return Object.freeze({
    async submitDiary() {
      return PUBLIC_WRITE_UNAVAILABLE;
    },

    async getSegments() {
      return READ_CAPABILITY_UNAVAILABLE;
    },

    async getSegmentDetails() {
      return READ_CAPABILITY_UNAVAILABLE;
    },

    async getSegmentAnalytics() {
      return READ_CAPABILITY_UNAVAILABLE;
    },

    async submitAgree() {
      return PUBLIC_WRITE_UNAVAILABLE;
    },

    async submitImprove() {
      return PUBLIC_WRITE_UNAVAILABLE;
    },
  });
}

const defaultClient = createDiaryClient();

export const submitDiary = () => defaultClient.submitDiary();
export const getSegments = () => defaultClient.getSegments();
export const getSegmentDetails = () => defaultClient.getSegmentDetails();
export const getSegmentAnalytics = () => defaultClient.getSegmentAnalytics();
export const submitAgree = () => defaultClient.submitAgree();
export const submitImprove = () => defaultClient.submitImprove();
