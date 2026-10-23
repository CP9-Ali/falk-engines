# FALK Engines — Deviations from Specification

**Document version:** 2.0.0
**Date:** 2026-10-23
**Status:** Approved by project owner

---

## Purpose

This document records **deliberate deviations** from `FALK_Data_Engines_Detailed_Specification.docx`. Each deviation is documented with justification, impact, and approval. Per §2, we do not silently hide deviations — we record them.

---

## Changes since v1.0.0

**H3 is now IMPLEMENTED.** Deviation 1 (H3 removed) is closed. H3 is now built via `H3Aggregator` from 3×1h candles, aligned to 3-hour boundaries.

---

## Current Deviations (6)

### Deviation 1 — 1h and 1d added

**Spec (§1)**: M1, M5, M15, H3, H4, W1 (6 timeframes)
**Implementation**: 1m, 5m, 15m, 1h, H3, 4h, 1d, 1w (8 timeframes)

**Added:**
- `1h` — requested by owner (mid-point between 15m and 4h)
- `1d` — standard daily close reference

**Impact**: consumers get 8 instead of 6. All 6 spec timeframes are present.

**Approved by**: Project owner.

---

### Deviation 2 — Free-tier rate limits

**Spec (§5)**: enforce source rate limits
**Implementation**: `rate-limiter.ts` uses TwelveData free-tier documented limits (8/min, 800/day, 7.5s min interval)

**Approved by**: Project owner.

---

### Deviation 3 — ForexFactory (faireconomy.media) as calendar source

**Spec (§11)**: manage economic events
**Implementation**: `forexfactory-calendar.ts` uses faireconomy.media mirror (free, weekly)

**Approved by**: Project owner.

---

### Deviation 4 — Heuristic sentiment (not ML)

**Spec (§11)**: classify news
**Implementation**: `finnhub-news.ts` uses keyword heuristic labeled `heuristic_v1` in every result

**Approved by**: Project owner.

---

### Deviation 5 — No Level-2 / order book

**Spec (§6.4)**: order flow analysis
**Implementation**: `SourceRegistry` marks `orderbook: 'UNKNOWN'` for TwelveData. Binance PAXG has it but not consumed.

**Impact**: `suitable_for.order_flow = false`, `suitable_for.delta_cvd = false` in every usability report.

**Approved by**: Project owner.

---

### Deviation 6 — No real trade execution

**Spec (§2.12)**: analysis only, no execution
**Implementation**: no execution code. This is compliance, not deviation. Listed for completeness.

---

## Summary

| # | Deviation | Status |
|---|-----------|:------:|
| — | **H3 aggregation** | ✅ **RESOLVED** (Wave 4) |
| 1 | 1h + 1d added | ✅ |
| 2 | Free-tier rate limits | ✅ |
| 3 | ForexFactory mirror | ✅ |
| 4 | Heuristic sentiment | ✅ |
| 5 | No Level-2 | ✅ |
| 6 | Analysis only | ✅ |

**6 active deviations, all approved and documented. H3 now fully implemented.**