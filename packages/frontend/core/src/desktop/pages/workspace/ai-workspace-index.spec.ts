import type { Workspace } from '@blocksuite/affine/store';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  buildWorkspaceDocuments,
  resolveWorkspaceContentAccess,
  startWorkspaceContentIndexSync,
  syncWorkspaceContentPages,
  type WorkspaceContentDocument,
} from './ai-workspace-index';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace AI index access', () => {
  test('fails closed when a document access check fails or is inconclusive', async () => {
    const input = {
      docId: 'private-doc',
      meta: {},
      title: 'Private document',
    };

    await expect(
      resolveWorkspaceContentAccess(async () => {
        throw new Error('permission service unavailable');
      }, input)
    ).resolves.toBeNull();
    await expect(
      resolveWorkspaceContentAccess(async () => undefined, input)
    ).resolves.toBeNull();
    await expect(
      resolveWorkspaceContentAccess(
        async () => ({ readable: false, visibility: 'workspace' }),
        input
      )
    ).resolves.toBeNull();
  });

  test('keeps only a positive access decision and its visibility metadata', async () => {
    const access = await resolveWorkspaceContentAccess(
      async () => ({
        allowedUserIds: ['local-user'],
        readable: true,
        visibility: 'private',
      }),
      { docId: 'doc', meta: {}, title: 'Document' }
    );

    expect(access).toEqual({
      allowedUserIds: ['local-user'],
      readable: true,
      visibility: 'private',
    });
  });

  test('skips a rootless document without invoking snapshot export', async () => {
    const getTransformer = vi.fn();
    const load = vi.fn();
    const workspace = {
      getDoc: () => ({
        getStore: () => ({ getTransformer, load, root: null }),
      }),
      meta: {
        docMetas: [
          {
            createDate: 1,
            id: 'rootless-doc',
            title: 'Rootless document',
          },
        ],
        initialize: vi.fn(),
      },
    } as unknown as Workspace;

    await expect(
      buildWorkspaceDocuments({
        accessForDocument: async () => true,
        workspace,
        workspaceId: 'workspace-alpha',
      })
    ).resolves.toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    expect(getTransformer).not.toHaveBeenCalled();
  });
});

describe('workspace AI index pagination', () => {
  test('sends every document in ordered replacement pages without a 120-doc cap', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push(body);
        const documents = body.documents as WorkspaceContentDocument[];
        return new Response(
          JSON.stringify({
            indexed: documents.length,
            total: 125,
            workspaceId: body.workspaceId,
          }),
          { status: 200 }
        );
      })
    );
    const documents = Array.from({ length: 125 }, (_, index) => ({
      accessVerified: true as const,
      docId: `doc-${index}`,
      markdown: `# Document ${index}`,
      title: `Document ${index}`,
      visibility: 'workspace' as const,
    }));

    const result = await syncWorkspaceContentPages({
      documents,
      pageSize: 50,
      replaceWorkspace: true,
      syncId: 'sync-all-docs',
      workspaceId: 'workspace-alpha',
    });

    expect(result.indexed).toBe(125);
    expect(requests).toHaveLength(3);
    expect(
      requests.flatMap(request =>
        (request.documents as WorkspaceContentDocument[]).map(
          document => document.docId
        )
      )
    ).toEqual(documents.map(document => document.docId));
    expect(requests.map(request => request.replacement)).toEqual([
      { complete: false, page: 0, syncId: 'sync-all-docs' },
      { complete: false, page: 1, syncId: 'sync-all-docs' },
      { complete: true, page: 2, syncId: 'sync-all-docs' },
    ]);
  });

  test('sends an explicit final empty page when a workspace has no readable docs', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push(body);
        return new Response(
          JSON.stringify({
            indexed: 0,
            removed: 4,
            total: 0,
            workspaceId: body.workspaceId,
          }),
          { status: 200 }
        );
      })
    );

    await syncWorkspaceContentPages({
      documents: [],
      replaceWorkspace: true,
      syncId: 'sync-empty',
      workspaceId: 'workspace-alpha',
    });

    expect(requests).toEqual([
      {
        documents: [],
        replacement: { complete: true, page: 0, syncId: 'sync-empty' },
        workspaceId: 'workspace-alpha',
      },
    ]);
  });

  test('deletes a requested document when its access cannot be verified', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ body, path: url });
        const documents = (body.documents ?? []) as WorkspaceContentDocument[];
        return new Response(
          JSON.stringify({
            indexed: documents.length,
            removed: url.endsWith('/delete') ? 1 : 0,
            total: 1,
            workspaceId: body.workspaceId,
          }),
          { status: 200 }
        );
      })
    );
    const readableDocument: WorkspaceContentDocument = {
      accessVerified: true,
      docId: 'readable',
      markdown: '# Readable',
      title: 'Readable',
      visibility: 'workspace',
    };

    await syncWorkspaceContentPages({
      documents: [readableDocument],
      replaceWorkspace: false,
      requestedDocIds: ['readable', 'permission-check-failed'],
      workspaceId: 'workspace-alpha',
    });

    expect(requests).toEqual([
      {
        body: {
          docIds: ['permission-check-failed'],
          workspaceId: 'workspace-alpha',
        },
        path: '/v1/workspace/content/delete',
      },
      {
        body: {
          documents: [readableDocument],
          workspaceId: 'workspace-alpha',
        },
        path: '/v1/workspace/content/upsert',
      },
    ]);
  });
});

describe('workspace AI index lifecycle', () => {
  test('syncs on workspace entry, document updates, and the refresh interval', async () => {
    vi.useFakeTimers();
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push(body);
        return Response.json({
          indexed: 0,
          total: 0,
          workspaceId: body.workspaceId,
        });
      })
    );
    let onDocListUpdated: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const workspace = {
      getDoc: () => null,
      meta: {
        docMetas: [],
        initialize: vi.fn(),
      },
      slots: {
        docListUpdated: {
          subscribe: (callback: () => void) => {
            onDocListUpdated = callback;
            return { unsubscribe };
          },
        },
      },
    } as unknown as Workspace;

    const dispose = startWorkspaceContentIndexSync({
      accessForDocument: async () => true,
      debounceMs: 10,
      intervalMs: 100,
      workspace,
      workspaceId: 'workspace-alpha',
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);

    onDocListUpdated?.();
    await vi.advanceTimersByTimeAsync(9);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(requests).toHaveLength(3);

    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
