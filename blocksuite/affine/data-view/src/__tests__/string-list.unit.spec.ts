import { signal } from '@preact/signals-core';
import { describe, expect, test } from 'vitest';

import { filterMatcher } from '../core/filter/filter-fn/matcher.js';
import { t } from '../core/logical/type-presets.js';
import { evalSort } from '../core/sort/eval.js';
import type { Row } from '../core/view-manager/row.js';
import type { SingleView } from '../core/view-manager/single-view.js';

function listComparator(values: Record<string, unknown>, desc = false) {
  const view = {
    propertyGetOrCreate: () => ({
      dataType$: signal(t.array.instance(t.string.instance())),
    }),
    cellGetOrCreate: (rowId: string) => ({ jsonValue$: signal(values[rowId]) }),
  } as unknown as SingleView;
  const compare = evalSort(
    {
      sortBy: [{ ref: { type: 'ref', name: 'list' }, desc }],
      manuallySort: [],
    },
    view
  )!;
  return (a: { rowId: string }, b: { rowId: string }) =>
    compare(a as Row, b as Row);
}

describe('readable list sorting and filters', () => {
  test('sorts prefixes deterministically and leaves empty/missing lists last in both directions', () => {
    const values = {
      long: ['Alpha', 'Beta'],
      empty: [],
      short: ['Alpha'],
      zulu: ['Zulu'],
      missing: null,
    };
    for (const [desc, expected] of [
      [false, ['short', 'long', 'zulu', 'empty', 'missing']],
      [true, ['zulu', 'long', 'short', 'empty', 'missing']],
    ] as const) {
      const compare = listComparator(values, desc);
      expect(
        Object.keys(values)
          .map(rowId => ({ rowId }))
          .sort(compare)
          .map(row => row.rowId)
      ).toEqual(expected);
    }
  });
  test('advances past invalid legacy null items instead of hanging', () => {
    const compare = listComparator({
      first: ['Alpha', null, 'C'],
      second: ['Alpha', 'B', 'D'],
    });
    expect(compare({ rowId: 'first' }, { rowId: 'second' })).toBeLessThan(0);
  });
  test('offers string input contains filters for string arrays and compares complete values', () => {
    const filters = filterMatcher.filterListBySelfType(
      t.array.instance(t.string.instance())
    );
    const contains = filters.find(filter => filter.name === 'containsValue')!;
    const excludes = filters.find(
      filter => filter.name === 'doesNotContainValue'
    )!;
    expect(contains).toBeDefined();
    expect(contains.impl(['Review soon', 'Done'], 'Review')).toBe(false);
    expect(contains.impl(['Review soon', 'Done'], 'Done')).toBe(true);
    expect(excludes.impl([], 'Done')).toBe(true);
    expect(contains.args[0]).toEqual(t.string.instance());
  });
});
