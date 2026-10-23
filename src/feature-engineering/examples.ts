import { LookaheadLeakageError } from '../core/errors';
import { isAtOrBefore, isCandleClosed, now } from '../core/time';
import type { RawDataPoint } from '../core/types';
import type { FeatureDefinition } from './types';

export const simpleReturn1h: FeatureDefinition<ReadonlyArray<RawDataPoint<{ close: number }>>, number> = {
  featureId: 'simple_return_1h',
  definitionVersion: '1.0.0',
  timeframe: '1h',
  minHistoryMs: 2 * 60 * 60 * 1000,
  availabilityRule: { requireClosedCandle: true, expectedLagMs: 1000 },
  inputsRequired: ['close_series_1h'],
  dependencies: [],
  unit: 'ratio',
  parameters: { timeframeMs: 60 * 60 * 1000 },
  validationRules: [
    { name: 'finite', check: v => Number.isFinite(v) },
    { name: 'reasonable', check: v => Math.abs(v) < 10 },
  ],
  compute(ctx) {
    ctx.guard.assertNoLeak(ctx.inputs);

    const timeframeMs = ctx.parameters?.timeframeMs ?? 60 * 60 * 1000;
    const closedPoints = this.availabilityRule.requireClosedCandle
      ? ctx.inputs.filter(p => isCandleClosed(p, timeframeMs, ctx.asOfCutoff))
      : [...ctx.inputs];

    const sorted = [...closedPoints].sort(
      (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime(),
    );

    if (sorted.length < 2) {
      return {
        featureId: this.featureId,
        definitionVersion: this.definitionVersion,
        status: 'INSUFFICIENT_INPUTS',
        value: null,
        asOfCutoff: ctx.asOfCutoff,
        computedAt: now(),
        availabilityTime: null,
        parameters: ctx.parameters ?? {},
        snapshotRef: ctx.snapshotRef,
        fusionPolicyVersion: ctx.policyVersion,
      };
    }
    const earliest = sorted[0]!;
    const latest = sorted[sorted.length - 1]!;

    if (!isAtOrBefore(latest.availabilityTime, ctx.asOfCutoff)) {
      throw new LookaheadLeakageError([{
        sourceId: latest.sourceId,
        availableAt: latest.availabilityTime,
        cutoff: ctx.asOfCutoff,
      }]);
    }

    return {
      featureId: this.featureId,
      definitionVersion: this.definitionVersion,
      status: 'VALID',
      value: (latest.value.close - earliest.value.close) / earliest.value.close,
      asOfCutoff: ctx.asOfCutoff,
      computedAt: now(),
      availabilityTime: latest.availabilityTime,
      parameters: ctx.parameters ?? {},
      snapshotRef: ctx.snapshotRef,
      fusionPolicyVersion: ctx.policyVersion,
    };
  },
};