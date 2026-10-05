import { EventEmitter } from 'node:events';

import { MockLanguageModelV4 } from 'ai/test';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

const localOnnxMocks = vi.hoisted(() => ({
  assertLocalOnnxTextReady: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  listWorkspaceDocuments: vi.fn(),
  readWorkspaceDocument: vi.fn(),
  searchWorkspace: vi.fn(),
}));

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: aiMocks.streamText };
});

vi.mock('./local-onnx', async importOriginal => {
  const actual = await importOriginal<typeof import('./local-onnx')>();
  return {
    ...actual,
    assertLocalOnnxTextReady: localOnnxMocks.assertLocalOnnxTextReady,
  };
});

vi.mock('./workspace-search', async importOriginal => {
  const actual = await importOriginal<typeof import('./workspace-search')>();
  return {
    ...actual,
    listWorkspaceDocuments: workspaceMocks.listWorkspaceDocuments,
    readWorkspaceDocument: workspaceMocks.readWorkspaceDocument,
    searchWorkspace: workspaceMocks.searchWorkspace,
  };
});

import type { AiBackendConfig } from './config';
import type { AiModelRouter, TextModelRuntime } from './providers';
import { CopilotStore } from './store';
import {
  actionIntent,
  buildLocalOnnxActionProposal,
  configForRequestWorkspaceAccess,
  createStreamHandler,
  localInsertPosition,
  localOnnxMutationMarkdown,
  localWorkspaceDocumentMode,
  resolveLocalOnnxTargetDocument,
  toModelMessages,
  workspaceContentAccessForRequest,
} from './stream';
import { createNotaToolContext } from './tools';
import type { CopilotSession } from './types';

class StreamRequest extends EventEmitter {
  aborted = false;
  complete = true;
  params: Record<string, string> = {};
  query: Record<string, string> = {};
}

class StreamResponse extends EventEmitter {
  readonly chunks: string[] = [];
  writableEnded = false;

  end() {
    this.writableEnded = true;
    return this;
  }

  flushHeaders() {}

  write(chunk: unknown) {
    this.chunks.push(String(chunk));
    return true;
  }

  writeHead() {
    return this;
  }
}

beforeEach(() => {
  aiMocks.streamText.mockReset();
  localOnnxMocks.assertLocalOnnxTextReady.mockReset();
  localOnnxMocks.assertLocalOnnxTextReady.mockResolvedValue(undefined);
  workspaceMocks.listWorkspaceDocuments.mockReset();
  workspaceMocks.listWorkspaceDocuments.mockResolvedValue({
    documents: [],
    total: 0,
    workspaceId: 'workspace-1',
  });
  workspaceMocks.readWorkspaceDocument.mockReset();
  workspaceMocks.searchWorkspace.mockReset();
  workspaceMocks.searchWorkspace.mockResolvedValue({
    query: '',
    results: [],
    searchType: 'lexical-fallback',
  });
});

