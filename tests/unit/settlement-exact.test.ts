// @vitest-environment node
import { expect, it } from 'vitest';
import {
  exact,
  add,
  subtract,
  multiply,
  divide,
  minimum,
  decimalRate,
  describeExact,
  roundHalfUpNonnegative,
} from '@/server/services/settlement/exact';

it('normalizes zero, signs and common factors without Number arithmetic', () => {
  expect(exact(0n, -19n)).toEqual({ numerator: 0n, denominator: 1n });
  expect(exact(24n, -18n)).toEqual({ numerator: -4n, denominator: 3n });
  expect(exact(-24n, -18n)).toEqual({ numerator: 4n, denominator: 3n });
  expect(() => exact(1n, 0n)).toThrow('ZERO_DENOMINATOR');
});
it('combines rational operands exactly', () => {
  const third = exact(1n, 3n);
  const seventh = exact(1n, 7n);
  expect(add(third, seventh)).toEqual(exact(10n, 21n));
  expect(subtract(third, seventh)).toEqual(exact(4n, 21n));
  expect(multiply(third, seventh)).toEqual(exact(1n, 21n));
  expect(divide(third, seventh)).toEqual(exact(7n, 3n));
  expect(minimum(third, seventh)).toEqual(seventh);
  expect(minimum(seventh, third)).toEqual(seventh);
  expect(() => divide(third, exact(0n))).toThrow('ZERO_DENOMINATOR');
});
it.each([
  ['0', 0n, 1n],
  ['1.000000', 1n, 1n],
  ['0.300000', 3n, 10n],
  ['0.000001', 1n, 1_000_000n],
  ['0.999999', 999_999n, 1_000_000n],
])(
  'parses the approved decimal rate %s exactly',
  (value, numerator, denominator) => {
    expect(decimalRate(value)).toEqual(exact(numerator, denominator));
  },
);
it('marks repeating display projection inexact and retains authoritative fraction', () => {
  expect(describeExact(exact(1n, 3n))).toEqual({
    decimal: '0.333333333333333333333333333333',
    decimalIsExact: false,
    exact: { numerator: '1', denominator: '3' },
  });
  expect(describeExact(exact(-7n, 8n))).toEqual({
    decimal: '-0.875',
    decimalIsExact: true,
    exact: { numerator: '-7', denominator: '8' },
  });
  expect(describeExact(exact(0n))).toEqual({
    decimal: '0',
    decimalIsExact: true,
    exact: { numerator: '0', denominator: '1' },
  });
});
it('does not collapse integers above Number precision', () => {
  const integer = 9_007_199_254_740_993_000_000_000_000_000_007n;
  expect(describeExact(exact(integer)).decimal).toBe(integer.toString());
  expect(roundHalfUpNonnegative(exact(integer * 2n + 1n, 2n))).toBe(
    (integer + 1n).toString(),
  );
});
it('rounds final only at the exact half boundary even below display precision', () => {
  const denominator = 10n ** 80n;
  expect(
    roundHalfUpNonnegative(exact(denominator / 2n - 1n, denominator)),
  ).toBe('0');
  expect(roundHalfUpNonnegative(exact(denominator / 2n, denominator))).toBe(
    '1',
  );
  expect(
    roundHalfUpNonnegative(exact(denominator / 2n + 1n, denominator)),
  ).toBe('1');
  expect(() => roundHalfUpNonnegative(exact(-1n, 2n))).toThrow(
    'NEGATIVE_ROUNDING_INPUT',
  );
});
