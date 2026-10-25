# FALK Audit Report — 2026-10-25 03:05

## Git state
```
8d73b24 feat(12+13): feature metadata + MTF availability with acceptance tests (643 total)
96ea7da stage8.5+9+10: complete Fusion, Backtesting, Alerting at 100%
83c8549 stage8.5: close ┬د8 at 100% (alignment, semantic instrument, skip, fail, quote, priority)
c06001b stage9: complete Backtesting Engine (9.0-9.5)
00e075d stage8: complete Data Fusion Engine (8.0-8.4, 100%)


```

## src directories
| Directory | .ts files |
|---|---|
| alerts | 8 |
| audit | 2 |
| backtest | 8 |
| backup | 1 |
| calendar | 1 |
| contracts | 2 |
| core | 7 |
| dashboard | 2 |
| data | 0 |
| data-fusion | 12 |
| data-quality | 18 |
| events | 4 |
| evidence | 1 |
| feature-engineering | 8 |
| gates | 1 |
| ingestion | 22 |
| integration | 1 |
| monitoring | 4 |
| multi-timeframe | 3 |
| normalization | 4 |
| orchestration | 1 |
| replay | 4 |
| scenarios | 1 |
| security | 4 |
| storage | 1 |
| tests | 85 |

## Test files
| File | Declared tests |
|---|---|
| aggregation-source.test.ts | 4 |
| alert-bridge.test.ts | 4 |
| alerts-channels.test.ts | 15 |
| alerts-integration.test.ts | 15 |
| alerts-router.test.ts | 18 |
| alerts-rules.test.ts | 26 |
| alerts-types.test.ts | 9 |
| backtest-cli.test.ts | 11 |
| backtest-event-loop.test.ts | 14 |
| backtest-execution.test.ts | 20 |
| backtest-metrics.test.ts | 18 |
| backtest-runner.test.ts | 11 |
| backtest-types.test.ts | 11 |
| backup.test.ts | 3 |
| comparator.test.ts | 4 |
| conflict-record.test.ts | 3 |
| connector-manager.test.ts | 5 |
| csv-loader.test.ts | 1 |
| dashboard-reports-store.test.ts | 14 |
| dashboard-session.test.ts | 5 |
| engine-results.test.ts | 4 |
| error-queue.test.ts | 5 |
| event-intelligence.test.ts | 5 |
| evidence-snapshot.test.ts | 3 |
| feature.test.ts | 4 |
| feature-acceptance.test.ts | 9 |
| financial.test.ts | 7 |
| fusion.test.ts | 5 |
| fusion-enrich.test.ts | 8 |
| fusion-enrich-8-5.test.ts | 20 |
| fusion-enrich-independence.test.ts | 6 |
| fusion-enrich-v84.test.ts | 15 |
| fusion-independence.test.ts | 7 |
| fusion-outlier-detector.test.ts | 6 |
| fusion-price-difference.test.ts | 7 |
| fusion-quote-comparator.test.ts | 6 |
| fusion-report-adapter.test.ts | 4 |
| fusion-status-migration.test.ts | 8 |
| fusion-timestamp-aligner.test.ts | 5 |
| gap-fixer.test.ts | 15 |
| gaps.test.ts | 10 |
| h3-aggregator.test.ts | 7 |
| health-monitor.test.ts | 5 |
| history-restorer.test.ts | 4 |
| integration.test.ts | 2 |
| live-ingestion.test.ts | 6 |
| load.test.ts | 4 |
| migration.test.ts | 5 |
| missing.test.ts | 6 |
| monitoring.test.ts | 4 |
| mtf-acceptance.test.ts | 8 |
| multi-timeframe.test.ts | 8 |
| news-features.test.ts | 4 |
| oidc.test.ts | 1 |
| orchestration.test.ts | 2 |
| precision-handler.test.ts | 7 |
| quality.test.ts | 3 |
| quality-validators.test.ts | 7 |
| rate-limiter.test.ts | 5 |
| reference-fetcher.test.ts | 5 |
| replay-evidence.test.ts | 5 |
| request-tracker.test.ts | 4 |
| retry-manager.test.ts | 4 |
| run-context.test.ts | 5 |
| scenarios.test.ts | 1 |
| scheduler.test.ts | 5 |
| schema-mapper.test.ts | 6 |
| security.test.ts | 3 |
| session-calendar.test.ts | 52 |
| source-registry.test.ts | 9 |
| source-registry-audit.test.ts | 7 |
| stage11a-source-timestamp-connectors.test.ts | 3 |
| stage11bc-schema-tz.test.ts | 8 |
| stage1-normalization.test.ts | 6 |
| stage2-quality-checks.test.ts | 8 |
| stage7-quality-checks.test.ts | 8 |
| stage8a-symbol-metadata.test.ts | 11 |
| stage8b-source-timestamp.test.ts | 6 |
| stage8c-fusion-time-blocked.test.ts | 7 |
| stage8d-pipeline-time-blocking.test.ts | 4 |
| stage9-dashboard-history.test.ts | 5 |
| timestamp-validator.test.ts | 5 |
| unit-normalizer.test.ts | 4 |
| version-compare.test.ts | 3 |
| versions.test.ts | 4 |
| **TOTAL** | **646** |
