import 'fake-indexeddb/auto';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  Array as YArray,
  Doc as YDoc,
  encodeStateAsUpdate,
  Map as YMap,
  Text as YText,
} from 'yjs';

import {
  IndexedDBDocStorage,
  IndexedDBIndexerStorage,
  IndexedDBIndexerSyncStorage,
} from '../../impls/idb';
import { IndexerSyncImpl } from './index';

let docStorage: IndexedDBDocStorage;
let indexerStorage: IndexedDBIndexerStorage;
let indexerSyncStorage: IndexedDBIndexerSyncStorage;
let sync: IndexerSyncImpl;
let rootDoc: YDoc;
let doc: YDoc;

beforeEach(async () => {
  const options = {
    flavour: 'local',
    type: 'workspace' as const,
    id: crypto.randomUUID(),
  };
  docStorage = new IndexedDBDocStorage(options);
  indexerStorage = new IndexedDBIndexerStorage(options);
  indexerSyncStorage = new IndexedDBIndexerSyncStorage(options);
  for (const storage of [docStorage, indexerStorage, indexerSyncStorage]) {
    storage.connection.connect();
    await storage.connection.waitForConnected();
  }
  sync = new IndexerSyncImpl(
    docStorage,
    { local: indexerStorage, remotes: {} },
    indexerSyncStorage
  );
  rootDoc = new YDoc({ guid: options.id });
  doc = new YDoc({ guid: 'fallback-doc' });
});

afterEach(async () => {
  sync.stop();
  await new Promise<void>(resolve => setImmediate(resolve));
  rootDoc.destroy();
  doc.destroy();
  for (const storage of [docStorage, indexerStorage, indexerSyncStorage]) {
    storage.connection.disconnect();
  }
  vi.restoreAllMocks();
});

test('indexes real Yjs content, references and blobs when native crawling returns null', async () => {
  rootDoc.getMap('meta').set(
    'pages',
    YArray.from([
      new YMap([
        ['id', doc.guid],
        ['title', 'Local research'],
      ]),
    ])
  );

  const blocks = doc.getMap<YMap<unknown>>('blocks');
  function addBlock(
    id: string,
    flavour: string,
    children: string[],
    props: Record<string, unknown>
  ) {
    const block = new YMap<unknown>();
    block.set('sys:id', id);
    block.set('sys:flavour', flavour);
    block.set('sys:children', YArray.from(children));
    for (const [key, value] of Object.entries(props)) {
      block.set(`prop:${key}`, value);
    }
    blocks.set(id, block);
  }

  const text = new YText();
  text.applyDelta([
    { insert: 'Searchable quasar notes. See ' },
    {
      insert: 'Linked research',
      attributes: {
        reference: {
          pageId: 'target-doc',
          params: { mode: 'page', blockIds: ['target-block'] },
        },
      },
    },
  ]);
  addBlock('page', 'affine:page', ['note'], {
    title: new YText('Local research'),
  });
  addBlock('note', 'affine:note', ['text', 'linked', 'image', 'attachment'], {
    displayMode: 'page',
  });
  addBlock('text', 'affine:paragraph', [], { text, type: 'text' });
  addBlock('linked', 'affine:embed-linked-doc', [], {
    pageId: 'target-doc',
    params: { mode: 'edgeless' },
  });
  addBlock('image', 'affine:image', [], {
    sourceId: 'image-blob',
    caption: 'Telescope image',
  });
  addBlock('attachment', 'affine:attachment', [], {
    sourceId: 'attachment-blob',
    name: 'research.pdf',
  });

  await docStorage.pushDocUpdate({
    docId: rootDoc.guid,
    bin: encodeStateAsUpdate(rootDoc),
  });
  const clock = await docStorage.pushDocUpdate({
    docId: doc.guid,
    bin: encodeStateAsUpdate(doc),
  });
  const nativeCrawl = vi
    .spyOn(docStorage, 'crawlDocData')
    .mockResolvedValue(null);
  const getDoc = vi.spyOn(docStorage, 'getDoc');
  const errors = vi.spyOn(console, 'error');
  const indexerVersion = await indexerStorage.indexVersion();

  sync.start();
  // The clock is written after the real crawler output has been indexed.
  await vi.waitFor(async () => {
    expect(await indexerSyncStorage.getDocIndexedClock(doc.guid)).toEqual({
      ...clock,
      indexerVersion,
    });
  });

  expect(nativeCrawl).toHaveBeenCalledExactlyOnceWith(doc.guid);
  expect(getDoc).toHaveBeenCalledWith(doc.guid);
  expect(errors).not.toHaveBeenCalled();

  const textHits = await sync.search(
    'block',
    { type: 'match', field: 'content', match: 'quasar' },
    {
      fields: [
        'docId',
        'blockId',
        'content',
        'flavour',
        'parentBlockId',
        'parentFlavour',
        'additional',
      ],
    }
  );
  expect(textHits.nodes).toEqual([
    {
      id: `${doc.guid}:text`,
      score: expect.any(Number),
      fields: {
        docId: doc.guid,
        blockId: 'text',
        content: 'Searchable quasar notes. See Linked research',
        flavour: 'affine:paragraph',
        parentBlockId: 'note',
        parentFlavour: 'affine:note',
        additional: JSON.stringify({
          displayMode: 'page',
          noteBlockId: 'note',
        }),
      },
    },
  ]);

  const references = await sync.search(
    'block',
    { type: 'match', field: 'refDocId', match: 'target-doc' },
    { fields: ['blockId', 'ref', 'markdownPreview'] }
  );
  expect(references.nodes).toHaveLength(2);
  expect(references.nodes.map(node => node.fields)).toEqual(
    expect.arrayContaining([
      {
        blockId: 'text',
        ref: JSON.stringify({
          docId: 'target-doc',
          mode: 'page',
          blockIds: ['target-block'],
        }),
        markdownPreview: expect.stringContaining('Searchable quasar notes'),
      },
      {
        blockId: 'linked',
        ref: JSON.stringify({ docId: 'target-doc', mode: 'edgeless' }),
        markdownPreview: expect.stringContaining(
          `/workspace/${rootDoc.guid}/${doc.guid}?blockIds=linked`
        ),
      },
    ])
  );

  for (const [blockId, flavour, content, blob] of [
    ['image', 'affine:image', 'Telescope image', 'image-blob'],
    ['attachment', 'affine:attachment', 'research.pdf', 'attachment-blob'],
  ]) {
    const hits = await sync.search(
      'block',
      { type: 'match', field: 'blob', match: blob },
      { fields: ['docId', 'blockId', 'flavour', 'content', 'blob'] }
    );
    expect(hits.nodes).toEqual([
      {
        id: `${doc.guid}:${blockId}`,
        score: expect.any(Number),
        fields: { docId: doc.guid, blockId, flavour, content, blob },
      },
    ]);
  }

  const documents = await sync.search(
    'doc',
    { type: 'match', field: 'docId', match: doc.guid },
    { fields: ['title', 'summary'] }
  );
  expect(documents.nodes.map(node => node.fields)).toEqual([
    {
      title: 'Local research',
      summary: 'Searchable quasar notes. See Linked research',
    },
  ]);
});
