import { describe, expect, test } from 'vitest';

import {
  remapDatabaseIds,
  remapFormulaReferences,
} from '../adapters/middlewares/database-ids.js';

describe('database identities during duplication and native import', () => {
  const ids = new Map([
    ['doc', 'copy-doc'],
    ['db', 'copy-db'],
    ['row', 'copy-row'],
    ['n', 'copy-n'],
    ['r', 'copy-r'],
    ['f', 'copy-f'],
    ['s', 'copy-s'],
    ['view', 'copy-view'],
  ]);
  test('maps property calls but preserves string literals and external references', () => {
    expect(remapFormulaReferences('prop("n") + prop("outside")', ids)).toBe(
      'prop("copy-n") + prop("outside")'
    );
    expect(
      remapFormulaReferences(
        'concat("prop(\\"n\\")", format(prop ( "n" )))',
        ids
      )
    ).toBe('concat("prop(\\"n\\")", format(prop("copy-n")))');
  });
  test('preserves fixed title and type identities even with a preallocated global map', () => {
    const views = [
      {
        id: 'view',
        name: 'View',
        mode: 'table',
        columns: [{ id: 'title' }],
        header: { titleColumn: 'title', iconColumn: 'type' },
      },
    ];
    const next = remapDatabaseIds(
      [
        { id: 'title', type: 'title', name: 'Renamed title', data: {} },
        {
          id: 'f',
          type: 'formula',
          name: 'Length',
          data: { expression: 'length(prop("title"))' },
        },
        {
          id: 's',
          type: 'rollup',
          name: 'Title count',
          data: {
            relationColumnId: 'r',
            targetColumnId: 'title',
            operation: 'count',
          },
        },
      ],
      {},
      views,
      new Map([...ids, ['title', 'wrong-title'], ['type', 'wrong-type']])
    );
    expect(next.columns[0]?.id).toBe('title');
    expect(next.columns[1]?.data.expression).toBe('length(prop("title"))');
    expect(next.columns[2]?.data.targetColumnId).toBe('title');
    expect(next.views[0]).toMatchObject({
      columns: [{ id: 'title' }],
      header: { titleColumn: 'title', iconColumn: 'type' },
    });
  });
  test('keeps relations, computed definitions and view references connected to the copies', () => {
    const input = {
      columns: [
        { id: 'n', type: 'number', name: 'n', data: {} },
        {
          id: 'r',
          type: 'relation',
          name: 'Project',
          data: { targetDocId: 'doc', targetDatabaseId: 'db' },
        },
        {
          id: 'f',
          type: 'formula',
          name: 'Total',
          data: { expression: 'prop("n") * 2', resultType: 'number' },
        },
        {
          id: 's',
          type: 'rollup',
          name: 'Sum',
          data: {
            relationColumnId: 'r',
            targetColumnId: 'n',
            operation: 'sum',
          },
        },
      ],
      cells: {
        row: {
          r: { columnId: 'r', value: ['row', 'external-row'] },
          n: { columnId: 'n', value: 2 },
        },
      },
      views: [
        {
          id: 'view',
          mode: 'calendar',
          name: 'Calendar',
          dateColumn: 'n',
          columns: [{ id: 'r' }],
          header: { titleColumn: 'f', imageColumn: 'r' },
          filter: { conditions: [{ left: { type: 'ref', name: 'n' } }] },
          sort: { sortBy: [{ ref: { type: 'ref', name: 'f' } }] },
        },
      ],
    };
    const next = remapDatabaseIds(input.columns, input.cells, input.views, ids);
    expect(next.columns[1]?.data).toEqual({
      targetDocId: 'copy-doc',
      targetDatabaseId: 'copy-db',
    });
    expect(next.columns[2]?.data.expression).toBe('prop("copy-n") * 2');
    expect(next.columns[3]?.data).toEqual({
      relationColumnId: 'copy-r',
      targetColumnId: 'copy-n',
      operation: 'sum',
    });
    expect(next.cells['copy-row']?.['copy-r']).toEqual({
      columnId: 'copy-r',
      value: ['copy-row', 'external-row'],
    });
    expect(next.views[0]).toMatchObject({
      id: 'copy-view',
      dateColumn: 'copy-n',
      columns: [{ id: 'copy-r' }],
      header: { titleColumn: 'copy-f', imageColumn: 'copy-r' },
      filter: { conditions: [{ left: { name: 'copy-n' } }] },
      sort: { sortBy: [{ ref: { name: 'copy-f' } }] },
    });
    expect(input.columns[2]?.data.expression).toBe('prop("n") * 2');
    expect(input.cells.row.r.value).toEqual(['row', 'external-row']);
  });
});
