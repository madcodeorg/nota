import type {
  ColumnDataType,
  SerializedCells,
  ViewBasicDataType,
} from '@blocksuite/affine-model';

// Replace only actual prop calls, never text inside a quoted literal.
export function remapFormulaReferences(
  expression: string,
  ids: Map<string, string>
): string {
  let result = '';
  let offset = 0;
  while (offset < expression.length) {
    if (expression[offset] === '"') {
      const start = offset++;
      while (offset < expression.length) {
        const char = expression[offset++];
        if (char === '\\') offset++;
        else if (char === '"') break;
      }
      result += expression.slice(start, offset);
      continue;
    }
    const call = /^prop\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/.exec(
      expression.slice(offset)
    );
    if (
      call &&
      (offset === 0 || !/[A-Za-z_\d]/.test(expression[offset - 1]!))
    ) {
      try {
        const id = JSON.parse(call[1]!) as string;
        result += ids.has(id)
          ? `prop(${JSON.stringify(ids.get(id))})`
          : call[0];
        offset += call[0].length;
        continue;
      } catch {
        /* Preserve unsupported imported expressions verbatim. */
      }
    }
    result += expression[offset++];
  }
  return result;
}

const identityKeys = new Set([
  'id',
  'columnId',
  'propertyId',
  'datePropertyId',
  'coverPropertyId',
  'relationColumnId',
  'targetColumnId',
  'groupBy',
  'titleColumn',
  'imageColumn',
  'coverColumn',
  'dateColumn',
  'iconColumn',
  'manuallySort',
  'manuallyCardSort',
]);
function remapView(
  value: unknown,
  ids: Map<string, string>,
  key = ''
): unknown {
  if (typeof value === 'string')
    return identityKeys.has(key) ? (ids.get(value) ?? value) : value;
  if (Array.isArray(value)) return value.map(item => remapView(item, ids, key));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(object).map(([field, child]) => [
      field,
      field === 'name' && object.type === 'ref' && typeof child === 'string'
        ? (ids.get(child) ?? child)
        : remapView(child, ids, field),
    ])
  );
}

export function remapDatabaseIds(
  columns: ColumnDataType[],
  cells: SerializedCells,
  views: ViewBasicDataType[],
  ids: Map<string, string>
): {
  columns: ColumnDataType[];
  cells: SerializedCells;
  views: ViewBasicDataType[];
} {
  // Fixed fields can be virtual in one database and materialized in another.
  const propertyIds = new Map(ids);
  propertyIds.delete('title');
  propertyIds.delete('type');
  const relationIds = new Set(
    columns
      .filter(column => column.type === 'relation')
      .map(column => column.id)
  );
  return {
    columns: columns.map(column => {
      const data = { ...column.data };
      if (column.type === 'relation') {
        for (const key of ['targetDocId', 'targetDatabaseId']) {
          if (typeof data[key] === 'string')
            data[key] = ids.get(data[key]) ?? data[key];
        }
      } else if (
        column.type === 'formula' &&
        typeof data.expression === 'string'
      ) {
        data.expression = remapFormulaReferences(data.expression, propertyIds);
      } else if (column.type === 'rollup') {
        for (const key of ['relationColumnId', 'targetColumnId']) {
          if (typeof data[key] === 'string')
            data[key] = propertyIds.get(data[key]) ?? data[key];
        }
      }
      return { ...column, id: propertyIds.get(column.id) ?? column.id, data };
    }),
    cells: Object.fromEntries(
      Object.entries(cells).map(([row, values]) => [
        ids.get(row) ?? row,
        Object.fromEntries(
          Object.entries(values).map(([column, cell]) => [
            propertyIds.get(column) ?? column,
            {
              ...cell,
              columnId: propertyIds.get(cell.columnId) ?? cell.columnId,
              value:
                relationIds.has(column) && Array.isArray(cell.value)
                  ? cell.value.map(value =>
                      typeof value === 'string'
                        ? (ids.get(value) ?? value)
                        : value
                    )
                  : cell.value,
            },
          ])
        ),
      ])
    ),
    views: views.map(view => remapView(view, propertyIds) as ViewBasicDataType),
  };
}
