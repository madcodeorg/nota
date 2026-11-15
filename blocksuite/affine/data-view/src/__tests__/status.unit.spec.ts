import { signal } from '@preact/signals-core';
import { describe, expect, test, vi } from 'vitest';

import { groupTagOptions } from '../core/component/tags/multi-tag-select.js';
import { filterMatcher } from '../core/filter/filter-fn/matcher.js';
import { groupByMatchers } from '../core/group-by/define.js';
import { GroupTrait, sortByManually } from '../core/group-by/trait.js';
import type { DataSource } from '../core/index.js';
import { evalSort } from '../core/sort/eval.js';
import type { Row } from '../core/view-manager/row.js';
import type { SingleView } from '../core/view-manager/single-view.js';
import { presetPropertyConverts } from '../property-presets/converts.js';
import { selectPropertyModelConfig } from '../property-presets/select/define.js';
import {
  defaultStatusOptions,
  guessStatusGroup,
  sortStatusOptions,
  statusGroups,
  type StatusOption,
  statusOptionIdByName,
  type StatusPropertyData,
  statusPropertyModelConfig,
} from '../property-presets/status/define.js';

const option = (
  id: string,
  group: StatusOption['group'],
  value = id
): StatusOption => ({ id, value, color: 'var(--color)', group });

// Stored order is deliberately not grouped.
const data: StatusPropertyData = {
  options: [
    option('done', 'complete'),
    option('todo', 'todo'),
    option('doing', 'inProgress'),
    option('backlog', 'todo'),
  ],
};
const dataSource = {} as DataSource;
const findConvert = (from: string, to: string) =>
  presetPropertyConverts.find(v => v.from === from && v.to === to)!.convert as (
    property: { options: unknown[] },
    cells: (string | undefined)[]
  ) => { property: { options: unknown[] }; cells: unknown[] };
const statusType = () =>
  statusPropertyModelConfig.config.jsonValue.type({ data, dataSource });

