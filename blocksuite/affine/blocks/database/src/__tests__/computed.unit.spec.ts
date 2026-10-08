import { describe, expect, test } from 'vitest';

import {
  aggregateRollup,
  computedText,
  evaluateFormula,
} from '../properties/computed/evaluate.js';

describe('bounded database formulas', () => {
  test('evaluates arithmetic and compares stable column references', () => {
    expect(
      evaluateFormula(
        'if(prop("price-id") > 0, prop("price-id") * 2 + 1, 0)',
        id => (id === 'price-id' ? 4 : null)
      )
    ).toBe(9);
    expect(evaluateFormula('2 + 3 * 4', () => null)).toBe(14);
    expect(
      evaluateFormula('concat(upper("nota"), " ", format(2))', () => null)
    ).toBe('NOTA 2');
  });
  test('only evaluates the selected conditional or boolean branch', () => {
    expect(evaluateFormula('if(false, 1 / 0, 5)', () => null)).toBe(5);
    expect(evaluateFormula('false && (1 / 0 == 1)', () => null)).toBe(false);
  });
  test('null and incorrect types stay explicit', () => {
    expect(evaluateFormula('empty(prop("missing"))', () => null)).toBe(true);
    expect(evaluateFormula('prop("missing") + 1', () => null)).toEqual({
      error: 'Expected a finite number',
    });
    expect(evaluateFormula('1 / 0', () => null)).toEqual({
      error: 'Division by zero',
    });
    expect(
      evaluateFormula('prop("a")', () => ({
        error: 'Circular property reference',
      }))
    ).toEqual({ error: 'Circular property reference' });
  });
  test('date helpers use valid UTC dates and day units', () => {
    expect(
      evaluateFormula(
        'dateDiff(dateAdd(date("2026-10-05"), 2), date("2026-10-05"))',
        () => null
      )
    ).toBe(2);
    expect(evaluateFormula('date("2026-02-30")', () => null)).toEqual({
      error: 'Invalid date',
    });
  });
  test('rejects code execution, unknown functions and excessive complexity', () => {
    for (const formula of [
      'globalThis.fetch("url")',
      'constructor("code")',
      'prop("x")[0]',
      '1;2',
      'new Date()',
    ]) {
      expect(evaluateFormula(formula, () => null)).toHaveProperty('error');
    }
    expect(
      evaluateFormula('('.repeat(40) + '1' + ')'.repeat(40), () => null)
    ).toHaveProperty('error');
    expect(evaluateFormula('1+'.repeat(130) + '1', () => null)).toHaveProperty(
      'error'
    );
    expect(
      evaluateFormula('"' + 'x'.repeat(4096) + '"', () => null)
    ).toHaveProperty('error');
  });
});

describe('numeric database rollups', () => {
  test('lists readable values and removes duplicates only for unique values', () => {
    expect(
      aggregateRollup('values', [['Done', 'Review'], null, 'Done', ''])
    ).toEqual(['Done', 'Review', 'Done', '']);
    expect(
      aggregateRollup('unique', [['Done', 'Review'], null, 'Done'])
    ).toEqual(['Done', 'Review']);
    expect(aggregateRollup('values', [])).toEqual([]);
    expect(aggregateRollup('values', [4])).toEqual({
      error: 'Rollup requires readable values',
    });
    expect(
      aggregateRollup('values', [Array.from({ length: 10001 }, () => 'x')])
    ).toEqual({
      error: 'Rollup value limit exceeded',
    });
    expect(computedText(['Done', 'Review'])).toBe('Done, Review');
  });
  test('counts rows and aggregates numeric values without treating null as zero', () => {
    expect(aggregateRollup('count', [null, 0, 4])).toBe(3);
    expect(aggregateRollup('sum', [null, 0, 4])).toBe(4);
    expect(aggregateRollup('avg', [null, 0, 4])).toBe(2);
    expect(aggregateRollup('min', [3, 0, 4])).toBe(0);
    expect(aggregateRollup('max', [3, 0, 4])).toBe(4);
    expect(aggregateRollup('avg', [])).toBe(null);
    expect(aggregateRollup('sum', [])).toBe(0);
  });
  test('retains errors and rejects nonnumeric values', () => {
    expect(aggregateRollup('sum', [{ error: 'Unavailable target' }])).toEqual({
      error: 'Unavailable target',
    });
    expect(aggregateRollup('sum', ['4'])).toEqual({
      error: 'Rollup requires numeric values',
    });
  });
});
