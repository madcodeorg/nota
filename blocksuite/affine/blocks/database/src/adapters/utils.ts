import type { ColumnDataType, SerializedCells } from '@blocksuite/affine-model';
import type { BlockSnapshot, DeltaInsert } from '@blocksuite/store';

import { databaseBlockModels } from '../properties/model';

function calculateColumnWidths(rows: string[][]): number[] {
  return (
    rows[0]?.map((_, colIndex) =>
      Math.max(...rows.map(row => (row[colIndex] || '').length))
    ) ?? []
  );
}

function formatRow(
  row: string[],
  columnWidths: number[],
  isHeader: boolean
): string {
  const cells = row.map((cell, colIndex) =>
    cell?.padEnd(columnWidths[colIndex] ?? 0, ' ')
  );
  const rowString = `| ${cells.join(' | ')} |`;
  return isHeader
    ? `${rowString}\n${formatSeparator(columnWidths)}`
    : rowString;
}

function formatSeparator(columnWidths: number[]): string {
  const separator = columnWidths.map(width => '-'.repeat(width)).join(' | ');
  return `| ${separator} |`;
}

export function formatTable(rows: string[][]): string {
  const columnWidths = calculateColumnWidths(rows);
  const formattedRows = rows.map((row, index) =>
    formatRow(row, columnWidths, index === 0)
  );
  return formattedRows.join('\n');
}
export const isDelta = (value: unknown): value is { delta: DeltaInsert[] } => {
  if (typeof value === 'object' && value !== null) {
    return (
      '$blocksuite:internal:text$' in value &&
      'delta' in value &&
      Array.isArray(value.delta)
    );
  }
  return false;
};
type Table = {
  headers: ColumnDataType[];
  rows: Row[];
  warnings: string[];
};
type Row = {
  cells: Cell[];
};
type Cell = {
  value: string | { delta: DeltaInsert[] };
};

/** Keep unfamiliar native properties readable instead of dropping their data. */
export const readableCellValue = (value: unknown): string => {
  if (value == null) return '';
  if (isDelta(value)) {
    return value.delta
      .map(part =>
        typeof part.insert === 'string'
          ? part.insert
          : JSON.stringify(part.insert)
      )
      .join('');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

export const processTable = (
  columns: ColumnDataType[],
  children: BlockSnapshot[],
  cells: SerializedCells
): Table => {
  const headers = columns.some(column => column.type === 'title')
    ? columns
    : [{ id: 'title', type: 'title', name: 'Title', data: {} }, ...columns];
  const warnings = new Set<string>();
  const table: Table = {
    headers,
    rows: [],
    warnings: [],
  };
  children.forEach(v => {
    const row: Row = {
      cells: [],
    };
    headers.forEach(col => {
      const property = databaseBlockModels[col.type];
      const cell = cells[v.id]?.[col.id];
      if (col.type === 'title') {
        row.cells.push({
          value: isDelta(v.props.text)
            ? v.props.text
            : readableCellValue(v.props.text),
        });
        return;
      }
      const rawValue =
        col.type === 'created-time'
          ? (v.props['meta:createdAt'] ?? cell?.value)
          : col.type === 'created-by'
            ? (v.props['meta:createdBy'] ?? cell?.value)
            : col.type === 'type'
              ? v.flavour
              : cell?.value;
      if (rawValue == null) {
        row.cells.push({
          value: '',
        });
        return;
      }
      let value: string | { delta: DeltaInsert[] };
      if (isDelta(rawValue)) {
        value = rawValue;
      } else if (
        col.type === 'created-time' &&
        typeof rawValue === 'number' &&
        Number.isFinite(rawValue)
      ) {
        value = new Date(rawValue).toISOString();
      } else if (!property) {
        value = readableCellValue(rawValue);
        warnings.add(
          `${col.name} (${col.type}) was exported as a readable value. Use a Nota snapshot to preserve its property definition.`
        );
      } else {
        try {
          value = property.config.rawValue.toString({
            value: rawValue,
            data: col.data,
          });
          if (!value && readableCellValue(rawValue)) {
            value = readableCellValue(rawValue);
            warnings.add(
              `${col.name}: an unrecognized value was preserved as text.`
            );
          }
        } catch {
          value = readableCellValue(rawValue);
          warnings.add(
            `${col.name}: an unrecognized value was preserved as text.`
          );
        }
      }
      row.cells.push({
        value,
      });
    });
    table.rows.push(row);
  });
  table.warnings = [...warnings];
  return table;
};
