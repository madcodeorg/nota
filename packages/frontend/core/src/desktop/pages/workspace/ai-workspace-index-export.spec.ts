/**
 * @vitest-environment happy-dom
 */
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, Text } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import {
  buildWorkspaceDocuments,
  startWorkspaceContentIndexSync,
} from './ai-workspace-index';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

describe('workspace AI index incremental sync', () => {
  type Request = { body: Record<string, any>; method: string; path: string };

  function setup(workspaceId: string, manifest: Response | null) {
    const rootDoc = new YDoc();
    const workspace = new WorkspaceImpl({ id: workspaceId, rootDoc });
    workspace.meta.initialize();
    const requests: Request[] = [];
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/v1/workspace/content/manifest')) {
          return manifest?.clone() ?? new Response('nope', { status: 500 });
        }
        const body = JSON.parse(String(init?.body));
        requests.push({ body, method: init?.method ?? 'GET', path: url });
        return Response.json({
          indexed: body.documents?.length ?? 0,
          removed: 0,
          total: 0,
          workspaceId,
        });
      })
    );
    const createNote = (id: string, content: string, updatedDate: number) => {
      const doc = workspace.createDoc(id);
      workspace.meta.setDocMeta(id, { title: id, updatedDate });
      doc.load();
      const store = doc.getStore({ id });
      const page = store.addBlock('affine:page', { title: new Text(id) });
      const note = store.addBlock('affine:note', {}, page);
      store.addBlock('affine:paragraph', { text: new Text(content) }, note);
    };
    return { createNote, requests, workspace };
  }

  const upserts = (requests: Request[]) =>
    requests.filter(request => request.path.endsWith('/upsert'));

  test('skips unchanged docs, exports changed ones without replacing, and deletes removed ones', async () => {
    const { createNote, requests, workspace } = setup('incremental-a', null);
    createNote('a', 'alpha', 1000);
    createNote('b', 'beta', 1000);
    const dispose = startWorkspaceContentIndexSync({
      accessForDocument: async () => true,
      debounceMs: 10,
      workspace,
      workspaceId: workspace.id,
    });
    try {
      // The failed manifest request falls back to a full replacement.
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(upserts(requests)).toHaveLength(1));
      expect(upserts(requests)[0]?.body.replacement).toMatchObject({
        complete: true,
        page: 0,
      });
      expect(upserts(requests)[0]?.body.documents).toHaveLength(2);

      workspace.slots.docListUpdated.next();
      await vi.advanceTimersByTimeAsync(50);
      expect(requests).toHaveLength(1);

      workspace.meta.setDocMeta('b', { updatedDate: 2000 });
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() => expect(upserts(requests)).toHaveLength(2));
      const incremental = upserts(requests)[1]?.body;
      expect(incremental?.replacement).toBeUndefined();
      expect(
        incremental?.documents.map((doc: { docId: string }) => doc.docId)
      ).toEqual(['b']);

      workspace.removeDoc('a');
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() =>
        expect(requests.at(-1)).toMatchObject({
          body: { docIds: ['a'], workspaceId: workspace.id },
          path: '/v1/workspace/content/delete',
        })
      );
      expect(upserts(requests)).toHaveLength(2);
    } finally {
      dispose();
      workspace.dispose();
    }
  });

  test('seeds the diff from the backend manifest on the first sync', async () => {
    const manifest = Response.json({
      documents: [
        { docId: 'a', updatedAt: new Date(1000).toISOString() },
        { docId: 'b', updatedAt: new Date(500).toISOString() },
        { docId: 'gone' },
      ],
      workspaceId: 'incremental-b',
    });
    const { createNote, requests, workspace } = setup(
      'incremental-b',
      manifest
    );
    createNote('a', 'alpha', 1000);
    createNote('b', 'beta', 1000);
    const dispose = startWorkspaceContentIndexSync({
      accessForDocument: async () => true,
      workspace,
      workspaceId: workspace.id,
    });
    try {
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      const [upsert, deletion] = requests;
      expect(upsert?.path).toBe('/v1/workspace/content/upsert');
      expect(upsert?.body.replacement).toBeUndefined();
      expect(
        upsert?.body.documents.map((doc: { docId: string }) => doc.docId)
      ).toEqual(['b']);
      expect(deletion?.body.docIds).toEqual(['gone']);
    } finally {
      dispose();
      workspace.dispose();
    }
  });

  test('lets only the lock owner sync and hands over when it is disposed', async () => {
    const { createNote, requests, workspace } = setup(
      'incremental-c',
      Response.json({ documents: [], workspaceId: 'incremental-c' })
    );
    createNote('a', 'alpha', 1000);
    let tail = Promise.resolve();
    const request = vi.fn(
      (
        _name: string,
        options: { signal: AbortSignal },
        callback: () => Promise<void>
      ) => {
        const run = tail.then(() =>
          options.signal.aborted
            ? Promise.reject(new Error('aborted'))
            : callback()
        );
        tail = run.catch(() => {});
        return run;
      }
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const subscribe = vi.spyOn(workspace.slots.docListUpdated, 'subscribe');
    const create = () =>
      startWorkspaceContentIndexSync({
        accessForDocument: async () => true,
        debounceMs: 10,
        workspace,
        workspaceId: workspace.id,
      });
    const first = create();
    const second = create();
    try {
      expect(request.mock.calls[0]?.[0]).toBe('nota-ai-index:incremental-c');
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(upserts(requests)).toHaveLength(1));
      expect(subscribe).toHaveBeenCalledTimes(1);

      first();
      await vi.advanceTimersByTimeAsync(2000);
      expect(subscribe).toHaveBeenCalledTimes(2);

      workspace.meta.setDocMeta('a', { updatedDate: 3000 });
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() => expect(upserts(requests)).toHaveLength(2));
    } finally {
      first();
      second();
      workspace.dispose();
    }
  });

  test('reuses one store per doc across repeated exports', async () => {
    const rootDoc = new YDoc();
    const workspace = new WorkspaceImpl({ id: 'store-reuse', rootDoc });
    workspace.meta.initialize();
    try {
      const doc = workspace.createDoc('a');
      workspace.meta.setDocMeta('a', { title: 'a' });
      doc.load();
      const store = doc.getStore({ id: 'a' });
      const page = store.addBlock('affine:page', { title: new Text('a') });
      const note = store.addBlock('affine:note', {}, page);
      store.addBlock('affine:paragraph', { text: new Text('alpha') }, note);

      const getStore = vi.spyOn(doc, 'getStore');
      const options = {
        accessForDocument: async () => true,
        workspace,
        workspaceId: workspace.id,
      };
      await buildWorkspaceDocuments(options);
      await buildWorkspaceDocuments(options);

      expect(getStore).toHaveBeenCalledTimes(2);
      expect(getStore.mock.calls.every(([arg]) => arg?.id === 'a')).toBe(true);
      expect(getStore.mock.results.every(r => r.value === store)).toBe(true);
    } finally {
      workspace.dispose();
      rootDoc.destroy();
    }
  });
});
