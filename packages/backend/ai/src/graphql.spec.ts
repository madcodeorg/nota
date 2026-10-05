import type { Request, Response } from 'express';
import { describe, expect, test, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import { createGraphQLHandler } from './graphql';
import type { AiModelRouter } from './providers';
import { CopilotStore } from './store';

describe('saved chat retrieval', () => {
  test.each(['variable', 'options'])(
    'returns the requested session using the %s session ID rather than the latest chat',
    async location => {
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      store.appendAssistantMessage(sessionId, 'Your saved note proposal.', []);
      store.requireSession(sessionId).updatedAt = new Date(0).toISOString();
      store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      const json = vi.fn();
      const handler = createGraphQLHandler({
        config: {} as AiBackendConfig,
        models: {} as AiModelRouter,
        store,
      });
      const variables = {
        workspaceId: 'workspace-1',
        ...(location === 'variable'
          ? { sessionId }
          : { options: { sessionId } }),
      };
      await handler(
        { body: { operationName: 'getCopilotSession', variables } } as Request,
        { json } as unknown as Response
      );

      expect(json).toHaveBeenCalledWith({
        data: {
          currentUser: {
            copilot: {
              chats: expect.objectContaining({
                totalCount: 1,
                edges: [
                  expect.objectContaining({
                    node: expect.objectContaining({
                      sessionId,
                      messages: [
                        expect.objectContaining({
                          content: 'Your saved note proposal.',
                        }),
                      ],
                    }),
                  }),
                ],
              }),
            },
          },
        },
      });
    }
  );

  test.each(['missing-session', 'other-workspace'])(
    'does not substitute a different chat for a %s request',
    async target => {
      const store = new CopilotStore('test-model');
      const sessionId = store.createSession({
        promptName: 'Chat With Nota AI',
        workspaceId: 'workspace-1',
      });
      const json = vi.fn();
      await createGraphQLHandler({
        config: {} as AiBackendConfig,
        models: {} as AiModelRouter,
        store,
      })(
        {
          body: {
            operationName: 'getCopilotSession',
            variables: {
              workspaceId:
                target === 'other-workspace' ? 'workspace-2' : 'workspace-1',
              sessionId:
                target === 'missing-session' ? 'missing-session' : sessionId,
            },
          },
        } as Request,
        { json } as unknown as Response
      );
      expect(json).toHaveBeenCalledWith({
        data: {
          currentUser: {
            copilot: {
              chats: expect.objectContaining({ totalCount: 0, edges: [] }),
            },
          },
        },
      });
    }
  );
});
