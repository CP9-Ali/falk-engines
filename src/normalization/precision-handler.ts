/**
 * §7: Precision Handler — يتحقق من أن القيم لها دقة معقولة للمصدر.
 * لا "يعيد" التنسيق — فقط يكتشف الانحراف ويُبلغ.
 */

export interface PrecisionRule {
  readonly min_decimal_places: number;
  readonly max_decimal_places: number;
  readonly min_value: number;
  readonly max_value: number;
}

export const PRECISION_RULES: Record<string, PrecisionRule> = {
  'XAUUSD-price': { min_decimal_places: 2, max_decimal_places: 6, min_value: 1000, max_value: 10000 },
  'XAUUSD-volume': { min_decimal_places: 0, max_decimal_places: 4, min_value: 0, max_value: 1_000_000 },
};

export interface PrecisionCheck {
  readonly passed: boolean;
  readonly reason: string;
  readonly decimal_places: number;
  readonly value: number;
}

/** يحسب عدد الخانات العشرية الفعلية لرقم */
export function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return -1;
  const s = n.toString();
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  // تعامل مع الترميز العلمي
  if (s.indexOf('e') >= 0) return Math.max(0, -Math.floor(Math.log10(Math.abs(n))) + 10);
  return s.length - dot - 1;
}

export function checkPrecision(
  value: number,
  rule: PrecisionRule,
  label: string,
): PrecisionCheck {
  if (!Number.isFinite(value)) {
    return { passed: false, reason: label + ': not finite', decimal_places: -1, value };
  }
  if (value < rule.min_value || value > rule.max_value) {
    return {
      passed: false,
      reason: label + ': outside [' + rule.min_value + ', ' + rule.max_value + ']',
      decimal_places: decimalPlaces(value),
      value,
    };
  }
  const dp = decimalPlaces(value);
  if (dp < rule.min_decimal_places) {
    return {
      passed: true,
      reason: label + ': ' + dp + ' decimals (loose)',
      decimal_places: dp,
      value,
    };
  }
  if (dp > rule.max_decimal_places) {
    return {
      passed: false,
      reason: label + ': too many decimals (' + dp + ' > ' + rule.max_decimal_places + ')',
      decimal_places: dp,
      value,
    };
  }
  return { passed: true, reason: label + ': ok (' + dp + ' decimals)', decimal_places: dp, value };
}

export function checkPrice(price: number): PrecisionCheck {
  return checkPrecision(price, PRECISION_RULES['XAUUSD-price']!, 'price');
}

export function checkVolume(volume: number): PrecisionCheck {
  return checkPrecision(volume, PRECISION_RULES['XAUUSD-volume']!, 'volume');
}