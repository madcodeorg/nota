import type { Request, Response } from 'express';

import type { AiBackendConfig } from './config';
import { getLocalModelHealth } from './meetings';
import type { AiModelRouter } from './providers';
import type { CopilotStore } from './store';
import type { GraphQLRequestBody } from './types';

type GraphQLContext = {
  config: AiBackendConfig;
  models: AiModelRouter;
  store: CopilotStore;
};

function operationName(body: GraphQLRequestBody) {
  if (body.operationName || body.name) {
    return body.operationName ?? body.name ?? '';
  }

  if (typeof body.query !== 'string') {
    return '';
  }

  return (
    body.query.match(/\b(?:query|mutation)\s+([_A-Za-z][_0-9A-Za-z]*)/)?.[1] ??
    ''
  );
}

function ok(res: Response, data: Record<string, unknown>) {
  res.json({ data });
}

function now() {
  return new Date().toISOString();
}

function currentUser(store: CopilotStore, models: AiModelRouter) {
  return {
    id: 'local-user',
    name: 'Local User',
    email: 'local@nota.local',
    emailVerified: true,
    avatarUrl: null,
    token: { sessionToken: 'local-session' },
    features: [],
    copilot: {
      quota: {
        limit: null,
        used: 0,
        actions: 0,
      },
      models: () => models.models(),
      chats: store.listSessions('local'),
    },
  };
}

function parseMultipartBody(req: Request): GraphQLRequestBody {
  const body = req.body as Record<string, unknown>;
  if (typeof body.operations === 'string') {
    return JSON.parse(body.operations) as GraphQLRequestBody;
  }
  return body as GraphQLRequestBody;
}

function uploadedAttachmentDataUrls(req: Request) {
  const files = Array.isArray(req.files)
    ? (req.files as Express.Multer.File[])
    : [];
  return files.map(file => {
    const mediaType = file.mimetype || 'application/octet-stream';
    return `data:${mediaType};base64,${file.buffer.toString('base64')}`;
  });
}

function localServerConfig(config: AiBackendConfig) {
  return {
    version: '0.26.3-local-ai',
    baseUrl: `http://localhost:${config.port}`,
    name: 'Nota Local AI',
    features: ['Copilot', 'CopilotEmbedding', 'LocalWorkspace'],
    type: 'Selfhosted',
    initialized: true,
    calendarProviders: [],
    calendarCalDAVProviders: [],
    credentialsRequirement: {
      password: { minLength: 8, maxLength: 32 },
    },
  };
}

