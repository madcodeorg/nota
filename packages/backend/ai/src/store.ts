import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ChatMessage,
  CopilotSession,
  CreateChatMessageInput,
  CreateChatSessionInput,
  PaginatedSessions,
} from './types';

interface PersistedCopilotStore {
  contexts?: Array<{ id: string; key: string; workspaceId: string }>;
  sessions?: unknown[];
  version?: number;
}

function readPersistedMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<ChatMessage>;
  if (
    typeof message.id !== 'string' ||
    (message.role !== 'user' &&
      message.role !== 'assistant' &&
      message.role !== 'system') ||
    typeof message.content !== 'string' ||
    typeof message.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    __typename: 'ChatMessage',
    attachments: Array.isArray(message.attachments)
      ? message.attachments.filter(
          (attachment): attachment is string => typeof attachment === 'string'
        )
      : [],
    content: message.content,
    createdAt: message.createdAt,
    id: message.id,
    params:
      message.params && typeof message.params === 'object'
        ? message.params
        : null,
    role: message.role,
    streamObjects: Array.isArray(message.streamObjects)
      ? message.streamObjects
      : [],
  };
}

function readPersistedSession(value: unknown): CopilotSession | null {
  if (!value || typeof value !== 'object') return null;
  const session = value as Partial<CopilotSession>;
  if (
    typeof session.sessionId !== 'string' ||
    typeof session.workspaceId !== 'string' ||
    typeof session.promptName !== 'string' ||
    typeof session.model !== 'string' ||
    typeof session.createdAt !== 'string' ||
    typeof session.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    __typename: 'CopilotHistories',
    action: typeof session.action === 'string' ? session.action : null,
    createdAt: session.createdAt,
    docId: typeof session.docId === 'string' ? session.docId : null,
    messages: Array.isArray(session.messages)
      ? session.messages
          .map(readPersistedMessage)
          .filter((message): message is ChatMessage => !!message)
      : [],
    model: session.model,
    optionalModels: Array.isArray(session.optionalModels)
      ? session.optionalModels.filter(
          (model): model is string => typeof model === 'string'
        )
      : [],
    parentSessionId:
      typeof session.parentSessionId === 'string'
        ? session.parentSessionId
        : null,
    pinned: session.pinned === true,
    promptName: session.promptName,
    sessionId: session.sessionId,
    title: typeof session.title === 'string' ? session.title : null,
    tokens: Number.isFinite(session.tokens) ? Number(session.tokens) : 0,
    updatedAt: session.updatedAt,
    workspaceId: session.workspaceId,
  };
}

export class CopilotStore {
  private readonly sessions = new Map<string, CopilotSession>();
  private readonly contexts = new Map<
    string,
    { id: string; workspaceId: string }
  >();

  constructor(
    private defaultModel: string,
    private optionalModelIds: string[] = [],
    private readonly persistencePath?: string
  ) {
    this.load();
  }

  setDefaultModel(defaultModel: string, optionalModelIds?: string[]) {
    this.defaultModel = defaultModel;
    if (optionalModelIds) {
      this.optionalModelIds = optionalModelIds;
    }
  }

  createSession(input: CreateChatSessionInput) {
    if (input.reuseLatestChat) {
      const existing = this.findLatestSession(input.workspaceId, input.docId);
      if (existing) return existing.sessionId;
    }

    const now = new Date().toISOString();
    const session: CopilotSession = {
      __typename: 'CopilotHistories',
      sessionId: randomUUID(),
      workspaceId: input.workspaceId,
      docId: input.docId ?? null,
      parentSessionId: null,
      promptName: input.promptName,
      model: this.defaultModel,
      optionalModels: this.listModelIds(),
      action: null,
      pinned: input.pinned ?? false,
      title: null,
      tokens: 0,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.sessionId, session);
    this.persist();
    return session.sessionId;
  }

  createSessionWithHistory(input: CreateChatSessionInput) {
    return this.getSession(this.createSession(input));
  }

