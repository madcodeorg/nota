import type { Table } from '@nota/infra';
import { map } from 'rxjs';

import type {
  AFFiNEWorkspaceDbSchema,
  DocCommentRecord,
} from '../../db/schema/schema';
import type {
  CommentStore,
  DocComment,
  DocCommentContent,
  DocCommentListResult,
  DocCommentReply,
} from '../types';

/**
 * Local workspaces have no accounts, every comment is written by this user.
 */
export const LOCAL_COMMENT_USER_ID = '__local__';

const localUser = { id: LOCAL_COMMENT_USER_ID, name: '', avatarUrl: null };

export type LocalCommentTable = Pick<
  Table<AFFiNEWorkspaceDbSchema['docComments']>,
  'create' | 'update' | 'get' | 'find' | 'find$' | 'delete'
>;

const byCreatedAt = (a: { createdAt: number }, b: { createdAt: number }) =>
  a.createdAt - b.createdAt;

const toReply = (record: DocCommentRecord): DocCommentReply => ({
  id: record.id,
  commentId: record.commentId ?? '',
  content: record.content,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  user: localUser,
  mentions: [],
});

const toComments = (records: DocCommentRecord[]): DocComment[] => {
  const replies = new Map<string, DocCommentReply[]>();
  const comments: DocCommentRecord[] = [];
  for (const record of records) {
    if (record.commentId) {
      const list = replies.get(record.commentId) ?? [];
      list.push(toReply(record));
      replies.set(record.commentId, list);
    } else {
      comments.push(record);
    }
  }
  return comments.toSorted(byCreatedAt).map(record => ({
    id: record.id,
    content: record.content,
    resolved: !!record.resolved,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    user: localUser,
    mentions: [],
    replies: (replies.get(record.id) ?? []).toSorted(byCreatedAt),
  }));
};

/**
 * Comments stored in the workspace DB, synced with the workspace like any
 * other Yjs doc.
 */
export class LocalDocCommentStore implements CommentStore {
  constructor(
    private readonly table: LocalCommentTable,
    private readonly docId: string,
    private readonly waitForLoaded: () => Promise<unknown> = () =>
      Promise.resolve()
  ) {}

  async listComments(): Promise<DocCommentListResult> {
    await this.waitForLoaded();
    return {
      comments: toComments(this.table.find({ docId: this.docId })),
      hasNextPage: false,
      startCursor: '',
      endCursor: '',
    };
  }

  async listCommentChanges({ after }: { after?: string }) {
    return {
      changes: [],
      startCursor: after ?? '',
      endCursor: after ?? '',
      hasNextPage: false,
    };
  }

  watchComments() {
    return this.table.find$({ docId: this.docId }).pipe(map(toComments));
  }

  async createComment({
    content,
  }: {
    content: DocCommentContent;
  }): Promise<DocComment> {
    const now = Date.now();
    const record = this.table.create({
      docId: this.docId,
      content,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
    return toComments([record])[0];
  }

  async updateComment(
    commentId: string,
    { content }: { content: DocCommentContent }
  ): Promise<void> {
    this.updateContent(commentId, content);
  }

  async resolveComment(commentId: string, resolved = true): Promise<boolean> {
    return !!this.table.update(commentId, { resolved });
  }

  async deleteComment(commentId: string): Promise<boolean> {
    for (const reply of this.table.find({ commentId })) {
      this.table.delete(reply.id);
    }
    this.table.delete(commentId);
    return true;
  }

  async createReply(
    commentId: string,
    { content }: { content: DocCommentContent }
  ): Promise<DocCommentReply> {
    if (!this.table.get(commentId)) {
      throw new Error('Comment not found');
    }
    const now = Date.now();
    return toReply(
      this.table.create({
        docId: this.docId,
        commentId,
        content,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  async updateReply(
    replyId: string,
    { content }: { content: DocCommentContent }
  ): Promise<void> {
    this.updateContent(replyId, content);
  }

  // edits only send the new text, keep the quoted preview and doc mode
  private updateContent(id: string, content: DocCommentContent) {
    const previous = this.table.get(id)?.content;
    this.table.update(id, {
      content: { ...previous, ...content },
      updatedAt: Date.now(),
    });
  }

  async deleteReply(replyId: string): Promise<void> {
    this.table.delete(replyId);
  }
}