describe('status property', () => {
  test('creates the three fixed groups with one default option each', () => {
    const { options } = statusPropertyModelConfig.config.propertyData.default();
    expect(statusGroups.map(group => group.name)).toEqual([
      'To do',
      'In progress',
      'Complete',
    ]);
    expect(options.map(v => [v.value, v.group])).toEqual([
      ['Not started', 'todo'],
      ['In progress', 'inProgress'],
      ['Done', 'complete'],
    ]);
  });

  test('orders options by group, then by stored order', () => {
    expect(sortStatusOptions(data.options).map(v => v.id)).toEqual([
      'todo',
      'backlog',
      'doing',
      'done',
    ]);
    const legacy: { id: string; group?: string }[] = [
      { id: 'x' },
      option('a', 'todo'),
    ];
    expect(sortStatusOptions(legacy).map(v => v.id)).toEqual(['x', 'a']);
    expect(groupTagOptions(data.options, statusGroups)).toEqual(
      sortStatusOptions(data.options)
    );
  });

  test('reads and writes option names as strings', () => {
    const config = statusPropertyModelConfig.config.rawValue;
    expect(config.toString({ value: 'doing', data })).toBe('doing');
    expect(config.toString({ value: null, data })).toBe('');
    const options = defaultStatusOptions();
    expect(statusOptionIdByName(options, ' Done ')).toBe(options[2]?.id);
    expect(statusOptionIdByName(options, '')).toBeNull();
    const id = statusOptionIdByName(options, 'Blocked');
    expect(options.at(-1)).toMatchObject({
      id,
      value: 'Blocked',
      group: 'todo',
    });
    expect(guessStatusGroup('Completed')).toBe('complete');
    expect(guessStatusGroup('Doing')).toBe('inProgress');
  });

  test('offers is / is not / is empty filters', () => {
    const names = filterMatcher
      .filterListBySelfType(statusType())
      .map(filter => filter.name);
    expect(names).toEqual(
      expect.arrayContaining(['isOneOf', 'isNotOneOf', 'isEmpty', 'isNotEmpty'])
    );
    const isOneOf = filterMatcher.getFilterByName('isOneOf')!;
    expect(isOneOf.impl('doing', ['doing', 'done'])).toBe(true);
    expect(isOneOf.impl('todo', ['doing', 'done'])).toBe(false);
  });

  test('sorts by group, then option order, with empty values last', () => {
    const values: Record<string, string | null> = {
      r1: 'done',
      r2: null,
      r3: 'backlog',
      r4: 'doing',
      r5: 'todo',
    };
    const view = {
      propertyGetOrCreate: () => ({ dataType$: signal(statusType()) }),
      cellGetOrCreate: (rowId: string) => ({
        jsonValue$: signal(values[rowId]),
      }),
    } as unknown as SingleView;
    const compare = evalSort(
      {
        sortBy: [{ ref: { type: 'ref', name: 'status' }, desc: false }],
        manuallySort: [],
      },
      view
    )!;
    expect(
      Object.keys(values)
        .map(rowId => ({ rowId }) as Row)
        .sort(compare)
        .map(row => row.rowId)
    ).toEqual(['r5', 'r3', 'r4', 'r1', 'r2']);
  });

  test('groups kanban columns by group and moves cards by changing the value', () => {
    const config = groupByMatchers.find(v => v.name === 'select')!;
    expect(config.defaultKeys(statusType()).map(v => v.key)).toEqual([
      'Ungroups',
      'todo',
      'backlog',
      'doing',
      'done',
    ]);

    const values = new Map<string, string | null>([
      ['r1', 'todo'],
      ['r2', 'done'],
    ]);
    const jsonValueSet = vi.fn((rowId: string, value: string | null) =>
      values.set(rowId, value)
    );
    const services = new Map<unknown, unknown>();
    const view = {
      data$: signal({ groupProperties: [] }),
      rows$: signal(['r1', 'r2'].map(rowId => ({ rowId }) as Row)),
      isLocked$: signal(false),
      lockRows: vi.fn(),
      manager: {
        dataSource: {
          provider: { getAll: () => new Map() },
          serviceGetOrCreate: (key: unknown, create: () => unknown) => {
            if (!services.has(key)) services.set(key, create());
            return services.get(key);
          },
        },
      },
      propertyGetOrCreate: () => ({
        id: 'status',
        dataType$: signal(statusType()),
        meta$: signal({ config: {} }),
      }),
      cellGetOrCreate: (rowId: string) => ({
        jsonValue$: signal(values.get(rowId) ?? null),
        jsonValueSet: (value: string | null) => jsonValueSet(rowId, value),
      }),
    };
    const trait = new GroupTrait(
      signal({
        type: 'groupBy',
        columnId: 'status',
        name: 'select',
        hideEmpty: false,
      }),
      view as never,
      {
        groupBySet: vi.fn(),
        sortGroup: keys => sortByManually(keys, v => v, []),
        sortRow: (_key, rows) => rows,
        changeGroupSort: vi.fn(),
        changeRowSort: vi.fn(),
        changeGroupHide: vi.fn(),
      }
    );
    expect(trait.groupsDataList$.value?.map(group => group.key)).toEqual([
      'Ungroups',
      'todo',
      'backlog',
      'doing',
      'done',
    ]);

    trait.moveCardTo('r1', 'todo', 'doing', 'end');
    expect(jsonValueSet).toHaveBeenCalledWith('r1', 'doing');
  });

  test('converts to and from select, keeping names, colors and values', () => {
    const asSelect = findConvert(
      statusPropertyModelConfig.type,
      selectPropertyModelConfig.type
    )(data, ['done', undefined]);
    expect(asSelect.cells).toEqual(['done', undefined]);
    expect(asSelect.property.options).toEqual([
      { id: 'todo', value: 'todo', color: 'var(--color)' },
      { id: 'backlog', value: 'backlog', color: 'var(--color)' },
      { id: 'doing', value: 'doing', color: 'var(--color)' },
      { id: 'done', value: 'done', color: 'var(--color)' },
    ]);

    const asStatus = findConvert(
      selectPropertyModelConfig.type,
      statusPropertyModelConfig.type
    )(
      {
        options: [
          { id: 'a', value: 'Todo', color: 'red' },
          { id: 'b', value: 'In Progress', color: 'blue' },
          { id: 'c', value: 'Done', color: 'green' },
        ],
      },
      ['c', 'a']
    );
    expect(asStatus.cells).toEqual(['c', 'a']);
    expect(
      findConvert(
        selectPropertyModelConfig.type,
        statusPropertyModelConfig.type
      )({ options: [] }, []).property.options
    ).toHaveLength(3);
    expect(asStatus.property.options).toEqual([
      { id: 'a', value: 'Todo', color: 'red', group: 'todo' },
      { id: 'b', value: 'In Progress', color: 'blue', group: 'inProgress' },
      { id: 'c', value: 'Done', color: 'green', group: 'complete' },
    ]);
  });
});