  updateSession(input: {
    sessionId: string;
    pinned?: boolean | null;
    title?: string | null;
  }) {
    const session = this.requireSession(input.sessionId);
    if (typeof input.pinned === 'boolean') {
      session.pinned = input.pinned;
    }
    if (input.title !== undefined) {
      session.title = input.title;
    }
    session.updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  forkSession(input: { sessionId: string }) {
    const source = this.requireSession(input.sessionId);
    const now = new Date().toISOString();
    const forked: CopilotSession = {
      ...source,
      sessionId: randomUUID(),
      parentSessionId: source.sessionId,
      messages: source.messages.map(message => ({ ...message })),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(forked.sessionId, forked);
    this.persist();
    return forked.sessionId;
  }

  createMessage(input: CreateChatMessageInput) {
    const session = this.requireSession(input.sessionId);
    const now = new Date().toISOString();
    const content = input.content ?? '';
    const message: ChatMessage = {
      __typename: 'ChatMessage',
      id: randomUUID(),
      role: 'user',
      content,
      params: input.params ?? null,
      attachments: input.attachments ?? [],
      streamObjects: [],
      createdAt: now,
    };
    session.messages.push(message);
    session.title ||= content.trim().slice(0, 80) || 'New chat';
    session.updatedAt = now;
    this.persist();
    return message.id;
  }

  appendAssistantMessage(
    sessionId: string,
    content: string,
    streamObjects: ChatMessage['streamObjects'] = [],
    attachments: string[] = []
  ) {
    const session = this.requireSession(sessionId);
    const message: ChatMessage = {
      __typename: 'ChatMessage',
      id: randomUUID(),
      role: 'assistant',
      content,
      attachments,
      streamObjects,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(message);
    session.updatedAt = message.createdAt;
    this.persist();
    return message;
  }

  removeLastAssistantMessage(sessionId: string) {
    const session = this.requireSession(sessionId);
    const lastMessage = session.messages.at(-1);
    if (lastMessage?.role !== 'assistant') {
      return false;
    }

    session.messages.pop();
    session.updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionInWorkspace(workspaceId: string, sessionId: string) {
    const session = this.getSession(sessionId);
    return session?.workspaceId === workspaceId ? session : null;
  }

  requireSession(sessionId: string) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`AI chat session not found: ${sessionId}`);
    }
    return session;
  }

  requireSessionInWorkspace(workspaceId: string, sessionId: string) {
    const session = this.getSessionInWorkspace(workspaceId, sessionId);
    if (!session) {
      throw new Error(
        `AI chat session ${sessionId} was not found in workspace ${workspaceId}.`
      );
    }
    return session;
  }

  listSessions(workspaceId: string, docId?: string | null, sessionId?: string) {
    const sessions = [...this.sessions.values()]
      .filter(session => session.workspaceId === workspaceId)
      .filter(session => (docId ? session.docId === docId : true))
      .filter(session => (sessionId ? session.sessionId === sessionId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return this.paginate(sessions);
  }

  cleanupSessions(input: { sessionIds: string[] }) {
    let changed = false;
    for (const sessionId of input.sessionIds) {
      changed = this.sessions.delete(sessionId) || changed;
      for (const key of this.contexts.keys()) {
        if (key.endsWith(`:${sessionId}`)) {
          this.contexts.delete(key);
          changed = true;
        }
      }
    }
    if (changed) this.persist();
    return true;
  }

  createContext(workspaceId: string, sessionId: string) {
    this.requireSessionInWorkspace(workspaceId, sessionId);
    const id = randomUUID();
    this.contexts.set(`${workspaceId}:${sessionId}`, { id, workspaceId });
    this.persist();
    return id;
  }

  listContexts(workspaceId: string, sessionId: string) {
    const context = this.contexts.get(`${workspaceId}:${sessionId}`);
    return context ? [context] : [];
  }

  listModelIds() {
    return [this.defaultModel, ...this.optionalModelIds].filter(
      (value, index, all) => value && all.indexOf(value) === index
    );
  }

  private load() {
    if (!this.persistencePath) return;
    try {
      const parsed = JSON.parse(
        readFileSync(this.persistencePath, 'utf8')
      ) as PersistedCopilotStore;
      if (parsed.version !== 1) return;
      for (const value of parsed.sessions ?? []) {
        const session = readPersistedSession(value);
        if (session) this.sessions.set(session.sessionId, session);
      }
      for (const context of parsed.contexts ?? []) {
        if (
          typeof context?.key === 'string' &&
          typeof context.id === 'string' &&
          typeof context.workspaceId === 'string'
        ) {
          this.contexts.set(context.key, {
            id: context.id,
            workspaceId: context.workspaceId,
          });
        }
      }
    } catch {
      // A missing or corrupt local cache starts empty without blocking AI.
    }
  }

  private persist() {
    if (!this.persistencePath) return;
    try {
      mkdirSync(path.dirname(this.persistencePath), { recursive: true });
      const temporaryPath = `${this.persistencePath}.${process.pid}.tmp`;
      writeFileSync(
        temporaryPath,
        JSON.stringify(
          {
            contexts: [...this.contexts].map(([key, context]) => ({
              ...context,
              key,
            })),
            sessions: [...this.sessions.values()],
            version: 1,
          } satisfies PersistedCopilotStore,
          null,
          2
        ),
        { mode: 0o600 }
      );
      renameSync(temporaryPath, this.persistencePath);
    } catch (error) {
      console.error(
        '[copilot-store] failed to persist local chat history',
        error
      );
    }
  }

  private findLatestSession(workspaceId: string, docId?: string | null) {
    return this.listSessions(workspaceId, docId).edges[0]?.node ?? null;
  }

  private paginate(sessions: CopilotSession[]): PaginatedSessions {
    return {
      __typename: 'PaginatedCopilotHistoriesType',
      totalCount: sessions.length,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: sessions[0]?.sessionId ?? null,
        endCursor: sessions.at(-1)?.sessionId ?? null,
      },
      edges: sessions.map(session => ({
        __typename: 'CopilotHistoriesTypeEdge',
        cursor: session.sessionId,
        node: session,
      })),
    };
  }
}
