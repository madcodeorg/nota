import {
  docLinkBaseURLMiddleware,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/affine/shared/adapters';
import type { Store, Workspace } from '@blocksuite/affine/store';

type WorkspaceContentSource = 'attachment' | 'doc' | 'transcript' | 'web';
type WorkspaceContentVisibility = 'private' | 'workspace';

export type WorkspaceContentDocument = {
  accessVerified: true;
  allowedUserIds?: string[];
  docId: string;
  markdown: string;
  source?: WorkspaceContentSource;
  title: string;
  updatedAt?: string;
  visibility?: WorkspaceContentVisibility;
};

type WorkspaceContentAccess = {
  allowedUserIds?: string[];
  readable: boolean;
  visibility?: WorkspaceContentVisibility;
};

export type WorkspaceContentSyncOptions = {
  accessForDocument: (input: {
    docId: string;
    meta: Record<string, unknown>;
    title: string;
  }) => Promise<WorkspaceContentAccess | boolean | null | undefined>;
  documentIds?: string[];
  workspace: Workspace;
  workspaceId: string;
};

export type WorkspaceContentAccessForDocument =
  WorkspaceContentSyncOptions['accessForDocument'];

type WorkspaceContentReplacement = {
  complete: boolean;
  page: number;
  syncId: string;
};

const WORKSPACE_CONTENT_SYNC_PAGE_SIZE = 20;
const workspaceContentSyncQueues = new Map<string, Promise<void>>();

function isoDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

function sourceForDocument(
  title: string,
  markdown: string
): WorkspaceContentSource {
  const value = `${title}\n${markdown}`.toLowerCase();
  return value.includes('meeting') || value.includes('transcript')
    ? 'transcript'
    : 'doc';
}

async function exportDocMarkdown(doc: Store) {
  doc.load();
  if (!doc.root) {
    return '';
  }

  const transformer = doc.getTransformer([
    docLinkBaseURLMiddleware(doc.workspace.id),
    // Linked documents are indexed separately under their own access decision.
    // Expanding synced content here would inherit the parent document's access.
    titleMiddleware(
      doc.workspace.meta.docMetas.filter(meta => meta.id === doc.id)
    ),
  ]);
  const snapshot = transformer.docToSnapshot(doc);
  if (!snapshot) {
    return '';
  }

  const adapter = new MarkdownAdapter(transformer, doc.provider);
  const result = await adapter.fromDocSnapshot({
    assets: transformer.assetsManager,
    snapshot,
  });
  return result.file.trim();
}

export async function resolveWorkspaceContentAccess(
  accessForDocument: WorkspaceContentSyncOptions['accessForDocument'],
  input: {
    docId: string;
    meta: Record<string, unknown>;
    title: string;
  }
) {
  try {
    const access = await accessForDocument(input);
    if (access === true) {
      return { readable: true } satisfies WorkspaceContentAccess;
    }
    if (!access || access.readable !== true) {
      return null;
    }
    return access;
  } catch {
    return null;
  }
}

export async function buildWorkspaceDocuments(
  options: WorkspaceContentSyncOptions
) {
  options.workspace.meta.initialize();
  const docIds = options.documentIds ? new Set(options.documentIds) : null;
  const metas = options.workspace.meta.docMetas
    .filter(meta => {
      const record = meta as unknown as Record<string, unknown>;
      return (
        typeof meta.id === 'string' &&
        (!docIds || docIds.has(meta.id)) &&
        record.trash !== true &&
        record.isTemplate !== true
      );
    })
    .sort((left, right) => {
      const leftUpdated = Number(left.updatedDate ?? left.createDate ?? 0);
      const rightUpdated = Number(right.updatedDate ?? right.createDate ?? 0);
      return rightUpdated - leftUpdated;
    });

  const documents: WorkspaceContentDocument[] = [];
  for (const meta of metas) {
    const record = meta as unknown as Record<string, unknown>;
    const title = meta.title?.trim() || 'Untitled';
    const access = await resolveWorkspaceContentAccess(
      options.accessForDocument,
      {
        docId: meta.id,
        meta: record,
        title,
      }
    );
    if (!access) {
      continue;
    }

    const doc = options.workspace.getDoc(meta.id)?.getStore();
    if (!doc) {
      continue;
    }

    let markdown = '';
    try {
      markdown = await exportDocMarkdown(doc);
    } catch {
      // A document that cannot be safely exported must not retain stale AI access.
      continue;
    }
    if (!markdown) {
      continue;
    }

    documents.push({
      accessVerified: true,
      allowedUserIds: access.allowedUserIds,
      docId: meta.id,
      markdown,
      source: sourceForDocument(title, markdown),
      title,
      updatedAt: isoDate(meta.updatedDate ?? meta.createDate),
      visibility: access.visibility,
    });
  }

  return documents;
}

export async function upsertWorkspaceContentDocuments(options: {
  documents: WorkspaceContentDocument[];
  replacement?: WorkspaceContentReplacement;
  workspaceId: string;
}) {
  if (!options.documents.length && !options.replacement) {
    return { indexed: 0, total: 0, workspaceId: options.workspaceId };
  }

  const response = await fetch('/v1/workspace/content/upsert', {
    body: JSON.stringify({
      documents: options.documents,
      replacement: options.replacement,
      workspaceId: options.workspaceId,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to index workspace content: ${response.status}`);
  }
  return (await response.json()) as {
    indexed: number;
    removed?: number;
    total: number;
    workspaceId: string;
  };
}

function createWorkspaceContentSyncId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export async function syncWorkspaceContentPages(options: {
  documents: WorkspaceContentDocument[];
  pageSize?: number;
  replaceWorkspace: boolean;
  requestedDocIds?: string[];
  syncId?: string;
  workspaceId: string;
}) {
  const requestedPageSize =
    options.pageSize ?? WORKSPACE_CONTENT_SYNC_PAGE_SIZE;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.floor(requestedPageSize))
    : WORKSPACE_CONTENT_SYNC_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(options.documents.length / pageSize));
  const syncId = options.replaceWorkspace
    ? (options.syncId ?? createWorkspaceContentSyncId())
    : undefined;
  let indexed = 0;
  let latest = {
    indexed: 0,
    total: 0,
    workspaceId: options.workspaceId,
  };

  if (!options.replaceWorkspace && options.requestedDocIds?.length) {
    const indexedDocIds = new Set(
      options.documents.map(document => document.docId)
    );
    const unreadableDocIds = options.requestedDocIds.filter(
      docId => !indexedDocIds.has(docId)
    );
    if (unreadableDocIds.length) {
      const deleted = await deleteWorkspaceContentDocuments({
        docIds: unreadableDocIds,
        workspaceId: options.workspaceId,
      });
      latest = {
        indexed: 0,
        total: deleted.total,
        workspaceId: deleted.workspaceId,
      };
    }
  }

  for (let page = 0; page < pageCount; page++) {
    const documents = options.documents.slice(
      page * pageSize,
      (page + 1) * pageSize
    );
    if (!documents.length && !options.replaceWorkspace) {
      continue;
    }
    latest = await upsertWorkspaceContentDocuments({
      documents,
      replacement:
        options.replaceWorkspace && syncId
          ? {
              complete: page === pageCount - 1,
              page,
              syncId,
            }
          : undefined,
      workspaceId: options.workspaceId,
    });
    indexed += latest.indexed;
  }

  return { ...latest, indexed };
}

export async function deleteWorkspaceContentDocuments(options: {
  docIds: string[];
  workspaceId: string;
}) {
  const docIds = options.docIds.map(docId => docId.trim()).filter(Boolean);
  if (!docIds.length) {
    return { removed: 0, total: 0, workspaceId: options.workspaceId };
  }

  const response = await fetch('/v1/workspace/content/delete', {
    body: JSON.stringify({
      docIds,
      workspaceId: options.workspaceId,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(
      `Failed to remove workspace content from index: ${response.status}`
    );
  }
  return (await response.json()) as {
    removed: number;
    total: number;
    workspaceId: string;
  };
}

async function performWorkspaceContentSync(
  options: WorkspaceContentSyncOptions
) {
  const documents = await buildWorkspaceDocuments(options);
  return syncWorkspaceContentPages({
    documents,
    replaceWorkspace: !options.documentIds,
    requestedDocIds: options.documentIds,
    workspaceId: options.workspaceId,
  });
}

export function syncWorkspaceContentIndex(
  options: WorkspaceContentSyncOptions
) {
  const previous =
    workspaceContentSyncQueues.get(options.workspaceId) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => performWorkspaceContentSync(options));
  const settled = current.then(
    () => {},
    () => {}
  );
  workspaceContentSyncQueues.set(options.workspaceId, settled);
  settled
    .finally(() => {
      if (workspaceContentSyncQueues.get(options.workspaceId) === settled) {
        workspaceContentSyncQueues.delete(options.workspaceId);
      }
    })
    .catch(() => {});
  return current;
}

export function startWorkspaceContentIndexSync(
  options: WorkspaceContentSyncOptions & {
    debounceMs?: number;
    intervalMs?: number;
    onError?: (error: unknown) => void;
  }
) {
  const debounceMs = options.debounceMs ?? 1200;
  const intervalMs = options.intervalMs ?? 60_000;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sync = async () => {
    try {
      await syncWorkspaceContentIndex(options);
    } catch (error) {
      if (!disposed) {
        options.onError?.(error);
      }
    }
  };
  const scheduleSync = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      sync().catch(() => {});
    }, debounceMs);
  };

  sync().catch(() => {});
  const subscription =
    options.workspace.slots.docListUpdated.subscribe(scheduleSync);
  const interval = setInterval(scheduleSync, intervalMs);

  return () => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
    }
    clearInterval(interval);
    subscription.unsubscribe();
  };
}
