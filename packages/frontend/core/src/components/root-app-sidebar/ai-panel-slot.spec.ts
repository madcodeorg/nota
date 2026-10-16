import { afterEach, describe, expect, test } from 'vitest';

import { linkSidebarChat, sidebarChat$ } from './ai-panel-slot';

describe('linkSidebarChat', () => {
  afterEach(() => {
    sidebarChat$.next(null);
  });

  test('keeps the current chat when the same note asks again', () => {
    linkSidebarChat({ docId: 'doc-1' });
    const first = sidebarChat$.value;
    linkSidebarChat({ docId: 'doc-1' });
    expect(sidebarChat$.value).toBe(first);
  });

  test('relinks to another note or a requested session', () => {
    linkSidebarChat({ docId: 'doc-1' });
    linkSidebarChat({ docId: 'doc-2' });
    expect(sidebarChat$.value).toEqual({ docId: 'doc-2' });
    linkSidebarChat({ docId: 'doc-2', sessionId: 'session-1' });
    expect(sidebarChat$.value).toEqual({
      docId: 'doc-2',
      sessionId: 'session-1',
    });
  });
});
