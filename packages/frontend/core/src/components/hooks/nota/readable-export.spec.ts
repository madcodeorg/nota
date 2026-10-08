/** @vitest-environment happy-dom */
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { Text } from '@blocksuite/affine/store';
import { Unzip } from '@blocksuite/affine/widgets/linked-doc';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { parseCsv } from '../../../desktop/dialogs/import/csv';
import { exportPageData } from './use-export-page';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
});
function createPage() {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'readable-export', rootDoc });
  workspace.meta.initialize();
  cleanup.push(() => {
    workspace.dispose();
    rootDoc.destroy();
  });
  const doc = workspace.createDoc();
  doc.load();
  const store = doc.getStore();
  const pageId = store.addBlock('affine:page', { title: new Text('Readable') });
  const noteId = store.addBlock('affine:note', {}, pageId);
  const databaseId = store.addBlock(
    'affine:database',
    {
      title: new Text('Tasks'),
      columns: [
        { id: 'title', type: 'title', name: 'Task', data: {} },
        {
          id: 'count',
          type: 'number',
          name: 'Count',
          data: { decimal: 0, format: 'number' },
        },
        {
          id: 'computed',
          type: 'formula',
          name: 'Computed',
          data: { expression: 'prop("count") * 3', resultType: 'number' },
        },
        { id: 'unknown', type: 'future-property', name: 'Future', data: {} },
      ],
    },
    noteId
  );
  const rowId = store.addBlock(
    'affine:paragraph',
    { text: new Text('Task one') },
    databaseId
  );
  const database = store.getModelById(databaseId) as DatabaseBlockModel;
  database.props.cells[rowId] = {
    count: { columnId: 'count', value: 2 },
    unknown: { columnId: 'unknown', value: { useful: 'preserved' } },
  };
  return { store, database, rowId };
}

describe('shared readable page exports', () => {
  test.each(['html', 'markdown', 'csv'] as const)(
    'exports %s with current computed values and a conversion report without persisting results',
    async type => {
      const { store, database, rowId } = createPage();
      let exported: Blob | undefined;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
        exported = blob as Blob;
        return 'blob:readable-export-test';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        () => {}
      );
      await exportPageData(store, type);
      expect(exported).toBeDefined();
      expect(exported!.type).toBe('application/zip');
      const archive = new Unzip();
      await archive.load(exported!);
      const files = new Map<string, string>();
      for (const entry of archive)
        files.set(entry.path, await entry.content.text());
      const content =
        type === 'csv'
          ? files.get('1-Tasks.csv')
          : [...files].find(([path]) => path.startsWith('1-'))?.[1];
      expect(content).toContain('Task one');
      expect(content).toContain('preserved');
      if (type === 'csv') expect(parseCsv(content!).rows[0][2]).toBe('6');
      else expect(content).toMatch(/(?:>|\s)6(?:<|\s)/);
      expect(files.get('Export report.txt')).toContain('definition');
      expect(files.get('Export report.txt')).toContain('future-property');
      expect(database.props.cells[rowId].computed).toBeUndefined();
    }
  );
});