function sessionWithImage(image: string): CopilotSession {
  const now = new Date(0).toISOString();
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    docId: null,
    parentSessionId: null,
    promptName: 'Chat With Nota AI',
    model: '',
    optionalModels: [],
    action: null,
    pinned: false,
    title: null,
    tokens: 0,
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Describe this image',
        attachments: [image],
        streamObjects: [],
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function actionSession(content: string, docId: string | null = null) {
  const session = sessionWithImage('');
  session.docId = docId;
  session.messages[0] = {
    ...session.messages[0],
    attachments: [],
    content,
  };
  return session;
}

function streamConfig() {
  return {
    mcpConfig: '{}',
    mcpEnabled: false,
    openaiApiKey: 'test-openai-key',
    toolMaxSteps: 1,
    toolsEnabled: false,
    workspaceSearchToolEnabled: false,
  } as AiBackendConfig;
}

describe('AI SDK tool loop budget', () => {
  test.each([
    { budget: 1, finishAfter: 1 },
    { budget: 4, finishAfter: 4 },
    { budget: 50, finishAfter: 50 },
    { budget: 50, finishAfter: 2 },
    { budget: 50, finishAfter: 0 },
  ])(
    'answers after $finishAfter tool rounds with a budget of $budget',
    async ({ budget, finishAfter }) => {
      const actual = await vi.importActual<typeof import('ai')>('ai');
      aiMocks.streamText.mockImplementation(actual.streamText);
      let toolRounds = 0;
      const model = new MockLanguageModelV4({
        doStream: async options => {
          const useTool =
            options.toolChoice?.type !== 'none' &&
            (finishAfter === budget || toolRounds < finishAfter);
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                if (useTool) {
                  toolRounds++;
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: `read-${toolRounds}`,
                    toolName: 'list_nota_documents',
                    input: '{}',
                  });
                } else {
                  controller.enqueue({ type: 'text-start', id: 'answer' });
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'answer',
                    delta: 'Here is the final answer.',
                  });
                  controller.enqueue({ type: 'text-end', id: 'answer' });
                }
                controller.enqueue({
                  type: 'finish',
                  finishReason: {
                    unified: useTool ? 'tool-calls' : 'stop',
                    raw: useTool ? 'tool-calls' : 'stop',
                  },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: {
                      total: 1,
                      text: useTool ? 0 : 1,
                      reasoning: 0,
                    },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.createMessage({ content: 'Hello.', sessionId });
      const models = {
        select: vi.fn(() => ({
          model,
          modelId: 'test-model',
          provider: 'openai',
          runtime: 'hosted',
        })),
      } as unknown as AiModelRouter;
      const request = new StreamRequest();
      request.params = { sessionId };
      const response = new StreamResponse();
      await createStreamHandler({
        config: {
          ...streamConfig(),
          toolMaxSteps: budget,
          toolsEnabled: true,
          workspaceSearchToolEnabled: true,
        },
        models,
        store,
      })(request as unknown as Request, response as unknown as Response);

      expect(toolRounds).toBe(finishAfter);
      expect(workspaceMocks.listWorkspaceDocuments).toHaveBeenCalledTimes(
        finishAfter
      );
      expect(model.doStreamCalls).toHaveLength(finishAfter + 1);
      const finalCall = model.doStreamCalls.at(-1)!;
      if (finishAfter === budget) {
        expect(finalCall.toolChoice).toEqual({ type: 'none' });
        expect(finalCall.tools ?? []).toEqual([]);
        expect(finalCall.prompt).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining(
                'The tool round budget is exhausted.'
              ),
            }),
          ])
        );
      } else {
        expect(finalCall.toolChoice?.type).not.toBe('none');
      }
      expect(response.chunks.join('')).not.toContain('event: error');
      expect(response.chunks.join('')).toContain('Here is the final answer.');
      expect(response.writableEnded).toBe(true);
      const messages = store.requireSession(sessionId).messages;
      expect(messages.map(message => message.role)).toEqual([
        'user',
        'assistant',
      ]);
      expect(messages.at(-1)?.content).toBe('Here is the final answer.');
    }
  );
});

