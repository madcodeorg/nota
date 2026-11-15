import { createORMClient, YjsDBAdapter } from '@nota/infra';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { AFFiNE_WORKSPACE_DB_SCHEMA } from '../../db/schema';
import {
  LOCAL_COMMENT_USER_ID,
  LocalDocCommentStore,
} from '../entities/local-doc-comment-store';
import type { DocCommentContent } from '../types';

const schema = { docComments: AFFiNE_WORKSPACE_DB_SCHEMA.docComments };
const Client = createORMClient(schema);

const content = (text: string): DocCommentContent => ({
  snapshot: { type: 'page', meta: {}, blocks: { text } } as any,
  preview: text,
  mode: 'page',
});

let client: InstanceType<typeof Client>;
let store: LocalDocCommentStore;

beforeEach(() => {
  client = new Client(
    new YjsDBAdapter(schema, { getDoc: guid => new YDoc({ guid }) })
  );
  store = new LocalDocCommentStore(client.docComments, 'doc-a');
});

describe('LocalDocCommentStore', () => {
  test('creates a comment authored by the local user', async () => {
    const comment = await store.createComment({ content: content('hello') });

    expect(comment).toMatchObject({
      content: content('hello'),
      resolved: false,
      replies: [],
      mentions: [],
      user: { id: LOCAL_COMMENT_USER_ID },
    });

    const { comments, hasNextPage } = await store.listComments();
    expect(hasNextPage).toBe(false);
    expect(comments.map(c => c.id)).toEqual([comment.id]);
  });

  test('lists only the comments of its doc, oldest first', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const first = await store.createComment({ content: content('1') });
      vi.setSystemTime(2000);
      const second = await store.createComment({ content: content('2') });
      await new LocalDocCommentStore(client.docComments, 'doc-b').createComment(
        { content: content('other doc') }
      );

      const { comments } = await store.listComments();
      expect(comments.map(c => c.id)).toEqual([first.id, second.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('adds, edits and deletes replies', async () => {
    const comment = await store.createComment({ content: content('c') });
    const reply = await store.createReply(comment.id, {
      content: content('r'),
    });
    expect(reply.commentId).toBe(comment.id);

    await store.updateReply(reply.id, { content: content('edited') });
    let [listed] = (await store.listComments()).comments;
    expect(listed.replies?.map(r => r.content)).toEqual([content('edited')]);

    await store.deleteReply(reply.id);
    [listed] = (await store.listComments()).comments;
    expect(listed.replies).toEqual([]);
  });

  test('rejects a reply to a missing comment', async () => {
    await expect(
      store.createReply('missing', { content: content('r') })
    ).rejects.toThrow();
  });

  test('edits a comment and keeps its preview', async () => {
    const comment = await store.createComment({ content: content('c') });
    const { snapshot } = content('edited');
    await store.updateComment(comment.id, { content: { snapshot } });

    const [listed] = (await store.listComments()).comments;
    expect(listed.content).toEqual({ ...content('c'), snapshot });
    expect(listed.updatedAt).toBeGreaterThanOrEqual(comment.updatedAt);
  });

  test('resolves and unresolves a comment', async () => {
    const comment = await store.createComment({ content: content('c') });

    expect(await store.resolveComment(comment.id)).toBe(true);
    expect((await store.listComments()).comments[0].resolved).toBe(true);

    await store.resolveComment(comment.id, false);
    expect((await store.listComments()).comments[0].resolved).toBe(false);
  });

  test('deleting a comment deletes its replies', async () => {
    const comment = await store.createComment({ content: content('c') });
    const reply = await store.createReply(comment.id, {
      content: content('r'),
    });

    await store.deleteComment(comment.id);

    expect((await store.listComments()).comments).toEqual([]);
    expect(client.docComments.get(reply.id)).toBeNull();
  });

  test('watches comments of its doc', async () => {
    const seen: number[] = [];
    const subscription = store
      .watchComments()
      .subscribe(comments => seen.push(comments.length));

    await store.createComment({ content: content('c') });
    subscription.unsubscribe();

    expect(seen.at(-1)).toBe(1);
  });

  test('waits for the table to load before listing', async () => {
    let loaded!: () => void;
    const waiting = new LocalDocCommentStore(
      client.docComments,
      'doc-a',
      () => new Promise<void>(resolve => (loaded = resolve))
    );
    let done = false;
    const listing = waiting.listComments().then(() => (done = true));

    await Promise.resolve();
    expect(done).toBe(false);
    loaded();
    await listing;
    expect(done).toBe(true);
  });
});
