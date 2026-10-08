import 'fake-indexeddb/auto';

import { OpClient, type OpConsumer } from '@nota/infra/op';
import { afterEach, expect, test, vi } from 'vitest';
import { Doc, encodeStateAsUpdate } from 'yjs';

import { StoreManagerConsumer } from '../../worker/consumer';
import type { WorkerManagerOps, WorkerOps } from '../../worker/ops';
import { idbStorages } from '../idb';
import { googleDriveStorages } from './index';

afterEach(() => vi.unstubAllGlobals());

async function openWorker(accountId?: string) {
  const manager = new StoreManagerConsumer([
    ...idbStorages,
    ...googleDriveStorages,
  ]);
  let handlers!: Record<string, (input: unknown) => unknown>;
  manager.bindConsumer({
    registerAll: (value: typeof handlers) => {
      handlers = value;
    },
  } as unknown as OpConsumer<WorkerManagerOps>);
  const channel = new MessageChannel();
  const id = crypto.randomUUID();
  const local = (name: string) => ({
    name,
    opts: { id, flavour: 'local', type: 'workspace' },
  });
  handlers.open({
    key: id,
    closeKey: id,
    port: channel.port2,
    options: {
      local: {
        doc: local('IndexedDBDocStorage'),
        blob: local('IndexedDBBlobStorage'),
        docSync: local('IndexedDBDocSyncStorage'),
        blobSync: local('IndexedDBBlobSyncStorage'),
      },
      remotes: {
        drive: {
          doc: {
            name: 'google-drive:doc',
            opts: { id, accountId, tokens: null },
          },
          blob: {
            name: 'google-drive:blob',
            opts: { id, accountId, tokens: null },
          },
        },
      },
    },
  });
  const client = new OpClient<WorkerOps>(channel.port1);
  return {
    client,
    close: async () => {
      await handlers.close(id);
      channel.port1.close();
      channel.port2.close();
    },
  };
}

test('registered Drive storages initialize while disconnected and account mismatch does not block local saving', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { client, close } = await openWorker('owner-A');
  try {
    await client.call('docStorage.waitForConnected');
    await client.call('sync.setGoogleDriveTokens', {
      tokens: {
        accountId: 'other-owner',
        accessToken: 'wrong-token',
        expiresAt: Date.now() + 3600000,
      },
    });
    const doc = new Doc();
    doc.getText('text').insert(0, 'Saved locally without Drive authorization');
    const bin = encodeStateAsUpdate(doc);
    await client.call('docStorage.pushDocUpdate', {
      update: { docId: 'page', bin },
    });
    expect((await client.call('docStorage.getDoc', 'page'))?.bin).toEqual(bin);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

test('legacy caches bind only an explicit verified owner and reject replacement credentials', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ files: [], user: {} })
  );
  vi.stubGlobal('fetch', fetch);
  const { client, close } = await openWorker();
  const tokens = {
    accountId: 'owner-A',
    accessToken: 'owner-A-token',
    expiresAt: Date.now() + 3600000,
  };
  try {
    await client.call('docStorage.waitForConnected');
    await client.call('sync.setGoogleDriveTokens', { tokens });
    expect(fetch).not.toHaveBeenCalled();
    await client.call('sync.setGoogleDriveTokens', {
      tokens,
      workspaceOwner: 'owner-A',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await expect(
      client.call('sync.setGoogleDriveTokens', {
        tokens: {
          ...tokens,
          accountId: 'owner-B',
          accessToken: 'owner-B-token',
        },
        workspaceOwner: 'owner-B',
      })
    ).rejects.toThrow('different account');
    expect(
      fetch.mock.calls.every(
        ([, init]) =>
          new Headers(init?.headers).get('Authorization') ===
          'Bearer owner-A-token'
      )
    ).toBe(true);
    await client.call('sync.setGoogleDriveTokens', { tokens: null });
  } finally {
    await close();
  }
});
