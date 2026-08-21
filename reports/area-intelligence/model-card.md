# Area Intelligence baseline model card

Generated: 2026-08-21T07:53:40.810Z

## Decision

No count model passed every pre-defined temporal, spatial, interval-coverage, and category gate. Product serving remains historical-only and forecast is explicitly unavailable.

## Intended use

This baseline estimates weekly counts of preliminary PPD reported incidents for admitted census-tract and fixed-grid units. It is not an individual victim probability, safety score, safest-area or safest-route tool, live alert, causal model, or complete measure of harm.

## Data and evaluation

- Source coverage: 2006-01-01 to 2026-08-22 (exclusive upper bound); complete evaluation weeks end before 2026-08-17.
- Units: 408 tracts and 2352 fixed-grid cells with admitted event evidence.
- Admission excludes 549594 ambiguous tract rows and 64129 unmapped tract rows; they are never force-assigned.
- Four frozen rolling temporal folds and contiguous spatial-block holdouts are evaluated with MAE, Poisson/NB deviance, 90% interval coverage, relative seasonal gain, and category/space/data-volume residual slices.

## Aggregate primary metrics

| Model | MAE | Poisson deviance | NB deviance | 90% coverage | Gain vs seasonal |
| --- | ---: | ---: | ---: | ---: | ---: |
| moving-average-13w | 1.0722 | 1.3628 | 0.9846 | 93.49% | 25.35% |
| moving-average-4w | 1.1149 | 2.3957 | 1.9822 | 94.52% | 22.38% |
| negative-binomial-log-link-v1 | 1.2198 | 1.3057 | 0.8482 | 97.06% | 15.07% |
| poisson-log-link-v1 | 17.4851 | 29.7870 | 1.2138 | 82.64% | -1117.39% |
| seasonal-naive-52w | 1.4363 | 10.8203 | 10.0359 | 92.77% | 0.00% |

## Error and fairness boundaries

Residual and bias/error artifacts use `negative-binomial-log-link-v1` for diagnostic display even when it is not promoted. ACS population estimate and 90% MOE are audited only for temporally compatible 2020-2024 weeks and never used as ranking weights. Race, income, and poverty inputs are unavailable, so related disparities remain unmeasured rather than cleared.

## Governance and source limitations

- The model follows the use-case scoping, measurement, documentation, and stop/no-promotion posture of the [NIST AI Risk Management Framework 1.0](https://doi.org/10.6028/NIST.AI.100-1). NIST currently notes that AI RMF 1.0 is being revised; this card does not claim certification or compliance.
- The [Philadelphia official Crime Incidents page](https://data.phila.gov/visualizations/crime-incidents/) describes preliminary records, later reclassification, and hundred-block generalized locations.
- The [Census Bureau ACS methodology](https://www.census.gov/programs-surveys/acs/methodology/sample-size-and-data-quality/sample-size-definitions.html) publishes 90% margins of error; estimate and MOE remain distinct here.

Local fitting and backtesting do not establish main integration, remote CI, continuous retraining, production runtime, deployment, causal validity, future performance, scientific validity, or user decision quality.
