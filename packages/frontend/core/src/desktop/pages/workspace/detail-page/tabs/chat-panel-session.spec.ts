import type { CopilotChatHistoryFragment } from '@nota/graphql';
import { describe, expect, test, vi } from 'vitest';

import {
  buildChatUrl,
  getContextDocIdFromPathname,
  parseChatUrl,
  resolveChatScope,
  resolveInitialSession,
  type SessionService,
} from './chat-panel-session';

describe('universal chat context', () => {
  test('parses optional document context and ignores session ids', () => {
    expect(parseChatUrl('?contextDocId=doc-2&sessionId=session-3')).toEqual({
      contextDocId: 'doc-2',
    });
    expect(parseChatUrl('?contextDocId=   ')).toEqual({
      contextDocId: undefined,
    });
  });

  test('builds a chat URL with the note context only', () => {
    expect(buildChatUrl('/chat', { contextDocId: 'doc-2' })).toBe(
      '/chat?contextDocId=doc-2'
    );
    expect(buildChatUrl('/chat', {})).toBe('/chat');
  });

  test('uses document scope only when a document id exists', () => {
    expect(resolveChatScope('doc-2')).toEqual({
      kind: 'document',
      docId: 'doc-2',
    });
    expect(resolveChatScope('  ')).toEqual({ kind: 'workspace' });
    expect(resolveChatScope()).toEqual({ kind: 'workspace' });
  });

  test('detects document context only on a direct document route', () => {
    expect(getContextDocIdFromPathname('/doc-2')).toBe('doc-2');
    expect(getContextDocIdFromPathname('/all')).toBeUndefined();
    expect(getContextDocIdFromPathname('/chat')).toBeUndefined();
    expect(getContextDocIdFromPathname('/doc%2F2')).toBe('doc/2');
    expect(getContextDocIdFromPathname('/doc-2/blocks')).toBeUndefined();
  });
});

const workspaceId = 'ws-1';
const session = (sessionId: string, pinned = false) =>
  ({ sessionId, pinned }) as CopilotChatHistoryFragment;

describe('resolveInitialSession', () => {
  test('returns undefined without a session service', async () => {
    await expect(
      resolveInitialSession({ sessionService: null, workspaceId })
    ).resolves.toBeUndefined();
  });

  test('prefers the requested session over a pinned one', async () => {
    const requested = session('requested');
    const sessionService: SessionService = {
      getSessions: vi.fn().mockResolvedValue([session('pinned', true)]),
      getSession: vi.fn().mockResolvedValueOnce(requested),
    };

    const result = await resolveInitialSession({
      sessionService,
      workspaceId,
      docId: 'doc-1',
      sessionId: 'requested',
    });

    expect(result).toBe(requested);
    expect(sessionService.getSession).toHaveBeenCalledWith(
      workspaceId,
      'requested'
    );
    expect(sessionService.getSessions).not.toHaveBeenCalled();
  });

  test('uses the pinned chat when nothing was requested', async () => {
    const pinned = session('pinned', true);
    const sessionService: SessionService = {
      getSessions: vi.fn().mockResolvedValueOnce([pinned]),
      getSession: vi.fn(),
    };

    const result = await resolveInitialSession({
      sessionService,
      workspaceId,
      docId: 'doc-1',
    });

    expect(result).toBe(pinned);
    expect(sessionService.getSessions).toHaveBeenCalledWith(
      workspaceId,
      undefined,
      { pinned: true, limit: 1 }
    );
  });

  test('falls back to the note latest chat', async () => {
    const docSession = session('doc-session');
    const sessionService: SessionService = {
      getSessions: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([docSession]),
      getSession: vi.fn().mockResolvedValueOnce(null),
    };

    const result = await resolveInitialSession({
      sessionService,
      workspaceId,
      docId: 'doc-1',
      sessionId: 'deleted',
    });

    expect(result).toBe(docSession);
    expect(sessionService.getSessions).toHaveBeenLastCalledWith(
      workspaceId,
      'doc-1',
      { action: false, fork: false, limit: 1 }
    );
  });

  test('starts fresh without a note or pinned chat', async () => {
    const sessionService: SessionService = {
      getSessions: vi.fn().mockResolvedValueOnce([]),
      getSession: vi.fn(),
    };

    await expect(
      resolveInitialSession({ sessionService, workspaceId })
    ).resolves.toBeNull();
    expect(sessionService.getSessions).toHaveBeenCalledTimes(1);
  });
});
