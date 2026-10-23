/**
 * §7: Unit Normalizer — يتحقق من أن الوحدات معروفة ومتسقة.
 * لا يحوّل بين وحدات — يكتشف ويُبلغ.
 */

export type PriceUnit = 'USD/oz' | 'USD/g' | 'USD/kg' | 'UNKNOWN';
export type VolumeUnit = 'ticks' | 'contracts' | 'shares' | 'oz' | 'UNKNOWN';

export interface UnitInfo {
  readonly price_unit: PriceUnit;
  readonly volume_unit: VolumeUnit;
  readonly known: boolean;
}

export const UNITS_BY_SOURCE: Record<string, UnitInfo> = {
  'twelvedata-ws': { price_unit: 'USD/oz', volume_unit: 'UNKNOWN', known: true },
  'binance-paxg': { price_unit: 'USD/oz', volume_unit: 'ticks', known: true },
  'xaus-api': { price_unit: 'USD/oz', volume_unit: 'UNKNOWN', known: false },
  'fcsapi-xau': { price_unit: 'USD/oz', volume_unit: 'UNKNOWN', known: false },
};

export interface UnitCheck {
  readonly compatible: boolean;
  readonly reason: string;
  readonly normalized_price_unit: PriceUnit;
  readonly normalized_volume_unit: VolumeUnit;
}

export function resolveUnits(sourceId: string): UnitInfo {
  return UNITS_BY_SOURCE[sourceId] ?? { price_unit: 'UNKNOWN', volume_unit: 'UNKNOWN', known: false };
}

/** هل يمكن مقارنة مصدرين مباشرة؟ */
export function canCompare(sourceA: string, sourceB: string): UnitCheck {
  const a = resolveUnits(sourceA);
  const b = resolveUnits(sourceB);
  if (a.price_unit !== b.price_unit) {
    return {
      compatible: false,
      reason: 'price_unit mismatch: ' + a.price_unit + ' vs ' + b.price_unit,
      normalized_price_unit: a.price_unit,
      normalized_volume_unit: a.volume_unit,
    };
  }
  if (!a.known || !b.known) {
    return {
      compatible: false,
      reason: 'one source has UNKNOWN units',
      normalized_price_unit: a.price_unit,
      normalized_volume_unit: a.volume_unit,
    };
  }
  return {
    compatible: true,
    reason: 'both share ' + a.price_unit,
    normalized_price_unit: a.price_unit,
    normalized_volume_unit: a.volume_unit,
  };
}

/** هل يمكن استخدام volume_profile لهذا المصدر؟ */
export function canUseVolume(sourceId: string): { allowed: boolean; reason: string } {
  const u = resolveUnits(sourceId);
  if (u.volume_unit === 'UNKNOWN') {
    return { allowed: false, reason: 'volume_unit UNKNOWN' };
  }
  if (!u.known) {
    return { allowed: false, reason: 'units not verified' };
  }
  return { allowed: true, reason: 'volume_unit=' + u.volume_unit };
}