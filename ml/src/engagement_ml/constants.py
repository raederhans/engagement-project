from __future__ import annotations

ARTIFACT_REGISTRY_PROTOCOL = "ArtifactRegistry/v1"
MART_MANIFEST_SCHEMA = "engagement-area-intelligence-feature-mart/v2"
MART_ROW_SCHEMA = "engagement-area-intelligence-unit-week/v1"
PROTOCOL_SCHEMA = "engagement-area-intelligence-evaluation-protocol/v2"
ML_RESEARCH_RUN_SCHEMA = "MLResearchRun/v1"
ML_DATASET_MANIFEST_SCHEMA = "MLDatasetManifest/v1"
FEATURE_SCHEMA_V1 = "FeatureSchema/v1-js-parity"
FEATURE_SCHEMA_V2 = "FeatureSchema/v2"
BENCHMARK_REPORT_SCHEMA = "MLBenchmarkReport/v1"

SHA256_PREFIXED_PATTERN = r"^sha256:[a-f0-9]{64}$"
SHA256_BARE_PATTERN = r"^[a-f0-9]{64}$"

V1_FEATURE_COLUMNS = (
    "intercept",
    "log1p_lag52",
    "log1p_ma4",
    "log1p_ma13",
    "annual_sin",
    "annual_cos",
)

CATEGORY_COLUMNS = (
    "person",
    "property",
    "vehicle",
    "financial",
    "public_order",
    "other",
)

PRIMARY_MODEL_IDS = (
    "seasonal-naive-52w",
    "moving-average-4w",
    "moving-average-13w",
    "ewma-v1",
    "sklearn-poisson-l2-v1",
    "sklearn-hist-gradient-boosting-poisson-v1",
    "torch-nb-global-v1",
)

AUTHORITY_FALSE = {
    "serving_authority": False,
    "promotion_authority": False,
}
