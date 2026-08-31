# Data Foundation operations runbook

This runbook separates code/configuration availability from observed operations. A workflow file, prior
receipt, or copied report is not a current run observation.

## Preconditions

1. Pin the exact `ArtifactRegistry/v1` raw bytes and canonical `registryIdentity`.
2. Derive and admit `ArtifactObjectCatalog/v1`; every provider-neutral object key is
   `objects/sha256/<first-two-hex>/<full-hex>` and contains no credential or secret.
3. Select an explicit `file` or immutable `https` location. Never use Actions artifacts as the canonical
   warehouse.
4. Use a new caller-owned target root with enough capacity. Do not write a protected producer worktree.

## Manual clean-room restore

```powershell
node scripts/restore_data_artifacts.mjs plan --registry <registry.json> --registry-sha256 <64-lowercase-hex> --location file --file-location-root <mirror-root> --target <new-root>
node scripts/restore_data_artifacts.mjs restore --registry <registry.json> --registry-sha256 <64-lowercase-hex> --location file --file-location-root <mirror-root> --target <new-root>
node scripts/restore_data_artifacts.mjs verify --registry <registry.json> --registry-sha256 <64-lowercase-hex> --location file --file-location-root <mirror-root> --target <new-root>
```

The operator wrapper records a `DataFoundationOperationReceipt/v1` with environment identity, start/end,
duration, downloaded bytes, verified bytes/object count, verification duration, and peak disk. Until those
measurements are observed, use `status: unavailable` and null metrics.

## Second environment

Repeat the same plan/restore/verify sequence in a physically distinct environment. The receipt must use a
new environment identity and `physical_environment_observed: true`. A second directory on the same machine
is a clean-room path test, not second-physical-environment evidence.

## Manual and scheduled rebuild

- Manual rebuild: use `workflow_dispatch` only with exact registry path/SHA/identity and retain the terminal
  machine report.
- Scheduled rebuild: the cron configuration does not prove that a run occurred. Admit only the exact run
  receipt after registry/restore/full receipt reconciliation. Source or runner failure leaves status
  `unavailable` and must not advance a high-water mark or publish output.

## Missing/corrupted object disaster drill

1. Copy a lightweight fixture mirror into a new task-owned drill root.
2. Remove one fixture object; verify restore stops before downstream build.
3. Restore the fixture, mutate one object's bytes; verify SHA/bytes/row checks stop before downstream build.
4. Record both outcomes as `detected-and-blocked`, keep `downstream_build_started: false`, and record full
   operational metrics.

This fixture drill proves the failure contract only. It is not a full 10.81 GB warehouse drill, external
object-store proof, scheduled run, or production readiness evidence.
