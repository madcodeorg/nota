export type ChatRole = 'user' | 'assistant' | 'system';

export type StreamObject =
  | {
      type: 'text-delta';
      textDelta: string;
    }
  | {
      type: 'reasoning';
      textDelta: string;
    }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
    };

export interface ChatMessage {
  __typename?: 'ChatMessage';
  id: string;
  role: ChatRole;
  content: string;
  params?: Record<string, unknown> | null;
  attachments: string[];
  streamObjects: StreamObject[];
  createdAt: string;
}

export interface CopilotSession {
  __typename?: 'CopilotHistories';
  sessionId: string;
  workspaceId: string;
  docId: string | null;
  parentSessionId: string | null;
  promptName: string;
  model: string;
  optionalModels: string[];
  action: string | null;
  pinned: boolean;
  title: string | null;
  tokens: number;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatSessionInput {
  workspaceId: string;
  docId?: string | null;
  promptName: string;
  pinned?: boolean | null;
  reuseLatestChat?: boolean | null;
}

export interface CreateChatMessageInput {
  sessionId: string;
  content?: string | null;
  params?: Record<string, unknown> | null;
  attachments?: string[] | null;
}

export interface GraphQLRequestBody {
  operationName?: string;
  name?: string;
  query?: string;
  variables?: Record<string, unknown>;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface PaginatedSessions {
  __typename?: 'PaginatedCopilotHistoriesType';
  pageInfo: PageInfo;
  edges: Array<{
    __typename?: 'CopilotHistoriesTypeEdge';
    cursor: string;
    node: CopilotSession;
  }>;
  totalCount: number;
}
