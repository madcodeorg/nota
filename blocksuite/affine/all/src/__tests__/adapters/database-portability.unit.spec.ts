import { processTable } from '@blocksuite/affine-block-database';
import type { ColumnDataType, SerializedCells } from '@blocksuite/affine-model';
import type { BlockSnapshot } from '@blocksuite/store';
import { describe, expect, test } from 'vitest';

const text = (value: string) => ({
  '$blocksuite:internal:text$': true,
  delta: [{ insert: value }],
});
const row: BlockSnapshot = {
  type: 'block',
  id: 'row',
  flavour: 'affine:paragraph',
  props: {
    text: text('Task'),
    'meta:createdAt': 0,
    'meta:createdBy': 'local-user',
  },
  children: [],
};
const column = (id: string, type: string): ColumnDataType => ({
  id,
  type,
  name: id,
  data: {},
});
describe('readable database serialization', () => {
  test('synthesizes title only when absent and respects reordered title headers', () => {
    const cells: SerializedCells = {
      row: { count: { columnId: 'count', value: 0 } },
    };
    const count = {
      ...column('count', 'number'),
      data: { decimal: 0, format: 'number' },
    };
    const missing = processTable([count], [row], cells);
    expect(missing.headers.map(column => column.name)).toEqual([
      'Title',
      'count',
    ]);
    expect(missing.rows[0].cells.map(cell => cell.value)).toEqual([
      row.props.text,
      '0',
    ]);
    const reordered = processTable(
      [count, column('title', 'title')],
      [row],
      cells
    );
    expect(reordered.rows[0].cells.map(cell => cell.value)).toEqual([
      '0',
      row.props.text,
    ]);
    expect(reordered.rows[0].cells).toHaveLength(reordered.headers.length);
    expect(processTable([], [], {}).rows).toEqual([]);
  });
  test('preserves attachment metadata, member identities and unknown property values with a report', () => {
    const attachments = {
      blob: {
        id: 'blob',
        name: 'report.pdf',
        mime: 'application/pdf',
        order: 0,
      },
    };
    const columns = [
      column('title', 'title'),
      column('files', 'attachment'),
      column('people', 'member'),
      column('unknown', 'future-property'),
    ];
    const cells: SerializedCells = {
      row: {
        files: { columnId: 'files', value: attachments },
        people: { columnId: 'people', value: ['alice', 'bob'] },
        unknown: {
          columnId: 'unknown',
          value: { meaningful: false, amount: 0 },
        },
      },
    };
    const table = processTable(columns, [row], cells);
    expect(table.rows[0].cells.slice(1).map(cell => cell.value)).toEqual([
      JSON.stringify(attachments),
      '["alice","bob"]',
      '{"meaningful":false,"amount":0}',
    ]);
    expect(table.warnings).toHaveLength(3);
  });
  test('exports metadata-backed created time and creator without persisted cells', () => {
    const table = processTable(
      [column('time', 'created-time'), column('by', 'created-by')],
      [row],
      {}
    );
    expect(table.rows[0].cells.slice(1).map(cell => cell.value)).toEqual([
      '1970-01-01T00:00:00.000Z',
      'local-user',
    ]);
  });
});