describe('shared tool events', () => {
  test.each(['hosted', 'local-onnx'] as const)(
    'streams and stores %s tool failures alongside the final answer',
    async runtime => {
      aiMocks.streamText.mockReturnValue({
        fullStream: (async function* () {
          yield {
            type: 'tool-call',
            toolCallId: 'failed-lookup',
            toolName: 'read_nota_document',
            input: { docId: 'inaccessible' },
          };
          yield {
            type: 'tool-error',
            toolCallId: 'failed-lookup',
            toolName: 'read_nota_document',
            input: { docId: 'inaccessible' },
            error: new Error('The document is not accessible.'),
          };
          yield { type: 'text-delta', text: 'I could not read the document.' };
        })(),
      });
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.createMessage({ content: 'Read the note.', sessionId });
      const models = {
        select: vi.fn(() => ({
          model: {},
          modelId: 'test-model',
          provider: runtime === 'local-onnx' ? 'local' : 'openai',
          runtime,
        })),
      } as unknown as AiModelRouter;
      const request = new StreamRequest();
      request.params = { sessionId };
      const response = new StreamResponse();
      await createStreamHandler({
        config: { ...streamConfig(), toolsEnabled: true },
        models,
        store,
      })(request as unknown as Request, response as unknown as Response);
      const failedResult = {
        type: 'tool-result',
        toolCallId: 'failed-lookup',
        toolName: 'read_nota_document',
        args: { docId: 'inaccessible' },
        result: { status: 'error', error: 'The document is not accessible.' },
      };
      expect(response.chunks.join('')).toContain(JSON.stringify(failedResult));
      expect(
        store.requireSession(sessionId).messages.at(-1)?.streamObjects
      ).toContainEqual(failedResult);
    }
  );
  test.each(['hosted', 'local-onnx'] as const)(
    'preserves a completed %s proposal when final generation fails',
    async runtime => {
      const actual = await vi.importActual<typeof import('ai')>('ai');
      aiMocks.streamText.mockImplementation(actual.streamText);
      let calls = 0;
      const model = new MockLanguageModelV4({
        doStream: async () => {
          if (calls++) throw new Error('Final answer generation failed.');
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: 'completed-proposal',
                  toolName: 'propose_nota_action',
                  input: JSON.stringify({
                    proposal: {
                      type: 'create_note',
                      title: 'Synthetic note',
                      markdown: '# Synthetic note',
                    },
                    reason: 'Create the requested note.',
                  }),
                });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 1, text: 0, reasoning: 0 },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.createMessage({ content: 'Make a note.', sessionId });
      const models = {
        select: vi.fn(() => ({
          model,
          modelId: 'test-model',
          provider: runtime === 'local-onnx' ? 'local' : 'openai',
          runtime,
        })),
      } as unknown as AiModelRouter;
      const request = new StreamRequest();
      request.params = { sessionId };
      const response = new StreamResponse();
      await createStreamHandler({
        config: { ...streamConfig(), toolsEnabled: true },
        models,
        store,
      })(request as unknown as Request, response as unknown as Response);
      expect(response.chunks.join('')).toContain(
        'Final answer generation failed.'
      );
      const assistant = store.requireSession(sessionId).messages.at(-1);
      expect(assistant?.role).toBe('assistant');
      expect(assistant?.streamObjects).toContainEqual(
        expect.objectContaining({
          type: 'tool-result',
          toolCallId: 'completed-proposal',
          result: expect.objectContaining({
            proposal: expect.objectContaining({ status: 'pending_approval' }),
          }),
        })
      );
    }
  );
  test.each(['hosted', 'local-onnx'] as const)(
    'delivers the %s note proposal before the final answer and preserves it in history',
    async runtime => {
      const actual = await vi.importActual<typeof import('ai')>('ai');
      aiMocks.streamText.mockImplementation(actual.streamText);
      const proposal = {
        type: 'create_note',
        title: 'How LLMs Work',
        markdown:
          '# How LLMs Work\n\nLLMs predict tokens using learned patterns.',
      };
      const input = { proposal, reason: 'Create the requested note.' };
      let finishAnswer!: () => void;
      const answerReady = new Promise<void>(resolve => {
        finishAnswer = resolve;
      });
      let calls = 0;
      const model = new MockLanguageModelV4({
        doStream: async () => {
          const useTool = calls++ === 0;
          if (!useTool) await answerReady;
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                if (useTool) {
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: 'create-note-1',
                    toolName: 'propose_nota_action',
                    input: JSON.stringify(input),
                  });
                } else {
                  controller.enqueue({ type: 'text-start', id: 'answer' });
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'answer',
                    delta: 'Please approve the note proposal.',
                  });
                  controller.enqueue({ type: 'text-end', id: 'answer' });
                }
                controller.enqueue({
                  type: 'finish',
                  finishReason: {
                    unified: useTool ? 'tool-calls' : 'stop',
                    raw: useTool ? 'tool-calls' : 'stop',
                  },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: {
                      total: 1,
                      text: useTool ? 0 : 1,
                      reasoning: 0,
                    },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.createMessage({
        content: 'Make a note about how an LLM works.',
        sessionId,
      });
      const models = {
        select: vi.fn(() => ({
          model,
          modelId: 'test-model',
          provider: runtime === 'local-onnx' ? 'local' : 'openai',
          runtime,
        })),
      } as unknown as AiModelRouter;
      const request = new StreamRequest();
      request.params = { sessionId };
      const response = new StreamResponse();
      const handling = createStreamHandler({
        config: { ...streamConfig(), toolsEnabled: true },
        models,
        store,
      })(request as unknown as Request, response as unknown as Response);
      let liveObjects: unknown[] = [];
      try {
        await vi.waitFor(
          () => {
            liveObjects = response.chunks
              .filter(chunk => chunk.startsWith('data: {'))
              .map(chunk => JSON.parse(chunk.slice('data: '.length)));
            expect(liveObjects).toEqual([
              {
                type: 'tool-call',
                toolCallId: 'create-note-1',
                toolName: 'propose_nota_action',
                args: input,
              },
              expect.objectContaining({
                type: 'tool-result',
                toolCallId: 'create-note-1',
                toolName: 'propose_nota_action',
                args: input,
                result: expect.objectContaining({
                  proposal: expect.objectContaining({
                    proposal,
                    sessionId,
                    workspaceId: 'workspace-1',
                    status: 'pending_approval',
                  }),
                  requiresApproval: true,
                }),
              }),
            ]);
          },
          { timeout: 1000 }
        );
        expect(response.writableEnded).toBe(false);
        expect(store.requireSession(sessionId).messages).toHaveLength(1);
      } finally {
        finishAnswer();
        await handling;
      }
      expect(response.writableEnded).toBe(true);
      expect(response.chunks.join('')).not.toContain('event: error');
      expect(aiMocks.streamText.mock.calls[0][0]).toMatchObject({
        maxOutputTokens: 12_000,
      });
      const assistant = store.requireSession(sessionId).messages.at(-1);
      expect(assistant?.content).toBe('Please approve the note proposal.');
      expect(assistant?.streamObjects.slice(1)).toEqual(liveObjects);
    }
  );
});

describe('text stream disconnect cancellation', () => {
  test.each<{
    disconnect: 'request' | 'response';
    provider: 'local' | 'openai';
    runtime: TextModelRuntime;
    throwsAfterAbort: boolean;
  }>([
    {
      disconnect: 'request',
      provider: 'local',
      runtime: 'local-onnx',
      throwsAfterAbort: false,
    },
    {
      disconnect: 'response',
      provider: 'openai',
      runtime: 'hosted',
      throwsAfterAbort: true,
    },
  ])(
    'aborts $runtime inference on $disconnect disconnect without persisting a partial assistant message',
    async ({ disconnect, provider, runtime, throwsAfterAbort }) => {
      let markInferenceStarted!: () => void;
      const inferenceStarted = new Promise<void>(resolve => {
        markInferenceStarted = resolve;
      });
      let inferenceObservedAbort = false;
      let receivedSignal: AbortSignal | undefined;
      aiMocks.streamText.mockImplementation(
        (options: { abortSignal?: AbortSignal }) => {
          receivedSignal = options.abortSignal;
          return {
            fullStream: (async function* () {
              yield { text: 'Partial answer', type: 'text-delta' };
              markInferenceStarted();
              await new Promise<void>(resolve => {
                if (options.abortSignal?.aborted) {
                  inferenceObservedAbort = true;
                  resolve();
                  return;
                }
                options.abortSignal?.addEventListener(
                  'abort',
                  () => {
                    inferenceObservedAbort = true;
                    resolve();
                  },
                  { once: true }
                );
              });
              if (throwsAfterAbort) {
                throw new Error('Provider stopped after request abort.');
              }
            })(),
          };
        }
      );

      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.createMessage({
        content: 'Keep generating until I disconnect.',
        sessionId,
      });
      const models = {
        select: vi.fn(() => ({
          model: {} as never,
          modelId: 'test-model',
          provider,
          runtime,
        })),
      } as unknown as AiModelRouter;
      const request = new StreamRequest();
      request.params = { sessionId };
      const response = new StreamResponse();
      const handler = createStreamHandler({
        config: streamConfig(),
        models,
        store,
      });

      const handling = handler(
        request as unknown as Request,
        response as unknown as Response
      );
      await inferenceStarted;
      if (disconnect === 'request') {
        request.aborted = true;
        request.emit('aborted');
      } else {
        response.emit('close');
      }
      await handling;

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(true);
      expect(inferenceObservedAbort).toBe(true);
      expect(
        store.requireSession(sessionId).messages.map(message => message.role)
      ).toEqual(['user']);
      expect(response.chunks.join('')).not.toContain('event: error');
    }
  );
});

describe('toModelMessages image handling', () => {
  test('keeps images for local OpenAI-compatible models', () => {
    const image = 'data:image/png;base64,aW1hZ2U=';

    expect(
      toModelMessages(sessionWithImage(image), 'openai-compatible-local')
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image', image },
        ],
      },
    ]);
  });

  test('suppresses images only for local ONNX models', () => {
    const image = 'data:image/png;base64,aW1hZ2U=';

    expect(toModelMessages(sessionWithImage(image), 'local-onnx')).toEqual([
      {
        role: 'user',
        content: 'Describe this image',
      },
    ]);
  });
});

