import {
  ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION,
  createContractValidatorSupportV1,
} from './validator_support_v1.js';

export const ROUTE_DECISION_VALIDATOR_PROFILE_VERSION =
  `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:route-decision`;

export const {
  boundedId,
  booleanValue,
  deepFreeze,
  exactEnum,
  exactObject,
  exactSchemaVersion,
  exactSequence,
  fail,
  inspectPlainObject,
  safeInteger,
  strictArray,
  uniqueStrings,
} = createContractValidatorSupportV1({
  errorPrefix: 'route decision contract',
  exactObjectKeyOrder: 'input',
  exactSequenceBounds: 'max-only',
});
