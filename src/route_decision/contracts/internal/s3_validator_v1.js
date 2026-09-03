import {
  ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION,
  createContractValidatorSupportV1,
} from './validator_support_v1.js';

export const S3_VALIDATOR_PROFILE_VERSION =
  `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:scenario-cohort-v1`;

export const {
  deepFreeze,
  exactObject,
  fail,
  inspectPlainObject,
  strictArray,
} = createContractValidatorSupportV1({
  errorPrefix: 'route decision S3 protocol contract',
  symbolPropertyMessage: 'must not contain symbols',
  exactObjectKeyOrder: 'input',
});