describe('per-request workspace content access', () => {
  test('keeps backwards-compatible access when no per-chat setting is sent', () => {
    expect(workspaceContentAccessForRequest(undefined)).toBe(true);
  });

  test('disables all workspace retrieval when either all-docs permission is off', () => {
    expect(
      workspaceContentAccessForRequest(
        JSON.stringify({ readingDocs: false, searchWorkspace: true })
      )
    ).toBe(false);
    expect(
      workspaceContentAccessForRequest(
        JSON.stringify({ readingDocs: true, searchWorkspace: false })
      )
    ).toBe(false);
  });

  test('fails closed for an explicitly malformed tools config', () => {
    expect(workspaceContentAccessForRequest('{not-json')).toBe(false);
    expect(workspaceContentAccessForRequest(['unexpected'])).toBe(false);
    expect(
      workspaceContentAccessForRequest(
        JSON.stringify({ readingDocs: 'false', searchWorkspace: true })
      )
    ).toBe(false);
  });

  test('turns off workspace preflight and document tools without disabling other tools', async () => {
    const config = {
      mcpEnabled: false,
      shellToolEnabled: false,
      toolsEnabled: true,
      webCrawlToolEnabled: true,
      workspaceSearchToolEnabled: true,
    } as AiBackendConfig;
    const requestConfig = configForRequestWorkspaceAccess(config, false);

    expect(requestConfig).toMatchObject({
      toolsEnabled: true,
      webCrawlToolEnabled: true,
      workspaceSearchToolEnabled: false,
    });
    expect(config.workspaceSearchToolEnabled).toBe(true);

    const toolContext = await createNotaToolContext(requestConfig, {
      sessionId: 'session-1',
      userId: 'local-user',
      workspaceId: 'workspace-1',
    });
    try {
      expect(toolContext.tools).toHaveProperty('propose_nota_action');
      expect(toolContext.tools).toHaveProperty('web_crawl');
      expect(toolContext.tools).not.toHaveProperty('list_nota_documents');
      expect(toolContext.tools).not.toHaveProperty('read_nota_document');
      expect(toolContext.tools).not.toHaveProperty('search_nota_workspace');
    } finally {
      await toolContext.close();
    }
  });
});

