/**
 * @vitest-environment happy-dom
 */
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, Text } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { describe, expect, test } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { buildWorkspaceDocuments } from './ai-workspace-index';

describe('workspace AI index embedded document isolation', () => {
  test('never copies a synced document into its readable parent', async () => {
    const rootDoc = new YDoc();
    const workspace = new WorkspaceImpl({ id: 'index-access', rootDoc });
    workspace.meta.initialize();
    try {
      const createNote = (id: string, title: string, content: string) => {
        const doc = workspace.createDoc(id);
        workspace.meta.setDocMeta(id, { title });
        doc.load();
        const store = doc.getStore();
        const page = store.addBlock('affine:page', { title: new Text(title) });
        const note = store.addBlock('affine:note', {}, page);
        store.addBlock('affine:paragraph', { text: new Text(content) }, note);
        return { note, store };
      };
      const parent = createNote(
        'parent',
        'Public meeting',
        'Public discussion'
      );
      createNote(
        'restricted',
        'Restricted title',
        'Confidential salary detail'
      );
      parent.store.addBlock(
        'affine:embed-synced-doc',
        { pageId: 'restricted' },
        parent.note
      );
      parent.store.addBlock(
        'affine:embed-linked-doc',
        { pageId: 'restricted' },
        parent.note
      );
      parent.store.addBlock(
        'affine:paragraph',
        {
          text: new Text([
            { insert: 'Decision applies to ' },
            {
              insert: ' ',
              attributes: { reference: { pageId: 'restricted' } },
            },
          ] as DeltaInsert<AffineTextAttributes>[]),
        },
        parent.note
      );
      const documents = await buildWorkspaceDocuments({
        accessForDocument: async ({ docId }) => docId === 'parent',
        workspace,
        workspaceId: workspace.id,
      });
      expect(documents).toHaveLength(1);
      expect(documents[0]?.markdown).toContain('Public discussion');
      expect(documents[0]?.markdown).not.toContain(
        'Confidential salary detail'
      );
      expect(documents[0]?.markdown).not.toContain('Restricted title');

      const readable = await buildWorkspaceDocuments({
        accessForDocument: async () => true,
        workspace,
        workspaceId: workspace.id,
      });
      expect(readable).toHaveLength(2);
      expect(
        readable.find(doc => doc.docId === 'restricted')?.markdown
      ).toContain('Confidential salary detail');
      expect(
        readable.find(doc => doc.docId === 'parent')?.markdown
      ).not.toContain('Confidential salary detail');
      // Target titles must not inherit the parent's downstream visibility.
      expect(
        readable.find(doc => doc.docId === 'parent')?.markdown
      ).not.toContain('Restricted title');
      expect(documents[0]?.markdown).toContain('Decision applies to');
    } finally {
      workspace.dispose();
      rootDoc.destroy();
    }
  });
});
