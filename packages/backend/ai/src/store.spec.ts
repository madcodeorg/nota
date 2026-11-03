import fsPromises, { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopilotStore, flushAllCopilotStores } from './store';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { force: true, recursive: true }))
  );
});

describe('CopilotStore persistence', () => {
  it('restores local chat history and contexts across backend restarts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const first = new CopilotStore(
      'local:qwen3-0.6b-onnx-q4f16',
      ['openai:gpt-5-mini'],
      filePath
    );
    const sessionId = first.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
    });
    first.createMessage({
      content: 'What did we decide?',
      sessionId,
    });
    first.appendAssistantMessage(sessionId, 'We decided to keep it local.', [
      { textDelta: 'We decided to keep it local.', type: 'text-delta' },
    ]);
    const contextId = first.createContext('workspace-a', sessionId);
    await first.flush();

    const second = new CopilotStore('local:another-default', [], filePath);
    const restored = second.requireSession(sessionId);
    expect(restored.title).toBe('What did we decide?');
    expect(restored.messages.map(message => message.content)).toEqual([
      'What did we decide?',
      'We decided to keep it local.',
    ]);
    expect(second.listContexts('workspace-a', sessionId)).toEqual([
      { id: contextId, workspaceId: 'workspace-a' },
    ]);

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      version?: number;
    };
    expect(saved.version).toBe(1);

    second.cleanupSessions({ sessionIds: [sessionId] });
    await second.flush();
    const third = new CopilotStore('local:default', [], filePath);
    expect(third.getSession(sessionId)).toBeNull();
    expect(third.listContexts('workspace-a', sessionId)).toEqual([]);
  });

  it('filters session lists by pinned, action, fork and limit', () => {
    const store = new CopilotStore('local:default');
    const older = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
      docId: 'doc-1',
    });
    const pinned = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
      docId: 'doc-2',
      pinned: true,
    });
    const forked = store.forkSession({ sessionId: older });
    const latest = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
      docId: 'doc-1',
    });
    const ids = (options: Parameters<CopilotStore['listSessions']>[3]) =>
      store
        .listSessions('workspace-a', undefined, undefined, options)
        .edges.map(edge => edge.node.sessionId)
        .sort();

    expect(ids({ pinned: true })).toEqual([pinned]);
    expect(ids({ pinned: true, limit: 1 })).toEqual([pinned]);
    expect(ids({ fork: true })).toEqual([forked]);
    expect(ids({ fork: false, pinned: false })).toEqual([older, latest].sort());
    expect(
      store
        .listSessions('workspace-a', 'doc-1', undefined, {
          action: false,
          fork: false,
          limit: 1,
        })
        .edges.map(edge => edge.node.sessionId)
    ).toHaveLength(1);
  });

  it('removes only the final assistant answer before regeneration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:qwen3-0.6b-onnx-q4f16', [], filePath);
    const sessionId = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
    });
    store.createMessage({ content: 'Try this again', sessionId });
    store.appendAssistantMessage(sessionId, 'A partial answer');

    expect(store.removeLastAssistantMessage(sessionId)).toBe(true);
    expect(
      store.requireSession(sessionId).messages.map(message => message.content)
    ).toEqual(['Try this again']);
    expect(store.removeLastAssistantMessage(sessionId)).toBe(false);
    await store.flush();

    const restored = new CopilotStore('local:default', [], filePath);
    expect(
      restored.requireSession(sessionId).messages.map(message => message.role)
    ).toEqual(['user']);
  });

  it('coalesces rapid mutations into few writes and keeps the latest state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:default', [], filePath);
    const rename = vi.spyOn(fsPromises, 'rename');
    try {
      for (let i = 0; i < 50; i++) {
        store.createSession({
          promptName: 'Chat With Nota AI',
          workspaceId: 'workspace-a',
        });
      }
      await store.flush();
      expect(rename.mock.calls.length).toBeLessThanOrEqual(2);
      const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
        sessions: unknown[];
      };
      expect(saved.sessions).toHaveLength(50);
    } finally {
      rename.mockRestore();
    }
  });

  it('does not lose a mutation made during an in-flight write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:default', [], filePath);
    store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
    });
    const first = store.flush();
    store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-b',
    });
    await first;
    await store.flush();
    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      sessions: unknown[];
    };
    expect(saved.sessions).toHaveLength(2);
  });

  it('writes the same file a single JSON.stringify would, across several chunks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:default', [], filePath);
    // Enough text to need several write chunks, with characters that must be
    // escaped or encoded as multi-byte UTF-8.
    const text = 'quote " backslash \\ newline \n emoji 😀 中文 '.repeat(2000);
    const sessionIds: string[] = [];
    for (let index = 0; index < 12; index++) {
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-a',
      });
      sessionIds.push(sessionId);
      store.createMessage({ content: `${index} ${text}`, sessionId });
      store.appendAssistantMessage(sessionId, `answer ${index} ${text}`);
    }
    store.createContext('workspace-a', sessionIds[0]);
    await store.flush();

    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk.length).toBeGreaterThan(256 * 1024 * 3);
    expect(onDisk).toBe(
      JSON.stringify({
        contexts: [...store['contexts']].map(([key, context]) => ({
          ...context,
          key,
        })),
        sessions: sessionIds.map(id => store.requireSession(id)),
        version: 1,
      })
    );

    const restored = new CopilotStore('local:default', [], filePath);
    for (const [index, sessionId] of sessionIds.entries()) {
      expect(
        restored.requireSession(sessionId).messages.map(m => m.content)
      ).toEqual([`${index} ${text}`, `answer ${index} ${text}`]);
    }
    expect(restored.listContexts('workspace-a', sessionIds[0])).toHaveLength(1);
  });

  it('leaves the previous history intact and no temporary file when a write fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:default', [], filePath);
    store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
    });
    await store.flush();
    const before = await readFile(filePath, 'utf8');

    // `store.ts` imports `rename` by name, so replace it at the module level.
    vi.resetModules();
    vi.doMock('node:fs/promises', async importOriginal => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      rename: vi.fn().mockRejectedValue(new Error('disk full')),
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failing = await import('./store');
      const failingStore = new failing.CopilotStore(
        'local:default',
        [],
        filePath
      );
      failingStore.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-a',
      });
      await failingStore.flush();
      expect(error).toHaveBeenCalledWith(
        '[copilot-store] failed to persist local chat history',
        expect.objectContaining({ message: 'disk full' })
      );
    } finally {
      error.mockRestore();
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }

    await expect(readFile(filePath, 'utf8')).resolves.toBe(before);
    await expect(fsPromises.readdir(root)).resolves.toEqual([
      'copilot-sessions.json',
    ]);
  });

  it('flushAllCopilotStores persists pending state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-copilot-store-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'copilot-sessions.json');
    const store = new CopilotStore('local:default', [], filePath);
    store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-a',
    });
    await flushAllCopilotStores();
    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      sessions: unknown[];
    };
    expect(saved.sessions).toHaveLength(1);
  });
});