describe('local ONNX workspace and edit routing', () => {
  test('loads canonical documents only for full read-style requests', () => {
    expect(localWorkspaceDocumentMode('List all my notes')).toBe('list');
    expect(localWorkspaceDocumentMode('Summarize the Launch Plan note')).toBe(
      'read'
    );
    expect(
      localWorkspaceDocumentMode('What did we decide about pricing?')
    ).toBe('search');
  });

  test('routes selected-content rewrites to a replacement proposal', () => {
    expect(
      actionIntent(
        'Polish this paragraph.\n\nContext:\nSelected Markdown:\nDraft copy'
      )
    ).toBe('replace_selection');
  });

  test('honors selection, start, and end insertion positions', () => {
    expect(localInsertPosition('Add this after the selected text')).toBe(
      'selection'
    );
    expect(
      localInsertPosition('Insert this at the beginning of the note')
    ).toBe('start');
    expect(localInsertPosition('Append this to the note')).toBe('end');
  });

  test('resolves only the longest unique exact note-title mention', () => {
    const candidates = [
      { docId: 'plan', title: 'Plan' },
      { docId: 'launch-plan', title: 'Launch Plan' },
    ];

    expect(
      resolveLocalOnnxTargetDocument(
        'Append this update to the Launch Plan note.',
        candidates
      )
    ).toEqual({ docId: 'launch-plan', status: 'resolved' });
    expect(
      resolveLocalOnnxTargetDocument('Append this update to another note.', [
        ...candidates,
        { docId: 'launch-plan-copy', title: 'Launch Plan' },
      ])
    ).toEqual({ docId: null, status: 'missing' });
    expect(
      resolveLocalOnnxTargetDocument(
        'Append this update to the Launch Plan note.',
        [...candidates, { docId: 'launch-plan-copy', title: 'Launch Plan' }]
      )
    ).toEqual({ docId: null, status: 'ambiguous' });
  });

  test('extracts only one fenced mutation body and excludes preface and sources', () => {
    const response = [
      'I prepared the requested update.',
      '```markdown',
      '## Launch update',
      '',
      'Ship the local build.',
      '```',
      '',
      'Sources:',
      '- Launch Plan [source: nota://workspace-1/launch-plan]',
    ].join('\n');

    expect(localOnnxMutationMarkdown(response)).toBe(
      '## Launch update\n\nShip the local build.'
    );
    expect(localOnnxMutationMarkdown('Preface\n\nPlain markdown')).toBeNull();
    expect(
      localOnnxMutationMarkdown(
        '```markdown\nFirst\n```\n\n```markdown\nSecond\n```'
      )
    ).toBeNull();
  });

  test('uses the current session document before a resolved named target', () => {
    const assistantText = '```markdown\n## Update\n\nDone.\n```';

    expect(
      buildLocalOnnxActionProposal({
        assistantText,
        session: actionSession(
          'Append this update to the Launch Plan note.',
          'current-doc'
        ),
        targetDocId: 'launch-plan',
        userContent: 'Append this update to the Launch Plan note.',
      })
    ).toEqual({
      docId: 'current-doc',
      markdown: '## Update\n\nDone.',
      position: 'end',
      type: 'insert_markdown',
    });
    expect(
      buildLocalOnnxActionProposal({
        assistantText,
        session: actionSession('Append this update to the Launch Plan note.'),
        userContent: 'Append this update to the Launch Plan note.',
      })
    ).toBeNull();
  });

  test('targets an exact accessible note and keeps the action approval-gated', async () => {
    const result = {
      blockId: 'block-1',
      docId: 'launch-plan',
      id: 'launch-plan:block-1',
      score: 1,
      snippet: 'Existing launch plan.',
      source: 'doc' as const,
      sourceRef: 'nota://workspace-1/launch-plan',
      title: 'Launch Plan',
      workspaceId: 'workspace-1',
    };
    workspaceMocks.searchWorkspace.mockResolvedValue({
      query: 'Append this update to the Launch Plan note.',
      results: [result],
      searchType: 'lexical-fallback',
    });
    workspaceMocks.listWorkspaceDocuments.mockResolvedValue({
      documents: [
        {
          docId: 'launch-plan',
          source: 'doc',
          sourceRef: 'nota://workspace-1/launch-plan',
          title: 'Launch Plan',
          workspaceId: 'workspace-1',
        },
      ],
      total: 1,
      workspaceId: 'workspace-1',
    });
    workspaceMocks.readWorkspaceDocument.mockResolvedValue({
      document: {
        docId: 'launch-plan',
        markdown: '# Launch Plan\n\nExisting launch plan.',
        source: 'doc',
        sourceRef: 'nota://workspace-1/launch-plan',
        title: 'Launch Plan',
        workspaceId: 'workspace-1',
      },
    });
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          text: [
            'I prepared the update.',
            '```markdown',
            '## Update',
            '',
            'Ship the local build.',
            '```',
          ].join('\n'),
          type: 'text-delta',
        };
      })(),
    });

    const store = new CopilotStore('test-model');
    const sessionId = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-1',
    });
    store.createMessage({
      content: 'Append this update to the Launch Plan note.',
      sessionId,
    });
    const models = {
      select: vi.fn(() => ({
        model: {} as never,
        modelId: 'gemma-test',
        provider: 'local',
        runtime: 'local-onnx',
      })),
    } as unknown as AiModelRouter;
    const request = new StreamRequest();
    request.params = { sessionId };
    const response = new StreamResponse();
    const handler = createStreamHandler({
      config: {
        ...streamConfig(),
        toolsEnabled: true,
        workspaceSearchToolEnabled: true,
      },
      models,
      store,
    });

    await handler(
      request as unknown as Request,
      response as unknown as Response
    );

    const assistant = store.requireSession(sessionId).messages.at(-1);
    const proposalObject = assistant?.streamObjects.find(
      object =>
        object.type === 'tool-result' &&
        object.toolName === 'propose_nota_action'
    );
    expect(proposalObject).toMatchObject({
      result: {
        proposal: {
          proposal: {
            docId: 'launch-plan',
            markdown: '## Update\n\nShip the local build.',
            position: 'end',
            type: 'insert_markdown',
          },
          status: 'pending_approval',
        },
        requiresApproval: true,
      },
    });
    expect(workspaceMocks.listWorkspaceDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: 'Launch Plan' })
    );
    expect(assistant?.content).toContain('Sources:');
  });

  test.each([
    {
      documents: [],
      expected: 'could not safely identify one accessible target note',
      label: 'missing',
    },
    {
      documents: [
        {
          docId: 'launch-plan-1',
          source: 'doc',
          sourceRef: 'nota://workspace-1/launch-plan-1',
          title: 'Launch Plan',
          workspaceId: 'workspace-1',
        },
        {
          docId: 'launch-plan-2',
          source: 'doc',
          sourceRef: 'nota://workspace-1/launch-plan-2',
          title: 'Launch Plan',
          workspaceId: 'workspace-1',
        },
      ],
      expected: 'more than one accessible note matches that title',
      label: 'ambiguous',
    },
  ])('refuses a $label named-note target before inference', async testCase => {
    workspaceMocks.listWorkspaceDocuments.mockResolvedValue({
      documents: testCase.documents,
      total: testCase.documents.length,
      workspaceId: 'workspace-1',
    });

    const store = new CopilotStore('test-model');
    const sessionId = store.createSession({
      promptName: 'Chat With Nota AI',
      workspaceId: 'workspace-1',
    });
    store.createMessage({
      content: 'Append this update to the Launch Plan note.',
      sessionId,
    });
    const models = {
      select: vi.fn(() => ({
        model: {} as never,
        modelId: 'gemma-test',
        provider: 'local',
        runtime: 'local-onnx',
      })),
    } as unknown as AiModelRouter;
    const request = new StreamRequest();
    request.params = { sessionId };
    const response = new StreamResponse();
    const handler = createStreamHandler({
      config: {
        ...streamConfig(),
        toolsEnabled: true,
        workspaceSearchToolEnabled: true,
      },
      models,
      store,
    });

    await handler(
      request as unknown as Request,
      response as unknown as Response
    );

    const assistant = store.requireSession(sessionId).messages.at(-1);
    expect(aiMocks.streamText).not.toHaveBeenCalled();
    expect(assistant?.content).toContain(testCase.expected);
    expect(assistant?.streamObjects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'propose_nota_action' }),
      ])
    );
  });
});
