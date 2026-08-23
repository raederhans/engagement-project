import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  CONTROLLER_RUNTIME_CAPABILITY_SCHEMA,
} from './contracts.mjs';

export const REQUIRED_WINDOWS_RUNTIME_CAPABILITIES = Object.freeze([
  'exclusive-durable-nonce-reservation-no-replace',
  'durable-parent-directory-commit',
  'handle-level-ancestor-and-target-reparse-rejection',
  'open-then-final-path-and-file-identity-revalidation',
  'same-volume-atomic-no-replace-promotion',
  'closed-file-complete-traversal-sha256-and-byte-count',
  'post-promotion-reopen-and-complete-rehash',
  'windows-job-object-child-tree-containment',
  'bounded-controller-owned-stdout-stderr-capture',
  'deadline-tree-termination-before-terminal-state',
]);

export function inspectWindowsRuntimeAdapterCapability() {
  if (arguments.length !== 0) {
    fail('runtime-capability-arguments', 'runtime adapter capability inspection accepts no caller input');
  }
  return freezeData({
    schema: CONTROLLER_RUNTIME_CAPABILITY_SCHEMA,
    status: 'unavailable',
    implementation: null,
    implementationIdentity: null,
    nativeBindingObserved: false,
    handleLevelReparseSafetyProven: false,
    durableNoReplacePromotionProven: false,
    windowsJobObjectTreeContainmentProven: false,
    rootPidTerminationAcceptedAsTreeContainment: false,
    liveMethodsExposed: false,
    commandsRunnable: false,
    requiredCapabilities: REQUIRED_WINDOWS_RUNTIME_CAPABILITIES,
    reasonCodes: [
      'reviewed-native-filesystem-capability-missing',
      'reviewed-job-object-capability-missing',
      'live-adapter-not-installed',
    ],
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G unavailable Windows runtime adapter capability');
}
