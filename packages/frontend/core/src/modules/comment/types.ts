import type { DocMode } from '@blocksuite/affine/model';
import type {
  BaseSelection,
  DocSnapshot,
  Store,
} from '@blocksuite/affine/store';
import type { CommentChangeAction, PublicUserType } from '@nota/graphql';
import type { Observable } from 'rxjs';

export type CommentId = string;

export type CommentAttachment = {
  id: string;
  url?: string; // attachment may not be uploaded yet
  filename?: string;
  mimeType?: string;
  size?: number; // in bytes
};

export interface BaseComment {
  id: CommentId;
  content?: DocCommentContent;
  createdAt: number;
  updatedAt: number;
  user: PublicUserType;
}

export interface DocComment extends BaseComment {
  resolved: boolean;
  mentions: string[];
  replies?: DocCommentReply[];
}

export type PendingComment = {
  id: CommentId;
  doc: Store;
  preview?: string;
  selections?: BaseSelection[];
  commentId?: CommentId; // only for replies, points to the parent comment
  attachments: CommentAttachment[];
};

export interface DocCommentReply extends BaseComment {
  commentId: CommentId;
  mentions: string[];
}

export type DocCommentContent = {
  snapshot: DocSnapshot; // blocksuite snapshot
  attachments?: CommentAttachment[];
  mode?: DocMode;
  preview?: string; // text preview of the target
};

export interface DocCommentListResult {
  comments: DocComment[];
  hasNextPage: boolean;
  startCursor: string;
  endCursor: string;
}

export interface DocCommentChange {
  action: CommentChangeAction;
  comment: DocComment;
  id: CommentId; // the id of the comment or reply
  commentId?: CommentId; // a change with comment id is a reply
}

export type DocCommentChangeListResult = {
  changes: DocCommentChange[];
  startCursor: string;
  endCursor: string;
  hasNextPage: boolean;
};

/**
 * Storage backend of a doc's comments. Server-backed workspaces use GraphQL,
 * local and Google Drive workspaces use the workspace DB.
 */
export interface CommentStore {
  listComments(options: { after?: string }): Promise<DocCommentListResult>;
  listCommentChanges(options: {
    after?: string;
  }): Promise<DocCommentChangeListResult>;
  /**
   * Live comments, when the backend can push changes instead of being polled.
   */
  watchComments?(): Observable<DocComment[]>;
  createComment(input: {
    content: DocCommentContent;
    mentions?: string[];
  }): Promise<DocComment>;
  updateComment(
    commentId: string,
    input: { content: DocCommentContent }
  ): Promise<void>;
  resolveComment(commentId: string, resolved?: boolean): Promise<boolean>;
  deleteComment(commentId: string): Promise<boolean>;
  createReply(
    commentId: string,
    input: { content: DocCommentContent; mentions?: string[] }
  ): Promise<DocCommentReply>;
  updateReply(
    replyId: string,
    input: { content: DocCommentContent }
  ): Promise<void>;
  deleteReply(replyId: string): Promise<void>;
  uploadCommentAttachment?(file: File): Promise<string>;
}
