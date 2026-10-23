# FALK Engines - Architecture

## 11-Stage Data Lifecycle

| # | Stage | File | Status |
|---|-------|------|--------|
| 1 | Source Registry | src/ingestion/source-registry.ts | OK |
| 2 | Data Ingestion | src/ingestion/twelvedata-ws.ts, binance-history.ts, checkpoint.ts | OK |
| 3 | Raw Storage | src/storage/raw-store.ts | OK |
| 4 | Data Quality | src/data-quality/checks/*.ts (8 checks) | OK |
| 5 | Normalization | src/normalization/canonical.ts | OK |
| 6 | Data Fusion | src/data-fusion/engine.ts | OK |
| 7 | Feature Engineering | src/feature-engineering/financial.ts | OK |
| 8 | Multi-Timeframe | src/multi-timeframe/aggregator.ts + aggregation-source.ts | OK |
| 9 | Event Intelligence | src/events/event-intelligence.ts + finnhub-news.ts + forexfactory-calendar.ts | OK |
| 10 | Evidence | src/evidence/evidence-chain.ts | OK |
| 11 | Replay | src/replay/replay-engine.ts + src/replay-cli.ts | OK |

## Session Calendar

src/calendar/session-calendar.ts - ASIA / LONDON / NY / OVERLAP + classifyGap

## 12 Non-Negotiable Principles - Coverage

| # | Principle | Enforced by |
|---|-----------|-------------|
| 1 | Keep raw + normalized | .backup/raw/ + CanonicalCandle.raw_payload_ref |
| 2 | Trace every value | lineage_id + raw_payload_ref |
| 3 | Preserve source symbol | CanonicalCandle.source_symbol |
| 4 | UTC + source time | event_time_utc + source_timezone |
| 5 | Volume semantics | volume_semantics: TICK/REAL/CONTRACT/UNKNOWN |
| 6 | Missing not zero | UNKNOWN instead of 0 |
| 7 | No lookahead | LookaheadGuard.assertNoLeak |
| 8 | Version changes tracked | normalization_version + compareVersions |
| 9 | Success not quality not suitability | SourceRegistry.validateUse + assessUsability |
| 10 | No Delta from OHLC | suitable_for.delta_cvd = false |
| 11 | No hidden conflict | STRICT_PRIORITY + REJECT_ON_CONFLICT |
| 12 | Analysis only | No execution code |

## Runtime Sources

- WebSocket primary: twelvedata-ws (XAU/USD)
- Backup: Binance PAXG (binance-paxg)
- News: Finnhub (finnhub)
- Calendar: ForexFactory (forexfactory)

## Data Directories

.backup/
  raw/{source}/{tf}/{lineage}.json    - 760+ auditable snapshots
  snapshots/                          - WORM (read-only)
  index.jsonl                         - append-only
  checkpoints/{source}-{tf}.json      - last sync per source:tf

## Commands

- npm run build       - TypeScript compile
- npm test            - 110 tests across 23 files
- npm start           - live pipeline (7 timeframes)
- npm run acceptance  - CERTIFIED
- npm run health      - 5-step verification
- npm run replay      - historical re-run