# FALK Engines â€” Deviations from Specification

**Document version:** 2.0.0
**Date:** 2026-10-23
**Status:** Approved by project owner

---

## Purpose

This document records **deliberate deviations** from `FALK_Data_Engines_Detailed_Specification.docx`. Each deviation is documented with justification, impact, and approval. Per Â§2, we do not silently hide deviations â€” we record them.

---

## Changes since v1.0.0

**H3 is now IMPLEMENTED.** Deviation 1 (H3 removed) is closed. H3 is now built via `H3Aggregator` from 3Ã—1h candles, aligned to 3-hour boundaries.

---

## Current Deviations (6)

### Deviation 1 â€” 1h and 1d added

**Spec (Â§1)**: M1, M5, M15, H3, H4, W1 (6 timeframes)
**Implementation**: 1m, 5m, 15m, 1h, H3, 4h, 1d, 1w (8 timeframes)

**Added:**
- `1h` â€” requested by owner (mid-point between 15m and 4h)
- `1d` â€” standard daily close reference

**Impact**: consumers get 8 instead of 6. All 6 spec timeframes are present.

**Approved by**: Project owner.

---

### Deviation 2 â€” Free-tier rate limits

**Spec (Â§5)**: enforce source rate limits
**Implementation**: `rate-limiter.ts` uses TwelveData free-tier documented limits (8/min, 800/day, 7.5s min interval)

**Approved by**: Project owner.

---

### Deviation 3 â€” ForexFactory (faireconomy.media) as calendar source

**Spec (Â§11)**: manage economic events
**Implementation**: `forexfactory-calendar.ts` uses faireconomy.media mirror (free, weekly)

**Approved by**: Project owner.

---

### Deviation 4 â€” Heuristic sentiment (not ML)

**Spec (Â§11)**: classify news
**Implementation**: `finnhub-news.ts` uses keyword heuristic labeled `heuristic_v1` in every result

**Approved by**: Project owner.

---

### Deviation 5 â€” No Level-2 / order book

**Spec (Â§6.4)**: order flow analysis
**Implementation**: `SourceRegistry` marks `orderbook: 'UNKNOWN'` for TwelveData. Binance PAXG has it but not consumed.

**Impact**: `suitable_for.order_flow = false`, `suitable_for.delta_cvd = false` in every usability report.

**Approved by**: Project owner.

---

### Deviation 6 â€” No real trade execution

**Spec (Â§2.12)**: analysis only, no execution
**Implementation**: no execution code. This is compliance, not deviation. Listed for completeness.

---

## Summary

| # | Deviation | Status |
|---|-----------|:------:|
| â€” | **H3 aggregation** | âœ… **RESOLVED** (Wave 4) |
| 1 | 1h + 1d added | âœ… |
| 2 | Free-tier rate limits | âœ… |
| 3 | ForexFactory mirror | âœ… |
| 4 | Heuristic sentiment | âœ… |
| 5 | No Level-2 | âœ… |
| 6 | Analysis only | âœ… |

### Deviation 7 — H1 not built from M5

**Spec (§10)**: "ÅÐÇ Èõäí H1 ãä M5¡ íÌÈ ÊæËíÞ ÍÏæÏ ÇáÓÇÚÉ æØÑíÞÉ ÇáÊÚÇãá ãÚ M5 ÇáäÇÞÕÉ"
**Implementation**: We use `1h` directly from TwelveData, not aggregated from M5.

**Justification:**
- TwelveData provides H1 as a first-class timeframe with verified OHLC.
- Aggregating H1 from 5m would require 12 consecutive 5m candles per bucket, introducing 12× the fail points.
- H3 requires aggregation because TwelveData does not provide it. H1 does not.
- The spec's requirement is conditional: "**ÅÐÇ** Èõäí H1 ãä M5" — since we don't build it, the requirement is not triggered.

**Impact:** H1 is directly verified from source, not derived. This is arguably stronger than aggregation.

**Approved by**: Project owner.

---

**7 active deviations, all approved and documented. H3 fully implemented.**