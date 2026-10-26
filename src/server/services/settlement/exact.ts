import 'server-only';
import {
  SETTLEMENT_CALCULATION,
  type SettlementExactDecimal,
} from '@/config/settlement-calculation';

export type Exact = { numerator: bigint; denominator: bigint };
function gcd(left: bigint, right: bigint): bigint {
  while (right !== SETTLEMENT_CALCULATION.zero)
    [left, right] = [right, left % right];
  return left < SETTLEMENT_CALCULATION.zero ? -left : left;
}
export function exact(
  numerator: bigint,
  denominator: bigint = SETTLEMENT_CALCULATION.one,
): Exact {
  if (denominator === SETTLEMENT_CALCULATION.zero)
    throw new RangeError('ZERO_DENOMINATOR');
  const divisor = gcd(numerator, denominator);
  const sign =
    denominator < SETTLEMENT_CALCULATION.zero
      ? -SETTLEMENT_CALCULATION.one
      : SETTLEMENT_CALCULATION.one;
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}
export function add(left: Exact, right: Exact): Exact {
  return exact(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}
export function subtract(left: Exact, right: Exact): Exact {
  return add(left, exact(-right.numerator, right.denominator));
}
export function multiply(left: Exact, right: Exact): Exact {
  return exact(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}
export function divide(left: Exact, right: Exact): Exact {
  return exact(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}
export function decimalRate(value: string): Exact {
  // The public input schema restricts this to a nonnegative six-place rate.
  const [whole = '', fractional = ''] = value.split('.');
  return exact(
    BigInt(whole + fractional),
    SETTLEMENT_CALCULATION.decimalBase ** BigInt(fractional.length),
  );
}
export function minimum(left: Exact, right: Exact): Exact {
  return left.numerator * right.denominator <=
    right.numerator * left.denominator
    ? left
    : right;
}
export function roundHalfUpNonnegative(value: Exact): string {
  if (value.numerator < SETTLEMENT_CALCULATION.zero)
    throw new RangeError('NEGATIVE_ROUNDING_INPUT');
  const half = SETTLEMENT_CALCULATION.ratioTerms;
  return (
    (half * value.numerator + value.denominator) /
    (half * value.denominator)
  ).toString();
}
export function describeExact(value: Exact): SettlementExactDecimal {
  const reduced = exact(value.numerator, value.denominator);
  const negative = reduced.numerator < SETTLEMENT_CALCULATION.zero;
  const numerator = negative ? -reduced.numerator : reduced.numerator;
  const whole = numerator / reduced.denominator;
  let remainder = numerator % reduced.denominator;
  let digits = '';
  while (
    remainder !== SETTLEMENT_CALCULATION.zero &&
    digits.length < SETTLEMENT_CALCULATION.decimalPlaces
  ) {
    remainder *= SETTLEMENT_CALCULATION.decimalBase;
    digits += (remainder / reduced.denominator).toString();
    remainder %= reduced.denominator;
  }
  // This bounded decimal is only a display projection. The reduced rational is
  // authoritative, including when a repeating expansion is truncated here.
  return {
    decimal: `${negative ? '-' : ''}${whole}${digits ? `.${digits}` : ''}`,
    decimalIsExact: remainder === SETTLEMENT_CALCULATION.zero,
    exact: {
      numerator: reduced.numerator.toString(),
      denominator: reduced.denominator.toString(),
    },
  };
}
