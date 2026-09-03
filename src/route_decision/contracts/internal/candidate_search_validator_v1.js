import {
  ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION,
  createContractValidatorSupportV1,
} from './validator_support_v1.js';

export const CANDIDATE_SEARCH_VALIDATOR_PROFILE_VERSION =
  `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:candidate-search-v2`;

export const {
  boundedId,
  deepFreeze,
  exactEnum,
  exactObject,
  exactSequence,
  fail,
  inspectPlainObject,
  safeInteger,
  strictArray,
} = createContractValidatorSupportV1({
  errorPrefix: 'route candidate search contract',
  exactObjectKeyOrder: 'required',
  exactSequenceBounds: 'exact',
});
