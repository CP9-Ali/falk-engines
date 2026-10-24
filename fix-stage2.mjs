import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const FILES = {

'src/data-quality/checks/precision.ts': `import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { PRECISION_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-PRECISION: يكشف انحراف دقة OHLC عن المواصفة المسجلة في PRECISION_BY_SOURCE
 * يستخدم decimal_places (لا tick_size) لتجنب false positives
 */
export const precisionCheck: QualityCheck = {
  checkId: 'DQ-PRECISION',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const spec = PRECISION_BY_SOURCE[ctx.sourceId];
    if (!spec || !Number.isFinite(spec.decimal_places) || spec.decimal_places < 0) {
      return out;
    }
    const multiplier = Math.pow(10, spec.decimal_places);
    for (const p of ctx.points) {
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        const v = p.value[field];
        if (!Number.isFinite(v)) continue;
        const scaled = v * multiplier;
        const drift = Math.abs(scaled - Math.round(scaled));
        if (drift > 1e-6) {
          out.push({
            checkId: 'DQ-PRECISION-001',
            category: 'ANOMALY' as const,
            severity: 'WARNING' as const,
            message: field + '=' + v + ' exceeds ' + spec.decimal_places + ' decimal places (spec drift)',
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { field, value: v, drift, specDecimalPlaces: spec.decimal_places },
          });
          break;
        }
      }
    }
    return out;
  },
};
`,

'src/data-quality/checks/volume-semantics.ts': `import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { VOLUME_SEMANTICS_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-VOLUME-SEMANTICS: يحذر عندما يعرض المصدر حجماً لكن دلالته غير مسجلة (UNKNOWN)
 */
export const volumeSemanticsCheck: QualityCheck = {
  checkId: 'DQ-VOLUME-SEMANTICS',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const semantics = VOLUME_SEMANTICS_BY_SOURCE[ctx.sourceId] ?? 'UNKNOWN';
    if (semantics !== 'UNKNOWN') return out;

    const withVolume = ctx.points.filter(p => Number.isFinite(p.value.volume) && p.value.volume > 0);
    if (withVolume.length === 0) return out;

    const first = withVolume[0];
    const last = withVolume[withVolume.length - 1];
    if (!first || !last) return out;

    out.push({
      checkId: 'DQ-VOLUME-SEMANTICS-001',
      category: 'SUITABILITY' as const,
      severity: 'WARNING' as const,
      message: ctx.sourceId + ' reports volume but semantics is UNKNOWN (' + withVolume.length + '/' + ctx.points.length + ' points affected)',
      affectedRange: { from: first.eventTime, to: last.eventTime },
      evidence: {
        sourceId: ctx.sourceId,
        affectedPoints: withVolume.length,
        totalPoints: ctx.points.length,
      },
    });
    return out;
  },
};
`,

'src/data-quality/checks/timezone.ts': `import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { SOURCE_TIMEZONE } from '../../normalization/canonical';

/**
 * DQ-TIMEZONE: يحذر عندما لا يكون للمصدر منطقة زمنية مسجلة
 */
export const timezoneCheck: QualityCheck = {
  checkId: 'DQ-TIMEZONE',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const tz = SOURCE_TIMEZONE[ctx.sourceId];
    if (tz) return out;

    out.push({
      checkId: 'DQ-TIMEZONE-001',
      category: 'FRESHNESS' as const,
      severity: 'HIGH' as const,
      message: 'source ' + ctx.sourceId + ' has no registered timezone — time-sensitive comparisons will be blocked downstream',
      affectedRange: { from: ctx.range.from, to: ctx.range.to },
      evidence: { sourceId: ctx.sourceId },
    });
    return out;
  },
};
`,

'src/tests/stage2-quality-checks.test.ts': `import { describe, it, expect } from 'vitest';
import { precisionCheck } from '../data-quality/checks/precision';
import { volumeSemanticsCheck } from '../data-quality/checks/volume-semantics';
import { timezoneCheck } from '../data-quality/checks/timezone';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

function makePoint(sourceId: string, candle: Candle, eventTime = '2026-10-24T12:00:00.000Z'): RawDataPoint<Candle> {
  return {
    sourceId,
    value: candle,
    eventTime,
    arrivalTime: '2026-10-24T12:00:01.000Z',
    availabilityTime: '2026-10-24T12:00:01.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
  };
}

function makeCtx(sourceId: string, points: RawDataPoint<Candle>[]): CheckContext<Candle> {
  return {
    sourceId,
    points,
    range: { from: '2026-10-24T00:00:00.000Z', to: '2026-10-24T23:59:59.999Z' },
    expectedCadenceMs: 60_000,
    asOfCutoff: '2026-10-24T23:59:59.999Z',
  };
}

describe('DQ-PRECISION', () => {
  it('passes values within spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.67, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });

  it('flags value exceeding spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.678, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    const findings = precisionCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-PRECISION-001');
    expect(first.severity).toBe('WARNING');
  });

  it('returns no findings when source has no precision spec', () => {
    const ctx = makeCtx('unknown-source', [
      makePoint('unknown-source', { open: 1.123456, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-VOLUME-SEMANTICS', () => {
  it('flags volume present with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    const findings = volumeSemanticsCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-VOLUME-SEMANTICS-001');
    expect(first.category).toBe('SUITABILITY');
  });

  it('passes when semantics is known', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });

  it('passes when volume is zero even with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 0 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-TIMEZONE', () => {
  it('flags source with no registered timezone', () => {
    const ctx = makeCtx('made-up-source', [
      makePoint('made-up-source', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    const findings = timezoneCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-TIMEZONE-001');
    expect(first.severity).toBe('HIGH');
  });

  it('passes when source has registered timezone', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(timezoneCheck.run(ctx)).toHaveLength(0);
  });
});
`,
};

for (const [path, content] of Object.entries(FILES)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log('  [WRITE] ' + path);
}

console.log('\n=== VERIFICATION ===');

try {
  console.log('\n[1/2] npx tsc --noEmit');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch {
  console.error('\n❌ tsc failed. Inspect above.');
  process.exit(3);
}

try {
  console.log('\n[2/2] npm test');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch {
  console.error('\n❌ tests failed.');
  process.exit(4);
}

console.log('\n🎉 Stage 2 files fixed.');
