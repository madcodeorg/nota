import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CopilotStore } from './store';

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
    const third = new CopilotStore('local:default', [], filePath);
    expect(third.getSession(sessionId)).toBeNull();
    expect(third.listContexts('workspace-a', sessionId)).toEqual([]);
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

    const restored = new CopilotStore('local:default', [], filePath);
    expect(
      restored.requireSession(sessionId).messages.map(message => message.role)
    ).toEqual(['user']);
  });
});
