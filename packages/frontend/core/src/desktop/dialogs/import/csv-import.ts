import {
  DatabaseBlockDataSource,
  updateCell,
} from '@blocksuite/affine/blocks/database';
import type {
  ColumnDataType,
  DatabaseBlockModel,
} from '@blocksuite/affine/model';
import { Text, type Workspace } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { cssVarV2 } from '@toeverything/theme/v2';
import { nanoid } from 'nanoid';
import { applyUpdate, Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import {
  convertCsvValue,
  type CsvMapping,
  csvNumberDecimalPlaces,
  type CsvPreview,
  validateCsvMapping,
} from './csv';

export type CsvImportJob = {
  docId: string;
  databaseId: string;
  title: string;
  update: Uint8Array;
  rowCount: number;
  warnings: string[];
};

/** Build all content in a detached workspace, before publishing any document. */
export function prepareCsvImport(
  workspace: Workspace,
  preview: CsvPreview,
  mapping: CsvMapping[],
  title: string,
  docId = nanoid()
): CsvImportJob {
  const errors = validateCsvMapping(preview, mapping);
  if (errors.length) throw new Error(errors.join('\n'));
  const rootDoc = new YDoc();
  const staging = new WorkspaceImpl({ id: workspace.id, rootDoc });
  staging.meta.initialize();
  try {
    const doc = staging.createDoc(docId);
    doc.load();
    const store = doc.getStore();
    const pageId = store.addBlock('affine:page', { title: new Text(title) });
    store.addBlock('affine:surface', {}, pageId);
    const noteId = store.addBlock('affine:note', {}, pageId);
    const columns: (ColumnDataType | null)[] = mapping.map((column, i) => {
      if (column.type === 'skip') return null;
      const data: Record<string, unknown> =
        column.type === 'number'
          ? {
              decimal: Math.max(
                0,
                ...preview.rows.map(row => csvNumberDecimalPlaces(row[i] ?? ''))
              ),
              format: 'number',
            }
          : {};
      if (column.type === 'select') {
        data.options = [
          ...new Set(preview.rows.map(row => row[i]).filter(Boolean)),
        ].map(value => ({
          id: nanoid(),
          value,
          color: cssVarV2('chip/label/blue'),
        }));
      }
      return { id: nanoid(), type: column.type, name: column.name, data };
    });
    const databaseId = store.addBlock(
      'affine:database',
      {
        title: new Text(title),
        columns: columns.filter(
          (column): column is ColumnDataType => column !== null
        ),
        cells: Object.create(null),
        views: [],
      },
      noteId
    );
    const database = store.getModelById(databaseId) as DatabaseBlockModel;
    const source = new DatabaseBlockDataSource(database);
    for (const row of preview.rows) {
      const rowId = source.rowAdd('end');
      const rowModel = store.getModelById(rowId);
      if (!rowModel)
        throw new Error('An imported database row could not be created.');
      columns.forEach((column, index) => {
        if (!column) return;
        const raw = row[index] ?? '';
        if (column.type === 'title') {
          store.updateBlock(rowModel, { text: new Text(raw) });
          return;
        }
        const value =
          column.type === 'rich-text'
            ? new Text(raw)
            : column.type === 'select'
              ? ((column.data.options as { id: string; value: string }[]).find(
                  option => option.value === raw
                )?.id ?? null)
              : convertCsvValue(raw, mapping[index].type);
        // Keep empty checkbox cells absent rather than converting them to false.
        if (value !== null)
          updateCell(database, rowId, { columnId: column.id, value });
      });
    }
    source.viewManager.viewAdd('table');
    return {
      docId,
      databaseId,
      title,
      update: encodeStateAsUpdate(store.spaceDoc),
      rowCount: preview.rows.length,
      warnings: [
        ...preview.warnings,
        ...(mapping.some(column => column.type === 'skip')
          ? ['Columns marked Skip were omitted.']
          : []),
        'CSV carries cell values. Page relationships, formulas, views, and attachments require a Nota snapshot for full fidelity.',
      ],
    };
  } finally {
    staging.dispose();
    rootDoc.destroy();
  }
}

/** Publish once in the same event turn. Retrying this job never adds another doc. */
export function publishCsvImport(
  workspace: Workspace,
  job: CsvImportJob
): string {
  const existing = workspace.getDoc(job.docId);
  if (existing) {
    existing.load();
    const block = existing.getStore().getModelById(job.databaseId);
    if (block?.flavour !== 'affine:database')
      throw new Error(
        'The import destination already exists. Start a new import.'
      );
    workspace.meta.setDocMeta(job.docId, { title: job.title });
    return job.docId;
  }
  let created = false;
  try {
    // createDoc needs its root metadata observers to run before it returns.
    // No importer await can expose half-built rows during publication.
    const doc = workspace.createDoc(job.docId);
    created = true;
    doc.load();
    const store = doc.getStore();
    applyUpdate(store.spaceDoc, job.update, store.spaceDoc.clientID);
    if (store.getModelById(job.databaseId)?.flavour !== 'affine:database')
      throw new Error('The prepared CSV database could not be published.');
    workspace.meta.setDocMeta(job.docId, { title: job.title });
    return job.docId;
  } catch (error) {
    if (created && workspace.getDoc(job.docId)) workspace.removeDoc(job.docId);
    throw error;
  }
}
