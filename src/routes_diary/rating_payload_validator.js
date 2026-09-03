import Ajv from 'ajv';

const ALL_TAGS = [
  'poor_lighting',
  'low_foot_traffic',
  'cars_too_close',
  'construction_blockage',
  'strangers_loitering',
  'no_sidewalk',
  'bike_conflict',
  'speeding_cars',
  'blocked_crosswalk',
  'potholes',
  'other',
  'dogs',
];

const ratingSchema = {
  type: 'object',
  required: ['route_id', 'segment_ids', 'overall_rating', 'tags', 'mode', 'user_hash'],
  properties: {
    route_id: { type: 'string', minLength: 1 },
    segment_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    overall_rating: { type: 'integer', minimum: 1, maximum: 5 },
    tags: {
      type: 'array',
      items: { type: 'string', enum: ALL_TAGS },
      minItems: 1,
      maxItems: 3,
    },
    segment_overrides: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        required: ['segment_id', 'rating'],
        properties: {
          segment_id: { type: 'string', minLength: 1 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      default: [],
    },
    mode: { type: 'string', enum: ['walk', 'bike'] },
    user_hash: { type: 'string', minLength: 3 },
    notes: { type: 'string', maxLength: 200 },
    timestamp: { type: 'string' },
  },
};

const ajv = new Ajv({ allErrors: true });
const validatePayload = ajv.compile(ratingSchema);

export function validateRatingPayload(payload) {
  const ok = validatePayload(payload);
  return {
    ok,
    error: ok ? '' : ajv.errorsText(validatePayload.errors, { separator: '\n' }),
  };
}
