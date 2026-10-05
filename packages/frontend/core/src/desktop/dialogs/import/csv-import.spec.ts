/** @vitest-environment happy-dom */
import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { exportDatabaseCsv } from '../../../components/hooks/nota/export-database-csv';
import { parseCsv, suggestCsvMapping } from './csv';
import { prepareCsvImport, publishCsvImport } from './csv-import';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
});
function createWorkspace() {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'csv-workspace', rootDoc });
  workspace.meta.initialize();
  cleanup.push(() => {
    workspace.dispose();
    rootDoc.destroy();
  });
  return workspace;
}

describe('staged CSV database import', () => {
  test('publishes exact rows and typed values, retries without duplicates, and exports the same readable values', () => {
    const workspace = createWorkspace();
    const preview = parseCsv(
      'Name,Count,Done,Date,Choice,Note\n"A, B",0,false,2026-10-05,"choice, with comma","first\nsecond"\nC,,true,,,'
    );
    const mapping = suggestCsvMapping(preview);
    mapping[4].type = 'select';
    const job = prepareCsvImport(workspace, preview, mapping, 'Imported tasks');
    expect(workspace.docs.size).toBe(0);
    expect(publishCsvImport(workspace, job)).toBe(job.docId);
    expect(publishCsvImport(workspace, job)).toBe(job.docId);
    expect(workspace.docs.size).toBe(1);
    const store = workspace.getDoc(job.docId)!.getStore();
    const model = store.getModelById(job.databaseId) as DatabaseBlockModel;
    expect(model.children).toHaveLength(2);
    expect(model.props.views).toHaveLength(1);
    expect(model.props.columns).toHaveLength(6);
    const source = new DatabaseBlockDataSource(model);
    expect(
      source.cellValueGet(model.children[0].id, model.props.columns[1].id)
    ).toBe(0);
    expect(
      source.cellValueGet(model.children[0].id, model.props.columns[2].id)
    ).toBe(false);
    const exported = exportDatabaseCsv(store);
    expect(exported).toHaveLength(1);
    const rows = parseCsv(exported[0].csv).rows;
    expect(rows[0]).toEqual([
      'A, B',
      '0',
      'False',
      '2026-10-05',
      'choice, with comma',
      'first\nsecond',
    ]);
    expect(rows[1]).toEqual(['C', '', 'True', '', '', '']);
  });
  test('rejects invalid conversions without exposing a partial document', () => {
    const workspace = createWorkspace();
    const create = vi.spyOn(workspace, 'createDoc');
    const preview = parseCsv('Name,Count\nA,broken');
    expect(() =>
      prepareCsvImport(
        workspace,
        preview,
        [
          { name: 'Name', type: 'title' },
          { name: 'Count', type: 'number' },
        ],
        'Bad'
      )
    ).toThrow('not a number');
    expect(create).not.toHaveBeenCalled();
    expect(workspace.docs.size).toBe(0);
  });

  test('preserves fractional precision through the imported number display and unchanged edit commit', () => {
    const workspace = createWorkspace();
    const preview = parseCsv('Name,Amount\nA,12.34\nB,0.001\nC,1.2');
    const job = prepareCsvImport(
      workspace,
      preview,
      suggestCsvMapping(preview),
      'Decimals'
    );
    publishCsvImport(workspace, job);
    const store = workspace.getDoc(job.docId)!.getStore();
    const model = store.getModelById(job.databaseId) as DatabaseBlockModel;
    const column = model.props.columns[1];
    expect(column.data.decimal).toBe(3);
    const displayed = new Intl.NumberFormat(navigator.language, {
      useGrouping: false,
      minimumFractionDigits: column.data.decimal as number,
      maximumFractionDigits: column.data.decimal as number,
    }).format(12.34);
    expect(displayed).toBe('12.340');
    const source = new DatabaseBlockDataSource(model);
    const parsed = source
      .propertyMetaGet('number')!
      .config.rawValue.fromString({
        value: displayed,
        data: column.data,
        dataSource: source,
      }).value;
    source.cellValueChange(model.children[0].id, column.id, parsed);
    expect(source.cellValueGet(model.children[0].id, column.id)).toBe(12.34);
    expect(parseCsv(exportDatabaseCsv(store)[0].csv).rows[0][1]).toBe('12.34');
  });
  test('rolls back failed publication and safely retries the same prepared job', () => {
    const workspace = createWorkspace();
    const preview = parseCsv('Name,Note\nA,note');
    const job = prepareCsvImport(
      workspace,
      preview,
      suggestCsvMapping(preview),
      'Retry'
    );
    const original = workspace.meta.setDocMeta.bind(workspace.meta);
    let calls = 0;
    const setMeta = vi
      .spyOn(workspace.meta, 'setDocMeta')
      .mockImplementation((...args) => {
        if (++calls === 2) throw new Error('metadata failure');
        original(...args);
      });
    expect(() => publishCsvImport(workspace, job)).toThrow('metadata failure');
    expect(workspace.docs.size).toBe(0);
    setMeta.mockRestore();
    publishCsvImport(workspace, job);
    expect(workspace.docs.size).toBe(1);
    expect(
      workspace.getDoc(job.docId)!.getStore().getModelById(job.databaseId)
        ?.children
    ).toHaveLength(1);
  });
  test('keeps duplicate headers, a reordered title, and empty rows without seed rows', () => {
    const workspace = createWorkspace();
    const preview = parseCsv('Duplicate,Title,Duplicate\n001,A,zero\n,,');
    const job = prepareCsvImport(
      workspace,
      preview,
      [
        { name: 'Duplicate', type: 'rich-text' },
        { name: 'Title', type: 'title' },
        { name: 'Duplicate', type: 'rich-text' },
      ],
      'Duplicates'
    );
    publishCsvImport(workspace, job);
    const exported = exportDatabaseCsv(workspace.getDoc(job.docId)!.getStore());
    expect(parseCsv(exported[0].csv)).toMatchObject({
      headers: preview.headers,
      rows: preview.rows,
    });
  });
});
