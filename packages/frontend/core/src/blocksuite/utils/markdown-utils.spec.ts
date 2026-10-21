import 'fake-indexeddb/auto';

import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getStoreManager } from '@nota/core/blocksuite/manager/store';
import { describe, expect, test } from 'vitest';

import { insertFromMarkdown } from './markdown-utils';

const extensions = getStoreManager().config.init().value.get('store');

describe('markdown-utils', () => {
  test('insertFromMarkdown does not create docs in the target workspace', async () => {
    const collection = new TestWorkspace({ id: 'test' });
    collection.meta.initialize();

    const store = collection.createDoc('page0').getStore({ extensions });
    store.load();
    const rootId = store.addBlock('affine:page', {
      title: new Text(''),
    });
    const noteId = store.addBlock('affine:note', {}, rootId);

    await insertFromMarkdown(
      undefined,
      ['- Summary item', '## Decisions', '- Ship it'].join('\n'),
      store,
      noteId,
      0
    );

    expect(collection.meta.docMetas.map(meta => meta.id)).toEqual(['page0']);
  });
});
