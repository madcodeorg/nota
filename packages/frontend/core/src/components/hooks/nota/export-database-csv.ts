import {
  DatabaseBlockDataSource,
  processTable,
  readableCellValue,
} from '@blocksuite/affine/blocks/database';
import type {
  ColumnDataType,
  DatabaseBlockModel,
  SerializedCells,
} from '@blocksuite/affine/model';
import type {
  BlockSnapshot,
  Store,
  TransformerMiddleware,
} from '@blocksuite/affine/store';
import { Transformer } from '@blocksuite/affine/store';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace/global-schema';
import { csvFormatRows } from 'd3-dsv';

export type DatabaseCsvExport = {
  title: string;
  csv: string;
  warnings: string[];
};

function includeComputedValues(
  snapshot: BlockSnapshot,
  model: DatabaseBlockModel
) {
  const source = new DatabaseBlockDataSource(model);
  const cells = snapshot.props.cells as SerializedCells;
  model.props.columns
    .filter(column => column.type === 'formula' || column.type === 'rollup')
    .forEach(column => {
      model.children.forEach(row => {
        const rowCells = (cells[row.id] ??= Object.create(null));
        rowCells[column.id] = {
          columnId: column.id,
          value: source.cellValueGet(row.id, column.id),
        };
      });
    });
}

export const readableDatabaseValuesMiddleware =
  (doc: Store): TransformerMiddleware =>
  ({ slots }) => {
    const subscription = slots.afterExport.subscribe(payload => {
      if (
        payload.type !== 'block' ||
        payload.snapshot.flavour !== 'affine:database'
      )
        return;
      const model = doc.getModelById(
        payload.snapshot.id
      ) as DatabaseBlockModel | null;
      if (model) includeComputedValues(payload.snapshot, model);
    });
    return () => subscription.unsubscribe();
  };

export function serializeDatabaseCsv(
  snapshot: BlockSnapshot
): DatabaseCsvExport {
  const table = processTable(
    snapshot.props.columns as ColumnDataType[],
    snapshot.children,
    snapshot.props.cells as SerializedCells
  );
  return {
    title: readableCellValue(snapshot.props.title) || 'Database',
    csv: csvFormatRows([
      table.headers.map(column => column.name),
      ...table.rows.map(row =>
        row.cells.map(cell => readableCellValue(cell.value))
      ),
    ]),
    warnings: [
      ...table.warnings,
      ...(snapshot.props.columns as ColumnDataType[])
        .filter(column =>
          ['relation', 'formula', 'rollup'].includes(column.type)
        )
        .map(
          column =>
            `${column.name} (${column.type}) exports its current readable value. Use a Nota snapshot to preserve its definition and references.`
        ),
    ],
  };
}

export function exportDatabaseCsv(doc: Store): DatabaseCsvExport[] {
  const transformer = new Transformer({
    schema: getAFFiNEWorkspaceSchema(),
    blobCRUD: doc.workspace.blobSync,
    docCRUD: {
      create: () => {
        throw new Error('CSV export cannot create documents.');
      },
      get: id => doc.workspace.getDoc(id)?.getStore({ id }) ?? null,
      delete: () => {
        throw new Error('CSV export cannot delete documents.');
      },
    },
  });
  return doc.getBlocksByFlavour('affine:database').map(block => {
    const model = block.model as DatabaseBlockModel;
    const snapshot = transformer.blockToSnapshot(model);
    if (!snapshot) throw new Error('A database could not be exported.');
    includeComputedValues(snapshot, model);
    return serializeDatabaseCsv(snapshot);
  });
}
