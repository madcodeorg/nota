import { MarkdownAdapter } from '@blocksuite/affine-shared/adapters';
import { MarkdownTransformer, Zip } from '@blocksuite/affine-widget-linked-doc';
import { Schema } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { expect, test, vi } from 'vitest';

import { AffineSchemas } from '../../schemas.js';
import { testStoreExtensions } from '../utils/store.js';

test('Markdown ZIP imports surface adapter failures with the file path', async () => {
  const collection = new TestWorkspace();
  collection.storeExtensions = testStoreExtensions;
  collection.meta.initialize();
  const adapter = vi
    .spyOn(MarkdownAdapter.prototype, 'toDoc')
    .mockResolvedValue(undefined);
  try {
    const zip = new Zip();
    await zip.file('Team/failed.md', '# Failed');
    await expect(
      MarkdownTransformer.importMarkdownZip({
        collection,
        schema: new Schema().register(AffineSchemas),
        imported: await zip.generate(),
        extensions: testStoreExtensions,
      })
    ).rejects.toThrow('Team/failed.md');
  } finally {
    adapter.mockRestore();
    collection.forceStop();
    collection.dispose();
    collection.doc.destroy();
  }
});
