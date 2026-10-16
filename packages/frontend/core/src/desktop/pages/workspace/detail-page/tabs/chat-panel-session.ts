import type { CopilotChatHistoryFragment } from '@nota/graphql';

type SessionListOptions = {
  pinned?: boolean;
  action?: boolean;
  fork?: boolean;
  limit?: number;
};

export interface ChatUrlState {
  contextDocId?: string;
}

export type ChatScope =
  | { kind: 'document'; docId: string }
  | { kind: 'workspace' };

const RESERVED_WORKSPACE_PATHS = new Set([
  'all',
  'chat',
  'journals',
  'meetings',
  'trash',
]);

const readQueryValue = (params: URLSearchParams, key: string) => {
  const value = params.get(key)?.trim();
  return value || undefined;
};

/** Reads the optional document context from a chat URL. */
export const parseChatUrl = (search = ''): ChatUrlState => {
  const params = new URLSearchParams(search);
  return {
    contextDocId: readQueryValue(params, 'contextDocId'),
  };
};

/** Builds a chat URL that keeps the note context. */
export const buildChatUrl = (pathname = '/chat', state: ChatUrlState = {}) => {
  const params = new URLSearchParams();
  if (state.contextDocId) {
    params.set('contextDocId', state.contextDocId);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/** A document context scopes chat history; without one chat is workspace-wide. */
export const resolveChatScope = (docId?: string | null): ChatScope => {
  const normalizedDocId = docId?.trim();
  return normalizedDocId
    ? { kind: 'document', docId: normalizedDocId }
    : { kind: 'workspace' };
};

/** Returns the active document id for a simple `/:docId` workspace route. */
export const getContextDocIdFromPathname = (
  pathname: string
): string | undefined => {
  const match = pathname.match(/^\/([^/]+)$/);
  if (!match || RESERVED_WORKSPACE_PATHS.has(match[1])) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export interface SessionService {
  getSessions: (
    workspaceId: string,
    docId?: string,
    options?: SessionListOptions
  ) => Promise<CopilotChatHistoryFragment[] | null | undefined>;
  getSession: (
    workspaceId: string,
    sessionId: string
  ) => Promise<CopilotChatHistoryFragment | null | undefined>;
}

/**
 * The conversation a chat opens with, shared by the sidebar and the full
 * page: a requested session, else the workspace's pinned chat, else the
 * note's latest chat. Without a note and nothing pinned, chat starts fresh.
 */
export const resolveInitialSession = async ({
  sessionService,
  workspaceId,
  docId,
  sessionId,
}: {
  sessionService?: SessionService | null;
  workspaceId: string;
  docId?: string;
  sessionId?: string;
}): Promise<CopilotChatHistoryFragment | null | undefined> => {
  if (!sessionService) {
    return undefined;
  }

  if (sessionId) {
    const session = await sessionService.getSession(workspaceId, sessionId);
    if (session) return session;
  }

  const pinSessions = await sessionService.getSessions(workspaceId, undefined, {
    pinned: true,
    limit: 1,
  });
  if (Array.isArray(pinSessions) && pinSessions[0]) {
    return pinSessions[0];
  }

  if (!docId) return null;
  const docSessions = await sessionService.getSessions(workspaceId, docId, {
    action: false,
    fork: false,
    limit: 1,
  });
  return docSessions?.[0] ?? null;
};
