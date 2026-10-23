# Changelog

## [1.0.0] -- 2026-10-23

### Added

**Data lifecycle (11/11 stages complete)**
- Source Registry with capability matrix + runtime status
- CheckpointManager: persistent last-sync per source:timeframe
- RawStore: 760+ auditable payload snapshots with lineage
- Schema + Duplicate + Cross-field validators
- Canonical normalization with source_symbol + volume_semantics
- Multi-timeframe aggregation (M1 -> M5/M15/H1/H4) with completeness check
- AggregationSource: builds H1 from M1, compares with 12d direct
- EventIntelligence: ForexFactory calendar (86 events)
- Finnhub news + heuristic sentiment (labeled heuristic_v1)
- Session calendar (ASIA/LONDON/NY/OVERLAP) + gap classifier
- EvidenceBuilder: raw -> normalized -> feature chain
- ReplayEngine: historical re-run from raw snapshots
- Version comparison with divergence detection

**Live pipeline**
- 7 timeframes: 1m, 5m, 15m, 1h, 4h, 1d, 1w
- Real XAU/USD via TwelveData WebSocket
- Automatic failover (TwelveData -> xaus.com -> Binance PAXG)
- Real-time dashboard on port 3000 with 7 tabs

**Dashboard**
- 7 timeframe tabs with per-tab chart, table, features
- Volume semantics indicator (UNKNOWN/TICK)
- Event stream with deduplication
- WORM snapshot counter

### Tests
- 110 tests across 23 files
- Coverage: features, quality, fusion, ingestion, multi-tf, events, evidence, replay

### Infrastructure
- GitHub Actions CI (FALK CI)
- Acceptance gate (npm run acceptance) -- CERTIFIED