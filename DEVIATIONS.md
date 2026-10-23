# FALK Engines — Deviations from Specification

**Document version:** 1.0.0
**Date:** 2026-10-23
**Status:** Approved by project owner

---

## Purpose

This document records **deliberate deviations** from `FALK_Data_Engines_Detailed_Specification.docx`. Each deviation is documented with its justification, impact, and approval status. The specification's §2 principle "every change to rules, settings, or equations produces a new version" is honored here: we are not silently hiding deviations, we are recording them.

---

## Deviation 1 — Timeframes

### Specification (§1)
> "األطر: M5 و M1 و H4 و H3 و M15 و W1"
> (M1, M5, M15, H3, H4, W1 — 6 timeframes)

### Implementation
> 1m, 5m, 15m, **1h**, 4h, **1d**, 1w (7 timeframes)

### Change
| Spec timeframe | Implemented | Status |
|---------------|:-----------:|:------:|
| M1 | 1m | ✅ |
| M5 | 5m | ✅ |
| M15 | 15m | ✅ |
| **H3** | (removed) | ❌ **DELIBERATE** |
| H4 | 4h | ✅ |
| W1 | 1w | ✅ |
| (not in spec) | 1h | ➕ **ADDED** |
| (not in spec) | 1d | ➕ **ADDED** |

### Justification
- **H3 removed:** TwelveData does not provide H3 directly. Building H3 from 3×1h requires either (a) a hidden 1h stream (which we have, but the owner chose simplicity) or (b) accepting the H3 gaps. The owner decided H3 adds complexity without proportional analytical value for the current use case.
- **1h added:** Provides a natural middle ground between 15m (intraday noise) and 4h (swing horizon). Owner requested it explicitly.
- **1d added:** Daily close is the standard reference in gold analysis. Owner requested it explicitly.

### Impact
- Aggregation testing (`compareTimeframes`) still works for 5m/15m/1h/4h.
- Replay works for all 7 implemented timeframes.
- Any consumer expecting H3 candles will receive none.

### Approval
- **Approved by:** Project owner (CP9-Ali)
- **Date:** 2026-10-23

---

## Deviation 2 — TwelveData rate limits

### Specification (§5)
> "Rate Limit Manager: احترام حدود المصدر — تجنب حلقات الطلبات السريعة"

### Implementation
`src/ingestion/rate-limiter.ts` enforces:
- `max_per_minute: 8`
- `max_per_day: 800`
- `min_interval_ms: 7500`

### Justification
These match TwelveData's **free tier** (documented in `SourceRegistry`). The paid tier allows more, but the owner is using free tier.

### Impact
- History loading is throttled (7 timeframes × ~8s each = ~1 min).
- Once fully loaded, WebSocket ticks are not rate-limited (no API calls).

### Approval
- **Approved by:** Project owner

---

## Deviation 3 — ForexFactory, not official economic calendar

### Specification (§11)
> "إدارة األخبار واألحداث الزمنية"

### Implementation
`src/events/forexfactory-calendar.ts` uses **faireconomy.media** (ForexFactory mirror).

### Justification
- Official ForexFactory API requires license.
- faireconomy.media provides the same data, free, weekly.
- Aggregator, not primary source. Acceptable for analysis-only system.

### Impact
- 1-week lookback/forward only.
- If faireconomy goes down, events are stale.

### Approval
- **Approved by:** Project owner

---

## Deviation 4 — Heuristic sentiment (not ML)

### Specification (§11)
> "صنّف األخبار حسب األهمية"

### Implementation
`src/events/finnhub-news.ts` uses keyword-based heuristic (`heuristic_v1`).

### Justification
- No ML model available.
- §10 says "لا تنشئ Delta أو CVD من OHLC" — we extended this principle: don't claim ML-level sentiment from keywords.
- Sentiment is explicitly labeled `heuristic_v1` in every result — no false precision.

### Impact
- Sentiment is directional (BULLISH/BEARISH/NEUTRAL), not graded.
- False positives possible for ambiguous headlines.

### Approval
- **Approved by:** Project owner

---

## Deviation 5 — No H3 aggregation

### Specification (§10)
> "إذا بُني H1 من M5، يجب توثيق حدود الساعة وطريقة التعامل مع M5 الناقصة"

### Implementation
Aggregation exists for M1 → M5/M15/H1/H4. **H3 is not built** (see Deviation 1).

### Justification
- Spec allows H3 from 3×1h. Since H3 is removed (Deviation 1), this clause is moot.
- If H3 is restored later, `aggregateCandles` supports it (tested in `multi-timeframe.test.ts`).

### Impact
- None for the current 7 timeframes.

### Approval
- **Approved by:** Project owner

---

## Deviation 6 — No order book / Level-2

### Specification (§6.4)
> "Order Book Imbalance: تحديثات دفتر أوامر بتوقيت مناسب"

### Implementation
`SourceRegistry` marks `orderbook: 'UNKNOWN'` for TwelveData. Binance PAXG has it but we don't consume it.

### Justification
- Owner's use case is price analysis, not microstructure.
- Adding Level-2 requires significant bandwidth and processing.

### Impact
- `suitable_for.order_flow = false` in every usability report.
- `suitable_for.delta_cvd = false` (requires bid/ask trades).

### Approval
- **Approved by:** Project owner

---

## Deviation 7 — No real trade execution

### Specification (§2.12)
> "FALK للتحليل واإلشارات فقط وال ينفذ صفقات حقيقية"

### Implementation
**No execution code exists.** This is compliance, not deviation. Listed here for completeness.

---

## Summary

| # | Deviation | Type | Approved |
|---|-----------|:----:|:--------:|
| 1 | H3 removed, 1h + 1d added | Deliberate | ✅ |
| 2 | Free-tier rate limits | Environmental | ✅ |
| 3 | ForexFactory mirror | Practical | ✅ |
| 4 | Heuristic sentiment | Honest labeling | ✅ |
| 5 | No H3 aggregation | Follows #1 | ✅ |
| 6 | No Level-2 | Scope choice | ✅ |
| 7 | Analysis only | Compliance | ✅ |

**All deviations are documented, justified, and approved. No silent changes.**