export function createGraphQLHandler(context: GraphQLContext) {
  return async (req: Request, res: Response) => {
    const body = parseMultipartBody(req);
    const variables = body.variables ?? {};
    const op = operationName(body);

    try {
      switch (op) {
        case 'serverConfig':
        case 'calendarProviders': {
          ok(res, {
            serverConfig: localServerConfig(context.config),
          });
          return;
        }
        case 'getCurrentUser':
        case 'getCurrentUserProfile':
        case 'getUserFeatures': {
          ok(res, { currentUser: currentUser(context.store, context.models) });
          return;
        }
        case 'copilotQuota': {
          ok(res, {
            currentUser: {
              copilot: {
                quota: { limit: null, used: 0, actions: 0 },
              },
            },
          });
          return;
        }
        case 'getPromptModels': {
          const localModelHealth = await getLocalModelHealth(context.config);
          ok(res, {
            currentUser: {
              copilot: {
                models: await context.models.modelsWithDiscovery(
                  localModelHealth.models
                ),
              },
            },
          });
          return;
        }
        case 'createCopilotSession': {
          ok(res, {
            createCopilotSession: context.store.createSession(
              variables.options as never
            ),
          });
          return;
        }
        case 'createCopilotSessionWithHistory': {
          ok(res, {
            createCopilotSessionWithHistory:
              context.store.createSessionWithHistory(
                variables.options as never
              ),
          });
          return;
        }
        case 'updateCopilotSession': {
          ok(res, {
            updateCopilotSession: context.store.updateSession(
              variables.options as never
            ),
          });
          return;
        }
        case 'forkCopilotSession': {
          ok(res, {
            forkCopilotSession: context.store.forkSession(
              variables.options as never
            ),
          });
          return;
        }
        case 'createCopilotMessage': {
          const options = variables.options as
            | {
                attachments?: string[] | null;
              }
            | undefined;
          const uploadedAttachments = uploadedAttachmentDataUrls(req);
          const input =
            uploadedAttachments.length && options
              ? {
                  ...options,
                  attachments: [
                    ...(options.attachments ?? []),
                    ...uploadedAttachments,
                  ],
                }
              : variables.options;
          ok(res, {
            createCopilotMessage: context.store.createMessage(input as never),
          });
          return;
        }
        case 'cleanupCopilotSession': {
          ok(res, {
            cleanupCopilotSession: context.store.cleanupSessions(
              variables.input as never
            ),
          });
          return;
        }
        case 'getCopilotSessions':
        case 'getCopilotHistories':
        case 'getCopilotHistoryIds':
        case 'getCopilotRecentSessions':
        case 'getCopilotPinnedSessions':
        case 'getCopilotDocSessions':
        case 'getCopilotWorkspaceSessions':
        case 'getCopilotLatestDocSession':
        case 'getCopilotSession': {
          const workspaceId =
            typeof variables.workspaceId === 'string'
              ? variables.workspaceId
              : 'local';
          const docId =
            typeof variables.docId === 'string' ? variables.docId : null;
          const options = variables.options as
            | { sessionId?: string | null }
            | undefined;
          const sessionId =
            typeof variables.sessionId === 'string'
              ? variables.sessionId
              : (options?.sessionId ?? undefined);
          ok(res, {
            currentUser: {
              copilot: {
                chats: context.store.listSessions(
                  workspaceId,
                  docId,
                  sessionId
                ),
              },
            },
          });
          return;
        }
        case 'createCopilotContext': {
          ok(res, {
            createCopilotContext: context.store.createContext(
              variables.workspaceId as string,
              variables.sessionId as string
            ),
          });
          return;
        }
        case 'listContext':
        case 'listContextObject': {
          ok(res, {
            currentUser: {
              copilot: {
                contexts: context.store.listContexts(
                  variables.workspaceId as string,
                  variables.sessionId as string
                ),
              },
            },
          });
          return;
        }
        case 'matchContext':
        case 'matchContextDocs':
        case 'matchContextFiles': {
          ok(res, {
            currentUser: {
              copilot: {
                contexts: [
                  {
                    matchFiles: [],
                    matchWorkspaceDocs: [],
                  },
                ],
              },
            },
          });
          return;
        }
        case 'addContextBlob':
        case 'addContextDoc': {
          ok(res, {
            [op]: {
              id: `local-context-${Date.now()}`,
              createdAt: now(),
              status: 'finished',
            },
          });
          return;
        }
        case 'addContextFile': {
          ok(res, {
            addContextFile: {
              id: `local-file-${Date.now()}`,
              createdAt: now(),
              name: 'Local context file',
              mimeType: 'application/octet-stream',
              chunkSize: 0,
              error: null,
              status: 'finished',
              blobId: null,
            },
          });
          return;
        }
        case 'addContextCategory': {
          ok(res, {
            addContextCategory: {
              id: `local-category-${Date.now()}`,
              createdAt: now(),
              type: 'local',
              docs: [],
            },
          });
          return;
        }
        case 'removeContextBlob':
        case 'removeContextCategory':
        case 'removeContextDoc':
        case 'removeContextFile':
        case 'applyDocUpdates': {
          ok(res, { [op]: true });
          return;
        }
        case 'getWorkspaceEmbeddingStatus': {
          ok(res, {
            queryWorkspaceEmbeddingStatus: {
              total: 0,
              embedded: 0,
            },
          });
          return;
        }
        default: {
          ok(res, {});
        }
      }
    } catch (error) {
      res.status(400).json({
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  };
}
