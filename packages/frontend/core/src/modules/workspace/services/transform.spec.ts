import { Text } from '@blocksuite/affine/store';
import { Framework } from '@nota/infra';
import type { BlobRecord, DocStorage } from '@nota/nbstore';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc, encodeStateAsUpdate } from 'yjs';

import type { Workspace } from '../entities/workspace';
import { WorkspaceImpl } from '../impls/workspace';
import type { WorkspaceDestroyService } from './destroy';
import type { WorkspaceFactoryService } from './factory';
import { workspaceCopyBlobIds, WorkspaceTransformService } from './transform';

function setup() {
  const root = new Doc({ guid: 'source' });
  root.getMap('meta').set('name', 'Original');
  const page = new Doc({ guid: 'page' });
  page.getText('text').insert(0, 'Durable text');
  const records = new Map([
    ['source', encodeStateAsUpdate(root)],
    ['page', encodeStateAsUpdate(page)],
  ]);
  const getClocks = () => ({ source: new Date(1), page: new Date(2) });
  const sourceStorage = {
    getDocTimestamps: vi.fn(async () => getClocks()),
    getDoc: vi.fn(async (id: string) => ({
      docId: id,
      bin: records.get(id),
      timestamp: getClocks()[id as 'page'],
    })),
  };
  const blob = {
    key: 'image',
    data: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
  };
  const source = {
    flavour: 'local',
    id: 'source',
    meta: { id: 'source', flavour: 'local' },
    docCollection: { doc: root, docs: new Map([['page', page]]) },
    engine: {
      doc: {
        waitForUpdated: vi.fn().mockResolvedValue(undefined),
        storage: sourceStorage,
      },
      blob: {
        get: vi.fn(async () => blob),
        storage: {
          get: vi.fn(async () => blob),
          list: vi.fn(async () => [
            { key: 'image', size: 3, mime: 'image/png' },
          ]),
        },
      },
    },
  } as unknown as Workspace;
  const destination = new Map<string, Uint8Array>();
  const media = new Map<string, BlobRecord>();
  const destinationStorage = {
    pushDocUpdate: vi.fn(async ({ docId, bin }) => {
      destination.set(docId, bin.slice());
    }),
    getDoc: vi.fn(async (id: string) => ({
      docId: id,
      bin: destination.get(id),
    })),
  } as unknown as DocStorage;
  const targetRoot = new Doc({ guid: 'destination' });
  const factory = {
    create: vi.fn(async (flavour, initial) => {
      await initial(
        {
          id: 'destination',
          doc: targetRoot,
          getDoc: () => ({
            load: vi.fn(),
            spaceDoc: new Doc({ guid: 'page' }),
          }),
        },
        {
          set: async (record: BlobRecord) => {
            media.set(record.key, record);
          },
          get: async (id: string) => media.get(id),
        },
        destinationStorage
      );
      return { id: 'destination', flavour };
    }),
  };
  const destroy = { deleteWorkspace: vi.fn() };
  const framework = new Framework();
  framework.service(
    WorkspaceTransformService,
    () =>
      new WorkspaceTransformService(
        factory as unknown as WorkspaceFactoryService,
        destroy as unknown as WorkspaceDestroyService
      )
  );
  const service = framework.provider().get(WorkspaceTransformService);
  return {
    service,
    source,
    sourceStorage,
    factory,
    destroy,
    destination,
    media,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('safe user-owned workspace copies', () => {
  test('inspects required attachments even when their bytes are absent from the local blob listing', () => {
    const rootDoc = new Doc({ guid: 'source' });
    const collection = new WorkspaceImpl({ id: 'source', rootDoc });
    collection.meta.initialize();
    const page = collection.createDoc('page');
    page.load();
    const store = page.getStore();
    const root = store.addBlock('affine:page', { title: new Text('Files') });
    const note = store.addBlock('affine:note', {}, root);
    store.addBlock(
      'affine:attachment',
      { name: 'Missing file', sourceId: 'required-but-not-cached' },
      note
    );
    try {
      const required = workspaceCopyBlobIds('source', [
        {
          docId: 'source',
          bin: encodeStateAsUpdate(rootDoc),
          timestamp: new Date(1),
        },
        {
          docId: 'page',
          bin: encodeStateAsUpdate(page.spaceDoc),
          timestamp: new Date(1),
        },
      ]);
      expect([...required]).toEqual(['required-but-not-cached']);
    } finally {
      collection.dispose();
      rootDoc.destroy();
    }
  });

  test('flushes local persistence, verifies root/pages/media and retains the original local workspace', async () => {
    const { service, source, destroy, destination, media } = setup();
    expect(
      await service.transformLocalToCloud(source, null, 'google-drive')
    ).toEqual({ id: 'destination', flavour: 'google-drive' });
    expect(source.engine.doc.waitForUpdated).toHaveBeenCalled();
    expect([...destination.keys()]).toEqual(['destination', 'page']);
    expect(media.get('image')?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(destroy.deleteWorkspace).not.toHaveBeenCalled();
  });

  test('typing during copy aborts publication and preserves the original workspace', async () => {
    const { service, source, sourceStorage, destroy } = setup();
    sourceStorage.getDocTimestamps
      .mockResolvedValueOnce({ source: new Date(1), page: new Date(2) })
      .mockResolvedValue({ source: new Date(1), page: new Date(3) });
    await expect(
      service.transformLocalToCloud(source, null, 'google-drive')
    ).rejects.toThrow('Workspace changed while copying');
    expect(destroy.deleteWorkspace).not.toHaveBeenCalled();
  });

  test('missing attachments fail before a workspace is published', async () => {
    const { service, source, factory, destroy } = setup();
    vi.mocked(source.engine.blob.get).mockResolvedValue(null);
    await expect(
      service.transformLocalToCloud(source, null, 'google-drive')
    ).rejects.toThrow('Attachment image is unavailable');
    expect(factory.create).not.toHaveBeenCalled();
    expect(destroy.deleteWorkspace).not.toHaveBeenCalled();
  });

  test('keep a local copy retains cached pages and media without deleting or contacting Drive', async () => {
    const { service, source, destroy, media } = setup();
    Object.defineProperty(source, 'flavour', { value: 'google-drive' });
    expect(await service.transformDriveToLocal(source)).toEqual({
      id: 'destination',
      flavour: 'local',
    });
    expect(media.get('image')?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(destroy.deleteWorkspace).not.toHaveBeenCalled();
  });
});
